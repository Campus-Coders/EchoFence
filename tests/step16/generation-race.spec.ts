/**
 * tests/step16/generation-race.spec.ts
 * E2E Browser validation for Scenarios 1, 4, 5:
 * - Scenario 1: Normal Authoritative Voice Turn
 * - Scenario 4: Interrupt During Synthesis
 * - Scenario 5: Interrupt During Audio Decode
 */

import { test, expect } from "@playwright/test";
import { setupEchoFencePage, createWavBase64 } from "./helpers";

test.describe("Generation Authority & Lifecycle Races", () => {
  test("Scenario 1: Normal authoritative voice turn completes cleanly without stale results or resurrection", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    const testAudioBase64 = createWavBase64(0.2);

    // Mock provider routes for deterministic browser response
    await page.route("**/api/voice/turn", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { responseText: "I found 3 hotels in Mumbai for Friday starting at 4,200 rupees." },
        }),
      });
    });

    await page.route("**/api/voice/synthesize", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            audioAvailable: true,
            audioBase64: testAudioBase64,
            contentType: "audio/wav",
          },
        }),
      });
    });

    // Execute normal turn through integrated VoiceConsole
    await page.evaluate(async () => {
      await window.__ECHOFENCE_TEST__?.executeTurn("Find hotels in Mumbai for Friday");
    });

    // Verify DOM updates (.turn-card represents a conversation turn)
    await expect(page.locator(".turn-card")).toHaveCount(2);

    // Check invariants via observability interface
    const state = await page.evaluate(() => {
      const t = window.__ECHOFENCE_TEST__!;
      const fence = t.generationFence;
      const interruptCtrl = t.interruptController;
      return {
        currentGeneration: fence.getCurrentGeneration(),
        isCurrent: fence.isCurrent(1),
        isInterrupted: interruptCtrl.isInterrupted(1),
        metrics: t.getMeasurementSnapshot(),
        playback: t.getPlaybackSnapshot(),
        turns: t.getTurns(),
        smState: t.getStateMachineState(),
      };
    });

    expect(state.currentGeneration).toBe(1);
    expect(state.isCurrent).toBe(true);
    expect(state.isInterrupted).toBe(false);

    expect(state.turns).toHaveLength(2);
    expect(state.turns?.[0].role).toBe("user");
    expect(state.turns?.[1].role).toBe("assistant");
    expect(state.turns?.[1].audioAvailable).toBe(true);

    // Assert metric invariants
    expect(state.metrics.audio.resurrectionCount).toBe(0);
    expect(state.metrics.transcript.corruptionCount).toBe(0);
    expect(state.metrics.staleResults.protectionRate).toBe(100);
    expect(state.metrics.staleResults.blocked).toBe(0); // Clean path: 0 stale attempts

    // Error safety
    expect(monitor.getUnexpectedErrors()).toEqual([]);
  });

  test("Scenario 4: Interrupt during pending synthesis drops stale provider response and protects G2", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    const testAudioBase64 = createWavBase64(0.2);

    let resolveSynth: () => void;
    const synthDelayPromise = new Promise<void>((res) => {
      resolveSynth = res;
    });

    await page.route("**/api/voice/turn", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { responseText: "Slow search response" },
        }),
      });
    });

    await page.route("**/api/voice/synthesize", async (route) => {
      // Delay synthesis response until after interrupt fires
      await synthDelayPromise;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            audioAvailable: true,
            audioBase64: testAudioBase64,
            contentType: "audio/wav",
          },
        }),
      });
    });

    // Start Gen 1
    const turnPromise = page.evaluate(() => {
      return window.__ECHOFENCE_TEST__?.executeTurn("Initial slow query");
    });

    // Wait until Gen 1 is created
    await page.waitForFunction(() => {
      const t = window.__ECHOFENCE_TEST__;
      return t && t.generationFence.getCurrentGeneration() === 1;
    });

    // User interrupts Gen 1 while synthesis is pending
    await page.evaluate(() => {
      window.__ECHOFENCE_TEST__?.triggerInterruption(1, "user_barge_in");
    });

    // Now resolve delayed synthesis response
    resolveSynth!();
    await turnPromise;

    // Start Gen 2 immediately
    await page.evaluate(async () => {
      await window.__ECHOFENCE_TEST__?.executeTurn("Gen 2 immediate query");
    });

    const state = await page.evaluate(() => {
      const t = window.__ECHOFENCE_TEST__!;
      const fence = t.generationFence;
      const interruptCtrl = t.interruptController;
      return {
        currentGeneration: fence.getCurrentGeneration(),
        isG1Interrupted: interruptCtrl.isInterrupted(1),
        isG2Current: fence.isCurrent(2),
        isG2Interrupted: interruptCtrl.isInterrupted(2),
        metrics: t.getMeasurementSnapshot(),
        turns: t.getTurns(),
        audit: t.getAuditEvents(50),
      };
    });

    // Gen 2 is authoritative; Gen 1 is interrupted
    expect(state.currentGeneration).toBe(2);
    expect(state.isG1Interrupted).toBe(true);
    expect(state.isG2Current).toBe(true);
    expect(state.isG2Interrupted).toBe(false);

    // Interruption / Abort triggered for Gen 1 synthesis
    const abortOrStaleEvent = state.audit?.find(
      (e) =>
        e.event === "async_work_aborted" ||
        e.event === "generation_interrupted" ||
        e.event === "stale_result_blocked" ||
        e.event === "stale_audio_blocked"
    );
    expect(abortOrStaleEvent).toBeDefined();

    // Gen 1 assistant turn was not committed to transcript
    const gen1AssistantTurns = state.turns?.filter((t) => t.generationId === 1 && t.role === "assistant");
    expect(gen1AssistantTurns).toHaveLength(0);

    // Invariants
    expect(state.metrics.audio.resurrectionCount).toBe(0);
    expect(state.metrics.transcript.corruptionCount).toBe(0);
    expect(state.metrics.staleResults.protectionRate).toBe(100);

    expect(monitor.getUnexpectedErrors()).toEqual([]);
  });

  test("Scenario 5: Interrupt during audio decode triggers post-decode authority barrier", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    const testAudioBase64 = createWavBase64(0.2);

    const result = await page.evaluate(async (audioBase64) => {
      const t = window.__ECHOFENCE_TEST__!;
      const fence = t.generationFence;
      const interruptCtrl = t.interruptController;
      const audioLayer = t.generationAwareAudio;

      // 1. Begin Gen 1
      const gen1 = fence.beginGeneration("test_turn", "Gen 1 decode test");

      // Prepare audio buffer bytes
      const binaryString = atob(audioBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const authResult = {
        authorized: true,
        generationId: gen1,
        requestId: `req-decode-${gen1}`,
        audioBuffer: bytes.buffer,
        contentType: "audio/wav",
        provider: "Rime",
        providerLatencyMs: 40,
        authorizedAt: Date.now(),
      };

      // 2. Interrupt Gen 1 right before/during decode
      interruptCtrl.interrupt(gen1, "user_barge_in");

      // 3. Play audio through generation-aware audio
      const outcome = await audioLayer.playAuthorizedAudio(authResult);

      return {
        outcome,
        isInterrupted: interruptCtrl.isInterrupted(gen1),
        resurrectionCount: t.getMeasurementSnapshot().audio.resurrectionCount,
        auditEvents: t.getAuditEvents(10),
      };
    }, testAudioBase64);

    // Post-decode authority check must block playback
    expect(result.outcome.kind).toBe("blocked");
    expect(result.outcome.reason).toMatch(/STALE/);
    expect(result.resurrectionCount).toBe(0);

    expect(monitor.getUnexpectedErrors()).toEqual([]);
  });
});
