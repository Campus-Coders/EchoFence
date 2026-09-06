/**
 * tests/step17/interrupt-chaos.spec.ts
 * Browser E2E specs for Step 17 Interruption & Concurrency Fault Scenarios:
 * - Scenario 10: Rapid interruption storm
 * - Scenario 11: Rapid generation advancement
 * - Scenario 12: Stale barge-in confirmation after generation switch
 */

import { test, expect } from "@playwright/test";
import { setupEchoFencePage } from "./helpers";

test.describe("Step 17: Interruption & Concurrency Chaos Scenarios", () => {
  test("Scenario 10: Rapid interruption storm is strictly idempotent with zero resource leaks", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    await page.evaluate(() => {
      const t = window.__ECHOFENCE_TEST__!;
      t.chaosController.enable({
        id: "scenario-10-interrupt-storm",
        name: "Rapid Interruption Storm",
        description: "Fire 5 consecutive interrupts against generation 1",
        plan: [{ point: "during_barge_in", fault: "INTERRUPT_STORM" }],
        expectedOutcome: {
          audioResurrectionCount: 0,
          transcriptCorruptionCount: 0,
          staleProtectionRate: 100,
          chaosSafetyRate: 100,
          resourceLeaksDetected: 0,
        },
      });

      const genId = t.generationFence.beginGeneration("test", "Storm test");

      // Fire 5 rapid interrupts on same generation
      t.interruptController.interrupt(genId, "user_barge_in");
      t.interruptController.interrupt(genId, "user_barge_in");
      t.interruptController.interrupt(genId, "user_barge_in");
      t.interruptController.interrupt(genId, "user_barge_in");
      t.interruptController.interrupt(genId, "user_barge_in");

      t.chaosController.completeScenario("scenario-10-interrupt-storm");
    });

    const status = await page.evaluate(() => {
      const t = window.__ECHOFENCE_TEST__!;
      const metrics = t.getMeasurementSnapshot();
      const leaks = t.checkResourceLeaks();
      return {
        interruptCount: metrics.interruption.count,
        resurrectionCount: metrics.audio.resurrectionCount,
        hasLeaks: leaks.hasLeaks,
      };
    });

    // Idempotent: exactly 1 interruption registered for G1
    expect(status.interruptCount).toBe(1);
    expect(status.resurrectionCount).toBe(0);
    expect(status.hasLeaks).toBe(false);
    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("Scenario 11: Rapid generation advancement blocks late results from older generations", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    const result = await page.evaluate(() => {
      const t = window.__ECHOFENCE_TEST__!;
      t.chaosController.enable({
        id: "scenario-11-rapid-advancement",
        name: "Rapid Generation Advancement",
        description: "G10 -> G11 -> G12 -> G13 -> G14 rapid generation cascade",
        plan: [{ point: "after_network_response", fault: "RAPID_GENERATION_ADVANCEMENT" }],
        expectedOutcome: {
          audioResurrectionCount: 0,
          transcriptCorruptionCount: 0,
          staleProtectionRate: 100,
          chaosSafetyRate: 100,
          resourceLeaksDetected: 0,
        },
      });

      // Rapidly advance generations
      const g10 = t.generationFence.beginGeneration("cascade", "Step 10");
      const g11 = t.generationFence.beginGeneration("cascade", "Step 11");
      const g12 = t.generationFence.beginGeneration("cascade", "Step 12");
      const g13 = t.generationFence.beginGeneration("cascade", "Step 13");
      const g14 = t.generationFence.beginGeneration("cascade", "Step 14");

      // Simulate late responses from G10, G11, G12, G13
      const g10Ok = t.generationFence.assertCurrent(g10, "late_response");
      const g11Ok = t.generationFence.assertCurrent(g11, "late_response");
      const g12Ok = t.generationFence.assertCurrent(g12, "late_response");
      const g13Ok = t.generationFence.assertCurrent(g13, "late_response");
      const g14Ok = t.generationFence.assertCurrent(g14, "authoritative_response");

      const metrics = t.getMeasurementSnapshot();
      t.chaosController.completeScenario("scenario-11-rapid-advancement");

      return {
        g10Ok,
        g11Ok,
        g12Ok,
        g13Ok,
        g14Ok,
        currentGen: metrics.generation.activeGeneration,
        staleBlocked: metrics.staleResults.blocked,
        protectionRate: metrics.staleResults.protectionRate,
      };
    });

    expect(result.g10Ok).toBe(false);
    expect(result.g11Ok).toBe(false);
    expect(result.g12Ok).toBe(false);
    expect(result.g13Ok).toBe(false);
    expect(result.g14Ok).toBe(true);
    expect(result.staleBlocked).toBe(4);
    expect(result.protectionRate).toBe(100);
    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("Scenario 12: Stale barge-in confirmation after generation switch ignores G1 and does NOT interrupt G2", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    const result = await page.evaluate(async () => {
      const t = window.__ECHOFENCE_TEST__!;
      t.chaosController.enable({
        id: "scenario-12-stale-barge-in",
        name: "Stale Barge-In After Generation Switch",
        description: "G1 VAD confirmation resolves after G2 has become authoritative",
        plan: [{ point: "during_barge_in", fault: "STALE_RESPONSE" }],
        expectedOutcome: {
          audioResurrectionCount: 0,
          transcriptCorruptionCount: 0,
          staleProtectionRate: 100,
          chaosSafetyRate: 100,
          resourceLeaksDetected: 0,
        },
      });

      // G1 is created and monitoring begins for G1
      const g1 = t.generationFence.beginGeneration("turn", "Turn 1");
      await t.bargeInDetector.startMonitoring(g1);

      // Speech begins targeting G1
      t.bargeInDetector.simulateAudioActivity(0.08, 20, g1);

      // User starts G2 before G1 VAD confirmation completes
      const g2 = t.generationFence.beginGeneration("turn", "Turn 2");

      // Delayed confirmation for G1 resolves now
      const delayedOutcome = t.bargeInDetector.simulateAudioActivity(0.08, 120, g1);

      const metrics = t.getMeasurementSnapshot();
      t.chaosController.completeScenario("scenario-12-stale-barge-in");

      return {
        delayedKind: delayedOutcome.kind,
        g2Current: t.generationFence.isCurrent(g2),
        g2Interrupted: t.interruptController.isInterrupted(g2),
        staleIgnoredCount: metrics.bargeIn.staleIgnoredCount,
      };
    });

    expect(result.delayedKind).toBe("stale_ignored");
    expect(result.g2Current).toBe(true);
    expect(result.g2Interrupted).toBe(false);
    expect(result.staleIgnoredCount).toBeGreaterThanOrEqual(1);

    const status = await page.evaluate(() => {
      const t = window.__ECHOFENCE_TEST__!;
      const leaks = t.checkResourceLeaks();
      return { hasLeaks: leaks.hasLeaks };
    });

    expect(status.hasLeaks).toBe(false);
    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });
});
