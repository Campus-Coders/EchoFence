import type { GenerationId } from "@/types/generation";
import type {
  InterruptReason,
  InterruptResult,
  InterruptMetrics,
} from "@/types/interrupt";
import { generationAudit } from "./generation-audit";
import { generationFence } from "./generation-fence";
import { stopActiveAudio } from "./browser-audio";
import { measurementPipeline } from "./measurement-pipeline";

export type InterruptListener = (
  result: InterruptResult,
  metrics: InterruptMetrics
) => void;

/**
 * Dedicated InterruptController.
 * Coordinates immediate audio stoppage, async AbortController cancellation,
 * generation invalidation, and recovery timing.
 */
export class InterruptController {
  private interruptedGenerations: Set<GenerationId> = new Set();
  private abortControllers: Map<GenerationId, AbortController> = new Map();
  private cleanups: Map<GenerationId, Set<() => void>> = new Map();
  private playbackStoppers: Set<(generationId: GenerationId) => void> = new Set();
  private synthesisAborters: Set<(generationId: GenerationId) => void> = new Set();
  private streamStoppers: Set<(generationId: GenerationId) => void> = new Set();
  private isCurrentlyInterrupting = false;
  private listeners: Set<InterruptListener> = new Set();
  private history: InterruptResult[] = [];

  private metrics: InterruptMetrics = {
    interruptionCount: 0,
    lastInterruptedGeneration: null,
    lastAudioStopLatencyMs: null,
    lastRecoveryTimeMs: null,
    lastInterruptTimestamp: null,
  };

  /**
   * Registers a playback stop handler (e.g. from GenerationAwareAudio).
   */
  public registerPlaybackStopper(
    stopper: (generationId: GenerationId) => void
  ): () => void {
    this.playbackStoppers.add(stopper);
    return () => {
      this.playbackStoppers.delete(stopper);
    };
  }

  /**
   * Registers a synthesis abort handler (e.g. from GenerationAwareSynthesis).
   */
  public registerSynthesisAborter(
    aborter: (generationId: GenerationId) => void
  ): () => void {
    this.synthesisAborters.add(aborter);
    return () => {
      this.synthesisAborters.delete(aborter);
    };
  }

  /**
   * Registers a stream stop handler (e.g. from GenerationAwareAudioStream).
   */
  public registerStreamStopper(
    stopper: (generationId: GenerationId) => void
  ): () => void {
    this.streamStoppers.add(stopper);
    return () => {
      this.streamStoppers.delete(stopper);
    };
  }

  /**
   * Registers an AbortController for in-flight fetch / async work of a specific generation.
   */
  public registerAbortController(
    generationId: GenerationId,
    controller: AbortController
  ): void {
    this.abortControllers.set(generationId, controller);
  }

  /**
   * Unregisters an AbortController for a specific generation.
   */
  public unregisterAbortController(
    generationId: GenerationId,
    controller?: AbortController
  ): void {
    if (!controller || this.abortControllers.get(generationId) === controller) {
      this.abortControllers.delete(generationId);
    }
  }

  /**
   * Returns active AbortController count.
   */
  public getActiveAbortControllerCount(): number {
    return this.abortControllers.size;
  }

  /**
   * Returns count of AbortControllers belonging to superseded generations.
   */
  public getStaleAbortControllerCount(currentGen: GenerationId): number {
    let stale = 0;
    for (const genId of this.abortControllers.keys()) {
      if (genId < currentGen) {
        stale++;
      }
    }
    return stale;
  }

  /**
   * Cleans up stale AbortControllers and cleanups for superseded generations.
   */
  public cleanStaleAbortControllers(currentGen: GenerationId): number {
    let cleaned = 0;
    for (const genId of Array.from(this.abortControllers.keys())) {
      if (genId < currentGen) {
        const ctrl = this.abortControllers.get(genId);
        if (ctrl && !ctrl.signal.aborted) {
          try {
            ctrl.abort(`Superseded by generation ${currentGen}`);
          } catch {
            // Ignored
          }
        }
        this.abortControllers.delete(genId);
        cleaned++;
      }
    }
    for (const genId of Array.from(this.cleanups.keys())) {
      if (genId < currentGen) {
        this.cleanups.delete(genId);
      }
    }
    return cleaned;
  }

  /**
   * Registers a cleanup callback to be invoked if the generation is interrupted.
   */
  public registerCleanup(
    generationId: GenerationId,
    cleanup: () => void
  ): void {
    if (!this.cleanups.has(generationId)) {
      this.cleanups.set(generationId, new Set());
    }
    this.cleanups.get(generationId)?.add(cleanup);
  }

  /**
   * Cleans up tracking for a generation that concluded normally.
   */
  public clearGeneration(generationId: GenerationId): void {
    this.abortControllers.delete(generationId);
    this.cleanups.delete(generationId);
  }

  /**
   * Checks whether a generation was ever marked interrupted.
   */
  public isInterrupted(generationId: GenerationId): boolean {
    return this.interruptedGenerations.has(generationId);
  }

  /**
   * Primary Interruption Method:
   * 1. Stops browser audio immediately.
   * 2. Invalidates the old generation via Generation Fence.
   * 3. Aborts pending async requests via AbortController.
   * 4. Executes registered cleanup callbacks.
   * 5. Computes audio stop latency & recovery timing.
   * 6. Emits audit events and notifies listeners.
   */
  public interrupt(
    generationId: GenerationId,
    reason: InterruptReason = "user_barge_in"
  ): InterruptResult {
    const startTime = typeof performance !== "undefined" ? performance.now() : Date.now();
    const timestamp = Date.now();

    // Prevent duplicate processing of the same generation interruption
    if (this.interruptedGenerations.has(generationId)) {
      console.warn(`[interrupt-controller] Generation ${generationId} was already interrupted`);
      return {
        interruptedGenerationId: generationId,
        audioStopped: false,
        audioStopLatencyMs: this.metrics.lastAudioStopLatencyMs || 0,
        asyncAborted: false,
        timestamp,
        reason,
        recoveryTimeMs: 0,
      };
    }

    this.isCurrentlyInterrupting = true;
    this.interruptedGenerations.add(generationId);

    measurementPipeline.recordInterruptDetected(generationId, startTime);

    // 1. Audit: Interruption Requested
    generationAudit.record(
      generationId,
      "interruption_requested",
      generationFence.getCurrentGeneration(),
      "interrupt_controller",
      `Interruption triggered: reason=${reason}`
    );

    // 2. Immediately stop playing audio
    measurementPipeline.recordAudioStopRequested(generationId);
    generationAudit.record(
      generationId,
      "audio_stop_requested",
      generationFence.getCurrentGeneration(),
      "interrupt_controller",
      "Immediate audio halt requested"
    );

    // Trigger registered generation-aware playback stoppers
    for (const stopper of this.playbackStoppers) {
      try {
        stopper(generationId);
      } catch (err) {
        console.warn("[interrupt-controller] Playback stopper error:", err);
      }
    }

    // Trigger registered generation-aware synthesis aborters
    for (const aborter of this.synthesisAborters) {
      try {
        aborter(generationId);
      } catch (err) {
        console.warn("[interrupt-controller] Synthesis aborter error:", err);
      }
    }

    // Trigger registered generation-aware stream stoppers
    for (const streamStopper of this.streamStoppers) {
      try {
        streamStopper(generationId);
      } catch (err) {
        console.warn("[interrupt-controller] Stream stopper error:", err);
      }
    }

    const audioStopRes = stopActiveAudio();
    measurementPipeline.recordAudioStopped(generationId, audioStopRes.stopLatencyMs || 1);

    if (audioStopRes.stopped) {
      generationAudit.record(
        generationId,
        "audio_stopped",
        generationFence.getCurrentGeneration(),
        "browser_audio",
        `Audio halted in ${audioStopRes.stopLatencyMs}ms at pos ${audioStopRes.playbackPositionSeconds?.toFixed(2) || 0}s`
      );
    }

    // 3. Invalidate generation in Generation Fence
    generationFence.invalidate(
      "interrupt_controller",
      `Interrupted by user barge-in (${reason})`
    );

    generationAudit.record(
      generationId,
      "generation_interrupted",
      generationFence.getCurrentGeneration(),
      "interrupt_controller",
      `Generation ${generationId} invalidated and marked interrupted`
    );

    // 4. Abort registered async work
    let asyncAborted = false;
    const abortController = this.abortControllers.get(generationId);
    if (abortController && !abortController.signal.aborted) {
      try {
        abortController.abort(`Generation ${generationId} interrupted: ${reason}`);
        asyncAborted = true;
        measurementPipeline.recordAbortIssued(generationId);
        generationAudit.record(
          generationId,
          "async_work_aborted",
          generationFence.getCurrentGeneration(),
          "interrupt_controller",
          `AbortController triggered for generation ${generationId}`
        );
      } catch (err) {
        console.warn("[interrupt-controller] Error aborting controller:", err);
      }
    }
    this.abortControllers.delete(generationId);

    // 5. Execute registered cleanups
    const cleanups = this.cleanups.get(generationId);
    if (cleanups) {
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch (err) {
          console.warn("[interrupt-controller] Cleanup error:", err);
        }
      }
      this.cleanups.delete(generationId);
    }

    // 6. Calculate recovery time
    const endTime = typeof performance !== "undefined" ? performance.now() : Date.now();
    const rawRecovery = Math.round(endTime - startTime);
    const recoveryTimeMs = Math.max(1, rawRecovery);
    measurementPipeline.recordRecoveryCompleted(generationId);

    // 7. Update metrics
    this.metrics = {
      interruptionCount: this.metrics.interruptionCount + 1,
      lastInterruptedGeneration: generationId,
      lastAudioStopLatencyMs: audioStopRes.stopLatencyMs || 1,
      lastRecoveryTimeMs: recoveryTimeMs,
      lastInterruptTimestamp: timestamp,
      lastReason: reason,
    };

    const result: InterruptResult = {
      interruptedGenerationId: generationId,
      audioStopped: audioStopRes.stopped,
      audioStopLatencyMs: audioStopRes.stopLatencyMs || 1,
      asyncAborted,
      timestamp,
      reason,
      recoveryTimeMs,
    };

    this.history.unshift(result);
    if (this.history.length > 50) {
      this.history.pop();
    }

    // 8. Audit: Interruption Recovered
    generationAudit.record(
      generationId,
      "interruption_recovered",
      generationFence.getCurrentGeneration(),
      "interrupt_controller",
      `Interruption recovered in ${recoveryTimeMs}ms`
    );

    this.isCurrentlyInterrupting = false;

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(result, this.metrics);
      } catch (err) {
        console.error("[interrupt-controller] Listener error:", err);
      }
    }

    return result;
  }

  public getMetrics(): InterruptMetrics {
    return { ...this.metrics };
  }

  public getHistory(): InterruptResult[] {
    return [...this.history];
  }

  public isBusyInterrupting(): boolean {
    return this.isCurrentlyInterrupting;
  }

  public subscribe(listener: InterruptListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public reset(): void {
    this.interruptedGenerations.clear();
    this.abortControllers.clear();
    this.cleanups.clear();
    this.history = [];
    this.isCurrentlyInterrupting = false;
    this.metrics = {
      interruptionCount: 0,
      lastInterruptedGeneration: null,
      lastAudioStopLatencyMs: null,
      lastRecoveryTimeMs: null,
      lastInterruptTimestamp: null,
    };
  }
}

// Canonical Singleton Anchor on globalThis
const globalForInterrupt = globalThis as unknown as {
  __ECHOFENCE_INTERRUPT_CONTROLLER__?: InterruptController;
};

export const interruptController: InterruptController =
  globalForInterrupt.__ECHOFENCE_INTERRUPT_CONTROLLER__ ?? new InterruptController();

if (!globalForInterrupt.__ECHOFENCE_INTERRUPT_CONTROLLER__) {
  globalForInterrupt.__ECHOFENCE_INTERRUPT_CONTROLLER__ = interruptController;
}

