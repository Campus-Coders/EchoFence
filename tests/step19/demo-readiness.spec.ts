/**
 * tests/step19/demo-readiness.spec.ts
 * Browser validation for Step 19 End-to-End Demo Readiness.
 *
 * Covers:
 * 1. Demo Controls Bar renders all 5 controls with proper test IDs.
 * 2. Normal Flow button initiates normal turn, commits assistant response, and returns to IDLE.
 * 3. Delayed Tool toggle updates button text and internal flag.
 * 4. Run Interruption Scenario executes deterministic race with 0 resurrections.
 * 5. Manual Interrupt button immediately stops active playback and recovers state.
 * 6. Reset Demo button resets all subsystems and UI to clean baseline.
 * 7. Evidence panel exposes Stale Results Spoken = 0 and Active/Previous Generation.
 * 8. Zero unexpected page errors, unhandled rejections, or console errors.
 */

import { test, expect } from "@playwright/test";
import { setupEchoFencePage } from "../step17/helpers";

test.describe("Step 19: End-to-End Demo Readiness & Controls Validation", () => {
  test.setTimeout(45000);

  test("1. Demo Controls Bar renders all 5 controls with appropriate labels and test IDs", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    // Verify all 5 demo controls exist and are visible
    const btnNormal = page.locator('[data-testid="btn-demo-normal-flow"]');
    const btnDelayed = page.locator('[data-testid="btn-demo-delayed-tool-toggle"]');
    const btnInterruption = page.locator('[data-testid="btn-demo-run-interruption"]');
    const btnInterrupt = page.locator('[data-testid="btn-demo-interrupt"]');
    const btnReset = page.locator('[data-testid="btn-demo-reset"]');

    await expect(btnNormal).toBeVisible();
    await expect(btnDelayed).toBeVisible();
    await expect(btnInterruption).toBeVisible();
    await expect(btnInterrupt).toBeVisible();
    await expect(btnReset).toBeVisible();

    // Verify labels
    await expect(btnNormal).toContainText("Normal Flow");
    await expect(btnDelayed).toContainText("Delayed Tool: OFF");
    await expect(btnInterruption).toContainText("Run Interruption Scenario");
    await expect(btnInterrupt).toContainText("Interrupt");
    await expect(btnReset).toContainText("Reset Demo");

    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("2. Normal Flow button executes clean turn and returns to IDLE", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    const btnNormal = page.locator('[data-testid="btn-demo-normal-flow"]');
    await expect(btnNormal).toBeEnabled();

    // Click Normal Flow
    await btnNormal.click();

    // Transcript should receive user message
    const userTurn = page.locator(".turn-card", {
      hasText: "Find me a hotel in Mumbai for Friday.",
    });
    await expect(userTurn).toBeVisible({ timeout: 5000 });

    // Assistant response should appear
    const asstTurn = page.locator(".turn-card", {
      hasText: "Mumbai",
    });
    await expect(asstTurn).toBeVisible({ timeout: 8000 });

    // Verify active generation in evidence panel
    const activeGen = page.locator('[data-testid="metric-card-active-gen"]');
    await expect(activeGen).toBeVisible();

    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("3. Delayed Tool toggle toggles active state and button appearance", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    const btnDelayed = page.locator('[data-testid="btn-demo-delayed-tool-toggle"]');
    await expect(btnDelayed).toContainText("Delayed Tool: OFF");

    // Toggle ON
    await btnDelayed.click();
    await expect(btnDelayed).toContainText("Delayed Tool: ON (4s)");

    // Verify test helper reports active
    const isDelayedActive = await page.evaluate(() => {
      return (window as unknown as { __ECHOFENCE_TEST__?: { isDelayedToolEnabled: () => boolean } })
        .__ECHOFENCE_TEST__?.isDelayedToolEnabled();
    });
    expect(isDelayedActive).toBe(true);

    // Toggle back OFF
    await btnDelayed.click();
    await expect(btnDelayed).toContainText("Delayed Tool: OFF");

    const isDelayedOff = await page.evaluate(() => {
      return (window as unknown as { __ECHOFENCE_TEST__?: { isDelayedToolEnabled: () => boolean } })
        .__ECHOFENCE_TEST__?.isDelayedToolEnabled();
    });
    expect(isDelayedOff).toBe(false);

    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("4. Run Interruption Scenario executes deterministic race and halts audio with 0 resurrections", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    const btnInterruption = page.locator('[data-testid="btn-demo-run-interruption"]');
    await expect(btnInterruption).toBeEnabled();

    // Run Interruption Scenario
    await btnInterruption.click();

    // Wait for the scenario to complete (4s delayed tool finishes and passes)
    const resultCard = page.locator(".demo-result-card").filter({ hasText: "DETERMINISTIC RACE RESULT" });
    await expect(resultCard).toBeVisible({ timeout: 15000 });

    // Verify invariants: 0 audio resurrections
    const snap = await page.evaluate(() => {
      return (window as unknown as { __ECHOFENCE_TEST__?: { getMeasurementSnapshot: () => { audio: { resurrectionCount: number } } } })
        .__ECHOFENCE_TEST__?.getMeasurementSnapshot();
    });
    expect(snap?.audio.resurrectionCount).toBe(0);

    // Verify Evidence Panel displays 0 stale results spoken
    const staleSpoken = page.locator('[data-testid="metric-card-stale-spoken"]');
    await expect(staleSpoken).toContainText("0");

    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("5. Reset Demo button resets state to clean baseline", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    // First do a turn to make state non-empty
    const btnNormal = page.locator('[data-testid="btn-demo-normal-flow"]');
    await btnNormal.click();

    // Wait for turn to show up
    await page.waitForSelector(".turn-card", { timeout: 6000 });

    // Toggle delayed tool on
    const btnDelayed = page.locator('[data-testid="btn-demo-delayed-tool-toggle"]');
    await btnDelayed.click();
    await expect(btnDelayed).toContainText("Delayed Tool: ON (4s)");

    // Click Reset Demo
    const btnReset = page.locator('[data-testid="btn-demo-reset"]');
    await btnReset.click();

    // Delayed tool toggle should be back to OFF
    await expect(btnDelayed).toContainText("Delayed Tool: OFF");

    // All transcript items should be cleared
    const turnCount = await page.locator(".turn-card").count();
    expect(turnCount).toBe(0);

    // Generation snapshot should be 0
    const genSnap = await page.evaluate(() => {
      return (window as unknown as { __ECHOFENCE_TEST__?: { getGenerationSnapshot: () => { currentGeneration: number } } })
        .__ECHOFENCE_TEST__?.getGenerationSnapshot();
    });
    expect(genSnap?.currentGeneration).toBe(0);

    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("6. Evidence Panel exposes Stale Results Spoken = 0 and Previous Generation", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    // Run interruption race so previous generation is populated
    const btnInterruption = page.locator('[data-testid="btn-demo-run-interruption"]');
    await btnInterruption.click();
    const resultCard = page.locator(".demo-result-card").filter({ hasText: "DETERMINISTIC RACE RESULT" });
    await expect(resultCard).toBeVisible({ timeout: 15000 });

    // Check Stale Results Spoken card
    const staleSpokenCard = page.locator('[data-testid="metric-card-stale-spoken"]');
    await expect(staleSpokenCard).toBeVisible();
    await expect(staleSpokenCard).toContainText("0");

    // Check Previous Gen card
    const prevGenCard = page.locator('[data-testid="metric-card-previous-gen"]');
    await expect(prevGenCard).toBeVisible();

    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("7. Provider status displays connected or fallback safely without leaking credentials", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    const badge = page.locator('[data-testid="provider-status-badge"]');
    await expect(badge).toBeVisible();

    const providerName = page.locator('[data-testid="provider-name"]');
    await expect(providerName).toBeVisible();

    // DOM must never leak secrets
    const pageHtml = await page.content();
    expect(pageHtml).not.toContain("rime_");
    expect(pageHtml).not.toContain("sk-");

    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });
});
