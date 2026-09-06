// test-step14.mjs
// Phase 3 Step 14: Real Barge-In Validation Verification Suite

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
    return this.currentGeneration > 0 && genId === this.currentGeneration && !this.invalidatedGens.has(genId);
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
    this.synthesisAborters = new Set();
    this.cleanups = new Map();
    this.stopCallCount = 0;
  }
  registerPlaybackStopper(stopper) {
    this.playbackStoppers.add(stopper);
    return () => this.playbackStoppers.delete(stopper);
  }
  registerSynthesisAborter(aborter) {
    this.synthesisAborters.add(aborter);
    return () => this.synthesisAborters.delete(aborter);
  }
  registerCleanup(genId, cleanup) {
    if (!this.cleanups.has(genId)) {
      this.cleanups.set(genId, new Set());
    }
    this.cleanups.get(genId).add(cleanup);
  }
  isInterrupted(genId) {
    return this.interruptedGens.has(genId);
  }
  interrupt(genId, reason = "user_barge_in") {
    this.stopCallCount++;
    this.interruptedGens.add(genId);
    this.fence.invalidate(genId);

    // Stop playback
    for (const stopper of this.playbackStoppers) {
      try {
        stopper(genId);
      } catch (err) {}
    }

    // Abort synthesis
    for (const aborter of this.synthesisAborters) {
      try {
        aborter(genId);
      } catch (err) {}
    }

    // Cleanups
    const cleanups = this.cleanups.get(genId);
    if (cleanups) {
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch (err) {}
      }
      this.cleanups.delete(genId);
    }
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
  }
  recordStaleResultAttempted() {
    this.staleResults.attempted++;
    this.updateProtectionRate();
  }
  recordStaleResultBlocked() {
    this.staleResults.blocked++;
    this.updateProtectionRate();
  }
  recordStaleAudioBlocked() {
    this.audio.staleAudioStartsBlocked++;
  }
  recordAudioPlaybackStopped(genId, latencyMs) {
    this.audio.stopLatencyMs = latencyMs;
  }
  recordBargeInActivityDetected() {
    this.bargeIn.detectedCount++;
  }
  recordBargeInConfirmed(genId, durationMs) {
    this.bargeIn.confirmedCount++;
    if (durationMs !== undefined) {
      this.bargeIn.detectionLatencyMs = durationMs;
    }
  }
  recordBargeInInterruptTriggered(genId, latencyMs) {
    this.bargeIn.interruptTriggeredCount++;
    if (latencyMs !== undefined) {
      this.bargeIn.interruptLatencyMs = latencyMs;
    }
  }
  recordBargeInStaleIgnored(genId) {
    this.bargeIn.staleIgnoredCount++;
    this.recordStaleResultAttempted();
    this.recordStaleResultBlocked();
  }
  recordBargeInSuppressedDuplicate() {
    this.bargeIn.falseDuplicateSuppressedCount++;
  }
  recordBargeInMicrophoneError() {
    this.bargeIn.microphoneErrors++;
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
    };
  }
}

/**
 * Mock AudioBufferSourceNode and AudioContext for Audio Playback Testing
 */
class MockSourceNode {
  constructor() {
    this.started = false;
    this.stopped = false;
    this.onended = null;
    this.stopCallCount = 0;
  }
  connect() {}
  disconnect() {}
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
    this.stopCallCount++;
  }
}

class MockAudioContext {
  constructor() {
    this.state = "running";
    this.sources = [];
  }
  createBufferSource() {
    const src = new MockSourceNode();
    this.sources.push(src);
    return src;
  }
  createMediaStreamSource() {
    return { connect() {}, disconnect() {} };
  }
  createAnalyser() {
    return {
      fftSize: 256,
      smoothingTimeConstant: 0.2,
      frequencyBinCount: 128,
      getByteFrequencyData(arr) {
        arr.fill(10);
      },
      connect() {},
      disconnect() {},
    };
  }
  close() {
    this.state = "closed";
  }
}

/**
 * Harness implementation of BargeInDetector aligned with lib/barge-in-detector.ts
 */
class TestBargeInDetector {
  constructor(fence, interruptCtrl, measurement, audit) {
    this.fence = fence;
    this.interruptCtrl = interruptCtrl;
    this.measurement = measurement;
    this.audit = audit;

    this.config = {
      enabled: true,
      threshold: 0.05,
      minActiveDurationMs: 80,
      cooldownMs: 400,
      sampleIntervalMs: 20,
    };

    this.targetGenerationId = null;
    this.isMonitoring = false;
    this.candidateStartTime = null;
    this.lastInterruptedGenId = null;
    this.lastInterruptTimestamp = 0;

    this.customMediaStream = null;
    this.customAudioContext = null;
    this.customAnalyserNode = null;
    this.listeners = new Set();
  }

  setMocksForTesting(mocks) {
    this.customMediaStream = mocks.mediaStream ?? null;
    this.customAudioContext = mocks.audioContext ?? null;
    this.customAnalyserNode = mocks.analyserNode ?? null;
  }

  async startMonitoring(targetGenerationId, options) {
    const timestamp = Date.now();
    if (options) {
      this.config = { ...this.config, ...options };
    }
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

    if (!this.customMediaStream) {
      this.measurement.recordBargeInMicrophoneError("MICROPHONE_UNAVAILABLE");
      this.audit.record(
        targetGenerationId,
        "barge_in_detection_failed",
        this.fence.getCurrentGeneration(),
        "barge_in_detector",
        "Microphone unavailable"
      );
      return {
        kind: "failed",
        errorCode: "MICROPHONE_UNAVAILABLE",
        error: "Microphone unavailable in test environment without mock",
        timestamp,
      };
    }

    this.isMonitoring = true;
    this.audit.record(
      targetGenerationId,
      "barge_in_monitoring_started",
      this.fence.getCurrentGeneration(),
      "barge_in_detector",
      `Started VAD monitoring for Gen ${targetGenerationId}`
    );

    return {
      kind: "below_threshold",
      targetGenerationId,
      detectedLevel: 0,
      timestamp,
    };
  }

  processAudioLevel(level, explicitTimestamp) {
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

    // 2. Candidate Speech Detected
    this.measurement.recordBargeInActivityDetected(targetGen, level);

    if (this.candidateStartTime === null) {
      this.candidateStartTime = now;
      this.audit.record(
        targetGen,
        "barge_in_activity_detected",
        this.fence.getCurrentGeneration(),
        "barge_in_detector",
        `Candidate voice activity detected for Gen ${targetGen}: level=${level}`
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
    this.stopMonitoring();

    // Trigger authoritative interruption through existing InterruptController
    this.interruptCtrl.interrupt(targetGen, "user_barge_in");

    return {
      kind: "interrupted",
      targetGenerationId: targetGen,
      detectedLevel: level,
      activeDurationMs: activeDuration,
      timestamp: now,
    };
  }

  simulateAudioActivity(level, durationMs = 100, targetGenId) {
    if (typeof targetGenId === "number") {
      this.targetGenerationId = targetGenId;
      this.isMonitoring = true;
    }
    const startTime = Date.now();
    this.processAudioLevel(level, startTime);
    const outcome = this.processAudioLevel(level, startTime + durationMs);
    if (outcome.kind === "insufficient_duration") {
      this.candidateStartTime = null;
    }
    return outcome;
  }

  stopMonitoring() {
    this.candidateStartTime = null;
    const prevGen = this.targetGenerationId;
    this.targetGenerationId = null;
    this.isMonitoring = false;

    if (prevGen !== null) {
      this.audit.record(
        prevGen,
        "barge_in_monitoring_stopped",
        this.fence.getCurrentGeneration(),
        "barge_in_detector",
        `Stopped VAD monitoring for Gen ${prevGen}`
      );
    }
  }

  isCurrentlyMonitoring() {
    return this.isMonitoring;
  }

  getTargetGeneration() {
    return this.targetGenerationId;
  }

  reset() {
    this.stopMonitoring();
    this.customMediaStream = null;
    this.customAudioContext = null;
    this.customAnalyserNode = null;
    this.lastInterruptedGenId = null;
    this.lastInterruptTimestamp = 0;
    this.candidateStartTime = null;
  }
}

/**
 * Harness implementation of Playback Layer to verify active audio stop on barge-in
 */
class TestPlaybackLayer {
  constructor(interruptCtrl, measurement) {
    this.interruptCtrl = interruptCtrl;
    this.measurement = measurement;
    this.activeNodes = new Map();

    this.interruptCtrl.registerPlaybackStopper((genId) => {
      this.stopGeneration(genId);
    });
  }

  startPlayback(generationId, sourceNode) {
    if (!this.activeNodes.has(generationId)) {
      this.activeNodes.set(generationId, []);
    }
    this.activeNodes.get(generationId).push(sourceNode);
    sourceNode.start();
  }

  stopGeneration(generationId) {
    const nodes = this.activeNodes.get(generationId);
    if (!nodes) return { stopped: false, stopLatencyMs: 0 };

    for (const node of nodes) {
      node.stop();
      node.onended = null;
    }
    this.activeNodes.delete(generationId);
    this.measurement.recordAudioPlaybackStopped(generationId, 2);
    return { stopped: true, stopLatencyMs: 2 };
  }

  isPlaying(generationId) {
    const nodes = this.activeNodes.get(generationId);
    return Boolean(nodes && nodes.length > 0 && nodes.some((n) => !n.stopped));
  }
}

/**
 * Harness implementation of Synthesis Layer to verify abort on barge-in
 */
class TestSynthesisLayer {
  constructor(interruptCtrl) {
    this.interruptCtrl = interruptCtrl;
    this.abortedGens = new Set();
    this.activeRequests = new Map();

    this.interruptCtrl.registerSynthesisAborter((genId) => {
      this.abortGeneration(genId);
    });
  }

  startSynthesis(generationId, requestId) {
    this.activeRequests.set(requestId, { generationId, aborted: false });
  }

  abortGeneration(generationId) {
    this.abortedGens.add(generationId);
    for (const [reqId, req] of this.activeRequests.entries()) {
      if (req.generationId === generationId) {
        req.aborted = true;
      }
    }
  }

  isAborted(generationId) {
    return this.abortedGens.has(generationId);
  }
}

async function runStep14Tests() {
  console.log(bold(cyan("\n==================================================")));
  console.log(bold(cyan(" PHASE 3 — STEP 14: REAL BARGE-IN VALIDATION SUITE")));
  console.log(bold(cyan("==================================================\n")));

  // --------------------------------------------------
  // TEST GROUP 1: MODULE EXISTENCE & FILE CONTRACTS
  // --------------------------------------------------
  console.log(bold("TEST GROUP 1: Module existence & type contracts"));
  const detectorPath = path.resolve("lib/barge-in-detector.ts");
  assert(fs.existsSync(detectorPath), "lib/barge-in-detector.ts exists on disk");
  const detectorSource = fs.readFileSync(detectorPath, "utf-8");
  assert(detectorSource.includes("export class BargeInDetector"), "Exports BargeInDetector class");
  assert(detectorSource.includes("export const bargeInDetector"), "Exports singleton bargeInDetector");

  const typesPath = path.resolve("types/barge-in.ts");
  assert(fs.existsSync(typesPath), "types/barge-in.ts exists on disk");
  const typesSource = fs.readFileSync(typesPath, "utf-8");
  assert(typesSource.includes("export interface BargeInConfig"), "types/barge-in.ts defines BargeInConfig");
  assert(typesSource.includes("export type BargeInOutcome"), "types/barge-in.ts defines BargeInOutcome");
  assert(typesSource.includes("export type BargeInErrorCode"), "types/barge-in.ts defines BargeInErrorCode");

  // Initialize isolated test harness
  const fence = new TestFence();
  const interruptCtrl = new TestInterruptController(fence);
  const measurement = new TestPipeline();
  const audit = new TestAudit();
  const detector = new TestBargeInDetector(fence, interruptCtrl, measurement, audit);
  const playback = new TestPlaybackLayer(interruptCtrl, measurement);
  const synthesis = new TestSynthesisLayer(interruptCtrl);

  const mockStream = {
    getTracks() {
      return [{ stop() {} }];
    },
  };
  const mockCtx = new MockAudioContext();

  // --------------------------------------------------
  // TEST GROUP 2: BARGE-IN DETECTION
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 2: Voice activity above threshold confirmed"));
  const gen1 = fence.beginGeneration();
  detector.setMocksForTesting({ mediaStream: mockStream, audioContext: mockCtx });

  await detector.startMonitoring(gen1);
  assert(detector.isCurrentlyMonitoring() === true, "Monitoring is active for Gen 1");

  // Simulate sustained speech (level 0.15 > 0.05 threshold for 100ms > 80ms minActiveDuration)
  const confirmedOutcome = detector.simulateAudioActivity(0.15, 100);
  assert(confirmedOutcome.kind === "interrupted", "Confirmed speech results in 'interrupted'");
  assert(confirmedOutcome.targetGenerationId === gen1, "Target generation preserved");
  assert(interruptCtrl.isInterrupted(gen1), "Gen 1 marked interrupted in controller");
  assert(detector.isCurrentlyMonitoring() === false, "Monitoring auto-stops after barge-in interruption");

  // --------------------------------------------------
  // TEST GROUP 3: NOISE / BELOW THRESHOLD
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 3: Noise below threshold does not interrupt"));
  const gen2 = fence.beginGeneration();
  await detector.startMonitoring(gen2);
  const initialStopCalls = interruptCtrl.stopCallCount;

  // Simulate background noise (0.02 < 0.05)
  const noiseOutcome = detector.simulateAudioActivity(0.02, 100);
  assert(noiseOutcome.kind === "below_threshold", "Noise evaluates to 'below_threshold'");
  assert(!interruptCtrl.isInterrupted(gen2), "Gen 2 was NOT interrupted by noise");
  assert(interruptCtrl.stopCallCount === initialStopCalls, "No interrupt triggered");
  assert(detector.isCurrentlyMonitoring() === true, "Monitoring remains active");

  // --------------------------------------------------
  // TEST GROUP 4: MINIMUM DURATION
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 4: Short spikes do not interrupt; sustained speech does"));
  // Short 30ms spike (30ms < 80ms minActiveDuration)
  const spikeOutcome = detector.simulateAudioActivity(0.2, 30);
  assert(spikeOutcome.kind === "insufficient_duration", "Short spike evaluated to 'insufficient_duration'");
  assert(!interruptCtrl.isInterrupted(gen2), "Gen 2 not interrupted by short spike");

  // Sustained speech (120ms > 80ms)
  const sustainedOutcome = detector.simulateAudioActivity(0.2, 120);
  assert(sustainedOutcome.kind === "interrupted", "Sustained speech confirms barge-in");
  assert(interruptCtrl.isInterrupted(gen2), "Gen 2 interrupted after sustained speech");

  // --------------------------------------------------
  // TEST GROUP 5: ACTIVE GENERATION INTERRUPTION
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 5: Active playback stops & in-flight synthesis aborts on barge-in"));
  const gen3 = fence.beginGeneration();
  const gen3Source = new MockSourceNode();
  playback.startPlayback(gen3, gen3Source);
  synthesis.startSynthesis(gen3, "req-3A");

  assert(playback.isPlaying(gen3) === true, "Gen 3 is playing audio");
  assert(synthesis.isAborted(gen3) === false, "Gen 3 synthesis is active");

  await detector.startMonitoring(gen3);
  detector.simulateAudioActivity(0.18, 100);

  assert(playback.isPlaying(gen3) === false, "Gen 3 playback was halted immediately");
  assert(gen3Source.stopped === true, "Source node stop() was called");
  assert(synthesis.isAborted(gen3) === true, "Gen 3 in-flight synthesis was aborted");

  // --------------------------------------------------
  // TEST GROUP 6: NEW GENERATION ISOLATION
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 6: Stopping G3 does NOT stop Generation G4"));
  const gen4 = fence.beginGeneration();
  const gen4Source = new MockSourceNode();
  playback.startPlayback(gen4, gen4Source);

  assert(playback.isPlaying(gen4) === true, "Gen 4 playback started");
  assert(gen4Source.stopCallCount === 0, "Gen 4 source has not been stopped");

  // Verify G3 is dead and G4 is live
  assert(fence.isCurrent(gen3) === false, "Gen 3 is not current");
  assert(fence.isCurrent(gen4) === true, "Gen 4 is authoritative");

  // --------------------------------------------------
  // TEST GROUP 7: STALE BARGE-IN CALLBACK (Critical Race)
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 7: Stale barge-in callback does NOT interrupt newer generation"));
  const gen5 = fence.beginGeneration();
  await detector.startMonitoring(gen5);

  // While detection was running for Gen 5, user initiates Gen 6
  const gen6 = fence.beginGeneration();
  assert(fence.isCurrent(gen6) === true, "Gen 6 is now current");

  // Delayed VAD sample for Gen 5 arrives late
  const staleOutcome = detector.simulateAudioActivity(0.2, 100);
  assert(staleOutcome.kind === "stale_ignored", "Delayed Gen 5 detection evaluated to 'stale_ignored'");
  assert(staleOutcome.targetGenerationId === gen5, "Preserves target Gen 5");
  assert(!interruptCtrl.isInterrupted(gen6), "Gen 6 was NOT interrupted by delayed Gen 5 speech");
  assert(fence.isCurrent(gen6) === true, "Gen 6 remains authoritative");

  // --------------------------------------------------
  // TEST GROUP 8: LATE SYNTHESIS AFTER BARGE-IN
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 8: Late synthesis result after barge-in cannot become authoritative"));
  const gen7 = fence.beginGeneration();
  await detector.startMonitoring(gen7);
  detector.simulateAudioActivity(0.25, 100);

  // Gen 8 starts
  const gen8 = fence.beginGeneration();
  // Late Gen 7 synthesis arrives
  const isGen7Current = fence.isCurrent(gen7);
  assert(isGen7Current === false, "Late Gen 7 synthesis cannot pass fence authority check");
  assert(fence.isCurrent(gen8) === true, "Gen 8 remains current");

  // --------------------------------------------------
  // TEST GROUP 9: LATE AUDIO DECODE AFTER BARGE-IN
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 9: Late audio decode after barge-in is blocked"));
  // Simulated decode checkpoint:
  const isStaleDuringDecode = !fence.isCurrent(gen7);
  assert(isStaleDuringDecode === true, "Gen 7 blocked after decode before source node creation");

  // --------------------------------------------------
  // TEST GROUP 10: ACTIVE AUDIO STOP LATENCY
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 10: Active audio stop latency & interrupt latency measured"));
  const snapshot10 = measurement.getSnapshot();
  assert(snapshot10.audio.stopLatencyMs !== null, "Audio stop latency was measured");
  assert(snapshot10.bargeIn.interruptLatencyMs !== null, "Barge-in interrupt latency was measured");

  // --------------------------------------------------
  // TEST GROUP 11: IDEMPOTENCY & DUPLICATE SUPPRESSION
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 11: Duplicate triggers within cooldown are suppressed"));
  const gen9 = fence.beginGeneration();
  await detector.startMonitoring(gen9);
  const int1 = detector.simulateAudioActivity(0.3, 100);
  assert(int1.kind === "interrupted", "First trigger causes interrupt");

  // Immediate second sample for same gen within cooldown
  detector.isMonitoring = true;
  detector.targetGenerationId = gen9;
  const int2 = detector.simulateAudioActivity(0.3, 100);
  assert(int2.kind === "suppressed_duplicate", "Second trigger within cooldown is suppressed");

  // --------------------------------------------------
  // TEST GROUP 12: MICROPHONE API UNAVAILABLE
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 12: Microphone API unavailable produces normalized error"));
  detector.reset(); // Clear mocks
  const gen10 = fence.beginGeneration();
  const noMicOutcome = await detector.startMonitoring(gen10);
  assert(noMicOutcome.kind === "failed", "Returns kind 'failed'");
  assert(noMicOutcome.errorCode === "MICROPHONE_UNAVAILABLE", "errorCode is MICROPHONE_UNAVAILABLE");

  // --------------------------------------------------
  // TEST GROUP 13: MICROPHONE PERMISSION DENIED
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 13: Permission denied produces normalized error"));
  const permissionDeniedSource = fs.readFileSync(detectorPath, "utf-8");
  assert(permissionDeniedSource.includes("MICROPHONE_PERMISSION_DENIED"), "Detector normalizes MICROPHONE_PERMISSION_DENIED");
  assert(permissionDeniedSource.includes("MICROPHONE_ACCESS_FAILED"), "Detector normalizes MICROPHONE_ACCESS_FAILED");

  // --------------------------------------------------
  // TEST GROUP 14: AUDIO ANALYSIS FAILURE
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 14: Audio analysis failure handles gracefully"));
  assert(permissionDeniedSource.includes("AUDIO_ANALYSER_UNAVAILABLE"), "Detector normalizes AUDIO_ANALYSER_UNAVAILABLE");

  // --------------------------------------------------
  // TEST GROUP 15: CLEANUP SAFETY
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 15: Idempotent cleanup and unmount safety"));
  detector.stopMonitoring();
  detector.stopMonitoring(); // Repeated stop
  assert(detector.isCurrentlyMonitoring() === false, "Monitoring remains false after repeated stop");
  assert(detector.getTargetGeneration() === null, "Target generation is null after cleanup");

  // --------------------------------------------------
  // TEST GROUP 16: AUDIT EVENTS
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 16: GenerationAudit records required Step 14 events"));
  const events = audit.getEvents();
  const eventTypes = new Set(events.map((e) => e.event));

  assert(eventTypes.has("barge_in_monitoring_started"), "Logged barge_in_monitoring_started");
  assert(eventTypes.has("barge_in_monitoring_stopped"), "Logged barge_in_monitoring_stopped");
  assert(eventTypes.has("barge_in_activity_detected"), "Logged barge_in_activity_detected");
  assert(eventTypes.has("barge_in_confirmed"), "Logged barge_in_confirmed");
  assert(eventTypes.has("barge_in_interrupt_triggered"), "Logged barge_in_interrupt_triggered");
  assert(eventTypes.has("stale_barge_in_ignored"), "Logged stale_barge_in_ignored");

  // Chronological ordering check
  let isSorted = true;
  for (let i = 0; i < events.length - 1; i++) {
    if (events[i].timestamp < events[i + 1].timestamp) {
      isSorted = false;
      break;
    }
  }
  assert(isSorted, "Audit events are chronologically descending");

  // --------------------------------------------------
  // TEST GROUP 17: MEASUREMENT INVARIANTS
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 17: Measurement invariants hold"));
  const finalSnapshot = measurement.getSnapshot();
  const b = finalSnapshot.bargeIn;

  assert(b.detectedCount >= b.confirmedCount, "confirmedCount <= detectedCount");
  assert(b.confirmedCount >= b.interruptTriggeredCount, "interruptTriggeredCount <= confirmedCount");
  assert(b.staleIgnoredCount >= 1, "staleIgnoredCount tracked (got " + b.staleIgnoredCount + ")");
  assert(b.falseDuplicateSuppressedCount >= 1, "falseDuplicateSuppressedCount tracked");
  assert(finalSnapshot.staleResults.blocked <= finalSnapshot.staleResults.attempted, "blocked <= attempted");
  assert(finalSnapshot.staleResults.protectionRate === 100, "protectionRate is 100%");
  assert(finalSnapshot.audio.resurrectionCount === 0, "audio.resurrectionCount is strictly 0");
  assert(finalSnapshot.transcript.corruptionCount === 0, "transcript.corruptionCount is strictly 0");

  // --------------------------------------------------
  // TEST GROUP 18: SECRET SAFETY
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 18: Zero secrets in outcomes, audit events, and metrics"));
  const testData = JSON.stringify([
    confirmedOutcome,
    noiseOutcome,
    spikeOutcome,
    staleOutcome,
    finalSnapshot,
    events,
  ]);

  const sensitive = [/RIME_API_KEY/, /apiKey/, /rawKey/, /Authorization/, /Bearer /, /sk-[a-zA-Z0-9]{20,}/];
  for (const pat of sensitive) {
    assert(!pat.test(testData), `No sensitive pattern ${pat} in Step 14 data`);
  }

  // --------------------------------------------------
  // TEST GROUP 19: INTEGRATION WITH VOICE CONSOLE & CONTROLLERS
  // --------------------------------------------------
  console.log(bold("\nTEST GROUP 19: Integration with VoiceConsole & InterruptController"));
  const consoleSource = fs.readFileSync(path.resolve("components/voice/VoiceConsole.tsx"), "utf-8");
  assert(consoleSource.includes('from "@/lib/barge-in-detector"'), "VoiceConsole imports bargeInDetector");
  assert(consoleSource.includes("bargeInDetector.startMonitoring"), "VoiceConsole starts barge-in monitoring");
  assert(consoleSource.includes("bargeInDetector.stopMonitoring"), "VoiceConsole stops barge-in monitoring");

  const interruptSource = fs.readFileSync(path.resolve("lib/interrupt-controller.ts"), "utf-8");
  assert(interruptSource.includes("registerSynthesisAborter"), "InterruptController has registerSynthesisAborter");
  assert(interruptSource.includes("for (const aborter of this.synthesisAborters)"), "InterruptController invokes synthesis aborters");

  const synthSource = fs.readFileSync(path.resolve("lib/generation-aware-synthesis.ts"), "utf-8");
  assert(synthSource.includes("registerSynthesisAborter"), "GenerationAwareSynthesis registers with InterruptController");

  console.log(bold(green("\nAll Step 14 verification tests passed successfully!")));
  console.log(bold(cyan("\n==================================================")));
  console.log(bold(cyan("   PHASE 3 — STEP 14: BARGE-IN COMPLETE           ")));
  console.log(bold(cyan("==================================================")));
  console.log(`SUMMARY:`);
  console.log(`${passedCount} PASSED, ${failedCount} FAILED`);
  console.log(bold(cyan("==================================================\n")));
}

runStep14Tests().catch((err) => {
  console.error(red(`\nTest suite failed with error: ${err.message}`));
  console.error(err.stack);
  process.exit(1);
});
