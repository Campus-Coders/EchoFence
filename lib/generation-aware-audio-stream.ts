import type { GenerationId } from "@/types/generation";
import type {
  StreamingAudioChunk,
  StreamPlaybackOutcome,
  StreamCancellationOutcome,
  StreamState,
  StreamPlaybackHandle,
} from "@/types/streaming-audio";
import { generationFence, GenerationFence } from "./generation-fence";
import { interruptController, InterruptController } from "./interrupt-controller";
import { measurementPipeline, MeasurementPipeline } from "./measurement-pipeline";
import { generationAudit, GenerationAuditLog } from "./generation-audit";

/**
 * GenerationAwareAudioStream coordinates multi-chunk streaming audio playback
 * under strict generation fencing.
 *
 * Enforces:
 * - STREAM ARRIVAL ORDER != PLAYBACK AUTHORITY
 * - MORE AUDIO CHUNKS != MORE PERMISSION TO PLAY
 * - INTERRUPTED GENERATION != ALLOWED TO RESURRECT
 * - CONCURRENT REQUESTS != SHARED OWNERSHIP
 *
 * Five Mandatory Authority Checkpoints:
 * 1. Chunk Arrival Checkpoint
 * 2. Pre-Decode Authority Checkpoint
 * 3. Post-Decode Authority Checkpoint
 * 4. Pre-Start Authority Checkpoint
 * 5. Generation-Scoped Interruption Stop Barrier
 */
export class GenerationAwareAudioStream {
  // Nested hierarchy: generationId -> streamId -> StreamState
  private streams: Map<GenerationId, Map<string, StreamState>> = new Map();
  // Active playing audio source nodes: generationId -> chunkId -> SourceNode
  private activeNodes: Map<GenerationId, Map<string, AudioBufferSourceNode>> = new Map();
  private audioContext: AudioContext | null = null;
  private customAudioContext: any = null;

  constructor(
    private fence: GenerationFence = generationFence,
    private interruptCtrl: InterruptController = interruptController,
    private measurement: MeasurementPipeline = measurementPipeline,
    private audit: GenerationAuditLog = generationAudit
  ) {
    // Register generation-aware stream stoppers with InterruptController
    this.interruptCtrl.registerPlaybackStopper((genId) => {
      this.stopGeneration(genId);
    });
    this.interruptCtrl.registerStreamStopper((genId) => {
      this.stopGeneration(genId);
    });
  }

  /**
   * Sets mock AudioContext for deterministic testing in Node.js / headless environments.
   */
  public setAudioContextForTesting(ctx: any): void {
    this.customAudioContext = ctx;
  }

  /**
   * Lazy initializes Web AudioContext with SSR safety.
   */
  private async getOrCreateAudioContext(): Promise<AudioContext | null> {
    if (this.customAudioContext) {
      return this.customAudioContext;
    }

    if (typeof window === "undefined") {
      return null;
    }

    if (!this.audioContext || this.audioContext.state === "closed") {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      if (!AudioCtxClass) {
        return null;
      }

      this.audioContext = new AudioCtxClass();
    }

    if (this.audioContext.state === "suspended") {
      try {
        await this.audioContext.resume();
      } catch {
        // Handled downstream
      }
    }

    return this.audioContext;
  }

  /**
   * Receives an audio stream chunk, verifies authority, manages sequencing,
   * buffers out-of-order chunks, and plays in-order authoritative chunks.
   */
  public async receiveChunk(chunk: StreamingAudioChunk): Promise<StreamPlaybackOutcome> {
    const timestamp = chunk.timestamp || Date.now();
    const genId = chunk.generationId;
    const streamId = chunk.streamId;
    const chunkId = chunk.chunkId;
    const seq = chunk.sequenceNumber;

    this.measurement.recordStreamingChunkReceived(genId);
    this.audit.record(
      genId,
      "audio_stream_chunk_received",
      this.fence.getCurrentGeneration(),
      "generation_aware_audio_stream",
      `Received chunk ${chunkId} (seq ${seq}) for stream ${streamId}`
    );

    // =========================================================================
    // CHECKPOINT 1: CHUNK ARRIVAL AUTHORITY CHECK
    // =========================================================================
    if (!this.fence.isCurrent(genId) || this.interruptCtrl.isInterrupted(genId)) {
      const activeGen = this.fence.getCurrentGeneration();
      this.measurement.recordStaleChunkBlocked(genId);
      this.audit.record(
        genId,
        "stale_audio_chunk_blocked",
        activeGen,
        "generation_aware_audio_stream",
        `Stale chunk arrival blocked: chunk belongs to Gen ${genId}, active Gen is ${activeGen}`
      );
      return {
        kind: "stale_blocked",
        chunkId,
        generationId: genId,
        streamId,
        sequenceNumber: seq,
        errorCode: "STREAM_STALE_GENERATION",
        timestamp,
      };
    }

    this.measurement.recordStreamingChunkAccepted(genId);

    // Acquire or initialize stream state for this generation
    let genStreams = this.streams.get(genId);
    if (!genStreams) {
      genStreams = new Map();
      this.streams.set(genId, genStreams);
    }

    let stream = genStreams.get(streamId);
    if (!stream) {
      stream = {
        generationId: genId,
        requestId: chunk.requestId,
        streamId,
        nextExpectedSequence: 0,
        bufferedChunks: new Map(),
        decodedBuffers: new Map(),
        seenChunkIds: new Set(),
        activeHandle: null,
        isLastReceived: false,
        isCompleted: false,
        isCancelled: false,
        startedAt: timestamp,
      };
      genStreams.set(streamId, stream);
      this.measurement.recordStreamStarted(genId);
      this.audit.record(
        genId,
        "audio_stream_started",
        this.fence.getCurrentGeneration(),
        "generation_aware_audio_stream",
        `Stream ${streamId} started for Gen ${genId}`
      );
    }

    // If stream was cancelled, reject chunk
    if (stream.isCancelled) {
      this.measurement.recordStaleChunkBlocked(genId);
      return {
        kind: "cancelled",
        chunkId,
        generationId: genId,
        streamId,
        sequenceNumber: seq,
        errorCode: "STREAM_CANCELLED",
        timestamp,
      };
    }

    // =========================================================================
    // DUPLICATE CHUNK PROTECTION
    // =========================================================================
    if (stream.seenChunkIds.has(chunkId)) {
      this.measurement.recordDuplicateChunkSuppressed(genId);
      this.audit.record(
        genId,
        "duplicate_audio_chunk_suppressed",
        this.fence.getCurrentGeneration(),
        "generation_aware_audio_stream",
        `Duplicate chunk ${chunkId} suppressed for stream ${streamId}`
      );
      return {
        kind: "duplicate_suppressed",
        chunkId,
        generationId: genId,
        streamId,
        sequenceNumber: seq,
        errorCode: "STREAM_DUPLICATE_CHUNK",
        timestamp,
      };
    }

    stream.seenChunkIds.add(chunkId);
    if (chunk.isLastChunk) {
      stream.isLastReceived = true;
    }

    // =========================================================================
    // ORDERING AND SEQUENCING LOGIC
    // =========================================================================
    if (seq > stream.nextExpectedSequence) {
      // Chunk arrived ahead of its turn (out-of-order) -> buffer it deterministically
      stream.bufferedChunks.set(seq, chunk);
      this.measurement.recordOutOfOrderChunkBuffered(genId);
      this.audit.record(
        genId,
        "audio_stream_chunk_buffered",
        this.fence.getCurrentGeneration(),
        "generation_aware_audio_stream",
        `Buffered out-of-order chunk ${chunkId} (seq ${seq}, expected ${stream.nextExpectedSequence})`
      );
      return {
        kind: "queued",
        chunkId,
        generationId: genId,
        streamId,
        sequenceNumber: seq,
        timestamp,
      };
    }

    if (seq < stream.nextExpectedSequence) {
      // Chunk sequence is behind current playback head -> duplicate or already passed
      this.measurement.recordDuplicateChunkSuppressed(genId);
      return {
        kind: "duplicate_suppressed",
        chunkId,
        generationId: genId,
        streamId,
        sequenceNumber: seq,
        errorCode: "STREAM_DUPLICATE_CHUNK",
        timestamp,
      };
    }

    // seq === stream.nextExpectedSequence: this is the expected chunk!
    return await this.decodeAndPlayChunk(stream, chunk);
  }

  /**
   * Internal decode and playback pipeline passing Checkpoints 2, 3, and 4.
   */
  private async decodeAndPlayChunk(
    stream: StreamState,
    chunk: StreamingAudioChunk
  ): Promise<StreamPlaybackOutcome> {
    const genId = chunk.generationId;
    const streamId = chunk.streamId;
    const chunkId = chunk.chunkId;
    const seq = chunk.sequenceNumber;
    const timestamp = Date.now();

    // =========================================================================
    // CHECKPOINT 2: PRE-DECODE AUTHORITY CHECK
    // =========================================================================
    if (
      !this.fence.isCurrent(genId) ||
      this.interruptCtrl.isInterrupted(genId) ||
      stream.isCancelled
    ) {
      this.measurement.recordStaleChunkBlocked(genId);
      this.audit.record(
        genId,
        "stale_audio_chunk_blocked",
        this.fence.getCurrentGeneration(),
        "generation_aware_audio_stream",
        `Pre-decode authority check failed for chunk ${chunkId} (Gen ${genId})`
      );
      return {
        kind: "stale_blocked",
        chunkId,
        generationId: genId,
        streamId,
        sequenceNumber: seq,
        errorCode: "STREAM_STALE_GENERATION",
        timestamp,
      };
    }

    const ctx = await this.getOrCreateAudioContext();
    if (!ctx) {
      this.audit.record(
        genId,
        "audio_stream_failed",
        this.fence.getCurrentGeneration(),
        "generation_aware_audio_stream",
        "AudioContext unavailable for stream decode"
      );
      return {
        kind: "failed",
        chunkId,
        generationId: genId,
        streamId,
        sequenceNumber: seq,
        errorCode: "STREAM_AUDIO_CONTEXT_UNAVAILABLE",
        error: "AudioContext is unavailable in this environment",
        timestamp,
      };
    }

    // Perform decode
    const decodeStart = Date.now();
    let audioBuffer: AudioBuffer;
    try {
      if (typeof ctx.decodeAudioData === "function") {
        const copyBuffer = chunk.audioData.slice ? chunk.audioData.slice(0) : chunk.audioData;
        audioBuffer = await ctx.decodeAudioData(copyBuffer);
      } else {
        throw new Error("decodeAudioData not implemented on AudioContext");
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Decode failed";
      this.audit.record(
        genId,
        "audio_stream_failed",
        this.fence.getCurrentGeneration(),
        "generation_aware_audio_stream",
        `Decode failed for chunk ${chunkId}: ${errorMsg}`
      );
      return {
        kind: "failed",
        chunkId,
        generationId: genId,
        streamId,
        sequenceNumber: seq,
        errorCode: "STREAM_DECODE_FAILED",
        error: errorMsg,
        timestamp,
      };
    }

    const decodeLatency = Date.now() - decodeStart;
    this.measurement.recordChunkDecoded(genId, decodeLatency);
    this.audit.record(
      genId,
      "audio_stream_chunk_decoded",
      this.fence.getCurrentGeneration(),
      "generation_aware_audio_stream",
      `Decoded chunk ${chunkId} in ${decodeLatency}ms`
    );

    // =========================================================================
    // CHECKPOINT 3: POST-DECODE AUTHORITY CHECK (Async race barrier)
    // =========================================================================
    if (
      !this.fence.isCurrent(genId) ||
      this.interruptCtrl.isInterrupted(genId) ||
      stream.isCancelled
    ) {
      this.measurement.recordStaleChunkBlocked(genId);
      this.audit.record(
        genId,
        "stale_audio_chunk_blocked",
        this.fence.getCurrentGeneration(),
        "generation_aware_audio_stream",
        `Post-decode authority check failed for chunk ${chunkId} (Gen ${genId})`
      );
      return {
        kind: "stale_blocked",
        chunkId,
        generationId: genId,
        streamId,
        sequenceNumber: seq,
        errorCode: "STREAM_STALE_GENERATION",
        timestamp,
      };
    }

    // Store decoded buffer
    stream.decodedBuffers.set(seq, audioBuffer);

    // Create source node
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    if (typeof source.connect === "function") {
      source.connect(ctx.destination);
    }

    // =========================================================================
    // CHECKPOINT 4: PRE-START AUTHORITY CHECK
    // =========================================================================
    if (
      !this.fence.isCurrent(genId) ||
      this.interruptCtrl.isInterrupted(genId) ||
      stream.isCancelled
    ) {
      try {
        source.disconnect();
      } catch {
        // Ignored
      }
      this.measurement.recordStaleChunkBlocked(genId);
      this.audit.record(
        genId,
        "stale_audio_chunk_blocked",
        this.fence.getCurrentGeneration(),
        "generation_aware_audio_stream",
        `Pre-start authority check failed for chunk ${chunkId} (Gen ${genId})`
      );
      return {
        kind: "stale_blocked",
        chunkId,
        generationId: genId,
        streamId,
        sequenceNumber: seq,
        errorCode: "STREAM_STALE_GENERATION",
        timestamp,
      };
    }

    // Register active source node
    let genNodes = this.activeNodes.get(genId);
    if (!genNodes) {
      genNodes = new Map();
      this.activeNodes.set(genId, genNodes);
    }
    genNodes.set(chunkId, source);

    const handle: StreamPlaybackHandle = {
      chunkId,
      generationId: genId,
      streamId,
      sequenceNumber: seq,
      sourceNode: source,
      startedAt: Date.now(),
      stopped: false,
    };
    stream.activeHandle = handle;

    // Attach completion handler
    source.onended = () => {
      this.handleChunkEnded(stream, chunk, source);
    };

    // Start playback
    const startStart = Date.now();
    try {
      source.start(0);
    } catch (startErr: unknown) {
      genNodes.delete(chunkId);
      const errorMsg = startErr instanceof Error ? startErr.message : "source.start failed";
      this.audit.record(
        genId,
        "audio_stream_failed",
        this.fence.getCurrentGeneration(),
        "generation_aware_audio_stream",
        `source.start() failed for chunk ${chunkId}: ${errorMsg}`
      );
      return {
        kind: "failed",
        chunkId,
        generationId: genId,
        streamId,
        sequenceNumber: seq,
        errorCode: "STREAM_START_FAILED",
        error: errorMsg,
        timestamp,
      };
    }

    const startLatency = Date.now() - startStart;
    this.measurement.recordChunkPlayed(genId, startLatency);
    this.audit.record(
      genId,
      "audio_stream_chunk_playback_started",
      this.fence.getCurrentGeneration(),
      "generation_aware_audio_stream",
      `Playback started for chunk ${chunkId} (seq ${seq})`
    );

    // Advance sequence pointer
    stream.nextExpectedSequence++;

    // Drain any consecutively buffered subsequent chunks
    this.drainBufferedChunks(stream);

    return {
      kind: "playing",
      chunkId,
      generationId: genId,
      streamId,
      sequenceNumber: seq,
      timestamp,
    };
  }

  /**
   * Asynchronously drains contiguous buffered chunks.
   */
  private async drainBufferedChunks(stream: StreamState): Promise<void> {
    while (stream.bufferedChunks.has(stream.nextExpectedSequence)) {
      if (
        !this.fence.isCurrent(stream.generationId) ||
        this.interruptCtrl.isInterrupted(stream.generationId) ||
        stream.isCancelled
      ) {
        break;
      }
      const nextChunk = stream.bufferedChunks.get(stream.nextExpectedSequence)!;
      stream.bufferedChunks.delete(stream.nextExpectedSequence);
      await this.decodeAndPlayChunk(stream, nextChunk);
    }
  }

  /**
   * Handles chunk playback completion. Guards against late callbacks.
   */
  private handleChunkEnded(
    stream: StreamState,
    chunk: StreamingAudioChunk,
    source: AudioBufferSourceNode
  ): void {
    const genId = chunk.generationId;
    const chunkId = chunk.chunkId;

    // Detach and disconnect node
    source.onended = null;
    try {
      source.disconnect();
    } catch {
      // Ignored
    }

    const genNodes = this.activeNodes.get(genId);
    if (genNodes) {
      genNodes.delete(chunkId);
    }

    // Guard: If generation was superseded or interrupted, late onended must not mutate state!
    if (
      !this.fence.isCurrent(genId) ||
      this.interruptCtrl.isInterrupted(genId) ||
      stream.isCancelled
    ) {
      this.audit.record(
        genId,
        "stale_stream_completion_ignored",
        this.fence.getCurrentGeneration(),
        "generation_aware_audio_stream",
        `Stale onended callback for chunk ${chunkId} ignored`
      );
      return;
    }

    this.audit.record(
      genId,
      "audio_stream_chunk_playback_completed",
      this.fence.getCurrentGeneration(),
      "generation_aware_audio_stream",
      `Chunk ${chunkId} finished playing`
    );

    // Check if entire stream completed
    if (stream.isLastReceived && stream.bufferedChunks.size === 0 && (!genNodes || genNodes.size === 0)) {
      stream.isCompleted = true;
      this.measurement.recordStreamCompleted(genId);
    }
  }

  /**
   * =========================================================================
   * CHECKPOINT 5: GENERATION-SCOPED INTERRUPTION STOP BARRIER
   * =========================================================================
   * Halts active audio, purges buffered/queued chunks, and marks streams cancelled
   * strictly for the specified generationId.
   *
   * Generation N+1 is completely unaffected.
   */
  public stopGeneration(generationId: GenerationId): StreamCancellationOutcome {
    const startTime = Date.now();
    let cancelledCount = 0;
    let activeChunkStopped = false;

    // 1. Cancel queued and buffered chunks for this generation
    const genStreams = this.streams.get(generationId);
    if (genStreams) {
      for (const [_streamId, stream] of genStreams.entries()) {
        cancelledCount += stream.bufferedChunks.size;
        stream.bufferedChunks.clear();
        stream.decodedBuffers.clear();
        stream.isCancelled = true;
      }
    }

    // 2. Stop and detach all active source nodes strictly for this generation
    const genNodes = this.activeNodes.get(generationId);
    if (genNodes && genNodes.size > 0) {
      activeChunkStopped = true;
      for (const [_chunkId, source] of genNodes.entries()) {
        try {
          source.onended = null;
          source.stop();
          source.disconnect();
        } catch {
          // Idempotent stop
        }
      }
      genNodes.clear();
      this.activeNodes.delete(generationId);
    }

    const latencyMs = Date.now() - startTime;
    this.measurement.recordQueuedChunksCancelled(generationId, cancelledCount);
    this.measurement.recordStreamCancelled(generationId, latencyMs);

    this.audit.record(
      generationId,
      "audio_stream_interrupted",
      this.fence.getCurrentGeneration(),
      "generation_aware_audio_stream",
      `Interrupted stream for Gen ${generationId}: stopped active nodes, cancelled ${cancelledCount} queued chunks`
    );

    return {
      generationId,
      cancelledCount,
      activeChunkStopped,
      latencyMs,
      timestamp: Date.now(),
    };
  }

  /**
   * Stops a specific stream within a generation.
   */
  public stopStream(
    generationId: GenerationId,
    streamId: string
  ): StreamCancellationOutcome {
    const startTime = Date.now();
    let cancelledCount = 0;
    let activeChunkStopped = false;

    const genStreams = this.streams.get(generationId);
    const stream = genStreams?.get(streamId);
    if (stream) {
      cancelledCount += stream.bufferedChunks.size;
      stream.bufferedChunks.clear();
      stream.decodedBuffers.clear();
      stream.isCancelled = true;
    }

    const genNodes = this.activeNodes.get(generationId);
    if (stream?.activeHandle?.chunkId && genNodes?.has(stream.activeHandle.chunkId)) {
      activeChunkStopped = true;
      const src = genNodes.get(stream.activeHandle.chunkId)!;
      try {
        src.onended = null;
        src.stop();
        src.disconnect();
      } catch {
        // Ignored
      }
      genNodes.delete(stream.activeHandle.chunkId);
    }

    const latencyMs = Date.now() - startTime;
    return {
      generationId,
      streamId,
      cancelledCount,
      activeChunkStopped,
      latencyMs,
      timestamp: Date.now(),
    };
  }

  /**
   * Halts all streams across all generations.
   */
  public stopAll(): void {
    for (const genId of this.streams.keys()) {
      this.stopGeneration(genId);
    }
    for (const genId of this.activeNodes.keys()) {
      this.stopGeneration(genId);
    }
  }

  /**
   * Inspects stream state (for testing and telemetry).
   */
  public getStreamState(
    generationId: GenerationId,
    streamId: string
  ): StreamState | null {
    return this.streams.get(generationId)?.get(streamId) ?? null;
  }

  /**
   * Gets list of active stream IDs for a generation.
   */
  public getActiveStreams(generationId?: GenerationId): string[] {
    const targetGen = generationId ?? this.fence.getCurrentGeneration();
    const genStreams = this.streams.get(targetGen);
    if (!genStreams) {
      return [];
    }
    return Array.from(genStreams.entries())
      .filter(([_id, s]) => !s.isCancelled && !s.isCompleted)
      .map(([id]) => id);
  }

  /**
   * Returns active streaming audio node count across all generations.
   */
  public getActiveNodeCount(): number {
    let count = 0;
    for (const genNodes of this.activeNodes.values()) {
      count += genNodes.size;
    }
    return count;
  }

  /**
   * Returns active stream count belonging to superseded generations (< currentGen).
   */
  public getStaleStreamCount(currentGen: GenerationId): number {
    let stale = 0;
    for (const [genId, genStreams] of this.streams) {
      if (genId < currentGen) {
        for (const stream of genStreams.values()) {
          if (!stream.isCancelled && !stream.isCompleted) {
            stale++;
          }
        }
      }
    }
    return stale;
  }

  /**
   * Resets all internal streaming state.
   */
  public reset(): void {
    this.stopAll();
    this.streams.clear();
    this.activeNodes.clear();
    this.customAudioContext = null;
  }
}

export const generationAwareAudioStream = new GenerationAwareAudioStream();
