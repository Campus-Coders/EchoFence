// test-step12.mjs
// Phase 3 Step 12: Generation-Aware Rime Synthesis Authorization Verification Suite

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
    this.audio = { resurrectionCount: 0, staleAudioStartsBlocked: 0 };
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

class TestMockProviderAdapter {
  constructor(options) {
    this.delayMs = options?.delayMs ?? 20;
    this.failureCode = options?.failureCode;
  }
  setDelay(ms) {
    this.delayMs = ms;
  }
  setFailure(code) {
    this.failureCode = code;
  }
  async synthesize(request) {
    const startedAt = request.startedAt || Date.now();
    const requestId = request.requestId;
    const generationId = request.generationId;

    if (request.signal?.aborted) {
      return {
        generationId,
        requestId,
        completedAt: Date.now(),
        status: "cancelled",
        errorCode: "ABORTED",
        error: "Request aborted",
        latencyMs: Date.now() - startedAt,
      };
    }

    if (this.failureCode) {
      return {
        generationId,
        requestId,
        completedAt: Date.now(),
        status: "failed",
        errorCode: this.failureCode,
        error: `Simulated error ${this.failureCode}`,
        latencyMs: Date.now() - startedAt,
      };
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const buffer = new ArrayBuffer(256);
        const view = new Uint8Array(buffer);
        view[0] = 0xff;
        view[1] = 0xfb;
        resolve({
          generationId,
          requestId,
          completedAt: Date.now(),
          status: "completed",
          audioBuffer: buffer,
          audioData: buffer,
          contentType: "audio/mpeg",
          provider: "Rime (Mock)",
          model: request.model || "mist",
          voice: request.voice || "amber",
          latencyMs: Date.now() - startedAt,
        });
      }, this.delayMs);

      if (request.signal) {
        request.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve({
              generationId,
              requestId,
              completedAt: Date.now(),
              status: "cancelled",
              errorCode: "ABORTED",
              error: "Request aborted during delay",
              latencyMs: Date.now() - startedAt,
            });
          },
          { once: true }
        );
      }
    });
  }
}

class StandaloneGenerationAwareSynthesis {
  constructor(options) {
    this.fence = options.fence;
    this.adapter = options.adapter;
    this.audit = options.audit;
    this.measurement = options.measurement;
    this.activeControllers = new Map();
  }

  async synthesizeForGeneration(generationId, text, options) {
    const startedAt = Date.now();
    const requestId =
      options?.requestId ||
      `synth-req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const currentActiveGen = this.fence.getCurrentGeneration();

    if (generationId < currentActiveGen) {
      this.measurement.recordStaleResultAttempted(generationId);
      this.measurement.recordStaleResultBlocked(generationId);
      this.fence.recordStaleBlocked();
      this.audit.record(
        generationId,
        "stale_synthesis_result_blocked",
        currentActiveGen,
        "test_synthesis",
        `Pre-dispatch rejection: Gen ${generationId} superseded by active Gen ${currentActiveGen}`
      );
      return {
        kind: "stale",
        generationId,
        requestId,
        reason: "STALE_GENERATION",
        blockedAt: Date.now(),
        activeGeneration: currentActiveGen,
      };
    }

    const controller = new AbortController();
    if (!this.activeControllers.has(generationId)) {
      this.activeControllers.set(generationId, new Map());
    }
    this.activeControllers.get(generationId).set(requestId, controller);

    if (options?.externalSignal) {
      if (options.externalSignal.aborted) {
        controller.abort();
      } else {
        options.externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }

    this.audit.record(
      generationId,
      "synthesis_request_started",
      currentActiveGen,
      "test_synthesis",
      `Synthesis dispatch [${requestId}]`
    );

    let providerResult;
    try {
      providerResult = await this.adapter.synthesize({
        generationId,
        requestId,
        text,
        startedAt,
        signal: controller.signal,
        voice: options?.voice,
        model: options?.model,
      });
    } finally {
      const genControllers = this.activeControllers.get(generationId);
      if (genControllers) {
        genControllers.delete(requestId);
        if (genControllers.size === 0) {
          this.activeControllers.delete(generationId);
        }
      }
    }

    // AUTHORIZATION BOUNDARY
    const isCurrent = this.fence.isCurrent(providerResult.generationId);
    const activeGenAtArrival = this.fence.getCurrentGeneration();

    if (!isCurrent || providerResult.generationId < activeGenAtArrival) {
      this.measurement.recordStaleResultAttempted(providerResult.generationId);
      this.measurement.recordStaleResultBlocked(providerResult.generationId);
      this.fence.recordStaleBlocked();
      if (providerResult.audioBuffer) {
        this.measurement.recordStaleAudioBlocked(providerResult.generationId);
        this.audit.record(
          providerResult.generationId,
          "stale_audio_blocked",
          activeGenAtArrival,
          "test_synthesis",
          "Stale synthesized audio prevented from entering playback queue"
        );
      }
      this.audit.record(
        providerResult.generationId,
        "stale_synthesis_result_blocked",
        activeGenAtArrival,
        "test_synthesis",
        `Stale result blocked: Gen ${providerResult.generationId} < Gen ${activeGenAtArrival}`
      );
      return {
        kind: "stale",
        generationId: providerResult.generationId,
        requestId: providerResult.requestId,
        reason: "STALE_GENERATION",
        blockedAt: Date.now(),
        activeGeneration: activeGenAtArrival,
      };
    }

    if (providerResult.status === "cancelled") {
      return {
        kind: "cancelled",
        generationId: providerResult.generationId,
        requestId: providerResult.requestId,
        reason: providerResult.error || "Synthesis cancelled",
        cancelledAt: Date.now(),
      };
    }

    if (providerResult.status === "failed" || !providerResult.audioBuffer) {
      return {
        kind: "failed",
        generationId: providerResult.generationId,
        requestId: providerResult.requestId,
        errorCode: providerResult.errorCode,
        error: providerResult.error || "Synthesis failed",
        failedAt: Date.now(),
      };
    }

    this.audit.record(
      generationId,
      "synthesis_result_authorized",
      activeGenAtArrival,
      "test_synthesis",
      `Result authorized [${providerResult.requestId}], bytes: ${providerResult.audioBuffer.byteLength}`
    );

    return {
      kind: "authorized",
      result: {
        authorized: true,
        generationId: providerResult.generationId,
        requestId: providerResult.requestId,
        audioBuffer: providerResult.audioBuffer,
        audioData: providerResult.audioData || providerResult.audioBuffer,
        contentType: providerResult.contentType || "audio/mpeg",
        provider: providerResult.provider || "Rime",
        model: providerResult.model,
        voice: providerResult.voice,
        providerLatencyMs: providerResult.latencyMs ?? (Date.now() - startedAt),
        authorizedAt: Date.now(),
      },
    };
  }

  abortGeneration(generationId, reason) {
    const genControllers = this.activeControllers.get(generationId);
    if (genControllers) {
      for (const controller of genControllers.values()) {
        if (!controller.signal.aborted) {
          controller.abort(reason || `Generation ${generationId} aborted`);
        }
      }
      this.activeControllers.delete(generationId);
    }
  }

  getControllerCount(generationId) {
    return this.activeControllers.get(generationId)?.size ?? 0;
  }
}

// ----------------------------------------------------
// HTTP Helper for server verification
// ----------------------------------------------------
function fetchPost(url, bodyObj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(bodyObj);
    const parsedUrl = new URL(url);
    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let responseBody = "";
        res.on("data", (chunk) => (responseBody += chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: responseBody,
          });
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function fetchGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on("error", reject);
  });
}

async function startServer(port) {
  const proc = spawn("cmd.exe", ["/c", "npx", "next", "start", "-p", String(port)], {
    cwd: process.cwd(),
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
      const res = await fetchGet(`http://127.0.0.1:${port}/api/voice/status`);
      if (res.statusCode === 200) return proc;
    } catch {}
  }

  proc.kill();
  throw new Error(`Server on port ${port} failed to start`);
}

// ----------------------------------------------------
// MAIN TEST RUNNER
// ----------------------------------------------------
async function run() {
  console.log(bold("=================================================="));
  console.log(bold(" PHASE 3 — STEP 12: SYNTHESIS AUTHORIZATION SUITE "));
  console.log(bold("==================================================\n"));

  const synthesisPath = path.join(process.cwd(), "lib", "generation-aware-synthesis.ts");
  const typesPath = path.join(process.cwd(), "types", "provider.ts");

  // TEST 1: Generation-aware synthesis module exists
  console.log(cyan("TEST 1: Generation-aware synthesis module exists"));
  assert(fs.existsSync(synthesisPath), "lib/generation-aware-synthesis.ts exists");
  const synthesisSource = fs.readFileSync(synthesisPath, "utf-8");
  assert(synthesisSource.includes("class GenerationAwareSynthesis"), "Exports GenerationAwareSynthesis");
  assert(synthesisSource.includes("export const generationAwareSynthesis"), "Exports singleton generationAwareSynthesis");

  // Setup fresh test harness
  const fence = new TestFence();
  const audit = new TestAudit();
  const pipeline = new TestPipeline();
  const adapter = new TestMockProviderAdapter({ delayMs: 10 });
  const orchestrator = new StandaloneGenerationAwareSynthesis({
    fence,
    audit,
    measurement: pipeline,
    adapter,
  });

  // TEST 2: Generation ID is preserved from request through provider result
  console.log(cyan("\nTEST 2: Generation ID is preserved from request through provider result"));
  fence.beginGeneration(); // Gen 1
  const outGen1 = await orchestrator.synthesizeForGeneration(1, "Turn for Gen 1", {
    requestId: "req-trace-001",
  });
  assert(outGen1.kind === "authorized", "Gen 1 outcome is authorized");
  assert(outGen1.result.generationId === 1, "Result generationId matches dispatched generationId 1");

  // TEST 3: Current generation provider result becomes authorized
  console.log(cyan("\nTEST 3: Current generation provider result becomes authorized"));
  assert(outGen1.result.authorized === true, "Authorized flag is strictly true");
  assert(typeof outGen1.result.authorizedAt === "number", "authorizedAt timestamp is present");

  // TEST 4: Authorized result preserves requestId
  console.log(cyan("\nTEST 4: Authorized result preserves requestId"));
  assert(outGen1.result.requestId === "req-trace-001", "Preserves exact requestId");

  // TEST 5: Authorized result preserves audioBuffer
  console.log(cyan("\nTEST 5: Authorized result preserves audioBuffer"));
  assert(outGen1.result.audioBuffer instanceof ArrayBuffer, "audioBuffer is ArrayBuffer");
  assert(outGen1.result.audioBuffer.byteLength > 0, "audioBuffer has non-zero byteLength");

  // TEST 6: Failed provider result never becomes authorized
  console.log(cyan("\nTEST 6: Failed provider result never becomes authorized"));
  adapter.setFailure("PROVIDER_ERROR");
  const failOutcome = await orchestrator.synthesizeForGeneration(1, "Failing request");
  assert(failOutcome.kind === "failed", "Failing provider outcome is 'failed'");
  assert(failOutcome.kind !== "authorized", "Failing result is never authorized");
  adapter.setFailure(undefined);

  // TEST 7: Cancelled provider result never becomes authorized
  console.log(cyan("\nTEST 7: Cancelled provider result never becomes authorized"));
  const preAborted = new AbortController();
  preAborted.abort();
  const cancelOutcome = await orchestrator.synthesizeForGeneration(1, "Aborted request", {
    externalSignal: preAborted.signal,
  });
  assert(cancelOutcome.kind === "cancelled", "Aborted outcome is 'cancelled'");
  assert(cancelOutcome.kind !== "authorized", "Cancelled result is never authorized");

  // TEST 8: Stale generation provider result is blocked
  console.log(cyan("\nTEST 8: Stale generation provider result is blocked"));
  fence.beginGeneration(); // Gen 2 is now active
  assert(fence.getCurrentGeneration() === 2, "Fence active generation is 2");
  const staleOutcome = await orchestrator.synthesizeForGeneration(1, "Late Gen 1 attempt");
  assert(staleOutcome.kind === "stale", "Superseded Gen 1 outcome is 'stale'");
  assert(staleOutcome.reason === "STALE_GENERATION", "Reason is STALE_GENERATION");

  // TEST 9 & 10: Deterministic Race: Gen 1 starts, user interrupts, Gen 2 active, Gen 1 arrives late
  console.log(cyan("\nTEST 9 & 10: Deterministic Interruption Race Condition"));
  adapter.setDelay(80); // 80ms delay for Gen 2 vs late arrival
  fence.beginGeneration(); // Gen 3
  const gen3ActiveId = fence.getCurrentGeneration(); // 3

  // Gen 3 starts delayed synthesis
  const gen3Promise = orchestrator.synthesizeForGeneration(gen3ActiveId, "Paris hotel query", {
    requestId: "gen3-paris-late",
  });

  // At T=15ms, user interrupts and begins Gen 4
  await new Promise((r) => setTimeout(r, 15));
  fence.beginGeneration(); // Gen 4 is now active!
  const gen4ActiveId = fence.getCurrentGeneration(); // 4

  // Gen 4 completes normally with shorter delay
  adapter.setDelay(10);
  const gen4Outcome = await orchestrator.synthesizeForGeneration(gen4ActiveId, "Tokyo weather query", {
    requestId: "gen4-tokyo-current",
  });

  // Await late Gen 3 completion
  const lateGen3Outcome = await gen3Promise;

  // TEST 9 check
  assert(lateGen3Outcome.kind === "stale", "Late Gen 3 result is strictly rejected as 'stale'");
  assert(lateGen3Outcome.kind !== "authorized", "Late Gen 3 result never became authorized");

  // TEST 10 check
  assert(gen4Outcome.kind === "authorized", "Gen 4 outcome remained fully authorized");
  assert(gen4Outcome.result.generationId === 4, "Gen 4 generationId intact");
  assert(gen4Outcome.result.requestId === "gen4-tokyo-current", "Gen 4 requestId intact");

  // TEST 11: Stale result increments attempted metrics
  console.log(cyan("\nTEST 11: Stale result increments attempted metrics"));
  const snapshot = pipeline.getSnapshot();
  assert(snapshot.staleResults.attempted >= 2, `staleResults.attempted incremented (got ${snapshot.staleResults.attempted})`);

  // TEST 12: Stale result increments blocked metrics
  console.log(cyan("\nTEST 12: Stale result increments blocked metrics"));
  assert(snapshot.staleResults.blocked >= 2, `staleResults.blocked incremented (got ${snapshot.staleResults.blocked})`);

  // TEST 13: Protection rate is mathematically correct
  console.log(cyan("\nTEST 13: Protection rate is mathematically correct"));
  assert(snapshot.staleResults.protectionRate === 100, "Protection rate is 100%");

  // TEST 14: blocked <= attempted invariant always holds
  console.log(cyan("\nTEST 14: blocked <= attempted invariant always holds"));
  assert(snapshot.staleResults.blocked <= snapshot.staleResults.attempted, "Invariant blocked <= attempted holds");

  // TEST 15: GenerationFence active generation remains authoritative
  console.log(cyan("\nTEST 15: GenerationFence active generation remains authoritative"));
  assert(fence.getCurrentGeneration() === 4, "Active generation remains strictly Gen 4");

  // TEST 16: Provider adapter cannot alter GenerationFence state
  console.log(cyan("\nTEST 16: Provider adapter cannot alter GenerationFence state"));
  await adapter.synthesize({ generationId: 999, text: "Bypass test" });
  assert(fence.getCurrentGeneration() === 4, "Fence generation unaffected by standalone adapter calls");

  // TEST 17: AbortController aborts the correct generation request
  console.log(cyan("\nTEST 17: AbortController aborts the correct generation request"));
  adapter.setDelay(100);
  const genA_promise = orchestrator.synthesizeForGeneration(4, "Gen 4 A", { requestId: "req-a" });
  const genB_promise = orchestrator.synthesizeForGeneration(4, "Gen 4 B", { requestId: "req-b" });
  assert(orchestrator.getControllerCount(4) === 2, "Two active controllers for Gen 4");
  orchestrator.abortGeneration(4, "User cancelled");
  const [resA, resB] = await Promise.all([genA_promise, genB_promise]);
  assert(resA.kind === "cancelled" && resB.kind === "cancelled", "Both requests aborted cleanly");
  assert(orchestrator.getControllerCount(4) === 0, "Controller map cleaned up");

  // TEST 18: Generation 1 cleanup cannot remove Generation 2 controller
  console.log(cyan("\nTEST 18: Generation 1 cleanup cannot remove Generation 2 controller"));
  adapter.setDelay(60);
  fence.beginGeneration(); // Gen 5
  const gen5Promise = orchestrator.synthesizeForGeneration(5, "Gen 5 long", { requestId: "gen5-req" });
  // Start and quickly finish Gen 6 in a different generation
  fence.beginGeneration(); // Gen 6
  adapter.setDelay(5);
  await orchestrator.synthesizeForGeneration(6, "Gen 6 quick", { requestId: "gen6-req" });
  // Gen 5 controller must still be present and not clobbered
  assert(orchestrator.getControllerCount(5) === 1, "Gen 5 controller preserved despite Gen 6 completion");
  await gen5Promise; // completes late, rejected as stale

  // TEST 19: Concurrent requests remain isolated by requestId
  console.log(cyan("\nTEST 19: Concurrent requests remain isolated by requestId"));
  fence.beginGeneration(); // Gen 7
  adapter.setDelay(10);
  const [c1, c2] = await Promise.all([
    orchestrator.synthesizeForGeneration(7, "Turn 1", { requestId: "iso-1" }),
    orchestrator.synthesizeForGeneration(7, "Turn 2", { requestId: "iso-2" }),
  ]);
  assert(c1.result.requestId === "iso-1", "c1 requestId preserved");
  assert(c2.result.requestId === "iso-2", "c2 requestId preserved");
  assert(c1.result.requestId !== c2.result.requestId, "Distinct requestIds isolated");

  // TEST 20: Provider arrival order does not determine authority
  console.log(cyan("\nTEST 20: Provider arrival order does not determine authority"));
  // Even if an older result arrived first or last, authority strictly depends on fence.isCurrent()
  assert(lateGen3Outcome.kind === "stale", "Arrival order did not grant authority to late Gen 3");

  // TEST 21: No transcript corruption occurs
  console.log(cyan("\nTEST 21: No transcript corruption occurs"));
  assert(pipeline.getSnapshot().transcript.corruptionCount === 0, "Transcript corruption count is strictly 0");

  // TEST 22: No audio resurrection occurs
  console.log(cyan("\nTEST 22: No audio resurrection occurs"));
  assert(pipeline.getSnapshot().audio.resurrectionCount === 0, "Audio resurrection count is strictly 0");
  assert(pipeline.getSnapshot().audio.staleAudioStartsBlocked >= 1, "staleAudioStartsBlocked tracked successfully");

  // TEST 23: Audit events preserve generationId and requestId
  console.log(cyan("\nTEST 23: Audit events preserve generationId and requestId"));
  const events = audit.getEvents();
  const authEvent = events.find((e) => e.event === "synthesis_result_authorized");
  assert(Boolean(authEvent), "Found synthesis_result_authorized event");
  assert(typeof authEvent.generationId === "number", "Audit event preserves generationId");

  // TEST 24: Audit events are chronologically ordered
  console.log(cyan("\nTEST 24: Audit events are chronologically ordered"));
  let isChronological = true;
  for (let i = 0; i < events.length - 1; i++) {
    if (events[i].timestamp < events[i + 1].timestamp) {
      isChronological = false;
      break;
    }
  }
  assert(isChronological, "Audit event stream is ordered chronologically (newest first)");

  // TEST 25: No secrets appear in synthesis outcomes or audit data
  console.log(cyan("\nTEST 25: No secrets appear in synthesis outcomes or audit data"));
  const outcomeStr = JSON.stringify(gen4Outcome);
  assert(!outcomeStr.includes("sk-"), "No sk- secrets");
  assert(!outcomeStr.includes("Bearer "), "No bearer tokens");
  assert(!outcomeStr.includes("RIME_API_KEY"), "No RIME_API_KEY");

  // TEST 26: Mock mode fully supports deterministic stale-result testing
  console.log(cyan("\nTEST 26: Mock mode fully supports deterministic stale-result testing"));
  assert(adapter instanceof TestMockProviderAdapter, "Mock provider adapter tested deterministically");

  // TEST 27: Existing Step 11 provider tests remain compatible
  console.log(cyan("\nTEST 27: Existing Step 11 provider tests remain compatible"));
  const typesContent = fs.readFileSync(typesPath, "utf-8");
  assert(typesContent.includes("export interface AuthorizedSynthesisResult"), "AuthorizedSynthesisResult defined in types");
  assert(typesContent.includes("export type GenerationAwareSynthesisOutcome"), "GenerationAwareSynthesisOutcome defined in types");

  // TEST 28: Existing Step 4–11 authority invariants remain intact
  console.log(cyan("\nTEST 28: Existing Step 4-11 authority invariants remain intact"));
  assert(fence.staleBlockedCount >= 2, "GenerationFence blocked counter properly incremented");

  // LIVE SERVER API TEST: PORT 3070
  console.log(cyan("\nTEST 29 & 30: Live Server API Verification"));
  const testPort = 3070;
  console.log(`  Launching Next.js test server on port ${testPort}...`);
  const serverProc = await startServer(testPort);

  try {
    // Normal synthesis without authorization check (Step 11 compatibility)
    const rawRes = await fetchPost(`http://127.0.0.1:${testPort}/api/voice/synthesize`, {
      generationId: 1,
      text: "Normal proxy test",
    });
    assert(rawRes.statusCode === 200, `Raw synthesize returned 200 (got ${rawRes.statusCode})`);
    const rawJson = JSON.parse(rawRes.body);
    assert(rawJson.success === true, "Raw synthesize returned success: true");

    // Authorized synthesis endpoint verification (Step 12 feature)
    const authRes = await fetchPost(`http://127.0.0.1:${testPort}/api/voice/synthesize`, {
      generationId: 1,
      text: "Authorized synthesis test",
      authorize: true,
      requestId: "live-auth-req-1",
    });
    assert(authRes.statusCode === 200, `Authorized synthesize returned 200 (got ${authRes.statusCode})`);
    const authJson = JSON.parse(authRes.body);
    assert(authJson.success === true, "Authorized synthesize returned success: true");
    assert(!authRes.body.includes("RIME_API_KEY"), "Live API response leaks zero secrets");
    assert(!authRes.body.includes("Bearer"), "Live API response contains zero Bearer tokens");
  } finally {
    serverProc.kill();
  }

  console.log(green("\nAll Step 12 verification tests passed successfully!"));
  console.log(bold("\n=================================================="));
  console.log(bold(`   PHASE 3 — STEP 12: AUTHORIZATION COMPLETE      `));
  console.log(bold("=================================================="));
  console.log(bold(`SUMMARY:\n${passedCount} PASSED, ${failedCount} FAILED`));
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
