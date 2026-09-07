/**
 * lib/measurement-pipeline.ts
 * Canonical Measurement Pipeline for EchoFence.
 *
 * Converts runtime lifecycle events, timestamps, and guard decisions
 * into quantitative, verifiable performance and correctness evidence.
 *
 * All metrics originate from real runtime execution:
 * - Interruption latency (detection, abort, audio stop, silence)
 * - Recovery latency (generation switch, full recovery)
 * - Correctness (stale attempts, stale blocked, protection rate)
 * - Integrity (transcript corruption count, audio resurrection count)
 */

import { performanceClock } from "./performance-clock";
import type {
  MeasurementSnapshot,
  MeasurementRun,
  MeasurementListener,
  InterruptionMeasurement,
  RecoveryMeasurement,
  GenerationMeasurement,
  StaleResultsMeasurement,
  TranscriptMeasurement,
  AudioMeasurement,
  FenceMeasurement,
  BargeInMeasurement,
  StreamingAudioMeasurement,
  ChaosMeasurement,
} from "./measurement-types";
import type { ConversationTurn } from "@/types/conversation";

export class MeasurementPipeline {
  public readonly instanceId: string = `pipe_${Math.random().toString(36).slice(2, 8)}`;
  private sessionId: string = this.generateSessionId();
  private runStartedAt: number = Date.now();
  private history: MeasurementRun[] = [];
  private listeners: Set<MeasurementListener> = new Set();

  private logMutation(method: string, generationId?: number): void {
    const now = Date.now();
    const snap = this.getSnapshot();
    console.log(
      `[measurement-pipeline-mutation] ${method} | genId: ${generationId ?? "N/A"} | ts: ${now} | instance: ${this.instanceId}`,
      {
        activeGen: snap.generation.activeGeneration,
        started: snap.generation.generationsStarted,
        completed: snap.generation.generationsCompleted,
        interrupted: snap.generation.generationsInterrupted,
        staleAttempted: snap.staleResults.attempted,
        staleBlocked: snap.staleResults.blocked,
        protectionRate: snap.staleResults.protectionRate,
        detectionLatency: snap.interruption.detectionLatencyMs,
        abortLatency: snap.interruption.abortLatencyMs,
        stopLatency: snap.interruption.audioStopLatencyMs,
        recoveryTime: snap.recovery.recoveryTimeMs,
        genSwitchTime: snap.recovery.generationSwitchTimeMs,
      }
    );
  }

  // Raw Timing Marks
  private lastInterruptDetectedAt: number | null = null;
  private lastAudioStopRequestedAt: number | null = null;
  private lastRecoveryStartedAt: number | null = null;

  // Measurement State
  private interruption: InterruptionMeasurement = {
    count: 0,
    detectionLatencyMs: null,
    abortLatencyMs: null,
    audioStopLatencyMs: null,
    totalInterruptionToSilenceMs: null,
  };

  private recovery: RecoveryMeasurement = {
    recoveryTimeMs: null,
    generationSwitchTimeMs: null,
  };

  private generation: GenerationMeasurement = {
    activeGeneration: null,
    generationsStarted: 0,
    generationsCompleted: 0,
    generationsInterrupted: 0,
  };

  private staleResults: StaleResultsMeasurement = {
    attempted: 0,
    blocked: 0,
    protectionRate: 100,
  };

  private transcript: TranscriptMeasurement = {
    corruptionCount: 0,
    staleAssistantMessagesBlocked: 0,
  };

  private audio: AudioMeasurement = {
    resurrectionCount: 0,
    staleAudioStartsBlocked: 0,
    decodeLatencyMs: null,
    startLatencyMs: null,
    stopLatencyMs: null,
    activeGeneration: null,
  };

  private fence: FenceMeasurement = {
    active: true,
    staleBlockedCount: 0,
  };

  private bargeIn: BargeInMeasurement = {
    detectedCount: 0,
    confirmedCount: 0,
    interruptTriggeredCount: 0,
    staleIgnoredCount: 0,
    falseDuplicateSuppressedCount: 0,
    detectionLatencyMs: null,
    interruptLatencyMs: null,
    microphoneErrors: 0,
  };

  private streamingAudio: StreamingAudioMeasurement = {
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

  private chaos: ChaosMeasurement = {
    scenariosExecuted: 0,
    faultsInjected: 0,
    faultsRecovered: 0,
    safeFailures: 0,
    unsafeFailures: 0,
    networkFaults: 0,
    audioFaults: 0,
    streamingFaults: 0,
    interruptionFaults: 0,
    lifecycleFaults: 0,
    staleResultsBlockedDuringChaos: 0,
    resourceLeaksDetected: 0,
    unhandledErrorsDetected: 0,
    chaosSafetyRate: 100,
  };

  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  // ----------------------------------------------------
  // Generation Lifecycle Metrics
  // ----------------------------------------------------

  public startGeneration(generationId: number): void {
    this.generation.generationsStarted++;
    this.generation.activeGeneration = generationId;
    this.fence.active = true;
    this.logMutation("startGeneration", generationId);
    this.notify();
  }

  public recordGenerationActivated(generationId: number): void {
    this.generation.activeGeneration = generationId;
    if (this.lastInterruptDetectedAt !== null) {
      this.recovery.generationSwitchTimeMs = performanceClock.diff(
        performanceClock.now(),
        this.lastInterruptDetectedAt
      );
    }
    this.logMutation("recordGenerationActivated", generationId);
    this.notify();
  }

  public recordGenerationInvalidated(_generationId: number): void {
    this.logMutation("recordGenerationInvalidated", _generationId);
    this.notify();
  }

  public recordGenerationCompleted(_generationId: number): void {
    this.generation.generationsCompleted++;
    this.logMutation("recordGenerationCompleted", _generationId);
    this.notify();
  }

  // ----------------------------------------------------
  // Interruption Lifecycle Metrics
  // ----------------------------------------------------

  /**
   * Records that interruption was detected for a generation.
   * If an explicit external trigger time is provided, detection latency is calculated.
   * Otherwise, the earliest detection event is recorded as baseline (0ms detection latency).
   */
  public recordInterruptDetected(_generationId: number, triggerTime?: number): void {
    const now = performanceClock.now();
    this.lastInterruptDetectedAt = now;
    this.interruption.count++;
    this.generation.generationsInterrupted++;

    if (triggerTime !== undefined && triggerTime > 0) {
      this.interruption.detectionLatencyMs = performanceClock.diff(now, triggerTime);
    } else {
      this.interruption.detectionLatencyMs = 0;
    }
    this.logMutation("recordInterruptDetected", _generationId);
    this.notify();
  }

  public recordAbortIssued(_generationId: number): void {
    const now = performanceClock.now();
    if (this.lastInterruptDetectedAt !== null) {
      this.interruption.abortLatencyMs = performanceClock.diff(
        now,
        this.lastInterruptDetectedAt
      );
    }
    this.logMutation("recordAbortIssued", _generationId);
    this.notify();
  }

  public recordAudioStopRequested(_generationId: number): void {
    this.lastAudioStopRequestedAt = performanceClock.now();
    this.logMutation("recordAudioStopRequested", _generationId);
    this.notify();
  }

  public recordAudioStopped(_generationId: number, latencyMs?: number): void {
    const now = performanceClock.now();

    if (latencyMs !== undefined) {
      this.interruption.audioStopLatencyMs = latencyMs;
    } else if (this.lastAudioStopRequestedAt !== null) {
      this.interruption.audioStopLatencyMs = performanceClock.diff(
        now,
        this.lastAudioStopRequestedAt
      );
    } else {
      this.interruption.audioStopLatencyMs = 0;
    }

    if (this.lastInterruptDetectedAt !== null) {
      this.interruption.totalInterruptionToSilenceMs = performanceClock.diff(
        now,
        this.lastInterruptDetectedAt
      );
    }
    this.logMutation("recordAudioStopped", _generationId);
    this.notify();
  }

  // ----------------------------------------------------
  // Recovery Lifecycle Metrics
  // ----------------------------------------------------

  public recordRecoveryStarted(_generationId: number): void {
    this.lastRecoveryStartedAt = performanceClock.now();
    this.logMutation("recordRecoveryStarted", _generationId);
    this.notify();
  }

  public recordRecoveryCompleted(_generationId: number): void {
    if (this.lastInterruptDetectedAt !== null) {
      this.recovery.recoveryTimeMs = performanceClock.diff(
        performanceClock.now(),
        this.lastInterruptDetectedAt
      );
    } else if (this.lastRecoveryStartedAt !== null) {
      this.recovery.recoveryTimeMs = performanceClock.diff(
        performanceClock.now(),
        this.lastRecoveryStartedAt
      );
    }
    this.logMutation("recordRecoveryCompleted", _generationId);
    this.notify();
  }

  // ----------------------------------------------------
  // Stale Results & Protection Rate Metrics
  // ----------------------------------------------------

  /**
   * Recorded only when an asynchronous result actually reaches a callback boundary
   * where state mutation could potentially take place.
   */
  public recordStaleResultAttempted(_generationId: number): void {
    this.staleResults.attempted++;
    this.updateProtectionRate();
    this.logMutation("recordStaleResultAttempted", _generationId);
    this.notify();
  }

  /**
   * Recorded when the Generation Fence intercepts and rejects a stale result.
   */
  public recordStaleResultBlocked(_generationId: number): void {
    this.staleResults.blocked++;
    this.fence.staleBlockedCount++;
    this.updateProtectionRate();
    this.logMutation("recordStaleResultBlocked", _generationId);
    this.notify();
  }

  private updateProtectionRate(): void {
    if (this.staleResults.attempted === 0) {
      this.staleResults.protectionRate = 100;
    } else {
      this.staleResults.protectionRate = Math.min(
        100,
        Math.round((this.staleResults.blocked / this.staleResults.attempted) * 100)
      );
    }
  }

  // ----------------------------------------------------
  // Transcript Integrity Metrics
  // ----------------------------------------------------

  public recordStaleAssistantMessageBlocked(_generationId: number): void {
    this.transcript.staleAssistantMessagesBlocked++;
    this.logMutation("recordStaleAssistantMessageBlocked", _generationId);
    this.notify();
  }

  public recordTranscriptCorruption(_generationId: number): void {
    this.transcript.corruptionCount++;
    this.logMutation("recordTranscriptCorruption", _generationId);
    this.notify();
  }

  /**
   * Defensive verification helper:
   * Scans a conversation transcript to detect any assistant messages belonging
   * to non-authoritative (stale) generations.
   */
  public verifyTranscriptIntegrity(
    turns: ConversationTurn[],
    authoritativeGen: number
  ): {
    isClean: boolean;
    corruptionCount: number;
    staleMessages: ConversationTurn[];
  } {
    const staleMessages = turns.filter(
      (turn) =>
        turn.role === "assistant" &&
        turn.generationId !== undefined &&
        turn.generationId !== authoritativeGen &&
        turn.generationId < authoritativeGen
    );

    const corruptionCount = staleMessages.length;
    if (corruptionCount > 0) {
      this.transcript.corruptionCount += corruptionCount;
      this.notify();
    }

    return {
      isClean: corruptionCount === 0,
      corruptionCount,
      staleMessages,
    };
  }

  // ----------------------------------------------------
  // Audio Integrity Metrics
  // ----------------------------------------------------

  public recordStaleAudioBlocked(_generationId: number): void {
    this.audio.staleAudioStartsBlocked++;
    this.logMutation("recordStaleAudioBlocked", _generationId);
    this.notify();
  }

  public recordAudioResurrection(_generationId: number): void {
    this.audio.resurrectionCount++;
    this.logMutation("recordAudioResurrection", _generationId);
    this.notify();
  }

  public recordAudioDecodeCompleted(_generationId: number, latencyMs: number): void {
    this.audio.decodeLatencyMs = latencyMs;
    this.notify();
  }

  public recordAudioPlaybackStarted(generationId: number, latencyMs?: number): void {
    this.audio.activeGeneration = generationId;
    this.audio.startLatencyMs = latencyMs ?? 0;
    this.logMutation("recordAudioPlaybackStarted", generationId);
    this.notify();
  }

  public recordAudioPlaybackStopped(generationId: number, latencyMs?: number): void {
    if (this.audio.activeGeneration === generationId) {
      this.audio.activeGeneration = null;
    }
    if (latencyMs !== undefined) {
      this.audio.stopLatencyMs = latencyMs;
    }
    this.logMutation("recordAudioPlaybackStopped", generationId);
    this.notify();
  }

  // ----------------------------------------------------
  // Fence Status Metrics
  // ----------------------------------------------------

  public setFenceStatus(active: boolean): void {
    this.fence.active = active;
    this.notify();
  }

  // ----------------------------------------------------
  // Barge-In Metrics
  // ----------------------------------------------------

  public recordBargeInActivityDetected(_generationId: number, _level: number): void {
    this.bargeIn.detectedCount++;
    this.notify();
  }

  public recordBargeInConfirmed(_generationId: number, durationMs?: number): void {
    this.bargeIn.confirmedCount++;
    if (durationMs !== undefined) {
      this.bargeIn.detectionLatencyMs = durationMs;
    }
    this.notify();
  }

  public recordBargeInInterruptTriggered(_generationId: number, latencyMs?: number): void {
    this.bargeIn.interruptTriggeredCount++;
    if (latencyMs !== undefined) {
      this.bargeIn.interruptLatencyMs = latencyMs;
    }
    this.notify();
  }

  public recordBargeInStaleIgnored(generationId: number): void {
    this.bargeIn.staleIgnoredCount++;
    this.recordStaleResultAttempted(generationId);
    this.recordStaleResultBlocked(generationId);
    this.notify();
  }

  public recordBargeInSuppressedDuplicate(_generationId: number): void {
    this.bargeIn.falseDuplicateSuppressedCount++;
    this.notify();
  }

  public recordBargeInMicrophoneError(_errorCode?: string): void {
    this.bargeIn.microphoneErrors++;
    this.notify();
  }

  // ----------------------------------------------------
  // Streaming Audio Metrics
  // ----------------------------------------------------

  public recordStreamingChunkReceived(_generationId?: number): void {
    this.streamingAudio.streamingChunksReceived++;
    this.notify();
  }

  public recordStreamingChunkAccepted(_generationId?: number): void {
    this.streamingAudio.streamingChunksAccepted++;
    this.notify();
  }

  public recordStreamingChunkRejected(_generationId?: number): void {
    this.streamingAudio.streamingChunksRejected++;
    this.notify();
  }

  public recordStaleChunkBlocked(generationId?: number): void {
    const targetGen = generationId ?? 0;
    this.streamingAudio.staleChunksBlocked++;
    this.streamingAudio.streamingChunksRejected++;
    this.recordStaleResultAttempted(targetGen);
    this.recordStaleResultBlocked(targetGen);
    this.notify();
  }

  public recordDuplicateChunkSuppressed(_generationId?: number): void {
    this.streamingAudio.duplicateChunksSuppressed++;
    this.notify();
  }

  public recordOutOfOrderChunkBuffered(_generationId?: number): void {
    this.streamingAudio.outOfOrderChunksBuffered++;
    this.notify();
  }

  public recordChunkDecoded(_generationId?: number, latencyMs?: number): void {
    this.streamingAudio.chunksDecoded++;
    if (latencyMs !== undefined) {
      this.streamingAudio.chunkDecodeLatencyMs = latencyMs;
    }
    this.notify();
  }

  public recordChunkPlayed(_generationId?: number, latencyMs?: number): void {
    this.streamingAudio.chunksPlayed++;
    if (latencyMs !== undefined) {
      this.streamingAudio.chunkStartLatencyMs = latencyMs;
    }
    this.notify();
  }

  public recordQueuedChunksCancelled(_generationId?: number, count: number = 1): void {
    this.streamingAudio.queuedChunksCancelled += count;
    this.notify();
  }

  public recordStreamStarted(_generationId?: number): void {
    this.streamingAudio.activeStreams++;
    this.notify();
  }

  public recordStreamCompleted(_generationId?: number): void {
    this.streamingAudio.activeStreams = Math.max(0, this.streamingAudio.activeStreams - 1);
    this.streamingAudio.completedStreams++;
    this.notify();
  }

  public recordStreamCancelled(_generationId?: number, latencyMs?: number): void {
    this.streamingAudio.activeStreams = Math.max(0, this.streamingAudio.activeStreams - 1);
    this.streamingAudio.cancelledStreams++;
    if (latencyMs !== undefined) {
      this.streamingAudio.streamInterruptLatencyMs = latencyMs;
    }
    this.notify();
  }

  public recordStreamRaceFailure(_generationId?: number): void {
    this.streamingAudio.streamRaceFailures++;
    this.notify();
  }

  // ----------------------------------------------------
  // Chaos & Fault Injection Metrics
  // ----------------------------------------------------

  public recordChaosScenarioStarted(_scenarioId: string): void {
    this.chaos.scenariosExecuted++;
    this.notify();
  }

  public recordChaosScenarioCompleted(_scenarioId: string, _passed: boolean): void {
    this.updateChaosSafetyRate();
    this.notify();
  }

  public recordChaosFaultInjected(
    category: "network" | "audio" | "streaming" | "interruption" | "lifecycle"
  ): void {
    this.chaos.faultsInjected++;
    if (category === "network") this.chaos.networkFaults++;
    else if (category === "audio") this.chaos.audioFaults++;
    else if (category === "streaming") this.chaos.streamingFaults++;
    else if (category === "interruption") this.chaos.interruptionFaults++;
    else if (category === "lifecycle") this.chaos.lifecycleFaults++;
    this.updateChaosSafetyRate();
    this.notify();
  }

  public recordChaosFaultRecovered(): void {
    this.chaos.faultsRecovered++;
    this.updateChaosSafetyRate();
    this.notify();
  }

  public recordChaosSafeFailure(): void {
    this.chaos.safeFailures++;
    this.updateChaosSafetyRate();
    this.notify();
  }

  public recordChaosUnsafeFailure(): void {
    this.chaos.unsafeFailures++;
    this.updateChaosSafetyRate();
    this.notify();
  }

  public recordChaosStaleResultBlocked(_generationId: number): void {
    this.chaos.staleResultsBlockedDuringChaos++;
    this.notify();
  }

  public recordChaosResourceLeaksDetected(count: number): void {
    this.chaos.resourceLeaksDetected += count;
    if (count > 0) {
      this.chaos.unsafeFailures += count;
    }
    this.updateChaosSafetyRate();
    this.notify();
  }

  public recordChaosUnhandledErrorDetected(): void {
    this.chaos.unhandledErrorsDetected++;
    this.chaos.unsafeFailures++;
    this.updateChaosSafetyRate();
    this.notify();
  }

  private updateChaosSafetyRate(): void {
    const total = this.chaos.safeFailures + this.chaos.unsafeFailures;
    if (total === 0) {
      this.chaos.chaosSafetyRate = 100;
    } else {
      const rate = (this.chaos.safeFailures / total) * 100;
      this.chaos.chaosSafetyRate = Math.min(100, Math.max(0, Math.round(rate)));
    }
  }

  // ----------------------------------------------------
  // Snapshots & History
  // ----------------------------------------------------

  public getSnapshot(): MeasurementSnapshot {
    return {
      sessionId: this.sessionId,
      generatedAt: Date.now(),
      interruption: { ...this.interruption },
      recovery: { ...this.recovery },
      generation: { ...this.generation },
      staleResults: { ...this.staleResults },
      transcript: { ...this.transcript },
      audio: { ...this.audio },
      fence: { ...this.fence },
      bargeIn: { ...this.bargeIn },
      streamingAudio: { ...this.streamingAudio },
      chaos: { ...this.chaos },
    };
  }

  public completeRun(runId?: string): MeasurementRun {
    const run: MeasurementRun = {
      runId: runId || `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      startedAt: this.runStartedAt,
      completedAt: Date.now(),
      snapshot: this.getSnapshot(),
    };

    this.history.unshift(run);
    if (this.history.length > 10) {
      this.history.pop();
    }

    return run;
  }

  public getHistory(): MeasurementRun[] {
    return [...this.history];
  }

  public reset(): void {
    this.sessionId = this.generateSessionId();
    this.runStartedAt = Date.now();
    this.lastInterruptDetectedAt = null;
    this.lastAudioStopRequestedAt = null;
    this.lastRecoveryStartedAt = null;

    this.interruption = {
      count: 0,
      detectionLatencyMs: null,
      abortLatencyMs: null,
      audioStopLatencyMs: null,
      totalInterruptionToSilenceMs: null,
    };

    this.recovery = {
      recoveryTimeMs: null,
      generationSwitchTimeMs: null,
    };

    this.generation = {
      activeGeneration: null,
      generationsStarted: 0,
      generationsCompleted: 0,
      generationsInterrupted: 0,
    };

    this.staleResults = {
      attempted: 0,
      blocked: 0,
      protectionRate: 100,
    };

    this.transcript = {
      corruptionCount: 0,
      staleAssistantMessagesBlocked: 0,
    };

    this.audio = {
      resurrectionCount: 0,
      staleAudioStartsBlocked: 0,
      decodeLatencyMs: null,
      startLatencyMs: null,
      stopLatencyMs: null,
      activeGeneration: null,
    };

    this.fence = {
      active: true,
      staleBlockedCount: 0,
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

    this.chaos = {
      scenariosExecuted: 0,
      faultsInjected: 0,
      faultsRecovered: 0,
      safeFailures: 0,
      unsafeFailures: 0,
      networkFaults: 0,
      audioFaults: 0,
      streamingFaults: 0,
      interruptionFaults: 0,
      lifecycleFaults: 0,
      staleResultsBlockedDuringChaos: 0,
      resourceLeaksDetected: 0,
      unhandledErrorsDetected: 0,
      chaosSafetyRate: 100,
    };

    this.logMutation("reset", undefined);
    this.notify();
  }

  public subscribe(listener: MeasurementListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error("[measurement-pipeline] Listener error:", err);
      }
    }
  }
}

// Canonical Singleton Anchor on globalThis across all client bundles and HMR
const globalForPipeline = globalThis as unknown as {
  __ECHOFENCE_MEASUREMENT_PIPELINE__?: MeasurementPipeline;
};

export const measurementPipeline: MeasurementPipeline =
  globalForPipeline.__ECHOFENCE_MEASUREMENT_PIPELINE__ ?? new MeasurementPipeline();

if (!globalForPipeline.__ECHOFENCE_MEASUREMENT_PIPELINE__) {
  globalForPipeline.__ECHOFENCE_MEASUREMENT_PIPELINE__ = measurementPipeline;
}

