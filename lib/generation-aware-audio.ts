/**
 * lib/generation-aware-audio.ts
 * Generation-Aware Browser Audio Playback Layer.
 *
 * Implements the core EchoFence playback authority principle:
 *   ASYNC AUDIO ARRIVAL != PLAYBACK AUTHORITY
 *   STARTING PLAYBACK != PERMANENT PERMISSION TO CONTINUE PLAYING
 *
 * Enforces mandatory checkpoints at:
 *   Checkpoint 1: Pre-flight check before audio decoding
 *   Checkpoint 2: Post-decode check after asynchronous decodeAudioData()
 *   Checkpoint 3: Pre-start check immediately before source.start()
 *   Checkpoint 4: Interruption stop barrier with generation isolation
 *
 * Invariants:
 *   - audio.resurrectionCount === 0
 *   - GenerationFence is the single authority of truth
 *   - Provider results are untrusted until authorized by GenerationAwareSynthesis
 *   - Consumes ONLY AuthorizedSynthesisResult objects
 *   - Playback handles isolated by generationId + requestId
 */

import { generationFence, type GenerationFence } from "./generation-fence";
import { generationAudit } from "./generation-audit";
import { measurementPipeline, type MeasurementPipeline } from "./measurement-pipeline";
import { interruptController, type InterruptController } from "./interrupt-controller";
import type {
  AuthorizedSynthesisResult,
  AudioPlaybackOutcome,
  AudioPlaybackErrorCode,
  PlaybackHandle,
} from "@/types/provider";
import type { AudioStopResult } from "@/types/interrupt";

export type { AudioPlaybackErrorCode, AudioPlaybackOutcome, PlaybackHandle };

export class GenerationAwareAudio {
  private audioContext: AudioContext | null = null;
  private customAudioContext: AudioContext | null = null;
  private activePlaybacks: Map<number, Map<string, PlaybackHandle>> = new Map();

  constructor(
    private fence: GenerationFence = generationFence,
    private interruptCtrl: InterruptController = interruptController,
    private measurement: MeasurementPipeline = measurementPipeline,
    private audit = generationAudit
  ) {
    // Register generation-specific audio playback stopper with InterruptController
    this.interruptCtrl.registerPlaybackStopper((genId: number) => {
      this.stopGeneration(genId, "INTERRUPTED");
    });
  }

  /**
   * Sets or overrides the AudioContext for automated testing / headless environments.
   */
  public setAudioContextForTesting(ctx: AudioContext | null): void {
    this.customAudioContext = ctx;
  }

  /**
   * Returns the active AudioContext instance if available.
   */
  public getAudioContext(): AudioContext | null {
    return this.customAudioContext || this.audioContext;
  }

  /**
   * Lazily obtains or creates an AudioContext.
   * Safe for server-side rendering (returns null if window/AudioContext is unavailable).
   */
  private getOrCreateAudioContext(): AudioContext | null {
    if (this.customAudioContext) {
      return this.customAudioContext;
    }

    if (typeof window === "undefined") {
      return null;
    }

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass) {
      return null;
    }

    if (!this.audioContext || this.audioContext.state === "closed") {
      try {
        this.audioContext = new AudioContextClass();
      } catch (err) {
        console.warn("[generation-aware-audio] Failed to instantiate AudioContext:", err);
        return null;
      }
    }

    return this.audioContext;
  }

  /**
   * Principled browser audio unlock method.
   * Invoked synchronously within trusted user gesture handlers (Click to Talk, Demo Controls)
   * to initialize and resume the Web Audio AudioContext so that subsequent async speech synthesis
   * can play without hitting Chrome's transient user activation expiry.
   */
  public async ensureAudioUnlocked(): Promise<boolean> {
    const ctx = this.getOrCreateAudioContext();
    if (!ctx) return false;
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch (err) {
        console.warn("[generation-aware-audio] AudioContext resume failed:", err);
        return false;
      }
    }
    return ctx.state === "running";
  }

  /**
   * Primary Playback Method:
   * Consumes ONLY AuthorizedSynthesisResult from Step 12.
   * Enforces all 3 pre-playback generation checkpoints.
   */
  public async playAuthorizedAudio(
    authorized: AuthorizedSynthesisResult
  ): Promise<AudioPlaybackOutcome> {
    const timestamp = Date.now();

    // 0. Authorization Contract Validation
    if (!authorized || authorized.authorized !== true || !authorized.audioBuffer) {
      const genId = authorized?.generationId || 0;
      const reqId = authorized?.requestId || `invalid-${timestamp}`;
      this.handleStaleAttempt(genId, reqId, "UNAUTHORIZED_INPUT");
      return {
        kind: "blocked",
        generationId: genId,
        requestId: reqId,
        reason: "UNAUTHORIZED_INPUT",
        blockedAt: timestamp,
        activeGeneration: this.fence.getCurrentGeneration(),
      };
    }

    const { generationId, requestId, audioBuffer } = authorized;

    // CHECKPOINT 1 — BEFORE DECODING
    if (!this.fence.isCurrent(generationId) || this.interruptCtrl.isInterrupted(generationId)) {
      this.handleStaleAttempt(generationId, requestId, "PRE_PLAYBACK_STALE");
      return {
        kind: "blocked",
        generationId,
        requestId,
        reason: "PRE_PLAYBACK_STALE",
        blockedAt: Date.now(),
        activeGeneration: this.fence.getCurrentGeneration(),
      };
    }

    // Acquire AudioContext
    const ctx = this.getOrCreateAudioContext();
    if (!ctx) {
      const errOutcome: AudioPlaybackOutcome = {
        kind: "failed",
        generationId,
        requestId,
        errorCode: "AUDIO_CONTEXT_UNAVAILABLE",
        error: "AudioContext is not available in this environment",
        failedAt: Date.now(),
      };
      this.audit.record(
        generationId,
        "audio_playback_failed",
        this.fence.getCurrentGeneration(),
        "generation_aware_audio",
        `Playback failed: ${errOutcome.error}`
      );
      return errOutcome;
    }

    // Handle suspended AudioContext (e.g. browser autoplay restrictions)
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch (resumeErr: unknown) {
        const errorMsg =
          resumeErr instanceof Error ? resumeErr.message : "AudioContext resume rejected";
        const errOutcome: AudioPlaybackOutcome = {
          kind: "failed",
          generationId,
          requestId,
          errorCode: "AUDIO_CONTEXT_RESUME_FAILED",
          error: errorMsg,
          failedAt: Date.now(),
        };
        this.audit.record(
          generationId,
          "audio_playback_failed",
          this.fence.getCurrentGeneration(),
          "generation_aware_audio",
          `AudioContext resume failed: ${errorMsg}`
        );
        return errOutcome;
      }
    }

    // Asynchronous Audio Decoding
    this.audit.record(
      generationId,
      "audio_decode_started",
      this.fence.getCurrentGeneration(),
      "generation_aware_audio",
      `Decoding audio buffer for Gen ${generationId} (${requestId})`
    );

    const decodeStartTime = typeof performance !== "undefined" ? performance.now() : Date.now();
    let decodedAudioBuffer: AudioBuffer;

    try {
      // Create a copy of the buffer to prevent browser detachment issues
      const bufferCopy = audioBuffer.slice(0);
      decodedAudioBuffer = await ctx.decodeAudioData(bufferCopy);
    } catch (decodeErr: unknown) {
      const errorMsg =
        decodeErr instanceof Error ? decodeErr.message : "AudioBuffer decoding failed";
      const errOutcome: AudioPlaybackOutcome = {
        kind: "failed",
        generationId,
        requestId,
        errorCode: "AUDIO_DECODE_FAILED",
        error: errorMsg,
        failedAt: Date.now(),
      };
      this.audit.record(
        generationId,
        "audio_playback_failed",
        this.fence.getCurrentGeneration(),
        "generation_aware_audio",
        `Audio decode failed: ${errorMsg}`
      );
      return errOutcome;
    }

    const decodeEndTime = typeof performance !== "undefined" ? performance.now() : Date.now();
    const decodeLatencyMs = Math.max(1, Math.round(decodeEndTime - decodeStartTime));

    this.measurement.recordAudioDecodeCompleted(generationId, decodeLatencyMs);
    this.audit.record(
      generationId,
      "audio_decode_completed",
      this.fence.getCurrentGeneration(),
      "generation_aware_audio",
      `Decoded ${decodedAudioBuffer.duration.toFixed(2)}s audio in ${decodeLatencyMs}ms`
    );

    // CHECKPOINT 2 — AFTER ASYNCHRONOUS DECODING
    // (decodeAudioData is asynchronous; user may have barged in or a new generation may have started)
    if (!this.fence.isCurrent(generationId) || this.interruptCtrl.isInterrupted(generationId)) {
      this.handleStaleAttempt(generationId, requestId, "STALE_DURING_DECODE");
      return {
        kind: "blocked",
        generationId,
        requestId,
        reason: "STALE_DURING_DECODE",
        blockedAt: Date.now(),
        activeGeneration: this.fence.getCurrentGeneration(),
      };
    }

    // Create and configure AudioBufferSourceNode
    let sourceNode: AudioBufferSourceNode;
    try {
      sourceNode = ctx.createBufferSource();
      sourceNode.buffer = decodedAudioBuffer;
      sourceNode.connect(ctx.destination);
    } catch (nodeErr: unknown) {
      const errorMsg =
        nodeErr instanceof Error ? nodeErr.message : "AudioBufferSourceNode creation failed";
      return {
        kind: "failed",
        generationId,
        requestId,
        errorCode: "AUDIO_START_FAILED",
        error: errorMsg,
        failedAt: Date.now(),
      };
    }

    // CHECKPOINT 3 — IMMEDIATELY BEFORE source.start()
    if (!this.fence.isCurrent(generationId) || this.interruptCtrl.isInterrupted(generationId)) {
      try {
        sourceNode.disconnect();
      } catch {
        // Ignored
      }
      this.handleStaleAttempt(generationId, requestId, "PRE_START_STALE");
      return {
        kind: "blocked",
        generationId,
        requestId,
        reason: "PRE_START_STALE",
        blockedAt: Date.now(),
        activeGeneration: this.fence.getCurrentGeneration(),
      };
    }

    // Start Audio Playback
    const startTimestamp = Date.now();
    try {
      sourceNode.start(0);
    } catch (startErr: unknown) {
      try {
        sourceNode.disconnect();
      } catch {
        // Ignored
      }
      const errorMsg =
        startErr instanceof Error ? startErr.message : "sourceNode.start() threw an error";
      return {
        kind: "failed",
        generationId,
        requestId,
        errorCode: "AUDIO_START_FAILED",
        error: errorMsg,
        failedAt: Date.now(),
      };
    }

    // Register active playback handle isolated by (generationId, requestId)
    if (!this.activePlaybacks.has(generationId)) {
      this.activePlaybacks.set(generationId, new Map());
    }

    const handle: PlaybackHandle = {
      generationId,
      requestId,
      source: sourceNode,
      audioBuffer: decodedAudioBuffer,
      startedAt: startTimestamp,
      stopped: false,
    };

    this.activePlaybacks.get(generationId)!.set(requestId, handle);

    // Register cleanup with InterruptController
    this.interruptCtrl.registerCleanup(generationId, () => {
      this.stopGeneration(generationId, "INTERRUPTED");
    });

    // Configure completion onended handler
    sourceNode.onended = () => {
      // Guard against late onended execution if already stopped or generation superseded
      if (!handle.stopped) {
        handle.stopped = true;
        try {
          sourceNode.disconnect();
        } catch {
          // Ignored
        }

        const genMap = this.activePlaybacks.get(generationId);
        if (genMap) {
          genMap.delete(requestId);
          if (genMap.size === 0) {
            this.activePlaybacks.delete(generationId);
          }
        }

        this.measurement.recordAudioPlaybackStopped(generationId, 0);
      }
    };

    // Record playback start metrics and audit
    this.measurement.recordAudioPlaybackStarted(generationId, 0);
    this.audit.record(
      generationId,
      "audio_playback_started",
      this.fence.getCurrentGeneration(),
      "generation_aware_audio",
      `Audio playback started for Gen ${generationId} (${requestId}), duration=${decodedAudioBuffer.duration.toFixed(2)}s`
    );

    return {
      kind: "started",
      generationId,
      requestId,
      startedAt: startTimestamp,
      durationSeconds: decodedAudioBuffer.duration,
    };
  }

  /**
   * CHECKPOINT 4 — INTERRUPTION STOP
   * Immediately halts all active audio source nodes belonging strictly to generationId.
   * Detaches event listeners, disconnects audio nodes, and cleans up registry entries.
   * Does NOT touch any other generation.
   * Idempotent: repeated calls on the same generation are safe no-ops.
   */
  public stopGeneration(
    generationId: number,
    reason: "INTERRUPTED" | "SUPERSEDED" | "MANUAL" = "INTERRUPTED"
  ): AudioStopResult {
    const startTime = typeof performance !== "undefined" ? performance.now() : Date.now();
    const timestamp = Date.now();

    const genPlaybacks = this.activePlaybacks.get(generationId);
    if (!genPlaybacks || genPlaybacks.size === 0) {
      return {
        stopped: false,
        stopLatencyMs: 0,
        timestamp,
        playbackPositionSeconds: 0,
      };
    }

    let stoppedCount = 0;

    for (const [reqId, handle] of genPlaybacks) {
      if (!handle.stopped) {
        handle.stopped = true;

        // Detach onended handler to prevent late asynchronous completion callbacks
        handle.source.onended = null;

        try {
          handle.source.stop();
        } catch {
          // AudioBufferSourceNode may already be stopped
        }

        try {
          handle.source.disconnect();
        } catch {
          // Ignored
        }

        stoppedCount++;

        this.audit.record(
          generationId,
          "audio_playback_stopped",
          this.fence.getCurrentGeneration(),
          "generation_aware_audio",
          `Audio halted for Gen ${generationId} (${reqId}): reason=${reason}`
        );
      }
    }

    this.activePlaybacks.delete(generationId);

    const endTime = typeof performance !== "undefined" ? performance.now() : Date.now();
    const stopLatencyMs = Math.max(1, Math.round(endTime - startTime));

    this.measurement.recordAudioStopped(generationId, stopLatencyMs);
    this.measurement.recordAudioPlaybackStopped(generationId, stopLatencyMs);

    return {
      stopped: stoppedCount > 0,
      stopLatencyMs,
      timestamp,
      playbackPositionSeconds: 0,
    };
  }

  /**
   * Stops all active playbacks across all generations (e.g. system reset or global halt).
   */
  public stopAll(reason: "INTERRUPTED" | "SUPERSEDED" | "MANUAL" = "INTERRUPTED"): AudioStopResult[] {
    const results: AudioStopResult[] = [];
    const activeGens = Array.from(this.activePlaybacks.keys());
    for (const genId of activeGens) {
      results.push(this.stopGeneration(genId, reason));
    }
    return results;
  }

  /**
   * Handles a stale playback attempt cleanly across Audit, Fence, and Measurement.
   * Enforces audio.resurrectionCount === 0 while properly incrementing staleAudioStartsBlocked.
   */
  private handleStaleAttempt(
    generationId: number,
    requestId: string,
    reason:
      | "PRE_PLAYBACK_STALE"
      | "PRE_START_STALE"
      | "STALE_DURING_DECODE"
      | "STALE_PLAYBACK_ATTEMPT"
      | "UNAUTHORIZED_INPUT"
  ): void {
    // 1. Update MeasurementPipeline stale tracking
    this.measurement.recordStaleResultAttempted(generationId);
    this.measurement.recordStaleResultBlocked(generationId);
    this.measurement.recordStaleAudioBlocked(generationId);

    // 2. Update GenerationFence blocked counter
    this.fence.recordStaleBlocked(
      generationId,
      "stale_audio_start_blocked",
      "generation_aware_audio",
      `Stale audio playback blocked (${reason}) for Gen ${generationId} (${requestId})`
    );

    // 3. Record Audit Event
    this.audit.record(
      generationId,
      "stale_audio_start_blocked",
      this.fence.getCurrentGeneration(),
      "generation_aware_audio",
      `Audio playback prevented from starting: reason=${reason}, activeGen=${this.fence.getCurrentGeneration()}`
    );
  }

  /**
   * Returns whether a specific generation currently has active playback.
   */
  public isGenerationPlaying(generationId: number): boolean {
    const genPlaybacks = this.activePlaybacks.get(generationId);
    if (!genPlaybacks) return false;
    for (const handle of genPlaybacks.values()) {
      if (!handle.stopped) return true;
    }
    return false;
  }

  /**
   * Returns the count of actively playing handles across all generations.
   */
  public getActivePlaybackCount(): number {
    let count = 0;
    for (const genMap of this.activePlaybacks.values()) {
      for (const handle of genMap.values()) {
        if (!handle.stopped) count++;
      }
    }
    return count;
  }

  /**
   * Returns all generation IDs with active playbacks.
   */
  public getActiveGenerations(): number[] {
    const active: number[] = [];
    for (const [genId, genMap] of this.activePlaybacks) {
      let hasActive = false;
      for (const handle of genMap.values()) {
        if (!handle.stopped) {
          hasActive = true;
          break;
        }
      }
      if (hasActive) active.push(genId);
    }
    return active;
  }

  /**
   * Returns the count of active playbacks belonging to superseded generations (< currentGen).
   */
  public getStaleActivePlaybackCount(currentGen: number): number {
    let stale = 0;
    for (const [genId, genMap] of this.activePlaybacks) {
      if (genId < currentGen) {
        for (const handle of genMap.values()) {
          if (!handle.stopped) stale++;
        }
      }
    }
    return stale;
  }

  /**
   * Complete reset for tests and test harnesses.
   */
  public reset(): void {
    this.stopAll("MANUAL");
    this.activePlaybacks.clear();
    this.customAudioContext = null;
    if (this.audioContext && this.audioContext.state !== "closed") {
      try {
        this.audioContext.close();
      } catch {
        // Ignored
      }
    }
    this.audioContext = null;
  }
}

export const generationAwareAudio = new GenerationAwareAudio();
