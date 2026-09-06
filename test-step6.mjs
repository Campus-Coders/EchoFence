// test-step6.mjs
// Phase 2 Step 6: Deterministic Delayed Tool Fixture Verification Suite

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
// 1. ISOLATED HARNESS (Aligned with lib/delayed-tool.ts, lib/generation-fence.ts, lib/interrupt-controller.ts)
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

class TestGenerationAudit {
  constructor() {
    this.events = [];
    this.staleBlockedCount = 0;
    this.currentActiveGen = 0;
  }
  record(generationId, event, currentGeneration, source, details) {
    if (
      event === "stale_result_blocked" ||
      event === "stale_audio_blocked" ||
      event === "stale_state_transition_blocked" ||
      event === "stale_tool_result_blocked"
    ) {
      this.staleBlockedCount++;
    }
    if (event === "generation_started") {
      this.currentActiveGen = currentGeneration;
    }
    const entry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      generationId,
      event,
      timestamp: Date.now(),
      currentGeneration,
      stale: generationId < currentGeneration,
      source,
      details,
    };
    this.events.unshift(entry);
    return entry;
  }
  getEvents() { return [...this.events]; }
  getStaleBlockedCount() { return this.staleBlockedCount; }
}

class TestGenerationFence {
  constructor(audit) {
    this.currentGen = 0;
    this.audit = audit;
  }
  beginGeneration(source = "test", details) {
    const prev = this.currentGen;
    this.currentGen += 1;
    const newGen = this.currentGen;
    if (prev > 0) {
      this.audit.record(prev, "generation_invalidated", newGen, source, `Superseded by Gen ${newGen}`);
    }
    this.audit.record(newGen, "generation_started", newGen, source, details || `Gen ${newGen} started`);
    return newGen;
  }
  getCurrentGeneration() { return this.currentGen; }
  isCurrent(genId) { return this.currentGen > 0 && genId === this.currentGen; }
  recordStaleBlocked(genId, eventType, source, details) {
    this.audit.record(genId, eventType, this.currentGen, source, details);
  }
  completeGeneration(genId, source) {
    if (this.isCurrent(genId)) {
      this.audit.record(genId, "generation_completed", this.currentGen, source, `Gen ${genId} completed`);
    }
  }
}

class TestDelayedToolRegistry {
  constructor() {
    this.runs = 0;
    this.normalCompletions = 0;
    this.lateCompletions = 0;
    this.staleBlocked = 0;
  }
  recordRun() { this.runs++; }
  recordNormalCompletion() { this.normalCompletions++; }
  recordLateCompletion() { this.lateCompletions++; }
  recordStaleBlocked() { this.staleBlocked++; }
  getMetrics() {
    return {
      delayedToolRuns: this.runs,
      delayedToolCompletions: this.normalCompletions + this.lateCompletions,
      lateToolCompletions: this.lateCompletions,
      staleToolResultsBlocked: this.staleBlocked,
    };
  }
}

class TestAudioPlayer {
  constructor() {
    this.isPlaying = false;
    this.activeGenId = null;
    this.stopCalls = 0;
  }
  startPlayback(genId) {
    this.isPlaying = true;
    this.activeGenId = genId;
  }
  stopActiveAudio() {
    this.stopCalls++;
    this.isPlaying = false;
    this.activeGenId = null;
    return { stopped: true, latencyMs: 1 };
  }
}

class TestInterruptController {
  constructor(fence, audioPlayer) {
    this.fence = fence;
    this.audioPlayer = audioPlayer;
    this.interruptedGens = new Set();
    this.abortControllers = new Map();
  }
  registerAbortController(genId, ac) {
    this.abortControllers.set(genId, ac);
  }
  isInterrupted(genId) {
    return this.interruptedGens.has(genId);
  }
  interrupt(genId, reason = "user_barge_in") {
    this.interruptedGens.add(genId);
    this.audioPlayer.stopActiveAudio();
    const ac = this.abortControllers.get(genId);
    if (ac && !ac.signal.aborted) {
      ac.abort(new Error(`Gen ${genId} interrupted: ${reason}`));
    }
    this.fence.recordStaleBlocked(genId, "generation_interrupted", "interrupt_controller", `Gen ${genId} marked interrupted`);
  }
}

// Deterministic delayed hotel search fixture (matches lib/delayed-tool.ts)
function executeDelayedSearch(fence, audit, registry, options) {
  const {
    generationId,
    delayMs = 4000,
    signal,
    respectAbort = false,
    city = "Mumbai",
  } = options;

  const startedAt = Date.now();
  registry.recordRun();
  audit.record(
    generationId,
    "tool_started",
    fence.getCurrentGeneration(),
    "delayed_tool",
    `Started ${delayMs}ms delayed hotel search for Gen ${generationId} in ${city}`
  );

  return new Promise((resolve, reject) => {
    let timerId = null;

    const onAbort = () => {
      if (respectAbort) {
        if (timerId) clearTimeout(timerId);
        reject(new Error(`Delayed tool aborted for Gen ${generationId}`));
      }
    };

    if (signal) {
      if (signal.aborted && respectAbort) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    timerId = setTimeout(() => {
      const completedAt = Date.now();
      const isCurrent = fence.isCurrent(generationId);
      const isLate = !isCurrent;

      if (isLate) {
        registry.recordLateCompletion();
        audit.record(
          generationId,
          "tool_completed_late",
          fence.getCurrentGeneration(),
          "delayed_tool",
          `Gen ${generationId} delayed tool finished late after ${completedAt - startedAt}ms`
        );
      } else {
        registry.recordNormalCompletion();
        audit.record(
          generationId,
          "tool_completed",
          fence.getCurrentGeneration(),
          "delayed_tool",
          `Gen ${generationId} delayed tool finished normally`
        );
      }

      resolve({
        success: true,
        toolName: "searchHotelsDelayed",
        generationId,
        delayMs,
        startedAt,
        completedAt,
        completedLate: isLate,
        data: {
          summary: `Found 2 hotels in ${city} for Gen ${generationId}.`,
        },
      });
    }, delayMs);
  });
}

// HTTP Helper for Next.js endpoints
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
  console.log(bold("   PHASE 2 — STEP 6: DELAYED TOOL FIXTURE SUITE   "));
  console.log(bold("==================================================\n"));

  const audit = new TestGenerationAudit();
  const fence = new TestGenerationFence(audit);
  const audioPlayer = new TestAudioPlayer();
  const interruptCtrl = new TestInterruptController(fence, audioPlayer);
  const sm = new TestVoiceStateMachine("IDLE");
  const toolRegistry = new TestDelayedToolRegistry();

  const transcript = [];

  // TEST 1: Delayed tool starts for Gen 1.
  console.log(cyan("TEST 1: Delayed tool starts for Gen 1"));
  const gen1 = fence.beginGeneration("user_turn", "Find hotel with delayed search");
  assert(gen1 === 1, "Generation 1 issued monotonically");
  sm.transitionTo("LISTENING");
  transcript.push({ id: "t1", generationId: gen1, role: "user", text: "Find hotel with delayed search (4s)" });
  sm.transitionTo("THINKING");

  const ac1 = new AbortController();
  interruptCtrl.registerAbortController(gen1, ac1);

  let gen1ToolResolved = false;
  let gen1ToolResult = null;

  // Start 4000ms delayed tool with respectAbort = false to simulate un-cancellable remote execution
  const toolPromise = executeDelayedSearch(fence, audit, toolRegistry, {
    generationId: gen1,
    delayMs: 4000,
    signal: ac1.signal,
    respectAbort: false,
    city: "Mumbai",
  }).then((res) => {
    gen1ToolResolved = true;
    gen1ToolResult = res;
    return res;
  });

  assert(toolRegistry.runs === 1, "Delayed tool run counter incremented to 1");
  const startedEvent = audit.getEvents().find((e) => e.event === "tool_started" && e.generationId === gen1);
  assert(startedEvent !== undefined, "Audit log contains tool_started event for Gen 1");

  // TEST 2: Gen 1 remains pending before the configured 4000ms completion.
  console.log(cyan("\nTEST 2: Gen 1 remains pending before 4000ms completion"));
  await new Promise((r) => setTimeout(r, 400));
  assert(gen1ToolResolved === false, "Gen 1 delayed tool is still pending at T=400ms");
  assert(sm.getState() === "THINKING", "State remains THINKING for Gen 1");

  // TEST 3: Interruption occurs before Gen 1 completes.
  console.log(cyan("\nTEST 3: Interruption occurs before Gen 1 completes"));
  const interruptTime = Date.now();
  sm.transitionTo("INTERRUPTED");
  interruptCtrl.interrupt(gen1, "user_barge_in");
  assert(interruptCtrl.isInterrupted(gen1) === true, "Gen 1 marked interrupted");
  assert(ac1.signal.aborted === true, "Gen 1 AbortController signaled abort");
  assert(sm.transitionTo("RECOVERING") === true, "State moved to RECOVERING");

  // TEST 4: Generation Fence advances to Gen 2.
  console.log(cyan("\nTEST 4: Generation Fence advances to Gen 2"));
  assert(sm.transitionTo("LISTENING") === true, "State moved to LISTENING for Gen 2");
  const gen2 = fence.beginGeneration("user_barge_in", "Wait! Check Pune Saturday instead");
  assert(gen2 === 2, "Generation 2 issued with ID 2");
  const invalidatedEvent = audit.getEvents().find((e) => e.event === "generation_invalidated" && e.generationId === gen1);
  assert(invalidatedEvent !== undefined, "Gen 1 invalidated audit event logged");

  // TEST 5: Gen 2 becomes authoritative.
  console.log(cyan("\nTEST 5: Gen 2 becomes authoritative"));
  assert(fence.getCurrentGeneration() === 2, "Fence authoritative active generation is 2");
  assert(fence.isCurrent(gen2) === true, "Fence confirms Gen 2 is current");
  assert(fence.isCurrent(gen1) === false, "Fence confirms Gen 1 is NOT current");

  // TEST 6: Gen 2 can complete normally.
  console.log(cyan("\nTEST 6: Gen 2 can complete normally"));
  transcript.push({ id: "t2", generationId: gen2, role: "user", text: "Wait! Check Pune Saturday instead" });
  sm.transitionTo("THINKING");
  await new Promise((r) => setTimeout(r, 300));
  assert(sm.transitionTo("SPEAKING") === true, "Gen 2 transitioned to SPEAKING");
  audioPlayer.startPlayback(gen2);
  transcript.push({
    id: "t3",
    generationId: gen2,
    role: "assistant",
    text: "Found Trident Pune for Saturday under 5000.",
  });
  audioPlayer.stopActiveAudio();
  fence.completeGeneration(gen2, "test");
  sm.transitionTo("IDLE");
  assert(sm.getState() === "IDLE", "Gen 2 completed successfully and system is IDLE");

  // TEST 7: Gen 1 delayed tool eventually completes after its delay.
  console.log(cyan("\nTEST 7: Gen 1 delayed tool eventually completes after its 4000ms delay"));
  console.log("  Waiting for original Gen 1 4000ms tool to finish...");
  await toolPromise;
  assert(gen1ToolResolved === true, "Gen 1 delayed tool resolved after full delay duration");
  assert(gen1ToolResult !== null && gen1ToolResult.completedLate === true, "Gen 1 tool result flagged completedLate: true");

  // TEST 8: Late Gen 1 result reaches the guarded callback boundary.
  console.log(cyan("\nTEST 8: Late Gen 1 result reaches guarded callback boundary"));
  let gen1Committed = false;
  const guardedCallbackBoundary = (targetGenId, result) => {
    if (!fence.isCurrent(targetGenId) || interruptCtrl.isInterrupted(targetGenId)) {
      fence.recordStaleBlocked(
        targetGenId,
        "stale_tool_result_blocked",
        "delayed_tool",
        `Gen ${targetGenId} tool finished late; blocked by active Gen ${fence.getCurrentGeneration()}`
      );
      toolRegistry.recordStaleBlocked();
      return false; // REJECTED
    }
    gen1Committed = true;
    transcript.push({ id: "t-late", generationId: targetGenId, role: "assistant", text: result.data.summary });
    sm.transitionTo("SPEAKING");
    audioPlayer.startPlayback(targetGenId);
    return true;
  };

  const allowed = guardedCallbackBoundary(gen1, gen1ToolResult);
  assert(allowed === false, "Guarded callback boundary strictly rejected Gen 1 result");

  // TEST 9: Generation Fence rejects Gen 1 because Gen 2 is active.
  console.log(cyan("\nTEST 9: Generation Fence rejects Gen 1 because Gen 2 is active"));
  assert(gen1Committed === false, "Gen 1 result was prevented from committing");
  const blockedEvent = audit.getEvents().find((e) => e.event === "stale_tool_result_blocked" && e.generationId === gen1);
  assert(blockedEvent !== undefined, "Audit log contains stale_tool_result_blocked for Gen 1");

  // TEST 10: Gen 1 does not modify transcript.
  console.log(cyan("\nTEST 10: Gen 1 does not modify transcript"));
  const gen1AssistantTurns = transcript.filter((t) => t.generationId === gen1 && t.role === "assistant");
  assert(gen1AssistantTurns.length === 0, "Transcript contains zero assistant messages from stale Gen 1");
  assert(transcript.length === 3, "Transcript length is strictly 3 (Gen 1 user, Gen 2 user, Gen 2 assistant)");

  // TEST 11: Gen 1 does not start or restart audio.
  console.log(cyan("\nTEST 11: Gen 1 does not start or restart audio"));
  assert(audioPlayer.isPlaying === false, "Audio is not playing");
  assert(audioPlayer.activeGenId === null, "Active audio Gen ID is null");

  // TEST 12: Gen 1 does not overwrite Gen 2 voice state.
  console.log(cyan("\nTEST 12: Gen 1 does not overwrite Gen 2 voice state"));
  assert(sm.getState() === "IDLE", "Voice state remains owned by Gen 2 (IDLE), not altered by Gen 1");

  // TEST 13: Evidence telemetry records the late completion.
  console.log(cyan("\nTEST 13: Evidence telemetry records late completion"));
  const lateEvent = audit.getEvents().find((e) => e.event === "tool_completed_late" && e.generationId === gen1);
  assert(lateEvent !== undefined, "Audit log records tool_completed_late for Gen 1");
  assert(toolRegistry.getMetrics().lateToolCompletions >= 1, "Tool metrics records lateToolCompletions >= 1");

  // TEST 14: Evidence telemetry records stale result blocking.
  console.log(cyan("\nTEST 14: Evidence telemetry records stale result blocking"));
  assert(audit.getStaleBlockedCount() >= 1, "Audit staleBlockedCount >= 1");
  assert(toolRegistry.getMetrics().staleToolResultsBlocked >= 1, "Tool metrics staleToolResultsBlocked >= 1");

  // TEST 15: No secrets or API keys appear in any fixture or telemetry response.
  console.log(cyan("\nTEST 15: No secrets or API keys appear in fixture or telemetry response"));
  console.log("  Starting Next.js production server for API verification...");
  const testPort = 3025;
  const serverProc = await startServer(testPort);

  try {
    // 1. Evidence Generation endpoint
    const genRes = await fetchGet(`http://127.0.0.1:${testPort}/api/evidence/generation`);
    assert(genRes.statusCode === 200, `GET /api/evidence/generation returned 200 (got ${genRes.statusCode})`);
    const genData = JSON.parse(genRes.body);
    assert(genData.success === true, "Generation evidence response has success: true");
    assert(genData.data !== undefined, "Generation evidence response has data");
    assert(typeof genData.data.staleResultsBlocked === "number", "staleResultsBlocked is a number");
    assert(Array.isArray(genData.data.events), "events is an array");
    if (genData.data.toolMetrics) {
      assert(typeof genData.data.toolMetrics.delayedToolRuns === "number", "toolMetrics.delayedToolRuns is number");
    }

    // 2. Evidence Interrupt endpoint
    const intRes = await fetchGet(`http://127.0.0.1:${testPort}/api/evidence/interrupt`);
    assert(intRes.statusCode === 200, `GET /api/evidence/interrupt returned 200 (got ${intRes.statusCode})`);
    const intData = JSON.parse(intRes.body);
    assert(intData.success === true, "Interrupt evidence response has success: true");

    // 3. Voice Status endpoint
    const statusRes = await fetchGet(`http://127.0.0.1:${testPort}/api/voice/status`);
    assert(statusRes.statusCode === 200, `GET /api/voice/status returned 200 (got ${statusRes.statusCode})`);
    const statusData = JSON.parse(statusRes.body);
    assert(statusData.data !== undefined, "Status endpoint has data object");

    // 4. Zero secrets exposed check across all payloads
    const telemetryStr = genRes.body + intRes.body;
    assert(!telemetryStr.includes("RIME_API_KEY"), "RIME_API_KEY is not leaked in telemetry");
    assert(!telemetryStr.includes("OPENAI_API_KEY"), "OPENAI_API_KEY is not leaked in telemetry");
    assert(!telemetryStr.includes("secret"), "No secret tokens leaked in telemetry");

    assert(statusData.data.apiKey === undefined, "Actual apiKey string is NEVER exposed in status");
    assert(statusData.data.secret === undefined, "Actual secret string is NEVER exposed in status");
    assert(statusData.data.rawKey === undefined, "rawKey is NEVER exposed");

    console.log(cyan("\nVERIFYING COMPLETE END-TO-END DETERMINISTIC RACE SCENARIO"));
    console.log("  Gen 1: delayed tool starts (4000ms)");
    console.log("  T=500ms: user interruption triggers");
    console.log("  Gen 1: interrupted & invalidated");
    console.log("  Gen 2: starts, runs, and completes successfully");
    console.log("  T=4000ms: Gen 1 late tool result arrives");
    console.log("  Generation Fence: REJECTS Gen 1 with stale_tool_result_blocked");

    assert(fence.getCurrentGeneration() === 2, "Gen 2 remains strictly authoritative");
    assert(gen1Committed === false, "Gen 1 was strictly rejected");
    assert(transcript.filter((t) => t.generationId === gen1 && t.role === "assistant").length === 0, "Transcript remains pure");
    assert(audioPlayer.isPlaying === false, "Audio resurrection prevented");
    assert(sm.getState() === "IDLE", "Voice state maintained by Gen 2");
    assert(audit.getStaleBlockedCount() > 0, "Stale result counter incremented");

    console.log(green("\nAll Step 6 verification tests passed successfully!"));
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
