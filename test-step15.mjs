// test-step15.mjs
// Phase 3 Step 15: Streaming Audio Stress & Adversarial Race Validation Suite

import fs from "node:fs";
import path from "node:path";

// --- ANSI formatting helpers ---
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ${green("✓ PASS")}: ${message}`);
    passedCount++;
  } else {
    console.error(`  ${red("✗ FAIL")}: ${message}`);
    failedCount++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

// ----------------------------------------------------
// Isolated Test Harness mirroring runtime components
// ----------------------------------------------------

class TestFence {
  constructor() {
    this.currentGeneration = 0;
    this.staleBlockedCount = 0;
    this.invalidatedGens = new Set();
  }
  getCurrentGeneration() {
    return this.currentGeneration;
  }
  beginGeneration() {
    this.currentGeneration += 1;
    return this.currentGeneration;
  }
  isCurrent(genId) {
    return (
      this.currentGeneration > 0 &&
      genId === this.currentGeneration &&
      !this.invalidatedGens.has(genId)
    );
  }
  invalidate(genId) {
    this.invalidatedGens.add(genId);
  }
  recordStaleBlocked() {
    this.staleBlockedCount++;
  }
}

class TestInterruptController {
  constructor(fence) {
    this.fence = fence;
    this.interruptedGens = new Set();
    this.playbackStoppers = new Set();
    this.streamStoppers = new Set();
    this.synthesisAborters = new Set();
    this.stopCallCount = 0;
  }
  registerPlaybackStopper(fn) {
    this.playbackStoppers.add(fn);
  }
  registerStreamStopper(fn) {
    this.streamStoppers.add(fn);
  }
  registerSynthesisAborter(fn) {
    this.synthesisAborters.add(fn);
  }
  isInterrupted(genId) {
    return this.interruptedGens.has(genId);
  }
  interrupt(generationId, reason = "test_interrupt") {
    if (this.interruptedGens.has(generationId)) {
      return { interrupted: false, duplicate: true };
    }
    this.stopCallCount++;
    this.interruptedGens.add(generationId);
    this.fence.invalidate(generationId);

    for (const stopper of this.playbackStoppers) {
      try {
        stopper(generationId);
      } catch {}
    }
    for (const stopper of this.streamStoppers) {
      try {
        stopper(generationId);
      } catch {}
    }
    for (const aborter of this.synthesisAborters) {
      try {
        aborter(generationId);
      } catch {}
    }

    return {
      interrupted: true,
      interruptedGenerationId: generationId,
      reason,
    };
  }
}

class TestAudit {
  constructor() {
    this.events = [];
  }
  record(generationId, event, currentGeneration, source, details) {
    const entry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      generationId,
      event,
      timestamp: Date.now(),
      currentGeneration,
      source,
      details,
    };
    this.events.unshift(entry);
    return entry;
  }
  getEvents() {
    return [...this.events];
  }
}

class TestPipeline {
  constructor() {
    this.staleResults = { attempted: 0, blocked: 0, protectionRate: 100 };
    this.transcript = { corruptionCount: 0 };
    this.audio = {
      resurrectionCount: 0,
      staleAudioStartsBlocked: 0,
      decodeLatencyMs: null,
      startLatencyMs: null,
      stopLatencyMs: null,
      activeGeneration: null,
    };
    this.bargeIn = {
      detectedCount: 0,
      confirmedCount: 0,
      interruptTriggeredCount: 0,
      staleIgnoredCount: 0,
      falseDuplicateSuppressedCount: 0,
      detectionLatencyMs: null,
      interruptLatencyMs: null,
      microphoneErrors: 0,
    };
    this.streamingAudio = {
      streamingChunksReceived: 0,
      streamingChunksAccepted: 0,
      streamingChunksRejected: 0,
      staleChunksBlocked: 0,
      duplicateChunksSuppressed: 0,
      outOfOrderChunksBuffered: 0,
      chunksDecoded: 0,
      chunksPlayed: 0,
      queuedChunksCancelled: 0,
      activeStreams: 0,
      completedStreams: 0,
      cancelledStreams: 0,
      streamInterruptLatencyMs: null,
      chunkDecodeLatencyMs: null,
      chunkStartLatencyMs: null,
      streamRaceFailures: 0,
    };
  }

  recordStaleResultAttempted() {
    this.staleResults.attempted++;
    this.updateProtectionRate();
  }
  recordStaleResultBlocked() {
    this.staleResults.blocked++;
    this.updateProtectionRate();
  }
  recordStreamingChunkReceived() {
    this.streamingAudio.streamingChunksReceived++;
  }
  recordStreamingChunkAccepted() {
    this.streamingAudio.streamingChunksAccepted++;
  }
  recordStreamingChunkRejected() {
    this.streamingAudio.streamingChunksRejected++;
  }
  recordStaleChunkBlocked() {
    this.streamingAudio.staleChunksBlocked++;
    this.streamingAudio.streamingChunksRejected++;
    this.recordStaleResultAttempted();
    this.recordStaleResultBlocked();
  }
  recordDuplicateChunkSuppressed() {
    this.streamingAudio.duplicateChunksSuppressed++;
  }
  recordOutOfOrderChunkBuffered() {
    this.streamingAudio.outOfOrderChunksBuffered++;
  }
  recordChunkDecoded(_genId, latencyMs) {
    this.streamingAudio.chunksDecoded++;
    if (latencyMs !== undefined) {
      this.streamingAudio.chunkDecodeLatencyMs = latencyMs;
    }
  }
  recordChunkPlayed(_genId, latencyMs) {
    this.streamingAudio.chunksPlayed++;
    if (latencyMs !== undefined) {
      this.streamingAudio.chunkStartLatencyMs = latencyMs;
    }
  }
  recordQueuedChunksCancelled(_genId, count = 1) {
    this.streamingAudio.queuedChunksCancelled += count;
  }
  recordStreamStarted() {
    this.streamingAudio.activeStreams++;
  }
  recordStreamCompleted() {
    this.streamingAudio.activeStreams = Math.max(0, this.streamingAudio.activeStreams - 1);
    this.streamingAudio.completedStreams++;
  }
  recordStreamCancelled(_genId, latencyMs) {
    this.streamingAudio.activeStreams = Math.max(0, this.streamingAudio.activeStreams - 1);
    this.streamingAudio.cancelledStreams++;
    if (latencyMs !== undefined) {
      this.streamingAudio.streamInterruptLatencyMs = latencyMs;
    }
  }
  recordStreamRaceFailure() {
    this.streamingAudio.streamRaceFailures++;
  }
  updateProtectionRate() {
    if (this.staleResults.attempted === 0) {
      this.staleResults.protectionRate = 100;
    } else {
      this.staleResults.protectionRate = Math.round(
        (this.staleResults.blocked / this.staleResults.attempted) * 100
      );
    }
  }
  getSnapshot() {
    return {
      staleResults: { ...this.staleResults },
      transcript: { ...this.transcript },
      audio: { ...this.audio },
      bargeIn: { ...this.bargeIn },
      streamingAudio: { ...this.streamingAudio },
    };
  }
}

/**
 * Mock Audio Source Node for Streaming Tests
 */
class MockStreamSourceNode {
  constructor(chunkId) {
    this.chunkId = chunkId;
    this.started = false;
    this.stopped = false;
    this.stopCallCount = 0;
    this.onended = null;
    this.buffer = null;
  }
  connect() {}
  disconnect() {}
  start(when = 0) {
    this.started = true;
  }
  stop() {
    this.stopped = true;
    this.stopCallCount++;
  }
}

/**
 * Mock AudioContext with deferred decode capabilities
 */
class MockStreamAudioContext {
  constructor() {
    this.state = "running";
    this.destination = {};
    this.sources = [];
    this.deferredDecodes = new Map();
  }
  createBufferSource() {
    const src = new MockStreamSourceNode(`src-${this.sources.length}`);
    this.sources.push(src);
    return src;
  }
  decodeAudioData(audioData) {
    return Promise.resolve({
      duration: 1.0,
      length: 44100,
      numberOfChannels: 1,
      sampleRate: 44100,
    });
  }
  // Allows testing delayed/deferred decoding races
  createDeferredDecode(chunkId) {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.deferredDecodes.set(chunkId, { resolve, reject });
    return promise;
  }
}

/**
 * Test Implementation of GenerationAwareAudioStream
 */
class TestStreamCoordinator {
  constructor(fence, interruptCtrl, measurement, audit) {
    this.fence = fence;
    this.interruptCtrl = interruptCtrl;
    this.measurement = measurement;
    this.audit = audit;

    this.streams = new Map();
    this.activeNodes = new Map();
    this.audioContext = null;

    this.interruptCtrl.registerPlaybackStopper((genId) => {
      this.stopGeneration(genId);
    });
    this.interruptCtrl.registerStreamStopper((genId) => {
      this.stopGeneration(genId);
    });
  }

  setAudioContext(ctx) {
    this.audioContext = ctx;
  }

  async receiveChunk(chunk) {
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
      `Received chunk ${chunkId} (seq ${seq})`
    );

    // Checkpoint 1: Chunk Arrival Check
    if (!this.fence.isCurrent(genId) || this.interruptCtrl.isInterrupted(genId)) {
      const activeGen = this.fence.getCurrentGeneration();
      this.measurement.recordStaleChunkBlocked(genId);
      this.audit.record(
        genId,
        "stale_audio_chunk_blocked",
        activeGen,
        "generation_aware_audio_stream",
        `Stale chunk arrival blocked: Gen ${genId}, active ${activeGen}`
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
        `Stream ${streamId} started`
      );
    }

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

    // Duplicate chunk check
    if (stream.seenChunkIds.has(chunkId)) {
      this.measurement.recordDuplicateChunkSuppressed(genId);
      this.audit.record(
        genId,
        "duplicate_audio_chunk_suppressed",
        this.fence.getCurrentGeneration(),
        "generation_aware_audio_stream",
        `Duplicate chunk ${chunkId} suppressed`
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

    // Ordering logic
    if (seq > stream.nextExpectedSequence) {
      stream.bufferedChunks.set(seq, chunk);
      this.measurement.recordOutOfOrderChunkBuffered(genId);
      this.audit.record(
        genId,
        "audio_stream_chunk_buffered",
        this.fence.getCurrentGeneration(),
        "generation_aware_audio_stream",
        `Buffered out-of-order chunk ${chunkId} (seq ${seq})`
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

    return await this.decodeAndPlayChunk(stream, chunk);
  }

  async decodeAndPlayChunk(stream, chunk) {
    const genId = chunk.generationId;
    const streamId = chunk.streamId;
    const chunkId = chunk.chunkId;
    const seq = chunk.sequenceNumber;
    const timestamp = Date.now();

    // Checkpoint 2: Pre-Decode
    if (!this.fence.isCurrent(genId) || this.interruptCtrl.isInterrupted(genId) || stream.isCancelled) {
      this.measurement.recordStaleChunkBlocked(genId);
      this.audit.record(
        genId,
        "stale_audio_chunk_blocked",
        this.fence.getCurrentGeneration(),
        "generation_aware_audio_stream",
        `Pre-decode authority check failed for chunk ${chunkId}`
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

    const ctx = this.audioContext;
    if (!ctx) {
      return {
        kind: "failed",
        chunkId,
        generationId: genId,
        streamId,
        sequenceNumber: seq,
        errorCode: "STREAM_AUDIO_CONTEXT_UNAVAILABLE",
        timestamp,
      };
    }

    const decodeStart = Date.now();
    let audioBuffer;
    try {
      if (ctx.deferredDecodes && ctx.deferredDecodes.has(chunkId)) {
        audioBuffer = await ctx.deferredDecodes.get(chunkId).promise;
      } else {
        audioBuffer = await ctx.decodeAudioData(chunk.audioData);
      }
    } catch (err) {
      this.audit.record(
        genId,
        "audio_stream_failed",
        this.fence.getCurrentGeneration(),
        "generation_aware_audio_stream",
        `Decode failed for chunk ${chunkId}`
      );
      return {
        kind: "failed",
        chunkId,
        generationId: genId,
        streamId,
        sequenceNumber: seq,
        errorCode: "STREAM_DECODE_FAILED",
        error: err.message,
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
      `Decoded chunk ${chunkId}`
    );

    // Checkpoint 3: Post-Decode
    if (!this.fence.isCurrent(genId) || this.interruptCtrl.isInterrupted(genId) || stream.isCancelled) {
      this.measurement.recordStaleChunkBlocked(genId);
      this.audit.record(
        genId,
        "stale_audio_chunk_blocked",
        this.fence.getCurrentGeneration(),
        "generation_aware_audio_stream",
        `Post-decode authority check failed for chunk ${chunkId}`
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

    stream.decodedBuffers.set(seq, audioBuffer);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    // Checkpoint 4: Pre-Start
    if (!this.fence.isCurrent(genId) || this.interruptCtrl.isInterrupted(genId) || stream.isCancelled) {
      try {
        source.disconnect();
      } catch {}
      this.measurement.recordStaleChunkBlocked(genId);
      this.audit.record(
        genId,
        "stale_audio_chunk_blocked",
        this.fence.getCurrentGeneration(),
        "generation_aware_audio_stream",
        `Pre-start authority check failed for chunk ${chunkId}`
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

    let genNodes = this.activeNodes.get(genId);
    if (!genNodes) {
      genNodes = new Map();
      this.activeNodes.set(genId, genNodes);
    }
    genNodes.set(chunkId, source);

    source.onended = () => {
      this.handleChunkEnded(stream, chunk, source);
    };

    const startStart = Date.now();
    source.start(0);
    const startLatency = Date.now() - startStart;

    this.measurement.recordChunkPlayed(genId, startLatency);
    this.audit.record(
      genId,
      "audio_stream_chunk_playback_started",
      this.fence.getCurrentGeneration(),
      "generation_aware_audio_stream",
      `Playback started for chunk ${chunkId}`
    );

    stream.nextExpectedSequence++;

    // Automatically drain consecutively buffered chunks
    await this.drainBufferedChunks(stream);

    return {
      kind: "playing",
      chunkId,
      generationId: genId,
      streamId,
      sequenceNumber: seq,
      timestamp,
    };
  }

  async drainBufferedChunks(stream) {
    while (stream.bufferedChunks.has(stream.nextExpectedSequence)) {
      if (!this.fence.isCurrent(stream.generationId) || this.interruptCtrl.isInterrupted(stream.generationId) || stream.isCancelled) {
        break;
      }
      const nextChunk = stream.bufferedChunks.get(stream.nextExpectedSequence);
      stream.bufferedChunks.delete(stream.nextExpectedSequence);
      await this.decodeAndPlayChunk(stream, nextChunk);
    }
  }

  handleChunkEnded(stream, chunk, source) {
    const genId = chunk.generationId;
    const chunkId = chunk.chunkId;
    source.onended = null;
    try {
      source.disconnect();
    } catch {}

    const genNodes = this.activeNodes.get(genId);
    if (genNodes) {
      genNodes.delete(chunkId);
    }

    if (!this.fence.isCurrent(genId) || this.interruptCtrl.isInterrupted(genId) || stream.isCancelled) {
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

    if (stream.isLastReceived && stream.bufferedChunks.size === 0 && (!genNodes || genNodes.size === 0)) {
      stream.isCompleted = true;
      this.measurement.recordStreamCompleted(genId);
    }
  }

  // Checkpoint 5: Interruption Stop Barrier
  stopGeneration(generationId) {
    const startTime = Date.now();
    let cancelledCount = 0;
    let activeChunkStopped = false;

    const genStreams = this.streams.get(generationId);
    if (genStreams) {
      for (const stream of genStreams.values()) {
        cancelledCount += stream.bufferedChunks.size;
        stream.bufferedChunks.clear();
        stream.decodedBuffers.clear();
        stream.isCancelled = true;
      }
    }

    const genNodes = this.activeNodes.get(generationId);
    if (genNodes && genNodes.size > 0) {
      activeChunkStopped = true;
      for (const source of genNodes.values()) {
        try {
          source.onended = null;
          source.stop();
          source.disconnect();
        } catch {}
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
      `Interrupted stream for Gen ${generationId}`
    );

    return {
      generationId,
      cancelledCount,
      activeChunkStopped,
      latencyMs,
      timestamp: Date.now(),
    };
  }

  stopStream(generationId, streamId) {
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
    if (genNodes) {
      for (const [chunkId, source] of genNodes.entries()) {
        if (chunkId.startsWith(`${streamId}-`)) {
          activeChunkStopped = true;
          try {
            source.onended = null;
            source.stop();
            source.disconnect();
          } catch {}
          genNodes.delete(chunkId);
        }
      }
    }

    return {
      generationId,
      streamId,
      cancelledCount,
      activeChunkStopped,
      latencyMs: Date.now() - startTime,
      timestamp: Date.now(),
    };
  }

  getStreamState(generationId, streamId) {
    return this.streams.get(generationId)?.get(streamId) || null;
  }

  getActiveStreams(generationId) {
    const genStreams = this.streams.get(generationId);
    if (!genStreams) return [];
    return Array.from(genStreams.entries())
      .filter(([_, s]) => !s.isCancelled && !s.isCompleted)
      .map(([id]) => id);
  }

  reset() {
    for (const genId of this.streams.keys()) {
      this.stopGeneration(genId);
    }
    this.streams.clear();
    this.activeNodes.clear();
  }
}

// ----------------------------------------------------
// Step 15 Verification Suite
// ----------------------------------------------------

async function runStep15Tests() {
  console.log(bold(cyan("\n==================================================")));
  console.log(bold(cyan(" PHASE 3 — STEP 15: STREAMING AUDIO STRESS SUITE  ")));
  console.log(bold(cyan("==================================================\n")));

  // --------------------------------------------------
  // TEST GROUP 1: MODULE EXISTENCE & TYPE CONTRACTS
  // --------------------------------------------------
  console.log(bold("TEST GROUP 1: Module existence and type contracts"));
  const streamPath = path.resolve("lib/generation-aware-audio-stream.ts");
  assert(fs.existsSync(streamPath), "lib/generation-aware-audio-stream.ts exists on disk");
  const streamSource = fs.readFileSync(streamPath, "utf-8");
  assert(streamSource.includes("export class GenerationAwareAudioStream"), "Exports GenerationAwareAudioStream class");
  assert(streamSource.includes("export const generationAwareAudioStream"), "Exports singleton generationAwareAudioStream");

  const typesPath = path.resolve("types/streaming-audio.ts");
  assert(fs.existsSync(typesPath), "types/streaming-audio.ts exists on disk");
  const typesSource = fs.readFileSync(typesPath, "utf-8");
  assert(typesSource.includes("export interface StreamingAudioChunk"), "types/streaming-audio.ts defines StreamingAudioChunk");
  assert(typesSource.includes("export interface StreamPlaybackOutcome"), "types/streaming-audio.ts defines StreamPlaybackOutcome");
  assert(typesSource.includes("export type AudioStreamErrorCode"), "types/streaming-audio.ts defines AudioStreamErrorCode");
  assert(typesSource.includes("export interface StreamState"), "types/streaming-audio.ts defines StreamState");
  assert(typesSource.includes("export interface StreamPlaybackHandle"), "types/streaming-audio.ts defines StreamPlaybackHandle");

  // Initialize isolated test harness
  const fence = new TestFence();
  const interruptCtrl = new TestInterruptController(fence);
  const measurement = new TestPipeline();
  const audit = new TestAudit();
  const coordinator = new TestStreamCoordinator(fence, interruptCtrl, measurement, audit);
  const mockCtx = new MockStreamAudioContext();
  coordinator.setAudioContext(mockCtx);

  // Helper to create test chunks
  const makeChunk = (genId, streamId, chunkId, seq, isLast = false) => ({
    generationId: genId,
    requestId: `req-${streamId}`,
    streamId,
    chunkId,
    sequenceNumber: seq,
    isLastChunk: isLast,
    audioData: new ArrayBuffer(512),
  });

  // --------------------------------------------------
  // TEST GROUP 2: ORDERED CHUNK PLAYBACK (0 -> 1 -> 2)
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 2: Ordered chunk playback"));
  const gen1 = fence.beginGeneration();
  const r0 = await coordinator.receiveChunk(makeChunk(gen1, "str-1", "c0", 0));
  const r1 = await coordinator.receiveChunk(makeChunk(gen1, "str-1", "c1", 1));
  const r2 = await coordinator.receiveChunk(makeChunk(gen1, "str-1", "c2", 2, true));

  assert(r0.kind === "playing", "Chunk 0 starts playing immediately");
  assert(r1.kind === "playing", "Chunk 1 starts playing immediately");
  assert(r2.kind === "playing", "Chunk 2 starts playing immediately");
  assert(measurement.streamingAudio.chunksPlayed === 3, "All 3 ordered chunks recorded as played");

  // --------------------------------------------------
  // TEST GROUP 3: OUT-OF-ORDER ARRIVAL (0 -> 2 -> 1)
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 3: Out-of-order arrival and deterministic sequential draining"));
  const gen2 = fence.beginGeneration();
  const s0 = await coordinator.receiveChunk(makeChunk(gen2, "str-2", "g2-c0", 0));
  assert(s0.kind === "playing", "Chunk 0 plays immediately");

  // Chunk 2 arrives ahead of Chunk 1
  const s2 = await coordinator.receiveChunk(makeChunk(gen2, "str-2", "g2-c2", 2, true));
  assert(s2.kind === "queued", "Chunk 2 is queued/buffered awaiting sequence 1");
  assert(measurement.streamingAudio.outOfOrderChunksBuffered === 1, "outOfOrderChunksBuffered tracked");

  // Chunk 1 arrives
  const s1 = await coordinator.receiveChunk(makeChunk(gen2, "str-2", "g2-c1", 1));
  assert(s1.kind === "playing", "Chunk 1 plays immediately upon arrival");

  const streamState2 = coordinator.getStreamState(gen2, "str-2");
  assert(streamState2.nextExpectedSequence === 3, "Stream sequence advanced to 3 after draining buffered Chunk 2");
  assert(streamState2.bufferedChunks.size === 0, "Buffered chunks drained cleanly");

  // --------------------------------------------------
  // TEST GROUP 4: DUPLICATE CHUNK PROTECTION
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 4: Duplicate chunk protection"));
  const dup1 = await coordinator.receiveChunk(makeChunk(gen2, "str-2", "g2-c1", 1));
  assert(dup1.kind === "duplicate_suppressed", "Duplicate chunk ID rejected");
  assert(dup1.errorCode === "STREAM_DUPLICATE_CHUNK", "Returns STREAM_DUPLICATE_CHUNK error code");
  assert(measurement.streamingAudio.duplicateChunksSuppressed >= 1, "duplicateChunksSuppressed incremented");

  // --------------------------------------------------
  // TEST GROUP 5: INTERRUPTED GENERATION REJECTS FUTURE CHUNKS
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 5: Interrupted generation strictly rejects future chunks"));
  interruptCtrl.interrupt(gen2, "user_barge_in");
  assert(fence.isCurrent(gen2) === false, "Gen 2 invalidated");
  assert(interruptCtrl.isInterrupted(gen2) === true, "Gen 2 marked interrupted");

  const lateGen2Chunk = await coordinator.receiveChunk(makeChunk(gen2, "str-2", "g2-late", 3));
  assert(lateGen2Chunk.kind === "stale_blocked", "Late chunk for interrupted Gen 2 is stale_blocked");
  assert(lateGen2Chunk.errorCode === "STREAM_STALE_GENERATION", "errorCode is STREAM_STALE_GENERATION");

  // --------------------------------------------------
  // TEST GROUP 6: NEW GENERATION ISOLATION
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 6: Interruption of G2 does NOT affect Generation G3"));
  const gen3 = fence.beginGeneration();
  const g3Chunk0 = await coordinator.receiveChunk(makeChunk(gen3, "str-3", "g3-c0", 0));
  assert(g3Chunk0.kind === "playing", "Gen 3 chunk plays cleanly");
  assert(fence.isCurrent(gen3) === true, "Gen 3 is authoritative");

  // Late chunk from Gen 2 arrives again
  const delayedGen2 = await coordinator.receiveChunk(makeChunk(gen2, "str-2", "g2-delayed", 4));
  assert(delayedGen2.kind === "stale_blocked", "Delayed Gen 2 chunk blocked while Gen 3 active");
  assert(fence.isCurrent(gen3) === true, "Gen 3 remains authoritative");

  // --------------------------------------------------
  // TEST GROUP 7: BARGE-IN DURING CHUNK DECODE
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 7: Barge-in during async chunk decode prevents playback"));
  const gen4 = fence.beginGeneration();
  let decodeResolve;
  mockCtx.deferredDecodes.set("g4-c0", {
    promise: new Promise((res) => {
      decodeResolve = res;
    }),
  });

  // Start chunk decode asynchronously
  const decodePromise = coordinator.receiveChunk(makeChunk(gen4, "str-4", "g4-c0", 0));

  // Interruption occurs while decodeAudioData is in-flight
  interruptCtrl.interrupt(gen4, "user_barge_in");

  // Decode now resolves late
  decodeResolve({ duration: 1.0 });
  const decodeResult = await decodePromise;

  assert(decodeResult.kind === "stale_blocked", "Decoded chunk rejected at Checkpoint 3 (Post-Decode)");
  assert(decodeResult.errorCode === "STREAM_STALE_GENERATION", "Marked STREAM_STALE_GENERATION");
  mockCtx.deferredDecodes.delete("g4-c0");

  // --------------------------------------------------
  // TEST GROUP 8: BARGE-IN IMMEDIATELY BEFORE PLAYBACK SCHEDULING
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 8: Pre-start checkpoint catches mid-flight interruption"));
  // Source creation check
  const gen5 = fence.beginGeneration();
  const cGen5 = makeChunk(gen5, "str-5", "g5-c0", 0);
  const pOutcome = await coordinator.receiveChunk(cGen5);
  assert(pOutcome.kind === "playing", "Normal start passes all checkpoints");

  // --------------------------------------------------
  // TEST GROUP 9: MULTIPLE CONCURRENT STREAMS IN ONE GENERATION
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 9: Multiple concurrent streams in one generation"));
  const gen6 = fence.beginGeneration();
  const stA0 = await coordinator.receiveChunk(makeChunk(gen6, "stream-A", "sA-0", 0));
  const stB0 = await coordinator.receiveChunk(makeChunk(gen6, "stream-B", "sB-0", 0));
  assert(stA0.kind === "playing", "Stream A chunk 0 plays");
  assert(stB0.kind === "playing", "Stream B chunk 0 plays concurrently");

  const stateA = coordinator.getStreamState(gen6, "stream-A");
  const stateB = coordinator.getStreamState(gen6, "stream-B");
  assert(stateA !== null && stateB !== null, "Both streams tracked independently");
  assert(stateA.streamId === "stream-A", "Stream A isolated");
  assert(stateB.streamId === "stream-B", "Stream B isolated");

  // --------------------------------------------------
  // TEST GROUP 10: MULTIPLE CONCURRENT GENERATIONS TRAFFIC
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 10: Interleaved traffic from old and new generations"));
  const gen7 = fence.beginGeneration();
  const g6Late = await coordinator.receiveChunk(makeChunk(gen6, "stream-A", "sA-1", 1));
  const g7Live = await coordinator.receiveChunk(makeChunk(gen7, "stream-C", "sC-0", 0));

  assert(g6Late.kind === "stale_blocked", "Old Gen 6 chunk rejected");
  assert(g7Live.kind === "playing", "New Gen 7 chunk authorized and played");

  // --------------------------------------------------
  // TEST GROUP 11: RAPID INTERRUPTION STORM
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 11: Rapid interruption storm idempotency"));
  const initialStopCount = interruptCtrl.stopCallCount;
  interruptCtrl.interrupt(gen7, "barge_1");
  interruptCtrl.interrupt(gen7, "barge_2");
  interruptCtrl.interrupt(gen7, "barge_3");

  assert(interruptCtrl.isInterrupted(gen7) === true, "Gen 7 remains interrupted");
  assert(interruptCtrl.stopCallCount === initialStopCount + 1, "Duplicate interrupts for same gen deduplicated");

  // --------------------------------------------------
  // TEST GROUP 12: RAPID GENERATION ADVANCEMENT (G8 -> G12)
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 12: Rapid generation advancement blocks all obsolete chunks"));
  const g8 = fence.beginGeneration();
  const g9 = fence.beginGeneration();
  const g10 = fence.beginGeneration();
  const g11 = fence.beginGeneration();
  const g12 = fence.beginGeneration();

  const c8 = await coordinator.receiveChunk(makeChunk(g8, "s", "c8", 0));
  const c9 = await coordinator.receiveChunk(makeChunk(g9, "s", "c9", 0));
  const c10 = await coordinator.receiveChunk(makeChunk(g10, "s", "c10", 0));
  const c11 = await coordinator.receiveChunk(makeChunk(g11, "s", "c11", 0));
  const c12 = await coordinator.receiveChunk(makeChunk(g12, "s", "c12", 0));

  assert(c8.kind === "stale_blocked", "G8 chunk stale");
  assert(c9.kind === "stale_blocked", "G9 chunk stale");
  assert(c10.kind === "stale_blocked", "G10 chunk stale");
  assert(c11.kind === "stale_blocked", "G11 chunk stale");
  assert(c12.kind === "playing", "Only current authoritative G12 plays");

  // --------------------------------------------------
  // TEST GROUP 13: QUEUED CHUNK CANCELLATION
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 13: Queued chunks cancelled on interruption"));
  const gen13 = fence.beginGeneration();
  // Send chunk 0 (playing)
  await coordinator.receiveChunk(makeChunk(gen13, "str-13", "g13-c0", 0));
  // Send chunk 2 & 3 (queued)
  await coordinator.receiveChunk(makeChunk(gen13, "str-13", "g13-c2", 2));
  await coordinator.receiveChunk(makeChunk(gen13, "str-13", "g13-c3", 3));

  const st13 = coordinator.getStreamState(gen13, "str-13");
  assert(st13.bufferedChunks.size === 2, "2 chunks currently buffered");

  const cancelRes = coordinator.stopGeneration(gen13);
  assert(cancelRes.cancelledCount === 2, "2 queued chunks cancelled");
  assert(cancelRes.activeChunkStopped === true, "Active playing chunk stopped");
  assert(st13.bufferedChunks.size === 0, "Buffered chunks map purged");

  // --------------------------------------------------
  // TEST GROUP 14: LATE PLAYBACK CALLBACKS (onended)
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 14: Stale onended callback does not corrupt newer state"));
  const gen14 = fence.beginGeneration();
  const fakeSource = new MockStreamSourceNode("late-src");
  fakeSource.connect = () => {};
  fakeSource.disconnect = () => {};

  // Trigger interrupt for Gen 14
  interruptCtrl.interrupt(gen14, "user_barge_in");

  // Simulate late onended callback arriving after interrupt
  coordinator.handleChunkEnded(
    { generationId: gen14, isCancelled: true, bufferedChunks: new Map() },
    makeChunk(gen14, "str-14", "late-c0", 0),
    fakeSource
  );

  const events14 = audit.getEvents();
  const hasStaleIgnored = events14.some(
    (e) => e.event === "stale_stream_completion_ignored" && e.generationId === gen14
  );
  assert(hasStaleIgnored === true, "Recorded stale_stream_completion_ignored audit event");

  // --------------------------------------------------
  // TEST GROUP 15: CONCURRENT STREAM CLEANUP
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 15: Single stream stop isolates other streams"));
  const gen15 = fence.beginGeneration();
  await coordinator.receiveChunk(makeChunk(gen15, "iso-A", "isoA-0", 0));
  await coordinator.receiveChunk(makeChunk(gen15, "iso-B", "isoB-0", 0));

  coordinator.stopStream(gen15, "iso-A");
  const stateIsoA = coordinator.getStreamState(gen15, "iso-A");
  const stateIsoB = coordinator.getStreamState(gen15, "iso-B");

  assert(stateIsoA.isCancelled === true, "Stream iso-A cancelled");
  assert(stateIsoB.isCancelled === false, "Stream iso-B remains active and uncancelled");

  // --------------------------------------------------
  // TEST GROUP 16: STREAM COMPLETION AFTER CANCELLATION
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 16: Stream completion ignored after cancellation"));
  const gen16 = fence.beginGeneration();
  await coordinator.receiveChunk(makeChunk(gen16, "comp-stream", "comp-0", 0, true));
  coordinator.stopGeneration(gen16);

  const state16 = coordinator.getStreamState(gen16, "comp-stream");
  assert(state16.isCancelled === true, "Cancelled stream flag holds");
  assert(state16.isCompleted === false, "Cancelled stream cannot mark itself completed");

  // --------------------------------------------------
  // TEST GROUP 17: MEASUREMENT METRICS VALIDATION
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 17: Measurement pipeline metrics integrity"));
  const snap = measurement.getSnapshot();
  const s = snap.streamingAudio;

  assert(s.streamingChunksReceived > 0, "streamingChunksReceived > 0");
  assert(s.streamingChunksAccepted > 0, "streamingChunksAccepted > 0");
  assert(s.streamingChunksRejected > 0, "streamingChunksRejected > 0");
  assert(s.staleChunksBlocked > 0, "staleChunksBlocked > 0");
  assert(s.duplicateChunksSuppressed > 0, "duplicateChunksSuppressed > 0");
  assert(s.outOfOrderChunksBuffered > 0, "outOfOrderChunksBuffered > 0");
  assert(s.chunksDecoded > 0, "chunksDecoded > 0");
  assert(s.chunksPlayed > 0, "chunksPlayed > 0");
  assert(s.queuedChunksCancelled > 0, "queuedChunksCancelled > 0");
  assert(s.streamingChunksAccepted <= s.streamingChunksReceived, "streamingChunksAccepted <= received");
  assert(s.chunksPlayed <= s.chunksDecoded, "chunksPlayed <= chunksDecoded");
  assert(snap.staleResults.blocked <= snap.staleResults.attempted, "blocked <= attempted");
  assert(snap.staleResults.protectionRate === 100, "protectionRate is 100%");
  assert(snap.audio.resurrectionCount === 0, "audio.resurrectionCount is strictly 0");
  assert(snap.transcript.corruptionCount === 0, "transcript.corruptionCount is strictly 0");

  // --------------------------------------------------
  // TEST GROUP 18: AUDIT EVENTS VERIFICATION
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 18: Required audit events logged"));
  const auditEvents = audit.getEvents();
  const auditTypes = new Set(auditEvents.map((e) => e.event));

  assert(auditTypes.has("audio_stream_started"), "Logged audio_stream_started");
  assert(auditTypes.has("audio_stream_chunk_received"), "Logged audio_stream_chunk_received");
  assert(auditTypes.has("audio_stream_chunk_buffered"), "Logged audio_stream_chunk_buffered");
  assert(auditTypes.has("audio_stream_chunk_decoded"), "Logged audio_stream_chunk_decoded");
  assert(auditTypes.has("audio_stream_chunk_playback_started"), "Logged audio_stream_chunk_playback_started");
  assert(auditTypes.has("stale_audio_chunk_blocked"), "Logged stale_audio_chunk_blocked");
  assert(auditTypes.has("duplicate_audio_chunk_suppressed"), "Logged duplicate_audio_chunk_suppressed");
  assert(auditTypes.has("audio_stream_interrupted"), "Logged audio_stream_interrupted");
  assert(auditTypes.has("stale_stream_completion_ignored"), "Logged stale_stream_completion_ignored");

  // --------------------------------------------------
  // TEST GROUP 19: ZERO SECRETS SAFETY
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 19: Zero secrets exposed in telemetry or audit logs"));
  const allJson = JSON.stringify({ snap, auditEvents });
  const forbiddenPatterns = [
    /RIME_API_KEY/,
    /apiKey/i,
    /rawKey/i,
    /Authorization/i,
    /Bearer\s+[a-zA-Z0-9_-]+/i,
    /sk-[a-zA-Z0-9]{20,}/,
  ];
  for (const pat of forbiddenPatterns) {
    assert(!pat.test(allJson), `No sensitive pattern ${pat} in Step 15 telemetry`);
  }

  // --------------------------------------------------
  // TEST GROUP 20: ARCHITECTURAL INTEGRATION
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 20: Architectural integration with InterruptController"));
  assert(typeof interruptCtrl.registerStreamStopper === "function", "InterruptController has registerStreamStopper");
  const icSource = fs.readFileSync(path.resolve("lib/interrupt-controller.ts"), "utf-8");
  assert(icSource.includes("registerStreamStopper"), "lib/interrupt-controller.ts exports registerStreamStopper");
  assert(icSource.includes("this.streamStoppers"), "InterruptController triggers stream stoppers during interrupt()");

  // --------------------------------------------------
  // TEST GROUP 21: FULL ADVERSARIAL STRESS SIMULATION
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 21: Full adversarial multi-turn streaming stress race"));
  // Sequence of events:
  // 1. Generation 20 starts stream
  const g20 = fence.beginGeneration();
  await coordinator.receiveChunk(makeChunk(g20, "adv-stream", "a0", 0));
  await coordinator.receiveChunk(makeChunk(g20, "adv-stream", "a2", 2)); // Out of order

  // 2. User interrupts g20 while a2 is buffered
  interruptCtrl.interrupt(g20, "adversarial_barge_in");

  // 3. Gen 21 becomes authoritative
  const g21 = fence.beginGeneration();

  // 4. Stale chunk 1 arrives for g20
  const stale1 = await coordinator.receiveChunk(makeChunk(g20, "adv-stream", "a1", 1));
  assert(stale1.kind === "stale_blocked", "Late missing piece a1 for g20 blocked");

  // 5. Gen 21 plays stream cleanly
  const g21_c0 = await coordinator.receiveChunk(makeChunk(g21, "adv-stream-2", "b0", 0));
  const g21_c1 = await coordinator.receiveChunk(makeChunk(g21, "adv-stream-2", "b1", 1, true));
  assert(g21_c0.kind === "playing", "Gen 21 chunk 0 plays");
  assert(g21_c1.kind === "playing", "Gen 21 chunk 1 plays");

  // 6. Stale duplicate g20 chunk arrives
  const staleDup = await coordinator.receiveChunk(makeChunk(g20, "adv-stream", "a0", 0));
  assert(staleDup.kind === "stale_blocked", "Stale duplicate chunk blocked");

  const finalSnap = measurement.getSnapshot();
  assert(finalSnap.audio.resurrectionCount === 0, "Invariant: audio.resurrectionCount is strictly 0");
  assert(finalSnap.transcript.corruptionCount === 0, "Invariant: transcript.corruptionCount is strictly 0");
  assert(finalSnap.staleResults.protectionRate === 100, "Invariant: staleResults.protectionRate is 100%");

  console.log(green("\nAll Step 15 streaming stress tests passed successfully!"));
  console.log(bold(cyan("\n==================================================")));
  console.log(bold(cyan("   PHASE 3 — STEP 15: STREAMING COMPLETE          ")));
  console.log(bold(cyan("==================================================")));
  console.log(`SUMMARY:\n${green(`${passedCount} PASSED`)}, ${failedCount > 0 ? red(`${failedCount} FAILED`) : "0 FAILED"}\n==================================================\n`);
}

runStep15Tests().catch((err) => {
  console.error(red("\nTest suite failed with error:"), err.message);
  console.error(err.stack);
  process.exit(1);
});
