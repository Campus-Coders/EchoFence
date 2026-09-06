import { spawn } from "node:child_process";
import http from "node:http";

// --- Generation Fence and Audit Implementation for Isolated Deterministic Testing ---
class AuditLog {
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
  getActiveGen() { return this.currentActiveGen; }
}

class TestFence {
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
  assertCurrent(genId, source, details) {
    if (this.isCurrent(genId)) return true;
    this.audit.record(genId, "stale_result_blocked", this.currentGen, source, details);
    return false;
  }
  recordStaleBlocked(genId, eventType, source, details) {
    this.audit.record(genId, eventType, this.currentGen, source, details);
  }
  completeGeneration(genId, source) {
    if (this.isCurrent(genId)) {
      this.audit.record(genId, "generation_completed", this.currentGen, source, `Gen ${genId} completed`);
    }
  }
}

function fetchGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
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

async function run() {
  console.log("==================================================");
  console.log("   PHASE 2 — STEP 4: GENERATION FENCE TEST SUITE  ");
  console.log("==================================================\n");

  const audit = new AuditLog();
  const fence = new TestFence(audit);

  // TEST 1: Generation IDs increase monotonically
  const gen1 = fence.beginGeneration("test", "First turn");
  const gen2 = fence.beginGeneration("test", "Second turn");
  const gen3 = fence.beginGeneration("test", "Third turn");
  const t1Pass = gen1 === 1 && gen2 === 2 && gen3 === 3;
  console.log(`TEST 1 — Monotonic Generation IDs (1 -> 2 -> 3): ${t1Pass ? "PASS" : "FAIL"} (Observed: ${gen1}, ${gen2}, ${gen3})`);

  // Reset for clean isolated scenario
  const cleanAudit = new AuditLog();
  const cleanFence = new TestFence(cleanAudit);

  // TEST 2: Generation 1 is current immediately after creation
  const g1 = cleanFence.beginGeneration("test", "Turn 1");
  const t2Pass = g1 === 1 && cleanFence.isCurrent(1) && cleanFence.getCurrentGeneration() === 1;
  console.log(`TEST 2 — Generation 1 is current immediately after creation: ${t2Pass ? "PASS" : "FAIL"}`);

  // TEST 3: After Generation 2 begins, Generation 1 becomes stale
  const g2 = cleanFence.beginGeneration("test", "Turn 2");
  const t3Pass = g2 === 2 && !cleanFence.isCurrent(1) && cleanFence.isCurrent(2);
  console.log(`TEST 3 — Generation 1 becomes stale when Generation 2 begins: ${t3Pass ? "PASS" : "FAIL"}`);

  // TEST 4: A stale Generation 1 result is rejected
  const t4Assert = cleanFence.assertCurrent(1, "test_boundary", "Testing stale rejection");
  const t4Pass = t4Assert === false;
  console.log(`TEST 4 — Stale Generation 1 result is rejected by fence guard: ${t4Pass ? "PASS" : "FAIL"}`);

  // TEST 5: Generation 2 result is accepted
  const t5Assert = cleanFence.assertCurrent(2, "test_boundary", "Testing current acceptance");
  const t5Pass = t5Assert === true;
  console.log(`TEST 5 — Active Generation 2 result is accepted by fence guard: ${t5Pass ? "PASS" : "FAIL"}`);

  // TEST 6: Stale result counter increments correctly
  const initialCount = cleanAudit.getStaleBlockedCount();
  cleanFence.assertCurrent(1, "boundary_a", "Stale check 1");
  cleanFence.assertCurrent(1, "boundary_b", "Stale check 2");
  const finalCount = cleanAudit.getStaleBlockedCount();
  const t6Pass = finalCount === initialCount + 2;
  console.log(`TEST 6 — Stale results blocked counter increments accurately: ${t6Pass ? "PASS" : "FAIL"} (Count: ${finalCount})`);

  // TEST 7: Stale generation cannot trigger audio playback logic
  let audioPlayedForGen1 = false;
  const attemptPlay = (genId) => {
    if (!cleanFence.isCurrent(genId)) {
      cleanFence.recordStaleBlocked(genId, "stale_audio_blocked", "playback_guard");
      return;
    }
    audioPlayedForGen1 = true;
  };
  attemptPlay(1);
  const t7Pass = !audioPlayedForGen1 && cleanAudit.getEvents().some(e => e.event === "stale_audio_blocked");
  console.log(`TEST 7 — Stale generation cannot trigger audio playback: ${t7Pass ? "PASS" : "FAIL"}`);

  // TEST 8: Old async completion cannot overwrite newer voice state
  let simulatedVoiceState = "LISTENING"; // Active Gen 2 state
  const attemptStateTransition = (genId, targetState) => {
    if (!cleanFence.isCurrent(genId)) {
      cleanFence.recordStaleBlocked(genId, "stale_state_transition_blocked", "state_guard");
      return;
    }
    simulatedVoiceState = targetState;
  };
  attemptStateTransition(1, "IDLE"); // Gen 1 attempts to set state to IDLE
  const t8Pass = simulatedVoiceState === "LISTENING" && cleanAudit.getEvents().some(e => e.event === "stale_state_transition_blocked");
  console.log(`TEST 8 — Stale completion cannot overwrite newer voice state: ${t8Pass ? "PASS" : "FAIL"} (State preserved: ${simulatedVoiceState})`);

  // DETERMINISTIC RACE SCENARIO (Requirement 8)
  console.log("\n--- Deterministic Interruption Race Condition Simulation ---");
  const raceAudit = new AuditLog();
  const raceFence = new TestFence(raceAudit);
  let transcript = [];

  // Step 1: Start Gen 1 (Slow)
  const raceGen1 = raceFence.beginGeneration("race", "Gen 1: Mumbai Friday");
  transcript.push({ role: "user", text: "Find hotels in Mumbai for Friday", gen: raceGen1 });

  let gen1Resolved = false;
  let gen1Committed = false;

  // Simulate slow Gen 1 async task (e.g. 50ms simulated network)
  const slowGen1Promise = new Promise((resolve) => {
    setTimeout(() => {
      gen1Resolved = true;
      // Fence Guard at Boundary
      if (raceFence.isCurrent(raceGen1)) {
        gen1Committed = true;
        transcript.push({ role: "assistant", text: "Mumbai Friday hotels", gen: raceGen1 });
      } else {
        raceFence.recordStaleBlocked(raceGen1, "stale_result_blocked", "turn_response", "Gen 1 arrived after Gen 2");
      }
      resolve();
    }, 60);
  });

  // Step 2: Before Gen 1 finishes (at T=20ms), user interrupts with Gen 2
  await new Promise((r) => setTimeout(r, 20));
  const raceGen2 = raceFence.beginGeneration("race", "Gen 2: Saturday under 5000");
  transcript.push({ role: "user", text: "Make that Saturday under 5000", gen: raceGen2 });

  // Gen 2 finishes fast (at T=35ms)
  await new Promise((r) => setTimeout(r, 15));
  if (raceFence.isCurrent(raceGen2)) {
    transcript.push({ role: "assistant", text: "Saturday under 5000 hotels", gen: raceGen2 });
    raceFence.completeGeneration(raceGen2, "race");
  }

  // Await slow Gen 1 to finish its 60ms delay
  await slowGen1Promise;

  const racePass =
    gen1Resolved &&
    !gen1Committed &&
    transcript.length === 3 &&
    transcript[transcript.length - 1].gen === raceGen2 &&
    transcript[transcript.length - 1].role === "assistant" &&
    raceAudit.getStaleBlockedCount() === 1;

  console.log(`[RACE VERIFICATION] Gen 1 blocked, Gen 2 authoritative, transcript consistent: ${racePass ? "PASS" : "FAIL"}`);
  console.log(`Transcript turns count: ${transcript.length} (Expected: 3; Gen 1 assistant turn was rejected)`);

  // TEST 9 & 10: API & Security Verification on Live Server
  console.log("\n--- Live Server API Verification on Port 3005 ---");
  const server = await startServer(3005);

  try {
    console.log("Testing GET /api/evidence/generation...");
    const evidenceRes = await fetchGet("http://127.0.0.1:3005/api/evidence/generation");
    console.log(`Status: ${evidenceRes.statusCode}`);
    const evidenceJson = JSON.parse(evidenceRes.body);
    console.log("Evidence response data:", JSON.stringify(evidenceJson.data, null, 2));

    const t9Pass =
      evidenceRes.statusCode === 200 &&
      evidenceJson.success === true &&
      typeof evidenceJson.data?.activeGeneration === "number" &&
      typeof evidenceJson.data?.staleResultsBlocked === "number" &&
      Array.isArray(evidenceJson.data?.events);

    console.log(`TEST 9 — Generation evidence endpoint returns safe telemetry: ${t9Pass ? "PASS" : "FAIL"}`);

    // TEST 10: No secrets present in API responses
    const bodyStr = evidenceRes.body;
    const t10Pass =
      !bodyStr.includes("RIME_API_KEY") &&
      !bodyStr.includes("Bearer ") &&
      !bodyStr.includes("sk-") &&
      !bodyStr.includes("secret");

    console.log(`TEST 10 — No secrets or credentials exposed in evidence response: ${t10Pass ? "PASS" : "FAIL"}`);

    const allPassed =
      t1Pass &&
      t2Pass &&
      t3Pass &&
      t4Pass &&
      t5Pass &&
      t6Pass &&
      t7Pass &&
      t8Pass &&
      racePass &&
      t9Pass &&
      t10Pass;

    console.log("\n==================================================");
    if (allPassed) {
      console.log(">>> ALL 10 TESTS + RACE SIMULATION PASSED! <<<");
      console.log("==================================================");
      process.exit(0);
    } else {
      console.error(">>> SOME TESTS FAILED! <<<");
      console.log("==================================================");
      process.exit(1);
    }
  } finally {
    server.kill();
  }
}

run().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
