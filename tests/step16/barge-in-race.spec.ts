/**
 * tests/step16/barge-in-race.spec.ts
 * E2E Browser validation for Scenarios 2 and 3:
 * - Scenario 2: Barge-In During Active Playback
 * - Scenario 3: Stale Barge-In Callback vs New Generation
 */

import { test, expect } from "@playwright/test";
import { setupEchoFencePage, createWavBase64 } from "./helpers";

test.describe("Barge-In & Voice Activity Races", () => {
  test("Scenario 2: Real barge-in during active playback halts audio and triggers generation-scoped interruption", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    const testAudioBase64 = createWavBase64(0.5);

    const result = await page.evaluate(async (audioBase64) => {
      const t = window.__ECHOFENCE_TEST__!;
      const fence = t.generationFence;
      const detector = t.bargeInDetector;
      const audio = t.generationAwareAudio;

      // 1. Begin Gen 1
      const gen1 = fence.beginGeneration("user_turn", "Gen 1 with active audio");

      // Prepare audio
      const binaryString = atob(audioBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const authResult = {
        authorized: true,
        generationId: gen1,
        requestId: `req-audio-${gen1}`,
        audioBuffer: bytes.buffer,
        contentType: "audio/wav",
        provider: "Rime",
        providerLatencyMs: 40,
        authorizedAt: Date.now(),
      };

      // 2. Start VAD monitoring and audio playback
      await detector.startMonitoring(gen1);
      const playOutcome = await audio.playAuthorizedAudio(authResult);

      const isPlayingBeforeBargeIn = audio.isGenerationPlaying(gen1);

      // 3. User speaks into microphone: simulate sustained energy above threshold (0.2 > 0.05) for 100ms
      const bargeOutcome = detector.simulateAudioActivity(0.2, 100, gen1);

      const isPlayingAfterBargeIn = audio.isGenerationPlaying(gen1);
      const isInterrupted = t.interruptController.isInterrupted(gen1);
      const metrics = t.getMeasurementSnapshot();
      const audit = t.getAuditEvents(20);

      return {
        playOutcome,
        isPlayingBeforeBargeIn,
        bargeOutcome,
        isPlayingAfterBargeIn,
        isInterrupted,
        metrics,
        audit,
      };
    }, testAudioBase64);

    expect(result.isPlayingBeforeBargeIn).toBe(true);
    expect(result.bargeOutcome.kind).toBe("interrupted");
    expect(result.bargeOutcome.targetGenerationId).toBe(1);
    expect(result.isPlayingAfterBargeIn).toBe(false);
    expect(result.isInterrupted).toBe(true);

    // Assert audit events using e.event
    const eventTypes = result.audit.map((e: any) => e.event);
    expect(eventTypes).toContain("barge_in_monitoring_started");
    expect(eventTypes).toContain("barge_in_activity_detected");
    expect(eventTypes).toContain("barge_in_confirmed");
    expect(eventTypes).toContain("barge_in_interrupt_triggered");

    // Logical metric invariants
    expect(result.metrics.bargeIn.confirmedCount).toBeLessThanOrEqual(
      result.metrics.bargeIn.detectedCount
    );
    expect(result.metrics.bargeIn.interruptTriggeredCount).toBeLessThanOrEqual(
      result.metrics.bargeIn.confirmedCount
    );
    expect(result.metrics.audio.resurrectionCount).toBe(0);

    expect(monitor.getUnexpectedErrors()).toEqual([]);
  });

  test("Scenario 3: Stale G1 barge-in callback resolving after G2 start is ignored and cannot interrupt G2", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    const result = await page.evaluate(async () => {
      const t = window.__ECHOFENCE_TEST__!;
      const fence = t.generationFence;
      const detector = t.bargeInDetector;
      const interruptCtrl = t.interruptController;

      // T0: Generation G1 is authoritative
      const g1 = fence.beginGeneration("user_turn", "Generation 1 active");
      await detector.startMonitoring(g1);

      // T1: Voice activity candidate begins targeting G1
      const t1 = Date.now();
      detector.processAudioLevel(0.2, t1); // Candidate initiated

      // T2: Before confirmation completes, new turn begins: Generation advances G1 -> G2
      const g2 = fence.beginGeneration("user_turn", "Generation 2 advances");

      // T3: Delayed VAD confirmation for G1 resolves at t1 + 100ms
      const staleBargeOutcome = detector.processAudioLevel(0.2, t1 + 100);

      const metrics = t.getMeasurementSnapshot();
      const audit = t.getAuditEvents(20);

      return {
        g1,
        g2,
        staleBargeOutcome,
        isG1Interrupted: interruptCtrl.isInterrupted(g1),
        isG2Interrupted: interruptCtrl.isInterrupted(g2),
        isG2Current: fence.isCurrent(g2),
        metrics,
        audit,
      };
    });

    // G1 delayed barge-in must be safely classified as stale_ignored
    expect(result.staleBargeOutcome.kind).toBe("stale_ignored");
    expect(result.staleBargeOutcome.reason).toBe("TARGET_GENERATION_SUPERSEDED");

    // G2 must NOT be interrupted!
    expect(result.isG2Interrupted).toBe(false);
    expect(result.isG2Current).toBe(true);

    // Audit must contain stale_barge_in_ignored using e.event
    const eventTypes = result.audit.map((e: any) => e.event);
    expect(eventTypes).toContain("stale_barge_in_ignored");

    // Metrics invariants
    expect(result.metrics.staleResults.protectionRate).toBe(100);
    expect(result.metrics.audio.resurrectionCount).toBe(0);
    expect(result.metrics.transcript.corruptionCount).toBe(0);

    expect(monitor.getUnexpectedErrors()).toEqual([]);
  });
});
