/**
 * tests/step16/lifecycle-race.spec.ts
 * E2E Browser validation for Scenarios 8 and 9:
 * - Scenario 8: Rapid Interruption Storm & Idempotency
 * - Scenario 9: Component Unmount During Active Voice Operations
 */

import { test, expect } from "@playwright/test";
import { setupEchoFencePage, createWavBase64 } from "./helpers";

test.describe("System Lifecycle & Component Boundary Races", () => {
  test("Scenario 8: Rapid interruption storm is strictly idempotent without duplicate errors or state corruption", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    const testAudioBase64 = createWavBase64(0.2);

    const result = await page.evaluate(async (audioBase64) => {
      const t = window.__ECHOFENCE_TEST__!;
      const fence = t.generationFence;
      const interruptCtrl = t.interruptController;
      const audio = t.generationAwareAudio;

      // 1. Start G1 with active playback
      const g1 = fence.beginGeneration("user_turn", "Gen 1 under interruption storm");

      const binaryString = atob(audioBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      await audio.playAuthorizedAudio({
        authorized: true,
        generationId: g1,
        requestId: `req-storm-${g1}`,
        audioBuffer: bytes.buffer,
        contentType: "audio/wav",
        provider: "Rime",
        providerLatencyMs: 40,
        authorizedAt: Date.now(),
      });

      // 2. Fire rapid burst of 5 interruptions on G1
      const burstResults = [];
      burstResults.push(interruptCtrl.interrupt(g1, "user_barge_in"));
      burstResults.push(interruptCtrl.interrupt(g1, "user_barge_in"));
      burstResults.push(interruptCtrl.interrupt(g1, "manual_button"));
      burstResults.push(interruptCtrl.interrupt(g1, "test_simulation"));
      burstResults.push(interruptCtrl.interrupt(g1, "user_barge_in"));

      // 3. Begin G2 immediately
      const g2 = fence.beginGeneration("user_turn", "Gen 2 recovering after storm");
      const g2AudioResult = await audio.playAuthorizedAudio({
        authorized: true,
        generationId: g2,
        requestId: `req-storm-${g2}`,
        audioBuffer: bytes.buffer.slice(0),
        contentType: "audio/wav",
        provider: "Rime",
        providerLatencyMs: 40,
        authorizedAt: Date.now(),
      });

      const metrics = t.getMeasurementSnapshot();

      return {
        g1,
        g2,
        burstResults,
        g2AudioResult,
        isG1Interrupted: interruptCtrl.isInterrupted(g1),
        isG2Interrupted: interruptCtrl.isInterrupted(g2),
        isG2Current: fence.isCurrent(g2),
        metrics,
      };
    }, testAudioBase64);

    // First interrupt succeeded
    expect(result.burstResults[0].interruptedGenerationId).toBe(1);

    // Metrics only recorded 1 interruption (strictly idempotent)
    expect(result.metrics.interruption.count).toBe(1);

    // G2 started and played successfully
    expect(result.g2AudioResult.kind).toBe("started");
    expect(result.isG1Interrupted).toBe(true);
    expect(result.isG2Interrupted).toBe(false);
    expect(result.isG2Current).toBe(true);

    // Invariants hold
    expect(result.metrics.audio.resurrectionCount).toBe(0);
    expect(result.metrics.transcript.corruptionCount).toBe(0);

    expect(monitor.getUnexpectedErrors()).toEqual([]);
  });

  test("Scenario 9: Component unmount during active voice operations cleanly tears down resources without React warnings", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    const testAudioBase64 = createWavBase64(0.5);

    // 1. Start active voice playback and VAD monitoring
    await page.evaluate(async (audioBase64) => {
      const t = window.__ECHOFENCE_TEST__!;
      const fence = t.generationFence;
      const detector = t.bargeInDetector;
      const audio = t.generationAwareAudio;

      const g1 = fence.beginGeneration("user_turn", "Gen 1 active unmount test");
      await detector.startMonitoring(g1);

      const binaryString = atob(audioBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      await audio.playAuthorizedAudio({
        authorized: true,
        generationId: g1,
        requestId: `req-unmount-${g1}`,
        audioBuffer: bytes.buffer,
        contentType: "audio/wav",
        provider: "Rime",
        providerLatencyMs: 40,
        authorizedAt: Date.now(),
      });
    }, testAudioBase64);

    // Verify audio and monitoring are running before unmount
    const preUnmount = await page.evaluate(() => {
      const t = window.__ECHOFENCE_TEST__!;
      return {
        isMonitoring: t.getPlaybackSnapshot().isBargeInMonitoring,
        activePlaybackCount: t.getPlaybackSnapshot().activePlaybackCount,
      };
    });
    expect(preUnmount.isMonitoring).toBe(true);
    expect(preUnmount.activePlaybackCount).toBeGreaterThanOrEqual(1);

    // 2. Unmount VoiceConsole by navigating away
    await page.goto("about:blank");

    // Wait a short moment for any asynchronous timers or decode callbacks to attempt firing
    await page.waitForTimeout(300);

    // 3. Verify zero unhandled exceptions, zero React state update warnings
    const errors = monitor.getUnexpectedErrors();
    expect(errors).toEqual([]);
  });
});
