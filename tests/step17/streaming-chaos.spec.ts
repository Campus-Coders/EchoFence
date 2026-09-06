/**
 * tests/step17/streaming-chaos.spec.ts
 * Browser E2E specs for Step 17 Streaming Fault Scenarios:
 * - Scenario 7: Streaming packet reordering
 * - Scenario 8: Streaming duplicate packet storm
 * - Scenario 9: Streaming packet drop followed by interruption
 */

import { test, expect } from "@playwright/test";
import { setupEchoFencePage, createWavBase64 } from "./helpers";

test.describe("Step 17: Streaming Chaos Scenarios", () => {
  test("Scenario 7: Streaming packet reordering retains deterministic sequential playback", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);
    const wavBase64 = createWavBase64(0.1);

    const result = await page.evaluate(async (audioPayload) => {
      const t = window.__ECHOFENCE_TEST__!;
      t.chaosController.enable({
        id: "scenario-7-stream-reorder",
        name: "Streaming Packet Reordering",
        description: "Inject out-of-order chunks [0, 2, 1]",
        plan: [{ point: "during_streaming", fault: "STREAM_REORDER" }],
        expectedOutcome: {
          audioResurrectionCount: 0,
          transcriptCorruptionCount: 0,
          staleProtectionRate: 100,
          chaosSafetyRate: 100,
          resourceLeaksDetected: 0,
        },
      });

      const genId = t.generationFence.beginGeneration("stream_turn", "Streaming reorder test");
      const streamId = "stream-reorder-1";

      const binaryString = atob(audioPayload);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      function makeChunk(index: number, isLast = false) {
        return {
          chunkId: `chunk-${genId}-${streamId}-${index}`,
          generationId: genId,
          streamId,
          sequenceNumber: index,
          audioData: bytes.buffer.slice(0),
          contentType: "audio/wav",
          isLastChunk: isLast,
          timestamp: Date.now(),
          requestId: `req-stream-${index}`,
        };
      }

      // Deliver Chunk 0 (plays immediately)
      const res0 = await t.generationAwareAudioStream.receiveChunk(makeChunk(0));
      // Deliver Chunk 2 (queued)
      const res2 = await t.generationAwareAudioStream.receiveChunk(makeChunk(2, true));
      // Deliver Chunk 1 (unlocks draining of Chunk 2)
      const res1 = await t.generationAwareAudioStream.receiveChunk(makeChunk(1));

      // Wait a short tick for asynchronous draining
      await new Promise((r) => setTimeout(r, 150));

      const metrics = t.getMeasurementSnapshot();
      t.chaosController.completeScenario("scenario-7-stream-reorder");

      return {
        res0Kind: res0.kind,
        res2Kind: res2.kind,
        res1Kind: res1.kind,
        chunksPlayed: metrics.streamingAudio.chunksPlayed,
        outOfOrderBuffered: metrics.streamingAudio.outOfOrderChunksBuffered,
      };
    }, wavBase64);

    expect(result.res0Kind).toBe("playing");
    expect(result.res2Kind).toBe("queued");
    expect(result.res1Kind).toBe("playing");
    expect(result.outOfOrderBuffered).toBeGreaterThanOrEqual(1);

    const status = await page.evaluate(() => {
      const t = window.__ECHOFENCE_TEST__!;
      const metrics = t.getMeasurementSnapshot();
      const leaks = t.checkResourceLeaks();
      return {
        resurrectionCount: metrics.audio.resurrectionCount,
        corruptionCount: metrics.transcript.corruptionCount,
        hasLeaks: leaks.hasLeaks,
      };
    });

    expect(status.resurrectionCount).toBe(0);
    expect(status.corruptionCount).toBe(0);
    expect(status.hasLeaks).toBe(false);
    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("Scenario 8: Streaming duplicate packet storm suppresses duplicates with zero replay", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);
    const wavBase64 = createWavBase64(0.1);

    const result = await page.evaluate(async (audioPayload) => {
      const t = window.__ECHOFENCE_TEST__!;
      t.chaosController.enable({
        id: "scenario-8-duplicate-storm",
        name: "Streaming Duplicate Storm",
        description: "Inject storm of duplicated chunks [0, 0, 1, 1, 2, 2]",
        plan: [{ point: "during_streaming", fault: "STREAM_DUPLICATION" }],
        expectedOutcome: {
          audioResurrectionCount: 0,
          transcriptCorruptionCount: 0,
          staleProtectionRate: 100,
          chaosSafetyRate: 100,
          resourceLeaksDetected: 0,
        },
      });

      const genId = t.generationFence.beginGeneration("stream_turn", "Duplicate storm test");
      const streamId = "stream-dup-1";

      const binaryString = atob(audioPayload);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      function makeChunk(index: number, isLast = false) {
        return {
          chunkId: `chunk-${genId}-${streamId}-${index}`,
          generationId: genId,
          streamId,
          sequenceNumber: index,
          audioData: bytes.buffer.slice(0),
          contentType: "audio/wav",
          isLastChunk: isLast,
          timestamp: Date.now(),
          requestId: `req-dup-${index}`,
        };
      }

      // Deliver duplicate storm: 0, 0, 1, 1, 2, 2
      await t.generationAwareAudioStream.receiveChunk(makeChunk(0));
      const dup0 = await t.generationAwareAudioStream.receiveChunk(makeChunk(0));
      await t.generationAwareAudioStream.receiveChunk(makeChunk(1));
      const dup1 = await t.generationAwareAudioStream.receiveChunk(makeChunk(1));
      await t.generationAwareAudioStream.receiveChunk(makeChunk(2, true));
      const dup2 = await t.generationAwareAudioStream.receiveChunk(makeChunk(2, true));

      const metrics = t.getMeasurementSnapshot();
      t.chaosController.completeScenario("scenario-8-duplicate-storm");

      return {
        dup0Kind: dup0.kind,
        dup1Kind: dup1.kind,
        dup2Kind: dup2.kind,
        duplicateSuppressed: metrics.streamingAudio.duplicateChunksSuppressed,
      };
    }, wavBase64);

    expect(result.dup0Kind).toBe("duplicate_suppressed");
    expect(result.dup1Kind).toBe("duplicate_suppressed");
    expect(result.dup2Kind).toBe("duplicate_suppressed");
    expect(result.duplicateSuppressed).toBe(3);

    const status = await page.evaluate(() => {
      const t = window.__ECHOFENCE_TEST__!;
      const metrics = t.getMeasurementSnapshot();
      const leaks = t.checkResourceLeaks();
      return {
        resurrectionCount: metrics.audio.resurrectionCount,
        hasLeaks: leaks.hasLeaks,
      };
    });

    expect(status.resurrectionCount).toBe(0);
    expect(status.hasLeaks).toBe(false);
    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("Scenario 9: Streaming packet drop followed by interruption purges buffered chunks cleanly", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);
    const wavBase64 = createWavBase64(0.1);

    const result = await page.evaluate(async (audioPayload) => {
      const t = window.__ECHOFENCE_TEST__!;
      t.chaosController.enable({
        id: "scenario-9-drop-interrupt",
        name: "Streaming Drop Followed by Interrupt",
        description: "Chunk 1 dropped; buffered chunk 2 cancelled upon interrupt",
        plan: [
          { point: "during_streaming", fault: "STREAM_DROP" },
          { point: "during_streaming", fault: "ABORT_RACE" },
        ],
        expectedOutcome: {
          audioResurrectionCount: 0,
          transcriptCorruptionCount: 0,
          staleProtectionRate: 100,
          chaosSafetyRate: 100,
          resourceLeaksDetected: 0,
        },
      });

      const genId = t.generationFence.beginGeneration("stream_turn", "Drop & interrupt test");
      const streamId = "stream-drop-1";

      const binaryString = atob(audioPayload);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      function makeChunk(index: number, isLast = false) {
        return {
          chunkId: `chunk-${genId}-${streamId}-${index}`,
          generationId: genId,
          streamId,
          sequenceNumber: index,
          audioData: bytes.buffer.slice(0),
          contentType: "audio/wav",
          isLastChunk: isLast,
          timestamp: Date.now(),
          requestId: `req-drop-${index}`,
        };
      }

      // Chunk 0 arrives
      await t.generationAwareAudioStream.receiveChunk(makeChunk(0));
      // Chunk 2 arrives (Chunk 1 dropped)
      await t.generationAwareAudioStream.receiveChunk(makeChunk(2, true));

      // Trigger interruption on genId
      t.interruptController.interrupt(genId, "user_barge_in");

      const state = t.generationAwareAudioStream.getStreamState(genId, streamId);
      const metrics = t.getMeasurementSnapshot();
      t.chaosController.completeScenario("scenario-9-drop-interrupt");

      return {
        isCancelled: state?.isCancelled,
        bufferedCount: state?.bufferedChunks?.size ?? 0,
        queuedCancelled: metrics.streamingAudio.queuedChunksCancelled,
      };
    }, wavBase64);

    expect(result.isCancelled).toBe(true);
    expect(result.bufferedCount).toBe(0);

    const status = await page.evaluate(() => {
      const t = window.__ECHOFENCE_TEST__!;
      const metrics = t.getMeasurementSnapshot();
      const leaks = t.checkResourceLeaks();
      return {
        resurrectionCount: metrics.audio.resurrectionCount,
        hasLeaks: leaks.hasLeaks,
      };
    });

    expect(status.resurrectionCount).toBe(0);
    expect(status.hasLeaks).toBe(false);
    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });
});
