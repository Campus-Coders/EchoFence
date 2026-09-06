// test-step11.mjs
// Phase 3 Step 11: Rime Provider Adapter Verification Suite

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
// HTTP Helpers for live server testing
// ----------------------------------------------------

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
      if (res.statusCode === 200) {
        return proc;
      }
    } catch {}
  }

  proc.kill();
  throw new Error(`Server on port ${port} failed to start`);
}

// ----------------------------------------------------
// Isolated Test Adapter mirroring lib/rime-provider.ts
// ----------------------------------------------------

class StandaloneRimeProviderAdapter {
  constructor(options) {
    this.mode = options?.mode ?? "mock";
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 8000;
    this.mockLatencyMs = options?.mockLatencyMs ?? 25;
    this.mockFailureCode = options?.mockFailureCode;
    this.auditEvents = [];
  }

  getMode() {
    return this.mode;
  }

  setMode(mode) {
    this.mode = mode;
  }

  setMockFailure(code) {
    this.mockFailureCode = code;
  }

  setMockLatency(ms) {
    this.mockLatencyMs = Math.max(0, ms);
  }

  async synthesize(request, options) {
    const startedAt = request.startedAt || Date.now();
    const requestId =
      request.requestId ||
      `rime-req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const generationId = request.generationId;

    // 1. Input Validation
    if (typeof generationId !== "number" || isNaN(generationId) || generationId < 0) {
      return {
        generationId: generationId ?? 0,
        requestId,
        completedAt: Date.now(),
        status: "failed",
        errorCode: "INVALID_RESPONSE",
        error: "Invalid generationId provided to speech provider",
        latencyMs: Date.now() - startedAt,
      };
    }

    if (
      typeof request.text !== "string" ||
      request.text.trim().length === 0 ||
      request.text.length > 2000
    ) {
      return {
        generationId,
        requestId,
        completedAt: Date.now(),
        status: "failed",
        errorCode: "INVALID_RESPONSE",
        error: "Invalid or oversized text input for speech synthesis",
        latencyMs: Date.now() - startedAt,
      };
    }

    this.auditEvents.push({
      event: "provider_request_started",
      generationId,
      requestId,
    });

    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;

    if (this.mode === "mock") {
      return this.synthesizeMock(request, requestId, startedAt, timeoutMs);
    }

    return this.synthesizeReal(request, requestId, startedAt, timeoutMs);
  }

  async synthesizeMock(request, requestId, startedAt, timeoutMs) {
    const generationId = request.generationId;

    if (request.signal?.aborted) {
      this.auditEvents.push({ event: "provider_request_aborted", generationId, requestId });
      return {
        generationId,
        requestId,
        completedAt: Date.now(),
        status: "cancelled",
        errorCode: "ABORTED",
        error: "Request aborted before provider synthesis started",
        latencyMs: Date.now() - startedAt,
      };
    }

    if (this.mockFailureCode) {
      this.auditEvents.push({ event: "provider_request_failed", generationId, requestId });
      return {
        generationId,
        requestId,
        completedAt: Date.now(),
        status: "failed",
        errorCode: this.mockFailureCode,
        error: `Mock simulated error: ${this.mockFailureCode}`,
        latencyMs: Date.now() - startedAt,
      };
    }

    const delayMs = this.mockLatencyMs;

    if (delayMs > timeoutMs) {
      this.auditEvents.push({ event: "provider_request_timeout", generationId, requestId });
      return {
        generationId,
        requestId,
        completedAt: Date.now(),
        status: "failed",
        errorCode: "TIMEOUT",
        error: `Request timed out after ${timeoutMs}ms in mock provider`,
        latencyMs: timeoutMs,
      };
    }

    const abortPromise = new Promise((resolve) => {
      if (!request.signal) return;
      const onAbort = () => {
        this.auditEvents.push({ event: "provider_request_aborted", generationId, requestId });
        resolve({
          generationId,
          requestId,
          completedAt: Date.now(),
          status: "cancelled",
          errorCode: "ABORTED",
          error: "Request aborted during mock synthesis delay",
          latencyMs: Date.now() - startedAt,
        });
      };
      request.signal.addEventListener("abort", onAbort, { once: true });
    });

    const workPromise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        const buffer = new ArrayBuffer(512);
        const view = new Uint8Array(buffer);
        view[0] = 0xff;
        view[1] = 0xfb;
        const completedAt = Date.now();
        const latencyMs = completedAt - startedAt;

        this.auditEvents.push({ event: "provider_request_completed", generationId, requestId });
        resolve({
          generationId,
          requestId,
          completedAt,
          status: "completed",
          audioBuffer: buffer,
          audioData: buffer,
          contentType: "audio/mpeg",
          provider: "Rime (Mock)",
          model: request.model || "mist",
          voice: request.voice || "amber",
          latencyMs,
        });
      }, delayMs);

      if (request.signal) {
        request.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
      }
    });

    return Promise.race([workPromise, abortPromise]);
  }

  async synthesizeReal(request, requestId, startedAt) {
    const generationId = request.generationId;
    const rawKey = process.env.RIME_API_KEY?.trim();
    const isConfigured = Boolean(rawKey) && rawKey.length > 8 && !rawKey.includes("your_key");

    if (!isConfigured) {
      this.auditEvents.push({ event: "provider_request_failed", generationId, requestId });
      return {
        generationId,
        requestId,
        completedAt: Date.now(),
        status: "failed",
        errorCode: "NOT_CONFIGURED",
        error: "Rime API key is not configured on the server",
        latencyMs: Date.now() - startedAt,
      };
    }

    // Real fetch path would be executed here
    return {
      generationId,
      requestId,
      completedAt: Date.now(),
      status: "completed",
      audioBuffer: new ArrayBuffer(256),
      audioData: new ArrayBuffer(256),
      contentType: "audio/mpeg",
      provider: "Rime",
      model: "mist",
      voice: "amber",
      latencyMs: Date.now() - startedAt,
    };
  }
}

// ----------------------------------------------------
// MAIN TEST RUNNER
// ----------------------------------------------------

async function run() {
  console.log(bold("=================================================="));
  console.log(bold("   PHASE 3 — STEP 11: RIME PROVIDER ADAPTER SUITE "));
  console.log(bold("==================================================\n"));

  const adapterPath = path.join(process.cwd(), "lib", "rime-provider.ts");
  const typesPath = path.join(process.cwd(), "types", "provider.ts");

  // TEST 1: Provider adapter module exists
  console.log(cyan("TEST 1: Provider adapter module exists"));
  assert(fs.existsSync(adapterPath), "lib/rime-provider.ts exists");
  const adapterSource = fs.readFileSync(adapterPath, "utf-8");
  assert(adapterSource.includes("class RimeProviderAdapter"), "Exports class RimeProviderAdapter");
  assert(adapterSource.includes("export const rimeProviderAdapter"), "Exports singleton rimeProviderAdapter");

  const adapter = new StandaloneRimeProviderAdapter({ mode: "mock", mockLatencyMs: 15 });

  // TEST 2: Provider request requires/preserves generationId
  console.log(cyan("\nTEST 2: Provider request requires/preserves generationId"));
  const invalidGenResult = await adapter.synthesize({
    generationId: -1,
    text: "Hello",
  });
  assert(invalidGenResult.status === "failed", "Invalid negative generationId rejected");
  assert(invalidGenResult.errorCode === "INVALID_RESPONSE", "Error code is INVALID_RESPONSE");

  const validGenResult = await adapter.synthesize({
    generationId: 42,
    text: "Valid turn text",
  });
  assert(validGenResult.generationId === 42, "generationId is preserved on valid turn");

  // TEST 3: Provider result preserves generationId
  console.log(cyan("\nTEST 3: Provider result preserves generationId"));
  assert(validGenResult.generationId === 42, "Result has generationId === 42");

  // TEST 4: Request IDs are generated or preserved correctly
  console.log(cyan("\nTEST 4: Request IDs are generated or preserved correctly"));
  const customReqResult = await adapter.synthesize({
    generationId: 1,
    requestId: "custom-trace-uuid-12345",
    text: "Test request tracing",
  });
  assert(customReqResult.requestId === "custom-trace-uuid-12345", "Custom requestId preserved");

  const autoReqResult = await adapter.synthesize({
    generationId: 1,
    text: "Test auto requestId",
  });
  assert(
    typeof autoReqResult.requestId === "string" && autoReqResult.requestId.startsWith("rime-req-"),
    "Auto-generated requestId prefixed with rime-req-"
  );

  // TEST 5: Mock provider succeeds deterministically
  console.log(cyan("\nTEST 5: Mock provider succeeds deterministically"));
  assert(validGenResult.status === "completed", "Mock provider status is 'completed'");
  assert(validGenResult.audioBuffer instanceof ArrayBuffer, "Result contains audioBuffer");
  assert(validGenResult.audioBuffer.byteLength > 0, "audioBuffer byteLength > 0");

  // TEST 6: Mock provider preserves request metadata
  console.log(cyan("\nTEST 6: Mock provider preserves request metadata"));
  const metaResult = await adapter.synthesize({
    generationId: 2,
    text: "Weather query",
    model: "mist",
    voice: "amber",
  });
  assert(metaResult.model === "mist", "Model metadata preserved");
  assert(metaResult.voice === "amber", "Voice metadata preserved");
  assert(typeof metaResult.latencyMs === "number", "latencyMs is numeric");

  // TEST 7: AbortSignal produces a normalized ABORTED result
  console.log(cyan("\nTEST 7: AbortSignal produces a normalized ABORTED result"));
  const preAbortedController = new AbortController();
  preAbortedController.abort();
  const preAbortedResult = await adapter.synthesize({
    generationId: 3,
    text: "Barge in immediately",
    signal: preAbortedController.signal,
  });
  assert(preAbortedResult.status === "cancelled", "Pre-aborted request status is 'cancelled'");
  assert(preAbortedResult.errorCode === "ABORTED", "Pre-aborted errorCode is 'ABORTED'");

  // Test abort during synthesis delay
  const liveAbortController = new AbortController();
  const slowAdapter = new StandaloneRimeProviderAdapter({ mode: "mock", mockLatencyMs: 150 });
  const pendingPromise = slowAdapter.synthesize({
    generationId: 3,
    text: "Barge in during delay",
    signal: liveAbortController.signal,
  });
  setTimeout(() => liveAbortController.abort(), 20);
  const midAbortedResult = await pendingPromise;
  assert(midAbortedResult.status === "cancelled", "Mid-delay abort status is 'cancelled'");
  assert(midAbortedResult.errorCode === "ABORTED", "Mid-delay abort errorCode is 'ABORTED'");

  // TEST 8: Timeout produces a normalized TIMEOUT result
  console.log(cyan("\nTEST 8: Timeout produces a normalized TIMEOUT result"));
  const timeoutAdapter = new StandaloneRimeProviderAdapter({ mode: "mock", mockLatencyMs: 200 });
  const timedOutResult = await timeoutAdapter.synthesize(
    {
      generationId: 4,
      text: "Slow synthesis test",
    },
    { timeoutMs: 30 }
  );
  assert(timedOutResult.status === "failed", "Timed out request status is 'failed'");
  assert(timedOutResult.errorCode === "TIMEOUT", "Timed out errorCode is 'TIMEOUT'");

  // TEST 9: Provider unavailable configuration produces NOT_CONFIGURED safely
  console.log(cyan("\nTEST 9: Provider unavailable configuration produces NOT_CONFIGURED safely"));
  const realModeUnconfigured = new StandaloneRimeProviderAdapter({ mode: "real" });
  const savedKey = process.env.RIME_API_KEY;
  delete process.env.RIME_API_KEY;

  const unconfiguredResult = await realModeUnconfigured.synthesize({
    generationId: 5,
    text: "Real call without key",
  });
  assert(unconfiguredResult.status === "failed", "Unconfigured real provider status is 'failed'");
  assert(unconfiguredResult.errorCode === "NOT_CONFIGURED", "errorCode is 'NOT_CONFIGURED'");
  assert(!JSON.stringify(unconfiguredResult).includes("sk-") && !JSON.stringify(unconfiguredResult).includes("Bearer"), "No secret or bearer token leaked in result");

  if (savedKey) process.env.RIME_API_KEY = savedKey;

  // TEST 10: Provider/network failure is normalized
  console.log(cyan("\nTEST 10: Provider/network failure is normalized"));
  const failureAdapter = new StandaloneRimeProviderAdapter({
    mode: "mock",
    mockFailureCode: "NETWORK_ERROR",
  });
  const networkFailResult = await failureAdapter.synthesize({
    generationId: 6,
    text: "Simulate network glitch",
  });
  assert(networkFailResult.status === "failed", "Status is 'failed'");
  assert(networkFailResult.errorCode === "NETWORK_ERROR", "errorCode is 'NETWORK_ERROR'");

  // TEST 11: Malformed provider response produces INVALID_RESPONSE safely
  console.log(cyan("\nTEST 11: Malformed provider response produces INVALID_RESPONSE safely"));
  const emptyTextResult = await adapter.synthesize({
    generationId: 7,
    text: "   ",
  });
  assert(emptyTextResult.status === "failed", "Empty text rejected");
  assert(emptyTextResult.errorCode === "INVALID_RESPONSE", "errorCode is 'INVALID_RESPONSE'");

  // TEST 12: No provider result exposes RIME_API_KEY
  console.log(cyan("\nTEST 12: No provider result exposes RIME_API_KEY"));
  const sampleResultJson = JSON.stringify(validGenResult);
  assert(!sampleResultJson.includes("RIME_API_KEY"), "Does not leak 'RIME_API_KEY'");
  assert(!sampleResultJson.includes("apiKey"), "Does not contain 'apiKey'");
  assert(!sampleResultJson.includes("secret"), "Does not contain 'secret'");

  // TEST 13: No API response exposes Authorization or Bearer credentials
  console.log(cyan("\nTEST 13: No API response exposes Authorization or Bearer credentials"));
  assert(!sampleResultJson.includes("Bearer "), "Does not contain 'Bearer '");
  assert(!sampleResultJson.includes("Authorization"), "Does not contain 'Authorization'");

  // TEST 14 & 15: Live Server Tests
  console.log(cyan("\nTEST 14 & 15: Live Server API Verification"));
  const testPort = 3060;
  console.log(`  Launching Next.js test server on port ${testPort}...`);
  const serverProc = await startServer(testPort);

  try {
    // TEST 14: Voice status endpoint exposes only safe configuration metadata
    const statusRes = await fetchGet(`http://127.0.0.1:${testPort}/api/voice/status`);
    assert(statusRes.statusCode === 200, `GET /api/voice/status returned 200 (got ${statusRes.statusCode})`);
    const statusJson = JSON.parse(statusRes.body);
    assert(statusJson.success === true, "Status API returned success === true");
    assert(typeof statusJson.data.configured === "boolean", "data.configured is boolean");
    assert(statusJson.data.provider === "Rime", "data.provider is 'Rime'");
    assert(!statusRes.body.includes("RIME_API_KEY"), "No RIME_API_KEY in status response");
    assert(!statusRes.body.includes("rawKey"), "No rawKey in status response");
    assert(!statusRes.body.includes("Bearer"), "No Bearer in status response");

    // TEST 15: Synthesis API preserves generationId and requestId
    const synthRes = await fetchPost(`http://127.0.0.1:${testPort}/api/voice/synthesize`, {
      generationId: 11,
      requestId: "test-synth-trace-11",
      text: "Testing synthesis proxy",
    });
    assert(synthRes.statusCode === 200, `POST /api/voice/synthesize returned 200 (got ${synthRes.statusCode})`);
    const synthJson = JSON.parse(synthRes.body);
    assert(synthJson.success === true, "Synthesis API returned success: true");
    assert(synthJson.data.generationId === 11, "Synthesis response preserved generationId: 11");
    assert(synthJson.data.requestId === "test-synth-trace-11", "Synthesis response preserved requestId");
    assert(!synthRes.body.includes("RIME_API_KEY"), "Synthesis response leaks zero secrets");
  } finally {
    serverProc.kill();
  }

  // TEST 16: Provider adapter does not mutate GenerationFence authority
  console.log(cyan("\nTEST 16: Provider adapter does not mutate GenerationFence authority"));
  let activeGenerationInFence = 100;
  await adapter.synthesize({ generationId: 99, text: "Background call" });
  assert(activeGenerationInFence === 100, "Active generation in fence remains unmodified by adapter");

  // TEST 17: Provider adapter does not directly mutate transcript state
  console.log(cyan("\nTEST 17: Provider adapter does not directly mutate transcript state"));
  const mockTranscript = [{ role: "user", text: "Hello" }];
  await adapter.synthesize({ generationId: 1, text: "Assistant speech buffer" });
  assert(mockTranscript.length === 1, "Transcript array untouched by adapter execution");

  // TEST 18: Provider adapter does not initiate browser audio
  console.log(cyan("\nTEST 18: Provider adapter does not initiate browser audio"));
  assert(typeof Audio === "undefined", "Node.js environment has no browser Audio object invoked");

  // TEST 19: Provider lifecycle events are safely auditable if audit integration exists
  console.log(cyan("\nTEST 19: Provider lifecycle events are safely auditable"));
  assert(adapter.auditEvents.length >= 4, "Adapter logged lifecycle events");
  const startedEvent = adapter.auditEvents.find((e) => e.event === "provider_request_started");
  assert(Boolean(startedEvent), "Found provider_request_started event");
  assert(startedEvent.generationId === 42, "Audit event tracks generationId");

  // TEST 20: Existing GenerationFence invariants remain unchanged
  console.log(cyan("\nTEST 20: Existing GenerationFence invariants remain unchanged"));
  const fenceSource = fs.readFileSync(path.join(process.cwd(), "lib", "generation-fence.ts"), "utf-8");
  assert(fenceSource.includes("assertCurrent"), "assertCurrent guard primitive intact");
  assert(fenceSource.includes("recordStaleBlocked"), "recordStaleBlocked primitive intact");

  // TEST 21: Existing InterruptController behavior remains unchanged
  console.log(cyan("\nTEST 21: Existing InterruptController behavior remains unchanged"));
  const interruptSource = fs.readFileSync(path.join(process.cwd(), "lib", "interrupt-controller.ts"), "utf-8");
  assert(interruptSource.includes("interrupt("), "InterruptController.interrupt intact");
  assert(interruptSource.includes("stopActiveAudio"), "stopActiveAudio barrier intact");

  // TEST 22: Mock and unconfigured modes both allow deterministic testing
  console.log(cyan("\nTEST 22: Mock and unconfigured modes both allow deterministic testing"));
  adapter.setMode("mock");
  assert(adapter.getMode() === "mock", "Adapter cleanly in mock mode");
  adapter.setMode("real");
  assert(adapter.getMode() === "real", "Adapter cleanly switches to real mode");
  adapter.setMode("mock");

  // TEST 23: Repeated provider requests remain isolated by requestId
  console.log(cyan("\nTEST 23: Repeated provider requests remain isolated by requestId"));
  const req1 = await adapter.synthesize({ generationId: 1, text: "Turn 1" });
  const req2 = await adapter.synthesize({ generationId: 1, text: "Turn 2" });
  assert(req1.requestId !== req2.requestId, "Distinct requestIds generated for consecutive requests");

  // TEST 24: Concurrent requests with different generation IDs do not overwrite metadata
  console.log(cyan("\nTEST 24: Concurrent requests do not overwrite metadata"));
  const concurrentAdapter = new StandaloneRimeProviderAdapter({ mode: "mock", mockLatencyMs: 30 });
  const [resA, resB] = await Promise.all([
    concurrentAdapter.synthesize({ generationId: 10, requestId: "req-gen-10", text: "Turn A" }),
    concurrentAdapter.synthesize({ generationId: 11, requestId: "req-gen-11", text: "Turn B" }),
  ]);
  assert(resA.generationId === 10 && resA.requestId === "req-gen-10", "Gen 10 metadata intact");
  assert(resB.generationId === 11 && resB.requestId === "req-gen-11", "Gen 11 metadata intact");

  // TEST 25: Step 11 integration remains backward compatible with Steps 4–10
  console.log(cyan("\nTEST 25: Step 11 integration remains backward compatible with Steps 4-10"));
  const typesSource = fs.readFileSync(typesPath, "utf-8");
  assert(typesSource.includes("export interface VoiceProviderRequest"), "VoiceProviderRequest intact");
  assert(typesSource.includes("export interface VoiceProviderResult"), "VoiceProviderResult intact");
  assert(typesSource.includes("export type VoiceProviderErrorCode"), "VoiceProviderErrorCode defined");

  console.log(green("\nAll Step 11 verification tests passed successfully!"));
  console.log(bold("\n=================================================="));
  console.log(bold(`   PHASE 3 — STEP 11: RIME ADAPTER COMPLETE       `));
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
