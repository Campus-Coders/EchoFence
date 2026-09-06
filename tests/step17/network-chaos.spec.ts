/**
 * tests/step17/network-chaos.spec.ts
 * Browser E2E specs for Step 17 Network Fault Scenarios:
 * - Scenario 1: Network response timeout
 * - Scenario 2: Network response arrives after user interruption
 * - Scenario 3: Duplicate synthesis response
 */

import { test, expect } from "@playwright/test";
import { setupEchoFencePage, createWavBase64 } from "./helpers";

test.describe("Step 17: Network Chaos Scenarios", () => {
  test("Scenario 1: Network response timeout fails safely with zero audio and zero unhandled rejections", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    // Intercept /api/voice/turn with a simulated 504 Gateway Timeout
    await page.route("**/api/voice/turn", (route) => {
      route.fulfill({
        status: 504,
        contentType: "application/json",
        body: JSON.stringify({ error: "Gateway Timeout", message: "Request timed out" }),
      });
    });

    // Execute voice turn
    await page.evaluate(async () => {
      const t = window.__ECHOFENCE_TEST__!;
      t.chaosController.enable({
        id: "scenario-1-network-timeout",
        name: "Network Response Timeout",
        description: "Simulate network timeout on turn request",
        plan: [{ point: "during_network_request", fault: "NETWORK_TIMEOUT", delayMs: 10 }],
        expectedOutcome: {
          audioResurrectionCount: 0,
          transcriptCorruptionCount: 0,
          staleProtectionRate: 100,
          chaosSafetyRate: 100,
          resourceLeaksDetected: 0,
        },
      });

      await t.chaosController.executeFault("during_network_request", { point: "during_network_request", generationId: 1 });
      await t.executeTurn("Hello world timeout test");
      t.chaosController.completeScenario("scenario-1-network-timeout");
    });

    const status = await page.evaluate(() => {
      const t = window.__ECHOFENCE_TEST__!;
      const metrics = t.getMeasurementSnapshot();
      const playback = t.getPlaybackSnapshot();
      const leaks = t.checkResourceLeaks();
      return {
        playbackCount: playback.activePlaybackCount,
        resurrectionCount: metrics.audio.resurrectionCount,
        corruptionCount: metrics.transcript.corruptionCount,
        safeFailures: metrics.chaos.safeFailures,
        unsafeFailures: metrics.chaos.unsafeFailures,
        hasLeaks: leaks.hasLeaks,
      };
    });

    expect(status.playbackCount).toBe(0);
    expect(status.resurrectionCount).toBe(0);
    expect(status.corruptionCount).toBe(0);
    expect(status.safeFailures).toBeGreaterThanOrEqual(1);
    expect(status.unsafeFailures).toBe(0);
    expect(status.hasLeaks).toBe(false);
    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("Scenario 2: Network response arriving after user interruption is blocked as stale", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    let resolveTurnPromise: (value: any) => void;
    const turnDeferred = new Promise((resolve) => {
      resolveTurnPromise = resolve;
    });

    await page.route("**/api/voice/turn", async (route) => {
      await turnDeferred;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { responseText: "Delayed late response for interrupted turn" },
        }),
      });
    });

    await page.evaluate(() => {
      const t = window.__ECHOFENCE_TEST__!;
      t.chaosController.enable({
        id: "scenario-2-network-after-interrupt",
        name: "Network Response After Interruption",
        description: "Response arrives after user barge-in has invalidated generation",
        plan: [{ point: "after_network_response", fault: "STALE_RESPONSE" }],
        expectedOutcome: {
          audioResurrectionCount: 0,
          transcriptCorruptionCount: 0,
          staleProtectionRate: 100,
          chaosSafetyRate: 100,
          resourceLeaksDetected: 0,
        },
      });

      // Start turn G1 in background
      t.executeTurn("User prompt 1").catch(() => {});
    });

    // Wait a brief tick for the request to be dispatched
    await page.waitForTimeout(100);

    // Advance generation so G1 is superseded before network response resolves
    await page.evaluate(() => {
      const t = window.__ECHOFENCE_TEST__!;
      t.generationFence.beginGeneration("user_turn", "User prompt 2");
    });

    // Now resolve the late response
    resolveTurnPromise!(true);
    await page.waitForTimeout(200);

    const status = await page.evaluate(() => {
      const t = window.__ECHOFENCE_TEST__!;
      t.chaosController.completeScenario("scenario-2-network-after-interrupt");
      const metrics = t.getMeasurementSnapshot();
      const playback = t.getPlaybackSnapshot();
      const leaks = t.checkResourceLeaks();
      return {
        playbackCount: playback.activePlaybackCount,
        resurrectionCount: metrics.audio.resurrectionCount,
        corruptionCount: metrics.transcript.corruptionCount,
        staleBlocked: metrics.staleResults.blocked,
        protectionRate: metrics.staleResults.protectionRate,
        hasLeaks: leaks.hasLeaks,
      };
    });

    expect(status.playbackCount).toBe(0);
    expect(status.resurrectionCount).toBe(0);
    expect(status.corruptionCount).toBe(0);
    expect(status.staleBlocked).toBeGreaterThanOrEqual(1);
    expect(status.protectionRate).toBe(100);
    expect(status.hasLeaks).toBe(false);
    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("Scenario 3: Duplicate synthesis response does not cause duplicate audio or node creation", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);
    const wavBase64 = createWavBase64(0.2);

    await page.route("**/api/voice/turn", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { responseText: "Authoritative assistant response" },
        }),
      });
    });

    await page.route("**/api/voice/synthesize", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            audioAvailable: true,
            audioBase64: wavBase64,
            contentType: "audio/wav",
          },
        }),
      });
    });

    await page.evaluate(async (audioPayload) => {
      const t = window.__ECHOFENCE_TEST__!;
      t.chaosController.enable({
        id: "scenario-3-duplicate-response",
        name: "Duplicate Synthesis Response",
        description: "Inject duplicate synthesis response arrival",
        plan: [{ point: "after_network_response", fault: "DUPLICATE_RESPONSE" }],
        expectedOutcome: {
          audioResurrectionCount: 0,
          transcriptCorruptionCount: 0,
          staleProtectionRate: 100,
          chaosSafetyRate: 100,
          resourceLeaksDetected: 0,
        },
      });

      await t.executeTurn("Duplicate test");

      // Inject duplicate playback attempt for the same authorized payload
      const binaryString = atob(audioPayload);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Try playing duplicate payload
      await t.generationAwareAudio.playAuthorizedAudio({
        authorized: true,
        generationId: 1,
        requestId: "duplicate-req-1",
        audioBuffer: bytes.buffer,
        contentType: "audio/wav",
        provider: "Rime",
        providerLatencyMs: 20,
        authorizedAt: Date.now(),
      });

      t.chaosController.completeScenario("scenario-3-duplicate-response");
    }, wavBase64);

    const status = await page.evaluate(() => {
      const t = window.__ECHOFENCE_TEST__!;
      const metrics = t.getMeasurementSnapshot();
      const leaks = t.checkResourceLeaks();
      return {
        resurrectionCount: metrics.audio.resurrectionCount,
        corruptionCount: metrics.transcript.corruptionCount,
        protectionRate: metrics.staleResults.protectionRate,
        hasLeaks: leaks.hasLeaks,
      };
    });

    expect(status.resurrectionCount).toBe(0);
    expect(status.corruptionCount).toBe(0);
    expect(status.hasLeaks).toBe(false);
    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });
});
