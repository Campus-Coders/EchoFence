/**
 * tests/step16/streaming-race.spec.ts
 * E2E Browser validation for Scenarios 6 and 7:
 * - Scenario 6: Streaming Out-of-Order Delivery & Buffering
 * - Scenario 7: Stale Stream Arrival After Generation Switch
 */

import { test, expect } from "@playwright/test";
import { setupEchoFencePage, createWavBase64 } from "./helpers";

test.describe("Streaming Audio Concurrency & Ordering Races", () => {
  test("Scenario 6: Out-of-order streaming chunks buffer and drain sequentially in order 0 -> 1 -> 2", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    const testAudioBase64 = createWavBase64(0.1);

    const result = await page.evaluate(async (audioBase64) => {
      const t = window.__ECHOFENCE_TEST__!;
      const fence = t.generationFence;
      const streamCoord = t.generationAwareAudioStream;

      const gen1 = fence.beginGeneration("user_turn", "Gen 1 streaming out-of-order test");
      const streamId = "stream-ordered-1";

      const binaryString = atob(audioBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Helper to build chunk matching StreamingAudioChunk contract
      const makeChunk = (seq: number) => ({
        generationId: gen1,
        requestId: `req-chunk-${gen1}-${seq}`,
        streamId,
        chunkId: `c-${gen1}-${seq}`,
        sequenceNumber: seq,
        audioData: bytes.buffer.slice(0),
        isLastChunk: seq === 2,
        timestamp: Date.now(),
      });

      // 1. Deliver Chunk 0 (seq 0) -> plays immediately
      const out0 = await streamCoord.receiveChunk(makeChunk(0));

      // 2. Deliver Chunk 2 (seq 2) -> arrives out of order, MUST buffer (kind: "queued")
      const out2 = await streamCoord.receiveChunk(makeChunk(2));

      // 3. Deliver Chunk 1 (seq 1) -> unlocks draining of chunk 1 and chunk 2
      const out1 = await streamCoord.receiveChunk(makeChunk(1));

      // Wait for asynchronous drainBufferedChunks to decode and start buffered chunk 2
      await new Promise((r) => setTimeout(r, 150));

      const streamState = streamCoord.getStreamState(gen1, streamId);
      const metrics = t.getMeasurementSnapshot();
      const audit = t.getAuditEvents(20);

      return {
        out0,
        out2,
        out1,
        streamState: {
          nextExpectedSequence: streamState?.nextExpectedSequence,
          bufferedCount: streamState?.bufferedChunks.size,
          isCompleted: streamState?.isCompleted,
        },
        metrics,
        audit,
      };
    }, testAudioBase64);

    expect(result.out0.kind).toBe("playing");
    expect(result.out2.kind).toBe("queued"); // Buffered out-of-order!
    expect(result.out1.kind).toBe("playing"); // Played and drained

    expect(result.streamState.nextExpectedSequence).toBe(3); // Advanced through 0, 1, 2
    expect(result.streamState.bufferedCount).toBe(0); // All buffered chunks drained

    // Assert audit trail
    const eventTypes = result.audit.map((e: any) => e.event);
    expect(eventTypes).toContain("audio_stream_chunk_received");
    expect(eventTypes).toContain("audio_stream_chunk_buffered");
    expect(eventTypes).toContain("audio_stream_chunk_playback_started");

    // Logical metrics invariants
    expect(result.metrics.streamingAudio.streamingChunksAccepted).toBeLessThanOrEqual(
      result.metrics.streamingAudio.streamingChunksReceived
    );
    expect(result.metrics.streamingAudio.chunksPlayed).toBeLessThanOrEqual(
      result.metrics.streamingAudio.chunksDecoded
    );
    expect(result.metrics.streamingAudio.outOfOrderChunksBuffered).toBeGreaterThanOrEqual(1);

    expect(monitor.getUnexpectedErrors()).toEqual([]);
  });

  test("Scenario 7: Stale stream arrival after generation switch is blocked and leaves G2 stream unaffected", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    const testAudioBase64 = createWavBase64(0.1);

    const result = await page.evaluate(async (audioBase64) => {
      const t = window.__ECHOFENCE_TEST__!;
      const fence = t.generationFence;
      const streamCoord = t.generationAwareAudioStream;

      const binaryString = atob(audioBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // 1. G1 streaming starts
      const g1 = fence.beginGeneration("user_turn", "Gen 1 streaming");
      const outG1Chunk0 = await streamCoord.receiveChunk({
        generationId: g1,
        requestId: `req-s1-${g1}`,
        streamId: "stream-g1",
        chunkId: "c-g1-0",
        sequenceNumber: 0,
        audioData: bytes.buffer.slice(0),
        isLastChunk: false,
        timestamp: Date.now(),
      });

      // 2. G2 becomes authoritative
      const g2 = fence.beginGeneration("user_turn", "Gen 2 user barge-in update");

      // 3. Late chunk from G1 arrives after G2 active
      const outLateG1Chunk1 = await streamCoord.receiveChunk({
        generationId: g1,
        requestId: `req-s2-${g1}`,
        streamId: "stream-g1",
        chunkId: "c-g1-1",
        sequenceNumber: 1,
        audioData: bytes.buffer.slice(0),
        isLastChunk: true,
        timestamp: Date.now(),
      });

      // 4. Valid chunk from G2 arrives
      const outG2Chunk0 = await streamCoord.receiveChunk({
        generationId: g2,
        requestId: `req-s1-${g2}`,
        streamId: "stream-g2",
        chunkId: "c-g2-0",
        sequenceNumber: 0,
        audioData: bytes.buffer.slice(0),
        isLastChunk: true,
        timestamp: Date.now(),
      });

      const metrics = t.getMeasurementSnapshot();
      const audit = t.getAuditEvents(20);

      return {
        g1,
        g2,
        outG1Chunk0,
        outLateG1Chunk1,
        outG2Chunk0,
        metrics,
        audit,
      };
    }, testAudioBase64);

    expect(result.outG1Chunk0.kind).toBe("playing");
    expect(result.outLateG1Chunk1.kind).toBe("stale_blocked"); // Blocked by GenerationFence!
    expect(result.outLateG1Chunk1.errorCode).toBe("STREAM_STALE_GENERATION");
    expect(result.outG2Chunk0.kind).toBe("playing"); // G2 plays cleanly!

    // Audit verification
    const eventTypes = result.audit.map((e: any) => e.event);
    expect(eventTypes).toContain("stale_audio_chunk_blocked");

    // Invariants
    expect(result.metrics.staleResults.protectionRate).toBe(100);
    expect(result.metrics.audio.resurrectionCount).toBe(0);
    expect(result.metrics.transcript.corruptionCount).toBe(0);
    expect(result.metrics.staleResults.blocked).toBeLessThanOrEqual(
      result.metrics.staleResults.attempted
    );

    expect(monitor.getUnexpectedErrors()).toEqual([]);
  });
});
