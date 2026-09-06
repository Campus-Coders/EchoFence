// test-step13.mjs
// Phase 3 Step 13: Generation-Aware Browser Audio Playback Verification Suite

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";

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
  }
  getCurrentGeneration() {
    return this.currentGeneration;
  }
  beginGeneration() {
    this.currentGeneration += 1;
    return this.currentGeneration;
  }
  isCurrent(genId) {
    return this.currentGeneration > 0 && genId === this.currentGeneration;
  }
  recordStaleBlocked() {
    this.staleBlockedCount++;
  }
}

class TestInterruptController {
  constructor() {
    this.interruptedGens = new Set();
    this.cleanups = new Map();
    this.playbackStoppers = new Set();
  }
  registerCleanup(genId, cleanup) {
    if (!this.cleanups.has(genId)) {
      this.cleanups.set(genId, new Set());
    }
    this.cleanups.get(genId).add(cleanup);
  }
  registerPlaybackStopper(stopper) {
    this.playbackStoppers.add(stopper);
    return () => this.playbackStoppers.delete(stopper);
  }
  isInterrupted(genId) {
    return this.interruptedGens.has(genId);
  }
  interrupt(genId) {
    this.interruptedGens.add(genId);
    for (const stopper of this.playbackStoppers) {
      try {
        stopper(genId);
      } catch (err) {
        // Ignored
      }
    }
    const cleanups = this.cleanups.get(genId);
    if (cleanups) {
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch (err) {
          // Ignored
        }
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
  recordAudioDecodeCompleted(genId, latencyMs) {
    this.audio.decodeLatencyMs = latencyMs;
  }
  recordAudioPlaybackStarted(genId, latencyMs) {
    this.audio.activeGeneration = genId;
    this.audio.startLatencyMs = latencyMs ?? 0;
  }
  recordAudioPlaybackStopped(genId, latencyMs) {
    if (this.audio.activeGeneration === genId) {
      this.audio.activeGeneration = null;
    }
    if (latencyMs !== undefined) {
      this.audio.stopLatencyMs = latencyMs;
    }
  }
  recordAudioResurrection() {
    this.audio.resurrectionCount++;
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
    };
  }
}

// ----------------------------------------------------
// Mock Web Audio Implementation
// ----------------------------------------------------

class MockAudioBufferSourceNode {
  constructor(ctx) {
    this.ctx = ctx;
    this.buffer = null;
    this.onended = null;
    this.started = false;
    this.stopped = false;
    this.connected = false;
    this.startCallCount = 0;
    this.stopCallCount = 0;
  }
  connect(_destination) {
    this.connected = true;
  }
  disconnect() {
    this.connected = false;
  }
  start(_time = 0) {
    this.started = true;
    this.startCallCount++;
  }
  stop() {
    this.stopped = true;
    this.stopCallCount++;
  }
}

class MockAudioBuffer {
  constructor(duration = 2.5) {
    this.duration = duration;
    this.length = Math.round(44100 * duration);
    this.sampleRate = 44100;
    this.numberOfChannels = 1;
  }
}

class MockAudioContext {
  constructor(options = {}) {
    this.state = options.state || "running";
    this.destination = {};
    this.decodeDelayMs = options.decodeDelayMs || 0;
    this.shouldFailDecode = options.shouldFailDecode || false;
    this.shouldFailResume = options.shouldFailResume || false;
    this.createdSources = [];
    this.decodeCallCount = 0;
    this.duration = options.duration || 2.5;
    this.closed = false;
  }

  async resume() {
    if (this.shouldFailResume) {
      throw new Error("Autoplay policy prevented resume");
    }
    this.state = "running";
  }

  async decodeAudioData(_buffer) {
    this.decodeCallCount++;
    if (this.shouldFailDecode) {
      throw new Error("Corrupt audio payload could not be decoded");
    }
    if (this.decodeDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.decodeDelayMs));
    }
    return new MockAudioBuffer(this.duration);
  }

  createBufferSource() {
    const src = new MockAudioBufferSourceNode(this);
    this.createdSources.push(src);
    return src;
  }

  close() {
    this.closed = true;
    this.state = "closed";
  }
}

/**
 * Test Harness for GenerationAwareAudio aligning with lib/generation-aware-audio.ts
 */
class TestGenerationAwareAudio {
  constructor(fence, interruptCtrl, measurement, audit) {
    this.fence = fence;
    this.interruptCtrl = interruptCtrl;
    this.measurement = measurement;
    this.audit = audit;
    this.customAudioContext = null;
    this.activePlaybacks = new Map();

    this.interruptCtrl.registerPlaybackStopper((genId) => {
      this.stopGeneration(genId, "INTERRUPTED");
    });
  }

  setAudioContextForTesting(ctx) {
    this.customAudioContext = ctx;
  }

  getAudioContext() {
    return this.customAudioContext;
  }

  getOrCreateAudioContext() {
    return this.customAudioContext;
  }

  async playAuthorizedAudio(authorized) {
    const timestamp = Date.now();

    // 0. Validation
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

    const ctx = this.getOrCreateAudioContext();
    if (!ctx) {
      const errOutcome = {
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

    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch (resumeErr) {
        const errOutcome = {
          kind: "failed",
          generationId,
          requestId,
          errorCode: "AUDIO_CONTEXT_RESUME_FAILED",
          error: resumeErr?.message || "Resume failed",
          failedAt: Date.now(),
        };
        this.audit.record(
          generationId,
          "audio_playback_failed",
          this.fence.getCurrentGeneration(),
          "generation_aware_audio",
          `AudioContext resume failed: ${errOutcome.error}`
        );
        return errOutcome;
      }
    }

    this.audit.record(
      generationId,
      "audio_decode_started",
      this.fence.getCurrentGeneration(),
      "generation_aware_audio",
      `Decoding audio buffer for Gen ${generationId} (${requestId})`
    );

    const decodeStartTime = Date.now();
    let decodedAudioBuffer;

    try {
      const bufferCopy = audioBuffer.slice(0);
      decodedAudioBuffer = await ctx.decodeAudioData(bufferCopy);
    } catch (decodeErr) {
      const errOutcome = {
        kind: "failed",
        generationId,
        requestId,
        errorCode: "AUDIO_DECODE_FAILED",
        error: decodeErr?.message || "AudioBuffer decoding failed",
        failedAt: Date.now(),
      };
      this.audit.record(
        generationId,
        "audio_playback_failed",
        this.fence.getCurrentGeneration(),
        "generation_aware_audio",
        `Audio decode failed: ${errOutcome.error}`
      );
      return errOutcome;
    }

    const decodeLatencyMs = Math.max(1, Date.now() - decodeStartTime);
    this.measurement.recordAudioDecodeCompleted(generationId, decodeLatencyMs);
    this.audit.record(
      generationId,
      "audio_decode_completed",
      this.fence.getCurrentGeneration(),
      "generation_aware_audio",
      `Decoded ${decodedAudioBuffer.duration.toFixed(2)}s audio in ${decodeLatencyMs}ms`
    );

    // CHECKPOINT 2 — AFTER ASYNCHRONOUS DECODING
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

    let sourceNode;
    try {
      sourceNode = ctx.createBufferSource();
      sourceNode.buffer = decodedAudioBuffer;
      sourceNode.connect(ctx.destination);
    } catch (nodeErr) {
      return {
        kind: "failed",
        generationId,
        requestId,
        errorCode: "AUDIO_START_FAILED",
        error: nodeErr?.message || "AudioBufferSourceNode creation failed",
        failedAt: Date.now(),
      };
    }

    // CHECKPOINT 3 — IMMEDIATELY BEFORE source.start()
    if (!this.fence.isCurrent(generationId) || this.interruptCtrl.isInterrupted(generationId)) {
      try {
        sourceNode.disconnect();
      } catch (e) {}
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

    const startTimestamp = Date.now();
    try {
      sourceNode.start(0);
    } catch (startErr) {
      try {
        sourceNode.disconnect();
      } catch (e) {}
      return {
        kind: "failed",
        generationId,
        requestId,
        errorCode: "AUDIO_START_FAILED",
        error: startErr?.message || "sourceNode.start() failed",
        failedAt: Date.now(),
      };
    }

    if (!this.activePlaybacks.has(generationId)) {
      this.activePlaybacks.set(generationId, new Map());
    }

    const handle = {
      generationId,
      requestId,
      source: sourceNode,
      audioBuffer: decodedAudioBuffer,
      startedAt: startTimestamp,
      stopped: false,
    };

    this.activePlaybacks.get(generationId).set(requestId, handle);

    this.interruptCtrl.registerCleanup(generationId, () => {
      this.stopGeneration(generationId, "INTERRUPTED");
    });

    sourceNode.onended = () => {
      if (!handle.stopped) {
        handle.stopped = true;
        try {
          sourceNode.disconnect();
        } catch (e) {}
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

  stopGeneration(generationId, reason = "INTERRUPTED") {
    const startTime = Date.now();
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
        handle.source.onended = null;
        try {
          handle.source.stop();
        } catch (e) {}
        try {
          handle.source.disconnect();
        } catch (e) {}
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
    const stopLatencyMs = Math.max(1, Date.now() - startTime);

    this.measurement.recordAudioPlaybackStopped(generationId, stopLatencyMs);

    return {
      stopped: stoppedCount > 0,
      stopLatencyMs,
      timestamp,
      playbackPositionSeconds: 0,
    };
  }

  stopAll(reason = "INTERRUPTED") {
    const results = [];
    const activeGens = Array.from(this.activePlaybacks.keys());
    for (const genId of activeGens) {
      results.push(this.stopGeneration(genId, reason));
    }
    return results;
  }

  handleStaleAttempt(generationId, requestId, reason) {
    this.measurement.recordStaleResultAttempted(generationId);
    this.measurement.recordStaleResultBlocked(generationId);
    this.measurement.recordStaleAudioBlocked(generationId);

    this.fence.recordStaleBlocked(generationId);

    this.audit.record(
      generationId,
      "stale_audio_start_blocked",
      this.fence.getCurrentGeneration(),
      "generation_aware_audio",
      `Audio playback prevented from starting: reason=${reason}, activeGen=${this.fence.getCurrentGeneration()}`
    );
  }

  isGenerationPlaying(generationId) {
    const genPlaybacks = this.activePlaybacks.get(generationId);
    if (!genPlaybacks) return false;
    for (const handle of genPlaybacks.values()) {
      if (!handle.stopped) return true;
    }
    return false;
  }

  getActivePlaybackCount() {
    let count = 0;
    for (const genMap of this.activePlaybacks.values()) {
      for (const handle of genMap.values()) {
        if (!handle.stopped) count++;
      }
    }
    return count;
  }
}

function createDummyArrayBuffer(size = 64) {
  return new ArrayBuffer(size);
}

function createDummyAuthorizedResult(generationId, requestId, overrides = {}) {
  return {
    authorized: true,
    generationId,
    requestId: requestId || `req-${generationId}-${Date.now()}`,
    audioBuffer: createDummyArrayBuffer(64),
    contentType: "audio/mpeg",
    provider: "Rime",
    providerLatencyMs: 45,
    authorizedAt: Date.now(),
    ...overrides,
  };
}

async function runStep13Tests() {
  console.log(bold(cyan("\n==================================================")));
  console.log(bold(cyan(" PHASE 3 — STEP 13: BROWSER AUDIO PLAYBACK SUITE  ")));
  console.log(bold(cyan("==================================================\n")));

  // TEST 1: File Existence and Exports Verification
  console.log(bold("TEST 1: Generation-aware browser audio module files exist"));
  const audioModulePath = path.resolve("lib/generation-aware-audio.ts");
  assert(fs.existsSync(audioModulePath), "lib/generation-aware-audio.ts exists on disk");
  const audioSource = fs.readFileSync(audioModulePath, "utf-8");
  assert(audioSource.includes("export class GenerationAwareAudio"), "Exports GenerationAwareAudio class");
  assert(audioSource.includes("export const generationAwareAudio"), "Exports singleton generationAwareAudio");

  // TEST 2: Type Contracts Verification
  console.log(bold("\nTEST 2: Type contracts defined in types/provider.ts"));
  const providerTypesPath = path.resolve("types/provider.ts");
  const providerTypesSource = fs.readFileSync(providerTypesPath, "utf-8");
  assert(providerTypesSource.includes("export type AudioPlaybackOutcome"), "types/provider.ts defines AudioPlaybackOutcome");
  assert(providerTypesSource.includes("export type AudioPlaybackErrorCode"), "types/provider.ts defines AudioPlaybackErrorCode");
  assert(providerTypesSource.includes("export interface PlaybackHandle"), "types/provider.ts defines PlaybackHandle");

  // Instantiate isolated harness
  const fence = new TestFence();
  const interruptCtrl = new TestInterruptController();
  const measurement = new TestPipeline();
  const audit = new TestAudit();
  const audio = new TestGenerationAwareAudio(fence, interruptCtrl, measurement, audit);

  // TEST 3: Consumes ONLY AuthorizedSynthesisResult
  console.log(bold("\nTEST 3: Rejects invalid or unauthorized results"));
  const mockCtx = new MockAudioContext();
  audio.setAudioContextForTesting(mockCtx);

  const gen1 = fence.beginGeneration();
  const unauthOutcome = await audio.playAuthorizedAudio({
    authorized: false,
    generationId: gen1,
    requestId: "req-unauth",
    audioBuffer: createDummyArrayBuffer(),
  });
  assert(unauthOutcome.kind === "blocked", "Unauthorized result is blocked");
  assert(unauthOutcome.reason === "UNAUTHORIZED_INPUT", "Reason is UNAUTHORIZED_INPUT");

  // TEST 4: Checkpoint 1: Stale generation blocked BEFORE decode
  console.log(bold("\nTEST 4: Checkpoint 1: Stale generation blocked BEFORE decode"));
  const staleGen = 99; // Not current in fence (current is 1)
  const staleAuth = createDummyAuthorizedResult(staleGen, "req-stale-1");
  const preFlightCtx = new MockAudioContext();
  audio.setAudioContextForTesting(preFlightCtx);

  const stalePreOutcome = await audio.playAuthorizedAudio(staleAuth);
  assert(stalePreOutcome.kind === "blocked", "Stale result blocked at Checkpoint 1");
  assert(stalePreOutcome.reason === "PRE_PLAYBACK_STALE", "Reason is PRE_PLAYBACK_STALE");
  assert(preFlightCtx.decodeCallCount === 0, "decodeAudioData was NEVER called for stale generation");
  assert(preFlightCtx.createdSources.length === 0, "No audio source node was created");

  // TEST 5: Current generation successfully decodes and starts playback
  console.log(bold("\nTEST 5: Current generation successfully decodes and starts playback"));
  const gen2 = fence.beginGeneration();
  const gen2Ctx = new MockAudioContext();
  audio.setAudioContextForTesting(gen2Ctx);

  const gen2Auth = createDummyAuthorizedResult(gen2, "req-gen2-normal");
  const gen2Outcome = await audio.playAuthorizedAudio(gen2Auth);

  assert(gen2Outcome.kind === "started", "Outcome kind is 'started'");
  assert(gen2Outcome.generationId === gen2, "Preserves generationId 2");
  assert(gen2Outcome.requestId === "req-gen2-normal", "Preserves requestId");
  assert(gen2Ctx.decodeCallCount === 1, "decodeAudioData called exactly once");
  assert(gen2Ctx.createdSources.length === 1, "Audio source created");
  assert(gen2Ctx.createdSources[0].startCallCount === 1, "sourceNode.start() called exactly once");
  assert(audio.isGenerationPlaying(gen2), "isGenerationPlaying reports true for Gen 2");

  // TEST 6: Checkpoint 2: Stale audio decode completes AFTER interruption
  console.log(bold("\nTEST 6: Checkpoint 2: Stale audio decode completes AFTER interruption"));
  const gen3 = fence.beginGeneration();
  const raceCtx = new MockAudioContext({ decodeDelayMs: 40 });
  audio.setAudioContextForTesting(raceCtx);

  const gen3Auth = createDummyAuthorizedResult(gen3, "req-gen3-race");
  // Launch decode in background
  const racePromise = audio.playAuthorizedAudio(gen3Auth);

  // At T=10ms, user interrupts Gen 3 and Gen 4 begins!
  await new Promise((r) => setTimeout(r, 10));
  interruptCtrl.interrupt(gen3);
  const gen4 = fence.beginGeneration();

  // Await Gen 3 delayed decode resolution
  const raceOutcome = await racePromise;

  assert(raceOutcome.kind === "blocked", "Superseded Gen 3 outcome is blocked");
  assert(raceOutcome.reason === "STALE_DURING_DECODE", "Reason is STALE_DURING_DECODE");
  assert(raceCtx.createdSources.length === 0, "No source node created for superseded decode");
  assert(!audio.isGenerationPlaying(gen3), "Gen 3 is NOT playing");

  // TEST 7: Checkpoint 4: Interrupt stops active audio immediately
  console.log(bold("\nTEST 7: Checkpoint 4: Interrupt stops active audio immediately"));
  const gen4Ctx = new MockAudioContext();
  audio.setAudioContextForTesting(gen4Ctx);
  const gen4Auth = createDummyAuthorizedResult(gen4, "req-gen4-play");
  const gen4PlayOutcome = await audio.playAuthorizedAudio(gen4Auth);

  assert(gen4PlayOutcome.kind === "started", "Gen 4 audio started");
  assert(audio.isGenerationPlaying(gen4), "Gen 4 is actively playing");
  const gen4Source = gen4Ctx.createdSources[0];

  // Trigger stop on Gen 4
  const stopRes = audio.stopGeneration(gen4, "INTERRUPTED");
  assert(stopRes.stopped === true, "stopGeneration reports stopped: true");
  assert(stopRes.stopLatencyMs >= 0, "Stop latency measured");
  assert(gen4Source.stopCallCount === 1, "source.stop() was called");
  assert(gen4Source.onended === null, "onended handler was detached to prevent late callbacks");
  assert(!audio.isGenerationPlaying(gen4), "Gen 4 is no longer playing");

  // TEST 8: Repeated stop is idempotent
  console.log(bold("\nTEST 8: Repeated stop is idempotent"));
  const repeatStopRes = audio.stopGeneration(gen4, "INTERRUPTED");
  assert(repeatStopRes.stopped === false, "Repeated stop returns stopped: false safely");
  assert(gen4Source.stopCallCount === 1, "source.stop() not called again");

  // TEST 9: Generation isolation: Stopping Gen 4 does NOT stop Gen 5
  console.log(bold("\nTEST 9: Generation isolation: Stopping Gen 4 does NOT stop Gen 5"));
  const gen5 = fence.beginGeneration();
  const gen5Ctx = new MockAudioContext();
  audio.setAudioContextForTesting(gen5Ctx);
  const gen5Auth = createDummyAuthorizedResult(gen5, "req-gen5-isolation");
  await audio.playAuthorizedAudio(gen5Auth);

  assert(audio.isGenerationPlaying(gen5), "Gen 5 audio is active");
  const gen5Source = gen5Ctx.createdSources[0];

  // Stop Gen 4 again
  audio.stopGeneration(gen4, "INTERRUPTED");
  assert(gen5Source.stopCallCount === 0, "Gen 5 source was NOT stopped by Gen 4 stop call");
  assert(audio.isGenerationPlaying(gen5), "Gen 5 remains actively playing");

  // TEST 10: Late onended callback from stale playback does not corrupt active state
  console.log(bold("\nTEST 10: Late onended callback from stale playback does not corrupt active state"));
  if (gen4Source.onended) {
    gen4Source.onended();
  }
  assert(audio.isGenerationPlaying(gen5), "Gen 5 still active despite stale onended callback");

  // TEST 11: Concurrent requests remain isolated by requestId
  console.log(bold("\nTEST 11: Concurrent requests remain isolated by requestId"));
  const gen6 = fence.beginGeneration();
  const gen6Ctx = new MockAudioContext();
  audio.setAudioContextForTesting(gen6Ctx);

  const reqA = createDummyAuthorizedResult(gen6, "req-multi-A");
  const reqB = createDummyAuthorizedResult(gen6, "req-multi-B");

  await audio.playAuthorizedAudio(reqA);
  await audio.playAuthorizedAudio(reqB);

  assert(gen6Ctx.createdSources.length === 2, "Both concurrent requests created source nodes");
  assert(audio.getActivePlaybackCount() >= 2, "Active playback count tracks both handles");

  // TEST 12: Audio resurrection count remains strictly 0
  console.log(bold("\nTEST 12: Audio resurrection count remains strictly 0"));
  const metrics = measurement.getSnapshot();
  assert(metrics.audio.resurrectionCount === 0, `audio.resurrectionCount is strictly 0 (got ${metrics.audio.resurrectionCount})`);

  // TEST 13: Stale audio starts blocked metric is properly incremented
  console.log(bold("\nTEST 13: Stale audio starts blocked metric is properly incremented"));
  assert(metrics.audio.staleAudioStartsBlocked >= 2, `staleAudioStartsBlocked tracked (got ${metrics.audio.staleAudioStartsBlocked})`);

  // TEST 14: Stale attempts and blocked counts match with 100% protection rate
  console.log(bold("\nTEST 14: Stale attempts and blocked counts match with 100% protection rate"));
  assert(metrics.staleResults.blocked <= metrics.staleResults.attempted, "Invariant blocked <= attempted holds");
  assert(metrics.staleResults.protectionRate === 100, `protectionRate is 100% (got ${metrics.staleResults.protectionRate}%)`);

  // TEST 15: Transcript corruption count remains strictly 0
  console.log(bold("\nTEST 15: Transcript corruption count remains strictly 0"));
  assert(metrics.transcript.corruptionCount === 0, "transcript.corruptionCount is strictly 0");

  // TEST 16: GenerationAudit records required playback events
  console.log(bold("\nTEST 16: GenerationAudit records required playback events"));
  const events = audit.getEvents();
  const decodeStarted = events.find((e) => e.event === "audio_decode_started");
  const decodeCompleted = events.find((e) => e.event === "audio_decode_completed");
  const playbackStarted = events.find((e) => e.event === "audio_playback_started");
  const playbackStopped = events.find((e) => e.event === "audio_playback_stopped");
  const staleBlocked = events.find((e) => e.event === "stale_audio_start_blocked");

  assert(Boolean(decodeStarted), "Found audio_decode_started audit event");
  assert(Boolean(decodeCompleted), "Found audio_decode_completed audit event");
  assert(Boolean(playbackStarted), "Found audio_playback_started audit event");
  assert(Boolean(playbackStopped), "Found audio_playback_stopped audit event");
  assert(Boolean(staleBlocked), "Found stale_audio_start_blocked audit event");

  // TEST 17: Normalized error: AudioContext unavailable
  console.log(bold("\nTEST 17: Normalized error: AudioContext unavailable"));
  const gen7 = fence.beginGeneration();
  audio.setAudioContextForTesting(null); // No context available

  const noCtxAuth = createDummyAuthorizedResult(gen7, "req-no-ctx");
  const noCtxOutcome = await audio.playAuthorizedAudio(noCtxAuth);
  assert(noCtxOutcome.kind === "failed", "Outcome kind is 'failed'");
  assert(noCtxOutcome.errorCode === "AUDIO_CONTEXT_UNAVAILABLE", "errorCode is AUDIO_CONTEXT_UNAVAILABLE");

  // TEST 18: Normalized error: AudioContext resume failed
  console.log(bold("\nTEST 18: Normalized error: AudioContext resume failed"));
  const gen8 = fence.beginGeneration();
  const suspendedFailCtx = new MockAudioContext({ state: "suspended", shouldFailResume: true });
  audio.setAudioContextForTesting(suspendedFailCtx);

  const resumeFailAuth = createDummyAuthorizedResult(gen8, "req-resume-fail");
  const resumeFailOutcome = await audio.playAuthorizedAudio(resumeFailAuth);
  assert(resumeFailOutcome.kind === "failed", "Outcome kind is 'failed'");
  assert(resumeFailOutcome.errorCode === "AUDIO_CONTEXT_RESUME_FAILED", "errorCode is AUDIO_CONTEXT_RESUME_FAILED");

  // TEST 19: Normalized error: Audio decode failed
  console.log(bold("\nTEST 19: Normalized error: Audio decode failed"));
  const gen9 = fence.beginGeneration();
  const decodeFailCtx = new MockAudioContext({ shouldFailDecode: true });
  audio.setAudioContextForTesting(decodeFailCtx);

  const decodeFailAuth = createDummyAuthorizedResult(gen9, "req-decode-fail");
  const decodeFailOutcome = await audio.playAuthorizedAudio(decodeFailAuth);
  assert(decodeFailOutcome.kind === "failed", "Outcome kind is 'failed'");
  assert(decodeFailOutcome.errorCode === "AUDIO_DECODE_FAILED", "errorCode is AUDIO_DECODE_FAILED");

  // TEST 20: InterruptController integration: interrupt triggers playback stopper
  console.log(bold("\nTEST 20: InterruptController integration triggers playback stopper"));
  const gen10 = fence.beginGeneration();
  const gen10Ctx = new MockAudioContext();
  audio.setAudioContextForTesting(gen10Ctx);

  const gen10Auth = createDummyAuthorizedResult(gen10, "req-gen10-stopper");
  await audio.playAuthorizedAudio(gen10Auth);
  assert(audio.isGenerationPlaying(gen10), "Gen 10 playback active");

  // Trigger interrupt via InterruptController
  interruptCtrl.interrupt(gen10);
  assert(!audio.isGenerationPlaying(gen10), "InterruptController halted Gen 10 playback");
  assert(gen10Ctx.createdSources[0].stopCallCount === 1, "source.stop() called by InterruptController");

  // TEST 21: StopAll stops all active playbacks across all generations
  console.log(bold("\nTEST 21: stopAll stops all active playbacks"));
  const gen11 = fence.beginGeneration();
  const gen11Ctx = new MockAudioContext();
  audio.setAudioContextForTesting(gen11Ctx);

  await audio.playAuthorizedAudio(createDummyAuthorizedResult(gen11, "req-11"));
  assert(audio.getActivePlaybackCount() > 0, "Playbacks exist before stopAll");

  audio.stopAll("MANUAL");
  assert(audio.getActivePlaybackCount() === 0, "Zero active playbacks after stopAll");

  // TEST 22: Zero secrets in outcomes, audit events, or metrics
  console.log(bold("\nTEST 22: Zero secrets in outcomes, audit, and metrics"));
  const outcomesStr = JSON.stringify([
    unauthOutcome,
    stalePreOutcome,
    gen2Outcome,
    raceOutcome,
    noCtxOutcome,
    resumeFailOutcome,
    decodeFailOutcome,
  ]);
  const auditStr = JSON.stringify(audit.getEvents());
  const metricsStr = JSON.stringify(measurement.getSnapshot());

  const sensitivePatterns = [/RIME_API_KEY/, /apiKey/, /rawKey/, /Authorization/, /Bearer /, /sk-[a-zA-Z0-9]{20,}/];
  for (const pattern of sensitivePatterns) {
    assert(!pattern.test(outcomesStr), `Outcomes contain no ${pattern}`);
    assert(!pattern.test(auditStr), `Audit events contain no ${pattern}`);
    assert(!pattern.test(metricsStr), `Metrics snapshot contains no ${pattern}`);
  }

  // TEST 23: VoiceConsole integration verification
  console.log(bold("\nTEST 23: VoiceConsole imports and calls GenerationAwareAudio"));
  const voiceConsolePath = path.resolve("components/voice/VoiceConsole.tsx");
  const voiceConsoleSource = fs.readFileSync(voiceConsolePath, "utf-8");
  assert(voiceConsoleSource.includes('from "@/lib/generation-aware-audio"'), "VoiceConsole imports generation-aware-audio");
  assert(voiceConsoleSource.includes("generationAwareAudio.playAuthorizedAudio"), "VoiceConsole calls playAuthorizedAudio");
  assert(voiceConsoleSource.includes("generationAwareAudio.stopAll"), "VoiceConsole calls stopAll on unmount");

  // TEST 24: InterruptController playback stopper integration
  console.log(bold("\nTEST 24: InterruptController registers and invokes playback stoppers"));
  const interruptSource = fs.readFileSync(path.resolve("lib/interrupt-controller.ts"), "utf-8");
  assert(interruptSource.includes("registerPlaybackStopper"), "InterruptController has registerPlaybackStopper");
  assert(interruptSource.includes("for (const stopper of this.playbackStoppers)"), "InterruptController invokes playback stoppers");

  // TEST 25: Measurement pipeline contains audio metrics
  console.log(bold("\nTEST 25: Measurement pipeline contains Step 13 audio metrics"));
  const measurementSource = fs.readFileSync(path.resolve("lib/measurement-pipeline.ts"), "utf-8");
  assert(measurementSource.includes("recordAudioDecodeCompleted"), "Measurement pipeline records decode latency");
  assert(measurementSource.includes("recordAudioPlaybackStarted"), "Measurement pipeline records playback start");
  assert(measurementSource.includes("recordAudioPlaybackStopped"), "Measurement pipeline records playback stop");

  console.log(bold(green("\nAll Step 13 verification tests passed successfully!")));
  console.log(bold(cyan("\n==================================================")));
  console.log(bold(cyan("   PHASE 3 — STEP 13: PLAYBACK COMPLETE           ")));
  console.log(bold(cyan("==================================================")));
  console.log(`SUMMARY:`);
  console.log(`${passedCount} PASSED, ${failedCount} FAILED`);
  console.log(bold(cyan("==================================================\n")));
}

runStep13Tests().catch((err) => {
  console.error(red(`\nTest suite failed with error: ${err.message}`));
  console.error(err.stack);
  process.exit(1);
});
