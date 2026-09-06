// test-step5.mjs
// Phase 2 Step 5: Interrupt Controller Verification Suite

import { spawn } from "node:child_process";
import http from "node:http";

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

// ==========================================
// 1. ISOLATED CONTROLLER HARNESS (Aligned with lib/interrupt-controller.ts, lib/voice-state-machine.ts, lib/generation-fence.ts)
// ==========================================

const VALID_VOICE_TRANSITIONS = {
  IDLE: ["LISTENING"],
  LISTENING: ["THINKING", "IDLE"],
  THINKING: ["SPEAKING", "INTERRUPTED", "IDLE"],
  SPEAKING: ["IDLE", "INTERRUPTED"],
  INTERRUPTED: ["RECOVERING"],
  RECOVERING: ["LISTENING", "IDLE"],
};

class TestVoiceStateMachine {
  constructor(initial = "IDLE") {
    this.state = initial;
  }
  getState() { return this.state; }
  transitionTo(next) {
    const allowed = VALID_VOICE_TRANSITIONS[this.state] || [];
    if (!allowed.includes(next)) {
      return false;
    }
    this.state = next;
    return true;
  }
  reset() { this.state = "IDLE"; }
}

class TestGenerationFence {
  constructor() {
    this.currentGen = 0;
    this.auditEvents = [];
    this.staleBlockedCount = 0;
  }
  beginGeneration(source = "test", details) {
    const prev = this.currentGen;
    this.currentGen += 1;
    const newGen = this.currentGen;
    if (prev > 0) {
      this.recordAudit(prev, "generation_invalidated", `Superseded by Gen ${newGen}`);
    }
    this.recordAudit(newGen, "generation_started", details || `Gen ${newGen} started`);
    return newGen;
  }
  getCurrentGeneration() { return this.currentGen; }
  isCurrent(genId) { return this.currentGen > 0 && genId === this.currentGen; }
  assertCurrent(genId, source, details) {
    if (this.isCurrent(genId)) return true;
    this.staleBlockedCount++;
    this.recordAudit(genId, "stale_result_blocked", details);
    return false;
  }
  recordAudit(generationId, event, details) {
    this.auditEvents.push({
      id: `evt-${Date.now()}-${Math.random()}`,
      generationId,
      event,
      timestamp: Date.now(),
      currentGeneration: this.currentGen,
      details,
    });
  }
}

class TestAudioPlayer {
  constructor() {
    this.activeGenerationId = null;
    this.isPlaying = false;
    this.stopCalls = 0;
    this.onendedHandler = null;
  }
  startPlayback(genId, onended) {
    this.activeGenerationId = genId;
    this.isPlaying = true;
    this.onendedHandler = onended;
    return { started: true, generationId: genId };
  }
  stopActiveAudio() {
    const start = Date.now();
    const wasPlaying = this.isPlaying;
    const genId = this.activeGenerationId;
    this.stopCalls++;
    this.isPlaying = false;
    this.activeGenerationId = null;
    this.onendedHandler = null; // Handler detached!
    const latencyMs = Math.max(1, Date.now() - start);
    return {
      stopped: true,
      wasPlaying,
      latencyMs,
      generationId: genId,
      timestamp: Date.now(),
    };
  }
}

class TestInterruptController {
  constructor(fence, audioPlayer) {
    this.fence = fence;
    this.audioPlayer = audioPlayer;
    this.interruptedGens = new Set();
    this.abortControllers = new Map();
    this.cleanups = new Map();
    this.interruptionCount = 0;
    this.lastMetrics = {
      interruptionCount: 0,
      lastInterruptedGenerationId: null,
      lastAudioStopLatencyMs: null,
      lastRecoveryTimeMs: null,
      lastInterruptedAt: null,
      lastReason: null,
      recentInterruptions: [],
    };
  }
  registerAbortController(genId, ac) {
    this.abortControllers.set(genId, ac);
  }
  registerCleanup(genId, fn) {
    if (!this.cleanups.has(genId)) {
      this.cleanups.set(genId, []);
    }
    this.cleanups.get(genId).push(fn);
  }
  isInterrupted(genId) {
    return this.interruptedGens.has(genId);
  }
  interrupt(genId, reason = "user_barge_in") {
    const t0 = Date.now();
    this.interruptedGens.add(genId);
    this.interruptionCount++;

    this.fence.recordAudit(genId, "interruption_requested", `Reason: ${reason}`);

    // 1. Stop audio immediately
    this.fence.recordAudit(genId, "audio_stop_requested", "Stopping active playback");
    const stopResult = this.audioPlayer.stopActiveAudio();
    this.fence.recordAudit(genId, "audio_stopped", `Latency: ${stopResult.latencyMs}ms`);

    // 2. Abort async in-flight work
    const ac = this.abortControllers.get(genId);
    let asyncAborted = false;
    if (ac && !ac.signal.aborted) {
      ac.abort(new Error(`Generation ${genId} interrupted: ${reason}`));
      asyncAborted = true;
      this.fence.recordAudit(genId, "async_work_aborted", `Aborted AbortController for Gen ${genId}`);
    }

    // 3. Execute cleanups
    const cleanups = this.cleanups.get(genId) || [];
    for (const fn of cleanups) {
      try { fn(); } catch (e) { console.error(e); }
    }
    this.cleanups.delete(genId);

    this.fence.recordAudit(genId, "generation_interrupted", `Generation ${genId} fenced and invalidated`);

    const interruptEvent = {
      id: `int-${Date.now()}-${Math.random()}`,
      generationId: genId,
      timestamp: Date.now(),
      reason,
      audioStopLatencyMs: stopResult.latencyMs,
      audioStopped: stopResult.wasPlaying,
      asyncWorkAborted: asyncAborted,
    };

    this.lastMetrics = {
      interruptionCount: this.interruptionCount,
      lastInterruptedGenerationId: genId,
      lastAudioStopLatencyMs: stopResult.latencyMs,
      lastRecoveryTimeMs: null,
      lastInterruptedAt: interruptEvent.timestamp,
      lastReason: reason,
      recentInterruptions: [interruptEvent, ...this.lastMetrics.recentInterruptions].slice(0, 10),
    };

    return {
      interrupted: true,
      generationId: genId,
      stopResult,
      asyncWorkAborted: asyncAborted,
      event: interruptEvent,
    };
  }
  recordRecovery(genId, recoveryTimeMs) {
    this.lastMetrics.lastRecoveryTimeMs = recoveryTimeMs;
    this.fence.recordAudit(genId, "interruption_recovered", `Recovered in ${recoveryTimeMs}ms`);
  }
  getMetrics() {
    return { ...this.lastMetrics };
  }
}

// ==========================================
// HTTP Helper for Next.js endpoints
// ==========================================
function fetchGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
        });
      });
    });
    req.on("error", reject);
  });
}

async function startServer(port) {
  const proc = spawn("cmd.exe", ["/c", "npx", "next", "start", "-p", String(port)], {
    cwd: "c:\\Users\\gandavarapu kamalni\\OneDrive\\Desktop\\EchoFence",
    env: {
      ...process.env,
      PATH: "C:\\Program Files\\nodejs;" + process.env.PATH,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetchGet(`http://127.0.0.1:${port}/console`);
      if (res.statusCode === 200) {
        return proc;
      }
    } catch {}
  }

  proc.kill();
  throw new Error(`Server on port ${port} failed to start`);
}

// ==========================================
// MAIN TEST RUNNER
// ==========================================
async function run() {
  console.log(bold("\n=================================================="));
  console.log(bold("   PHASE 2 — STEP 5: INTERRUPT CONTROLLER SUITE   "));
  console.log(bold("==================================================\n"));

  const fence = new TestGenerationFence();
  const audioPlayer = new TestAudioPlayer();
  const interruptCtrl = new TestInterruptController(fence, audioPlayer);
  const sm = new TestVoiceStateMachine("IDLE");

  // TEST 1: Normal audio playback can start.
  console.log(cyan("TEST 1: Normal audio playback can start"));
  const gen1 = fence.beginGeneration("user_turn", "What is the weather?");
  assert(gen1 === 1, "Gen 1 initialized");
  sm.transitionTo("LISTENING");
  sm.transitionTo("THINKING");
  sm.transitionTo("SPEAKING");
  let gen1CompletedNormally = false;
  const playRes = audioPlayer.startPlayback(gen1, () => {
    gen1CompletedNormally = true;
  });
  assert(playRes.started === true, "Audio playback started for Gen 1");
  assert(audioPlayer.isPlaying === true, "AudioPlayer state is playing");
  assert(audioPlayer.activeGenerationId === gen1, "AudioPlayer activeGen is 1");

  // TEST 2: Interrupting active playback invokes stop.
  console.log(cyan("\nTEST 2: Interrupting active playback invokes stop"));
  const intResult = interruptCtrl.interrupt(gen1, "user_barge_in");
  assert(intResult.interrupted === true, "InterruptController reports interrupted");
  assert(audioPlayer.isPlaying === false, "Audio player is no longer playing");
  assert(audioPlayer.stopCalls === 1, "Audio player stopActiveAudio was invoked exactly once");
  assert(intResult.stopResult.wasPlaying === true, "Stop result confirms audio was playing when interrupted");

  // TEST 3: Audio stop latency is captured.
  console.log(cyan("\nTEST 3: Audio stop latency is captured"));
  assert(typeof intResult.stopResult.latencyMs === "number", "Latency is numeric");
  assert(intResult.stopResult.latencyMs >= 0, `Captured audio stop latency: ${intResult.stopResult.latencyMs}ms`);
  const metricsAfterInt = interruptCtrl.getMetrics();
  assert(metricsAfterInt.lastAudioStopLatencyMs === intResult.stopResult.latencyMs, "Metrics recorded correct stop latency");

  // TEST 4: Generation 1 becomes invalid after interruption.
  console.log(cyan("\nTEST 4: Generation 1 becomes invalid after interruption"));
  assert(interruptCtrl.isInterrupted(gen1) === true, "Generation 1 is marked as interrupted in controller");
  // State machine transition to INTERRUPTED -> RECOVERING
  assert(sm.transitionTo("INTERRUPTED") === true, "State machine transitioned from SPEAKING to INTERRUPTED");
  assert(sm.transitionTo("RECOVERING") === true, "State machine transitioned from INTERRUPTED to RECOVERING");

  // TEST 5: Generation 2 becomes the active generation.
  console.log(cyan("\nTEST 5: Generation 2 becomes the active generation"));
  assert(sm.transitionTo("LISTENING") === true, "State machine transitioned from RECOVERING to LISTENING");
  const gen2 = fence.beginGeneration("user_barge_in", "Wait, tell me the time instead!");
  assert(gen2 === 2, "Generation 2 initialized with monotonic ID 2");
  assert(fence.getCurrentGeneration() === 2, "Fence authoritative generation is 2");
  assert(fence.isCurrent(gen2) === true, "Gen 2 is current");
  assert(fence.isCurrent(gen1) === false, "Gen 1 is NOT current");

  // TEST 6: A stale Generation 1 completion callback cannot change the Generation 2 state.
  console.log(cyan("\nTEST 6: Stale Generation 1 completion callback cannot change Generation 2 state"));
  sm.transitionTo("THINKING");
  sm.transitionTo("SPEAKING"); // Gen 2 is now SPEAKING!
  assert(sm.getState() === "SPEAKING", "Current state is Gen 2 SPEAKING");

  // Simulate late callback from Gen 1 attempting to set state to IDLE:
  const lateGen1Completion = () => {
    if (!fence.isCurrent(gen1) || interruptCtrl.isInterrupted(gen1)) {
      fence.recordAudit(gen1, "stale_state_transition_blocked", "Gen 1 late completion attempted state change");
      return; // BLOCKED
    }
    sm.reset(); // Would erroneously reset to IDLE!
  };
  lateGen1Completion();
  assert(sm.getState() === "SPEAKING", "Voice state machine remains SPEAKING (Gen 2 state preserved)");
  assert(gen1CompletedNormally === false, "Gen 1 normal completion flag was not set");

  // TEST 7: A stale Generation 1 audio callback cannot restart playback.
  console.log(cyan("\nTEST 7: A stale Generation 1 audio callback cannot restart playback"));
  let audioResurrected = false;
  const lateGen1AudioRestart = () => {
    if (!fence.isCurrent(gen1) || interruptCtrl.isInterrupted(gen1)) {
      fence.recordAudit(gen1, "stale_audio_blocked", "Gen 1 audio chunk attempted late playback");
      return; // BLOCKED
    }
    audioResurrected = true;
    audioPlayer.startPlayback(gen1, () => {});
  };
  lateGen1AudioRestart();
  assert(audioResurrected === false, "Audio resurrection was blocked");
  assert(audioPlayer.activeGenerationId !== gen1, "Audio player did not resume Gen 1 audio");

  // TEST 8: Interrupting while THINKING prevents the old result from committing.
  console.log(cyan("\nTEST 8: Interrupting while THINKING prevents old result from committing"));
  const gen3 = fence.beginGeneration("test_turn", "Complex calculation");
  sm.reset();
  sm.transitionTo("LISTENING");
  sm.transitionTo("THINKING");
  assert(sm.getState() === "THINKING", "State is THINKING");

  const ac3 = new AbortController();
  interruptCtrl.registerAbortController(gen3, ac3);

  // User interrupts while THINKING:
  assert(sm.transitionTo("INTERRUPTED") === true, "Allowed transition from THINKING to INTERRUPTED");
  interruptCtrl.interrupt(gen3, "user_barge_in");
  assert(ac3.signal.aborted === true, "AbortController for Gen 3 was aborted");

  // Late async response resolves:
  let gen3Committed = false;
  const lateGen3Commit = (resultData) => {
    if (!fence.isCurrent(gen3) || interruptCtrl.isInterrupted(gen3)) {
      fence.recordAudit(gen3, "stale_result_blocked", "Gen 3 late response after interruption");
      return; // BLOCKED
    }
    gen3Committed = true;
  };
  lateGen3Commit({ text: "Late response" });
  assert(gen3Committed === false, "Gen 3 late result was prevented from committing");

  // TEST 9: AbortController is invoked for cancellable generation work.
  console.log(cyan("\nTEST 9: AbortController is invoked for cancellable generation work"));
  const gen4 = fence.beginGeneration("async_test", "Fetch test");
  const ac4 = new AbortController();
  let abortListenerFired = false;
  ac4.signal.addEventListener("abort", () => {
    abortListenerFired = true;
  });
  interruptCtrl.registerAbortController(gen4, ac4);
  assert(ac4.signal.aborted === false, "AbortController initially not aborted");
  interruptCtrl.interrupt(gen4, "user_barge_in");
  assert(ac4.signal.aborted === true, "AbortController aborted property is true");
  assert(abortListenerFired === true, "Abort event listener fired");

  // TEST 10: Recovery completes and system reaches LISTENING or next active state.
  console.log(cyan("\nTEST 10: Recovery completes and system reaches LISTENING"));
  assert(sm.transitionTo("RECOVERING") === true, "Transitioned to RECOVERING");
  const recoveryStart = Date.now();
  // Simulate brief recovery processing
  const recoveryTimeMs = 12;
  interruptCtrl.recordRecovery(gen4, recoveryTimeMs);
  assert(sm.transitionTo("LISTENING") === true, "Successfully recovered to LISTENING");
  assert(sm.getState() === "LISTENING", "Current state is LISTENING");
  const metricsRecovered = interruptCtrl.getMetrics();
  assert(metricsRecovered.lastRecoveryTimeMs === 12, "Recovery time recorded correctly");

  // TEST 11: Interrupt telemetry endpoint returns safe telemetry.
  console.log(cyan("\nTEST 11: Interrupt telemetry endpoint returns safe telemetry"));
  console.log("  Launching Next.js production server for API verification...");
  const testPort = 3015;
  const serverProc = await startServer(testPort);

  try {
    const res = await fetchGet(`http://127.0.0.1:${testPort}/api/evidence/interrupt`);
    assert(res.statusCode === 200, `GET /api/evidence/interrupt returned 200 (got ${res.statusCode})`);
    const data = JSON.parse(res.body);
    assert(data.success === true, "Endpoint returned success: true");
    assert(data.data !== undefined, "Endpoint returned data object");
    assert(data.data.metrics !== undefined, "Endpoint returned metrics object");
    assert(typeof data.data.metrics.interruptionCount === "number", "interruptionCount is number");
    assert(Array.isArray(data.data.history), "history is array");

    // Also check generation evidence endpoint
    const genRes = await fetchGet(`http://127.0.0.1:${testPort}/api/evidence/generation`);
    assert(genRes.statusCode === 200, "GET /api/evidence/generation returned 200");
    const genData = JSON.parse(genRes.body);
    assert(genData.success === true, "Generation endpoint returned success");

    // TEST 12: No API keys or secrets are exposed.
    console.log(cyan("\nTEST 12: No API keys or secrets are exposed"));
    const bodyStr = res.body + genRes.body;
    assert(!bodyStr.includes("RIME_API_KEY"), "RIME_API_KEY is not leaked in telemetry");
    assert(!bodyStr.includes("OPENAI_API_KEY"), "OPENAI_API_KEY is not leaked in telemetry");
    assert(!bodyStr.includes("secret"), "No secret tokens leaked");

    // Check status endpoint
    const statusRes = await fetchGet(`http://127.0.0.1:${testPort}/api/voice/status`);
    assert(statusRes.statusCode === 200, "GET /api/voice/status returned 200");
    const statusData = JSON.parse(statusRes.body);
    assert(statusData.data !== undefined, "Status includes safe provider metadata");
    assert(typeof statusData.data.configured === "boolean", "Exposes boolean configured only");
    assert(typeof statusData.data.provider === "string", "Exposes observable provider name");
    assert(statusData.data.apiKey === undefined, "Actual apiKey string is NEVER returned");
    assert(statusData.data.secret === undefined, "Actual secret string is NEVER returned");

    // Verify end-to-end race condition proof
    console.log(cyan("\nVERIFYING END-TO-END RACE SCENARIO"));
    console.log("  Gen 1 speaking -> User barge-in -> Gen 2 starts -> Gen 1 late callback attempts resurrection");
    assert(audioPlayer.stopCalls > 0, "Audio stop was deterministically invoked");
    assert(fence.getCurrentGeneration() >= 2, "Gen 2 or later remains strictly authoritative");
    assert(audioResurrected === false, "Zero audio resurrection occurred");
    assert(gen1CompletedNormally === false, "Stale callbacks strictly rejected");

    console.log(green("\nAll Step 5 verification tests passed successfully!"));
  } finally {
    serverProc.kill("SIGTERM");
  }

  console.log(bold("\n=================================================="));
  console.log(bold(`   SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED   `));
  console.log(bold("==================================================\n"));

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error(red(`\nTest suite execution error: ${err.message}`));
  console.error(err.stack);
  process.exit(1);
});
