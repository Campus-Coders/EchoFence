/**
 * tests/step17/full-chaos-timeline.spec.ts
 * Browser E2E spec for Scenario 15: Full Adversarial Multi-Turn Chaos Timeline.
 *
 * Sequence:
 * T0:  G1 synthesis begins
 * T1:  Network delay injected
 * T2:  Barge-in candidate begins for G1
 * T3:  G2 starts before VAD confirmation
 * T4:  G1 network result arrives (stale)
 * T5:  G1 stale decode attempt (blocked)
 * T6:  G2 stream chunk 2 arrives before chunk 1 (queued)
 * T7:  G1 late VAD confirmation fires (ignored)
 * T8:  Interrupt storm on G2
 * T9:  G3 starts
 * T10: Delayed completion from G2 fires (ignored)
 *
 * Assert: ONLY G3 remains authoritative. Zero leaks. 100% protection rate.
 */

import { test, expect } from "@playwright/test";
import { setupEchoFencePage, createWavBase64 } from "./helpers";

test.describe("Step 17: Full Adversarial Chaos Timeline", () => {
  test("Scenario 15: Complex multi-turn adversarial chaos timeline preserves single generation authority", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);
    const wavBase64 = createWavBase64(0.1);

    const result = await page.evaluate(async (audioPayload) => {
      const t = window.__ECHOFENCE_TEST__!;
      t.chaosController.enable({
        id: "scenario-15-adversarial-timeline",
        name: "Full Adversarial Chaos Timeline",
        description: "10-stage concurrent race under injected faults",
        plan: [
          { point: "during_network_request", fault: "NETWORK_DELAY", delayMs: 10 },
          { point: "after_network_response", fault: "STALE_RESPONSE" },
          { point: "during_streaming", fault: "STREAM_REORDER" },
          { point: "during_barge_in", fault: "INTERRUPT_STORM" },
          { point: "component_lifecycle", fault: "LATE_COMPLETION" },
        ],
        expectedOutcome: {
          audioResurrectionCount: 0,
          transcriptCorruptionCount: 0,
          staleProtectionRate: 100,
          chaosSafetyRate: 100,
          resourceLeaksDetected: 0,
        },
      });

      const binaryString = atob(audioPayload);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // T0: G1 begins
      const g1 = t.generationFence.beginGeneration("chaos_turn", "T0: G1 starts");

      // T1: Network delay simulated
      await new Promise((r) => setTimeout(r, 20));

      // T2: Barge-in candidate starts for G1
      await t.bargeInDetector.startMonitoring(g1);
      t.bargeInDetector.simulateAudioActivity(0.08, 15, g1);

      // T3: G2 starts before VAD confirmation
      const g2 = t.generationFence.beginGeneration("chaos_turn", "T3: G2 starts");

      // T4: G1 network result arrives (rejected by Fence)
      const g1NetAuthorized = t.generationFence.isCurrent(g1);
      if (!g1NetAuthorized) {
        t.generationFence.recordStaleBlocked(g1, "stale_result_blocked", "late_network", "G1 late network result");
      }

      // T5: G1 stale decode attempt
      const g1DecodeOutcome = await t.generationAwareAudio.playAuthorizedAudio({
        authorized: true,
        generationId: g1,
        requestId: "g1-late-req",
        audioBuffer: bytes.buffer.slice(0),
        contentType: "audio/wav",
        provider: "Rime",
        providerLatencyMs: 10,
        authorizedAt: Date.now(),
      });

      // T6: G2 stream chunk 2 arrives before chunk 1
      const streamId = "g2-stream";
      function makeChunk(gen: number, idx: number, isLast = false) {
        return {
          chunkId: `chunk-${gen}-${streamId}-${idx}`,
          generationId: gen,
          streamId,
          sequenceNumber: idx,
          audioData: bytes.buffer.slice(0),
          contentType: "audio/wav",
          isLastChunk: isLast,
          timestamp: Date.now(),
          requestId: `req-${gen}-${idx}`,
        };
      }
      const g2Chunk2Outcome = await t.generationAwareAudioStream.receiveChunk(makeChunk(g2, 2, true));

      // T7: G1 late VAD confirmation fires
      const g1VadOutcome = t.bargeInDetector.simulateAudioActivity(0.08, 120, g1);

      // T8: Interrupt storm on G2
      t.interruptController.interrupt(g2, "user_barge_in");
      t.interruptController.interrupt(g2, "user_barge_in");

      // T9: G3 starts
      const g3 = t.generationFence.beginGeneration("chaos_turn", "T9: G3 starts");

      // T10: Delayed completion from G2 fires
      t.generationFence.completeGeneration(g2, "delayed_g2_completion");

      // Deliver valid G3 chunk
      const g3Chunk0Outcome = await t.generationAwareAudioStream.receiveChunk({
        chunkId: `chunk-${g3}-g3stream-0`,
        generationId: g3,
        streamId: "g3-stream",
        sequenceNumber: 0,
        audioData: bytes.buffer.slice(0),
        contentType: "audio/wav",
        isLastChunk: true,
        timestamp: Date.now(),
        requestId: `req-${g3}-0`,
      });

      const metrics = t.getMeasurementSnapshot();
      const record = t.chaosController.completeScenario("scenario-15-adversarial-timeline");
      const leaks = t.checkResourceLeaks();

      return {
        g1NetAuthorized,
        g1DecodeKind: g1DecodeOutcome.kind,
        g2Chunk2Kind: g2Chunk2Outcome.kind,
        g1VadKind: g1VadOutcome.kind,
        g3Chunk0Kind: g3Chunk0Kind(g3Chunk0Outcome),
        activeGen: metrics.generation.activeGeneration,
        g3Current: t.generationFence.isCurrent(g3),
        g1Current: t.generationFence.isCurrent(g1),
        g2Current: t.generationFence.isCurrent(g2),
        g3Interrupted: t.interruptController.isInterrupted(g3),
        g2Interrupted: t.interruptController.isInterrupted(g2),
        resurrectionCount: metrics.audio.resurrectionCount,
        corruptionCount: metrics.transcript.corruptionCount,
        protectionRate: metrics.staleResults.protectionRate,
        chaosSafetyRate: metrics.chaos.chaosSafetyRate,
        scenarioPassed: record.passed,
        hasLeaks: leaks.hasLeaks,
      };

      function g3Chunk0Kind(outcome: any) {
        return outcome.kind;
      }
    }, wavBase64);

    expect(result.g1NetAuthorized).toBe(false);
    expect(result.g1DecodeKind).toBe("blocked");
    expect(result.g2Chunk2Kind).toBe("queued");
    expect(result.g1VadKind).toBe("stale_ignored");
    expect(result.g3Chunk0Kind).toBe("playing");

    expect(result.activeGen).toBe(3);
    expect(result.g3Current).toBe(true);
    expect(result.g1Current).toBe(false);
    expect(result.g2Current).toBe(false);
    expect(result.g3Interrupted).toBe(false);
    expect(result.g2Interrupted).toBe(true);

    expect(result.resurrectionCount).toBe(0);
    expect(result.corruptionCount).toBe(0);
    expect(result.protectionRate).toBe(100);
    expect(result.chaosSafetyRate).toBe(100);
    expect(result.scenarioPassed).toBe(true);
    expect(result.hasLeaks).toBe(false);

    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });
});
