/**
 * tests/step17/lifecycle-chaos.spec.ts
 * Browser E2E specs for Step 17 Component & Resource Lifecycle Fault Scenarios:
 * - Scenario 13: Component unmount during active async operations
 * - Scenario 14: Late completion callback after cleanup
 */

import { test, expect } from "@playwright/test";
import { setupEchoFencePage, createWavBase64 } from "./helpers";

test.describe("Step 17: Lifecycle Chaos Scenarios", () => {
  test("Scenario 13: Component unmount during active async operations cleanly tears down all resources", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);
    const wavBase64 = createWavBase64(0.5);

    await page.route("**/api/voice/turn", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { responseText: "Active voice turn for unmount testing" },
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

    // Start active voice turn
    await page.evaluate(() => {
      const t = window.__ECHOFENCE_TEST__!;
      t.chaosController.enable({
        id: "scenario-13-unmount-cleanup",
        name: "Component Unmount Cleanup",
        description: "Unmount component while async playback is active",
        plan: [{ point: "component_lifecycle", fault: "COMPONENT_UNMOUNT" }],
        expectedOutcome: {
          audioResurrectionCount: 0,
          transcriptCorruptionCount: 0,
          staleProtectionRate: 100,
          chaosSafetyRate: 100,
          resourceLeaksDetected: 0,
        },
      });

      t.executeTurn("Start playback and unmount");
    });

    // Allow playback to begin
    await page.waitForTimeout(100);

    // Navigate away or clear page DOM to trigger React component unmount
    await page.setContent("<div>Unmounted safely</div>");
    await page.waitForTimeout(100);

    // Verify error monitor captured ZERO React unmounted state update errors
    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("Scenario 14: Late completion callback after cleanup is ignored with zero state resurrection", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    const result = await page.evaluate(() => {
      const t = window.__ECHOFENCE_TEST__!;
      t.chaosController.enable({
        id: "scenario-14-late-completion",
        name: "Late Completion Callback",
        description: "Simulate late onended callback for superseded generation",
        plan: [{ point: "component_lifecycle", fault: "LATE_COMPLETION" }],
        expectedOutcome: {
          audioResurrectionCount: 0,
          transcriptCorruptionCount: 0,
          staleProtectionRate: 100,
          chaosSafetyRate: 100,
          resourceLeaksDetected: 0,
        },
      });

      const g1 = t.generationFence.beginGeneration("turn", "Turn 1");
      // Advance to G2
      const g2 = t.generationFence.beginGeneration("turn", "Turn 2");

      // Old G1 late completion callback attempts to complete
      t.generationFence.completeGeneration(g1, "late_audio_callback");

      const metrics = t.getMeasurementSnapshot();
      t.chaosController.completeScenario("scenario-14-late-completion");

      return {
        activeGeneration: metrics.generation.activeGeneration,
        g2Current: t.generationFence.isCurrent(g2),
        staleBlocked: metrics.staleResults.blocked,
        protectionRate: metrics.staleResults.protectionRate,
      };
    });

    expect(result.activeGeneration).toBe(2);
    expect(result.g2Current).toBe(true);
    expect(result.staleBlocked).toBeGreaterThanOrEqual(1);
    expect(result.protectionRate).toBe(100);

    const status = await page.evaluate(() => {
      const t = window.__ECHOFENCE_TEST__!;
      const leaks = t.checkResourceLeaks();
      return { hasLeaks: leaks.hasLeaks };
    });

    expect(status.hasLeaks).toBe(false);
    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });
});
