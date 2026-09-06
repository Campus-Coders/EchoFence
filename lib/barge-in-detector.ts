/**
 * lib/barge-in-detector.ts
 * Real Voice Activity & Barge-In Detection Layer for EchoFence.
 *
 * Implements the core principle:
 *   USER SPEECH DETECTION != GENERATION AUTHORITY
 *   VOICE ACTIVITY != INTERRUPTION AUTHORITY
 *   DELAYED BARGE-IN CALLBACK != PERMISSION TO INTERRUPT THE CURRENT GENERATION
 *
 * Architecture:
 * 1. Samples microphone audio levels (via AnalyserNode / RMS) during active speech.
 * 2. Stabilizes detection with an energy threshold, minimum active duration, and cooldown.
 * 3. Associates monitoring strictly with a target generation ID.
 * 4. Before triggering an interrupt, validates that targetGenerationId is STILL current.
 *    If target generation is superseded, the event is blocked as STALE and NEVER interrupts
 *    the newer generation.
 * 5. On verified barge-in, requests interruption through InterruptController.
 * 6. Does NOT mutate GenerationFence or transcript history directly.
 */

import { generationFence, type GenerationFence } from "./generation-fence";
import { interruptController, type InterruptController } from "./interrupt-controller";
import { generationAudit, type GenerationAuditLog } from "./generation-audit";
import { measurementPipeline, type MeasurementPipeline } from "./measurement-pipeline";
import type {
  BargeInConfig,
  BargeInOutcome,
  BargeInErrorCode,
  BargeInEvent,
} from "@/types/barge-in";

export type { BargeInConfig, BargeInOutcome, BargeInErrorCode, BargeInEvent };

export const DEFAULT_BARGE_IN_CONFIG: BargeInConfig = {
  enabled: true,
  threshold: 0.05,            // Energy / RMS threshold (0.0 to 1.0)
  minActiveDurationMs: 80,    // Minimum sustained speech to confirm barge-in
  cooldownMs: 400,            // Debounce cooldown between barge-in events
  sampleIntervalMs: 20,       // Polling frequency for audio analysis
};

export type BargeInListener = (event: BargeInEvent) => void;

export class BargeInDetector {
  private config: BargeInConfig = { ...DEFAULT_BARGE_IN_CONFIG };
  private targetGenerationId: number | null = null;
  private isMonitoring: boolean = false;

  // Browser Web Audio resources
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private dataArray: Uint8Array<ArrayBuffer> | null = null;
  private sampleTimer: ReturnType<typeof setInterval> | null = null;

  // Timing and detection state
  private candidateStartTime: number | null = null;
  private lastInterruptedGenId: number | null = null;
  private lastInterruptTimestamp: number = 0;
  private lastDetectedLevel: number = 0;
  private listeners: Set<BargeInListener> = new Set();

  // Test / Injection mocks
  private customMediaStream: MediaStream | null = null;
  private customAudioContext: AudioContext | null = null;
  private customAnalyserNode: AnalyserNode | null = null;

  constructor(
    private fence: GenerationFence = generationFence,
    private interruptCtrl: InterruptController = interruptController,
    private measurement: MeasurementPipeline = measurementPipeline,
    private audit: GenerationAuditLog = generationAudit
  ) {}

  /**
   * Sets mock audio objects for deterministic testing in Node.js or headless environments.
   */
  public setMocksForTesting(mocks: {
    mediaStream?: any;
    audioContext?: any;
    analyserNode?: any;
  }): void {
    this.customMediaStream = mocks.mediaStream ?? null;
    this.customAudioContext = mocks.audioContext ?? null;
    this.customAnalyserNode = mocks.analyserNode ?? null;
  }

  /**
   * Updates configuration parameters.
   */
  public configure(options: Partial<BargeInConfig>): void {
    this.config = { ...this.config, ...options };
  }

  public getConfig(): BargeInConfig {
    return { ...this.config };
  }

  /**
   * Begins monitoring microphone audio activity for the specified target generation.
   * Fails safely if microphone or Web Audio is unavailable.
   */
  public async startMonitoring(
    targetGenerationId: number,
    options?: Partial<BargeInConfig>
  ): Promise<BargeInOutcome> {
    const timestamp = Date.now();

    if (options) {
      this.configure(options);
    }

    // Stop any existing active monitoring session first
    this.stopMonitoring();

    // Check 1: Target Generation must be current in GenerationFence
    if (!this.fence.isCurrent(targetGenerationId) || this.interruptCtrl.isInterrupted(targetGenerationId)) {
      this.measurement.recordBargeInStaleIgnored(targetGenerationId);
      this.audit.record(
        targetGenerationId,
        "stale_barge_in_ignored",
        this.fence.getCurrentGeneration(),
        "barge_in_detector",
        `Refused to start monitoring for superseded Gen ${targetGenerationId}`
      );
      return {
        kind: "stale_ignored",
        targetGenerationId,
        activeGenerationId: this.fence.getCurrentGeneration(),
        detectedLevel: 0,
        timestamp,
        reason: "TARGET_GENERATION_SUPERSEDED",
      };
    }

    this.targetGenerationId = targetGenerationId;
    this.candidateStartTime = null;
    if (this.lastInterruptedGenId !== targetGenerationId) {
      this.lastInterruptTimestamp = 0;
    }

    // Acquire or mock microphone stream
    let stream: MediaStream | null = this.customMediaStream;
    if (!stream) {
      if (typeof window === "undefined" || !navigator?.mediaDevices?.getUserMedia) {
        const errOutcome: BargeInOutcome = {
          kind: "failed",
          errorCode: "MICROPHONE_UNAVAILABLE",
          error: "Microphone / getUserMedia API is unavailable in this environment",
          timestamp,
        };
        this.measurement.recordBargeInMicrophoneError("MICROPHONE_UNAVAILABLE");
        this.audit.record(
          targetGenerationId,
          "barge_in_detection_failed",
          this.fence.getCurrentGeneration(),
          "barge_in_detector",
          errOutcome.error
        );
        return errOutcome;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        this.mediaStream = stream;
      } catch (mediaErr: unknown) {
        const errorMsg = mediaErr instanceof Error ? mediaErr.message : "Permission denied";
        const isDenied =
          errorMsg.toLowerCase().includes("denied") ||
          errorMsg.toLowerCase().includes("notallowed") ||
          (mediaErr instanceof DOMException && mediaErr.name === "NotAllowedError");

        const errorCode: BargeInErrorCode = isDenied
          ? "MICROPHONE_PERMISSION_DENIED"
          : "MICROPHONE_ACCESS_FAILED";

        this.measurement.recordBargeInMicrophoneError(errorCode);
        this.audit.record(
          targetGenerationId,
          "barge_in_detection_failed",
          this.fence.getCurrentGeneration(),
          "barge_in_detector",
          `Microphone access error (${errorCode}): ${errorMsg}`
        );
        this.stopMonitoring();
        return {
          kind: "failed",
          errorCode,
          error: errorMsg,
          timestamp: Date.now(),
        };
      }
    } else {
      this.mediaStream = stream;
    }

    // Acquire or mock AudioContext & AnalyserNode
    try {
      if (this.customAudioContext && this.customAnalyserNode) {
        this.audioContext = this.customAudioContext;
        this.analyserNode = this.customAnalyserNode;
      } else {
        const AudioContextClass =
          typeof window !== "undefined"
            ? window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
            : null;

        if (!AudioContextClass) {
          throw new Error("AudioContext unavailable");
        }

        const ctx = new AudioContextClass();
        this.audioContext = ctx;

        if (ctx.state === "suspended") {
          await ctx.resume().catch(() => {});
        }

        const source = ctx.createMediaStreamSource(this.mediaStream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.2;

        source.connect(analyser);
        this.sourceNode = source;
        this.analyserNode = analyser;
      }

      this.dataArray = new Uint8Array(this.analyserNode.frequencyBinCount || 128);
    } catch (audioErr: unknown) {
      const errorMsg = audioErr instanceof Error ? audioErr.message : "Audio analysis setup failed";
      this.stopMonitoring();
      this.measurement.recordBargeInMicrophoneError("AUDIO_ANALYSER_UNAVAILABLE");
      this.audit.record(
        targetGenerationId,
        "barge_in_detection_failed",
        this.fence.getCurrentGeneration(),
        "barge_in_detector",
        errorMsg
      );
      return {
        kind: "failed",
        errorCode: "AUDIO_ANALYSER_UNAVAILABLE",
        error: errorMsg,
        timestamp: Date.now(),
      };
    }

    this.isMonitoring = true;

    this.audit.record(
      targetGenerationId,
      "barge_in_monitoring_started",
      this.fence.getCurrentGeneration(),
      "barge_in_detector",
      `Started VAD monitoring for Gen ${targetGenerationId}, threshold=${this.config.threshold}`
    );

    // Start polling sampler timer
    this.sampleTimer = setInterval(() => {
      this.sampleAudioLevel();
    }, this.config.sampleIntervalMs);

    return {
      kind: "below_threshold",
      targetGenerationId,
      detectedLevel: 0,
      timestamp: Date.now(),
    };
  }

  /**
   * Internal polling sampler: reads frequency data from AnalyserNode,
   * calculates normalized energy, and routes to processAudioLevel().
   */
  private sampleAudioLevel(): void {
    if (!this.isMonitoring || !this.analyserNode || !this.dataArray) {
      return;
    }

    try {
      this.analyserNode.getByteFrequencyData(this.dataArray);
      let sum = 0;
      for (let i = 0; i < this.dataArray.length; i++) {
        const val = this.dataArray[i];
        if (typeof val === "number") {
          sum += val;
        }
      }
      const avg = sum / (this.dataArray.length || 1);
      // Normalized between 0.0 and 1.0
      const normalizedLevel = Math.min(1.0, avg / 128.0);
      this.lastDetectedLevel = normalizedLevel;

      this.processAudioLevel(normalizedLevel);
    } catch {
      // Non-fatal sampling error
    }
  }

  /**
   * Evaluates audio energy against threshold and duration constraints.
   * Used by both live microphone sampler and deterministic test simulation.
   */
  public processAudioLevel(level: number, explicitTimestamp?: number): BargeInOutcome {
    const now = explicitTimestamp ?? Date.now();
    const targetGen = this.targetGenerationId;

    if (!this.isMonitoring || targetGen === null) {
      return {
        kind: "below_threshold",
        targetGenerationId: targetGen ?? 0,
        detectedLevel: level,
        timestamp: now,
      };
    }

    // 1. Noise / Below Threshold Check
    if (level < this.config.threshold) {
      this.candidateStartTime = null;
      return {
        kind: "below_threshold",
        targetGenerationId: targetGen,
        detectedLevel: level,
        timestamp: now,
      };
    }

    // 2. Candidate Speech Level Detected
    this.measurement.recordBargeInActivityDetected(targetGen, level);

    if (this.candidateStartTime === null) {
      this.candidateStartTime = now;
      this.audit.record(
        targetGen,
        "barge_in_activity_detected",
        this.fence.getCurrentGeneration(),
        "barge_in_detector",
        `Candidate voice activity detected for Gen ${targetGen}: level=${level.toFixed(3)}`
      );
    }

    const activeDuration = Math.max(0, now - this.candidateStartTime);

    // 3. Minimum Sustained Speech Duration Check
    if (activeDuration < this.config.minActiveDurationMs) {
      return {
        kind: "insufficient_duration",
        targetGenerationId: targetGen,
        detectedLevel: level,
        durationMs: activeDuration,
        timestamp: now,
      };
    }

    // 4. Repeated Trigger Suppression / Cooldown Check (for same interrupted generation)
    if (
      this.lastInterruptedGenId === targetGen &&
      now - this.lastInterruptTimestamp < this.config.cooldownMs
    ) {
      this.measurement.recordBargeInSuppressedDuplicate(targetGen);
      return {
        kind: "suppressed_duplicate",
        targetGenerationId: targetGen,
        detectedLevel: level,
        timestamp: now,
        reason: "COOLDOWN_ACTIVE",
      };
    }

    // Speech is sustained and valid!
    this.measurement.recordBargeInConfirmed(targetGen, activeDuration);
    this.audit.record(
      targetGen,
      "barge_in_confirmed",
      this.fence.getCurrentGeneration(),
      "barge_in_detector",
      `Voice activity confirmed for Gen ${targetGen} after ${activeDuration}ms`
    );

    // 5. CRITICAL GENERATION AUTHORITY CHECK:
    // Verify target generation is still current before acting.
    // If target generation was superseded, this delayed callback must NEVER interrupt the new generation!
    if (!this.fence.isCurrent(targetGen) || this.interruptCtrl.isInterrupted(targetGen)) {
      const activeGen = this.fence.getCurrentGeneration();
      this.measurement.recordBargeInStaleIgnored(targetGen);
      this.audit.record(
        targetGen,
        "stale_barge_in_ignored",
        activeGen,
        "barge_in_detector",
        `Stale barge-in ignored: detection for Gen ${targetGen} arrived while active Gen is ${activeGen}`
      );
      this.stopMonitoring();
      this.notifyListeners({
        id: `barge-${now}-${targetGen}`,
        generationId: targetGen,
        timestamp: now,
        level,
        durationMs: activeDuration,
        confirmed: true,
        interrupted: false,
        stale: true,
      });
      return {
        kind: "stale_ignored",
        targetGenerationId: targetGen,
        activeGenerationId: activeGen,
        detectedLevel: level,
        timestamp: now,
        reason: "TARGET_GENERATION_SUPERSEDED",
      };
    }

    // 6. Confirmed, Authoritative Barge-In Interruption Path
    this.lastInterruptedGenId = targetGen;
    this.lastInterruptTimestamp = now;
    this.candidateStartTime = null;

    this.audit.record(
      targetGen,
      "barge_in_interrupt_triggered",
      this.fence.getCurrentGeneration(),
      "barge_in_detector",
      `Triggering interrupt on Gen ${targetGen} via InterruptController`
    );

    this.measurement.recordBargeInInterruptTriggered(targetGen, activeDuration);

    // Stop monitoring before triggering interrupt to avoid self-reinforcing loops
    this.stopMonitoring();

    // Trigger authoritative interruption through existing InterruptController
    this.interruptCtrl.interrupt(targetGen, "user_barge_in");

    this.notifyListeners({
      id: `barge-${now}-${targetGen}`,
      generationId: targetGen,
      timestamp: now,
      level,
      durationMs: activeDuration,
      confirmed: true,
      interrupted: true,
      stale: false,
    });

    return {
      kind: "interrupted",
      targetGenerationId: targetGen,
      detectedLevel: level,
      activeDurationMs: activeDuration,
      timestamp: now,
    };
  }

  /**
   * Deterministic simulation helper for automated testing.
   */
  public simulateAudioActivity(
    level: number,
    durationMs: number = 100,
    targetGenId?: number
  ): BargeInOutcome {
    if (typeof targetGenId === "number") {
      this.targetGenerationId = targetGenId;
      this.isMonitoring = true;
    }
    const startTime = Date.now();
    // Simulate first sample to initiate candidate
    this.processAudioLevel(level, startTime);
    // Simulate resolution sample after durationMs
    const outcome = this.processAudioLevel(level, startTime + durationMs);
    if (outcome.kind === "insufficient_duration") {
      this.candidateStartTime = null;
    }
    return outcome;
  }

  /**
   * Stops active monitoring and cleans up all audio/stream resources.
   * Safe and idempotent to call multiple times.
   */
  public stopMonitoring(): void {
    if (this.sampleTimer) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }

    this.candidateStartTime = null;

    // Disconnect Web Audio nodes
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // Ignored
      }
      this.sourceNode = null;
    }

    if (this.analyserNode && !this.customAnalyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch {
        // Ignored
      }
      this.analyserNode = null;
    }

    // Stop and release microphone tracks
    if (this.mediaStream && !this.customMediaStream) {
      try {
        this.mediaStream.getTracks().forEach((track) => track.stop());
      } catch {
        // Ignored
      }
      this.mediaStream = null;
    }

    // Close AudioContext if owned
    if (this.audioContext && !this.customAudioContext) {
      try {
        if (this.audioContext.state !== "closed") {
          this.audioContext.close();
        }
      } catch {
        // Ignored
      }
      this.audioContext = null;
    }

    const previousGen = this.targetGenerationId;
    this.targetGenerationId = null;
    this.isMonitoring = false;

    if (previousGen !== null) {
      this.audit.record(
        previousGen,
        "barge_in_monitoring_stopped",
        this.fence.getCurrentGeneration(),
        "barge_in_detector",
        `Stopped VAD monitoring for Gen ${previousGen}`
      );
    }
  }

  public isCurrentlyMonitoring(): boolean {
    return this.isMonitoring;
  }

  public hasActiveMicrophoneTracks(): boolean {
    if (!this.mediaStream) return false;
    return this.mediaStream.getTracks().some((track) => track.readyState === "live");
  }

  public getTargetGeneration(): number | null {
    return this.targetGenerationId;
  }

  public getLastDetectedLevel(): number {
    return this.lastDetectedLevel;
  }

  public subscribe(listener: BargeInListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(event: BargeInEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener error suppressed
      }
    }
  }

  public reset(): void {
    this.stopMonitoring();
    this.customMediaStream = null;
    this.customAudioContext = null;
    this.customAnalyserNode = null;
    this.lastInterruptedGenId = null;
    this.lastInterruptTimestamp = 0;
    this.lastDetectedLevel = 0;
    this.candidateStartTime = null;
    this.listeners.clear();
    this.config = { ...DEFAULT_BARGE_IN_CONFIG };
  }
}

export const bargeInDetector = new BargeInDetector();
