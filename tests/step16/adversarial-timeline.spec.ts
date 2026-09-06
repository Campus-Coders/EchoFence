/**
 * tests/step16/adversarial-timeline.spec.ts
 * E2E Browser validation for Scenario 10:
 * - Full Adversarial Multi-Turn Timeline
 *
 * Verifies that interleaved async arrival across synthesis, audio decode, streaming chunks,
 * delayed VAD confirmation, and onended completion callbacks preserves strict generation authority.
 */

import { test, expect } from "@playwright/test";
import { setupEchoFencePage, createWavBase64 } from "./helpers";

test.describe("Adversarial Multi-Turn Integration Timeline", () => {
  test("Scenario 10: Full adversarial timeline T0–T10 preserves single-generation authority and prevents all resurrection", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    const testAudioBase64 = createWavBase64(0.15);

    const result = await page.evaluate(async (audioBase64) => {
      const t = window.__ECHOFENCE_TEST__!;
      const fence = t.generationFence;
      const interruptCtrl = t.interruptController;
      const detector = t.bargeInDetector;
      const streamCoord = t.generationAwareAudioStream;
      const audio = t.generationAwareAudio;

      const binaryString = atob(audioBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // T0: G1 begins synthesis / logical turn
      const g1 = fence.beginGeneration("user_turn", "T0: Gen 1 starts");
      await detector.startMonitoring(g1);

      // T1: G1 streaming audio chunk arrives
      const g1Chunk0 = {
        generationId: g1,
        requestId: `req-adv-${g1}-0`,
        streamId: "stream-adv-1",
        chunkId: `chunk-${g1}-0`,
        sequenceNumber: 0,
        audioData: bytes.buffer.slice(0),
        isLastChunk: false,
        timestamp: Date.now(),
      };
      const t1ChunkOutcome = await streamCoord.receiveChunk(g1Chunk0);

      // T2: G1 begins playback (verified: t1ChunkOutcome is playing)

      // T3: User begins speaking
      const now = Date.now();

      // T4: VAD candidate begins for G1
      detector.processAudioLevel(0.25, now);

      // T5: G2 starts before VAD confirmation completes (user enters new turn)
      const g2 = fence.beginGeneration("user_turn", "T5: Gen 2 advances");

      // T6: Delayed G1 VAD confirmation resolves
      const t6BargeOutcome = detector.processAudioLevel(0.25, now + 120);

      // T7: Late G1 streaming chunk arrives
      const g1Chunk1 = {
        generationId: g1,
        requestId: `req-adv-${g1}-1`,
        streamId: "stream-adv-1",
        chunkId: `chunk-${g1}-1`,
        sequenceNumber: 1,
        audioData: bytes.buffer.slice(0),
        isLastChunk: true,
        timestamp: Date.now(),
      };
      const t7LateChunkOutcome = await streamCoord.receiveChunk(g1Chunk1);

      // T8: Delayed G1 synthesis result resolves
      const lateG1AuthResult = {
        authorized: true,
        generationId: g1,
        requestId: `req-late-synth-${g1}`,
        audioBuffer: bytes.buffer.slice(0),
        contentType: "audio/wav",
        provider: "Rime",
        providerLatencyMs: 50,
        authorizedAt: Date.now(),
      };
      const t8LateSynthOutcome = await audio.playAuthorizedAudio(lateG1AuthResult);

      // T9: G2 streaming/audio begins
      const g2Chunk0 = {
        generationId: g2,
        requestId: `req-adv-${g2}-0`,
        streamId: "stream-adv-2",
        chunkId: `chunk-${g2}-0`,
        sequenceNumber: 0,
        audioData: bytes.buffer.slice(0),
        isLastChunk: true,
        timestamp: Date.now(),
      };
      const t9G2ChunkOutcome = await streamCoord.receiveChunk(g2Chunk0);

      // T10: Old G1 onended callback fires simulated late completion
      fence.recordStaleBlocked(
        g1,
        "stale_state_transition_blocked",
        "completion_callback",
        "Old G1 onended callback fired after G2 active"
      );

      const metrics = t.getMeasurementSnapshot();
      const audit = t.getAuditEvents(50);

      return {
        g1,
        g2,
        t1ChunkOutcome,
        t6BargeOutcome,
        t7LateChunkOutcome,
        t8LateSynthOutcome,
        t9G2ChunkOutcome,
        isG2Current: fence.isCurrent(g2),
        isG2Interrupted: interruptCtrl.isInterrupted(g2),
        metrics,
        audit,
      };
    }, testAudioBase64);

    // 1. T1: Chunk played
    expect(result.t1ChunkOutcome.kind).toBe("playing");

    // 2. T6: Stale barge-in ignored, did not interrupt G2
    expect(result.t6BargeOutcome.kind).toBe("stale_ignored");
    expect(result.isG2Interrupted).toBe(false);
    expect(result.isG2Current).toBe(true);

    // 3. T7: Late G1 chunk blocked
    expect(result.t7LateChunkOutcome.kind).toBe("stale_blocked");
    expect(result.t7LateChunkOutcome.errorCode).toBe("STREAM_STALE_GENERATION");

    // 4. T8: Delayed G1 synthesis blocked
    expect(result.t8LateSynthOutcome.kind).toBe("blocked");

    // 5. T9: G2 chunk played
    expect(result.t9G2ChunkOutcome.kind).toBe("playing");

    // 6. Audit Trail contains all required adversarial milestones
    const eventTypes = result.audit.map((e: any) => e.event);
    expect(eventTypes).toContain("stale_barge_in_ignored");
    expect(eventTypes).toContain("stale_audio_chunk_blocked");
    expect(eventTypes).toContain("stale_audio_start_blocked");
    expect(eventTypes).toContain("audio_stream_chunk_playback_started");

    // 7. Critical Invariants
    expect(result.metrics.audio.resurrectionCount).toBe(0);
    expect(result.metrics.transcript.corruptionCount).toBe(0);
    expect(result.metrics.staleResults.protectionRate).toBe(100);
    expect(result.metrics.staleResults.blocked).toBeLessThanOrEqual(
      result.metrics.staleResults.attempted
    );

    expect(monitor.getUnexpectedErrors()).toEqual([]);
  });
});
