/**
 * tests/step17/audio-chaos.spec.ts
 * Browser E2E specs for Step 17 Audio Fault Scenarios:
 * - Scenario 4: Malformed audio response
 * - Scenario 5: Interruption during audio decode
 * - Scenario 6: Generation switch immediately before source.start()
 */

import { test, expect } from "@playwright/test";
import { setupEchoFencePage, createWavBase64 } from "./helpers";

test.describe("Step 17: Audio Chaos Scenarios", () => {
  test("Scenario 4: Malformed audio response is normalized cleanly without crashing or corrupting state", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    // Provide invalid malformed base64 bytes for audio synthesis
    const corruptBase64 = Buffer.from("THIS_IS_CORRUPT_NOT_A_VALID_WAV_OR_MP3_PAYLOAD").toString("base64");

    await page.route("**/api/voice/turn", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { responseText: "Response with corrupted audio" },
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
            audioBase64: corruptBase64,
            contentType: "audio/wav",
          },
        }),
      });
    });

    await page.evaluate(async () => {
      const t = window.__ECHOFENCE_TEST__!;
      t.chaosController.enable({
        id: "scenario-4-malformed-audio",
        name: "Malformed Audio Response",
        description: "Inject corrupted audio bytes before decode",
        plan: [{ point: "before_audio_decode", fault: "MALFORMED_AUDIO" }],
        expectedOutcome: {
          audioResurrectionCount: 0,
          transcriptCorruptionCount: 0,
          staleProtectionRate: 100,
          chaosSafetyRate: 100,
          resourceLeaksDetected: 0,
        },
      });

      await t.executeTurn("Test malformed audio payload");
      t.chaosController.completeScenario("scenario-4-malformed-audio");
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
        hasLeaks: leaks.hasLeaks,
      };
    });

    expect(status.playbackCount).toBe(0);
    expect(status.resurrectionCount).toBe(0);
    expect(status.corruptionCount).toBe(0);
    expect(status.hasLeaks).toBe(false);
    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("Scenario 5: Interruption during audio decode blocks playback at post-decode barrier", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);
    const wavBase64 = createWavBase64(0.3);

    const outcome = await page.evaluate(async (audioPayload) => {
      const t = window.__ECHOFENCE_TEST__!;
      t.chaosController.enable({
        id: "scenario-5-decode-interrupt",
        name: "Interruption During Audio Decode",
        description: "Interrupt generation while decode is pending",
        plan: [{ point: "during_audio_decode", fault: "AUDIO_DECODE_FAILURE" }],
        expectedOutcome: {
          audioResurrectionCount: 0,
          transcriptCorruptionCount: 0,
          staleProtectionRate: 100,
          chaosSafetyRate: 100,
          resourceLeaksDetected: 0,
        },
      });

      const genId = t.generationFence.beginGeneration("test_turn", "Decode test");

      const binaryString = atob(audioPayload);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Interrupt G1 BEFORE playAuthorizedAudio resolves
      const playPromise = t.generationAwareAudio.playAuthorizedAudio({
        authorized: true,
        generationId: genId,
        requestId: `req-decode-${genId}`,
        audioBuffer: bytes.buffer,
        contentType: "audio/wav",
        provider: "Rime",
        providerLatencyMs: 25,
        authorizedAt: Date.now(),
      });

      // Fire interruption immediately
      t.interruptController.interrupt(genId, "user_barge_in");

      const res = await playPromise;
      t.chaosController.completeScenario("scenario-5-decode-interrupt");
      return res;
    }, wavBase64);

    expect(outcome.kind).toBe("blocked");

    const status = await page.evaluate(() => {
      const t = window.__ECHOFENCE_TEST__!;
      const metrics = t.getMeasurementSnapshot();
      const playback = t.getPlaybackSnapshot();
      const leaks = t.checkResourceLeaks();
      return {
        playbackCount: playback.activePlaybackCount,
        resurrectionCount: metrics.audio.resurrectionCount,
        staleBlocked: metrics.staleResults.blocked,
        protectionRate: metrics.staleResults.protectionRate,
        hasLeaks: leaks.hasLeaks,
      };
    });

    expect(status.playbackCount).toBe(0);
    expect(status.resurrectionCount).toBe(0);
    expect(status.protectionRate).toBe(100);
    expect(status.hasLeaks).toBe(false);
    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("Scenario 6: Generation switch immediately before source.start() blocks playback at Checkpoint 3", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);
    const wavBase64 = createWavBase64(0.2);

    const outcome = await page.evaluate(async (audioPayload) => {
      const t = window.__ECHOFENCE_TEST__!;
      t.chaosController.enable({
        id: "scenario-6-switch-before-start",
        name: "Generation Switch Before Source Start",
        description: "Advance generation fence immediately prior to source start",
        plan: [{ point: "before_source_start", fault: "RAPID_GENERATION_ADVANCEMENT" }],
        expectedOutcome: {
          audioResurrectionCount: 0,
          transcriptCorruptionCount: 0,
          staleProtectionRate: 100,
          chaosSafetyRate: 100,
          resourceLeaksDetected: 0,
        },
      });

      const gen1 = t.generationFence.beginGeneration("turn", "Turn 1");

      const binaryString = atob(audioPayload);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Advance generation right before calling playAuthorizedAudio
      t.generationFence.beginGeneration("turn", "Turn 2 (superseding)");

      const res = await t.generationAwareAudio.playAuthorizedAudio({
        authorized: true,
        generationId: gen1,
        requestId: `req-start-${gen1}`,
        audioBuffer: bytes.buffer,
        contentType: "audio/wav",
        provider: "Rime",
        providerLatencyMs: 25,
        authorizedAt: Date.now(),
      });

      t.chaosController.completeScenario("scenario-6-switch-before-start");
      return res;
    }, wavBase64);

    expect(outcome.kind).toBe("blocked");

    const status = await page.evaluate(() => {
      const t = window.__ECHOFENCE_TEST__!;
      const metrics = t.getMeasurementSnapshot();
      const playback = t.getPlaybackSnapshot();
      const leaks = t.checkResourceLeaks();
      return {
        playbackCount: playback.activePlaybackCount,
        resurrectionCount: metrics.audio.resurrectionCount,
        protectionRate: metrics.staleResults.protectionRate,
        hasLeaks: leaks.hasLeaks,
      };
    });

    expect(status.playbackCount).toBe(0);
    expect(status.resurrectionCount).toBe(0);
    expect(status.protectionRate).toBe(100);
    expect(status.hasLeaks).toBe(false);
    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });
});
