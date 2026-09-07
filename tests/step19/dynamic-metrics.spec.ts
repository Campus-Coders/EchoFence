/**
 * tests/step19/dynamic-metrics.spec.ts
 * End-to-end browser test proving that the parameters inside the section:
 * "CRITICAL PERFORMANCE & CORRECTNESS METRICS"
 * update dynamically and live during user interactions.
 *
 * Sequence:
 * 1. Capture initial baseline metric values.
 * 2. Click [Normal Flow].
 * 3. Verify appropriate metrics update (Started >= 1, Completed >= 1).
 * 4. Enable [Delayed Tool: ON].
 * 5. Run interruption scenario ([Run Interruption Scenario]).
 * 6. Verify interruption and stale-result metrics (Interrupted >= 1, Stale Blocked >= 1, Stop Latency measured).
 * 7. Verify Stale Results Spoken strictly remains 0.
 * 8. Verify Audio Resurrections strictly remains 0.
 * 9. Click [Reset Demo].
 * 10. Verify clean baseline values return.
 */

import { test, expect } from "@playwright/test";
import { setupEchoFencePage } from "../step17/helpers";

test.describe("Dynamic Critical Performance & Correctness Metrics", () => {
  test.setTimeout(60000);

  test("Verifies complete 10-step dynamic metrics lifecycle", async ({ page }) => {
    const monitor = await setupEchoFencePage(page);

    // Locators for Critical Performance & Correctness Metrics
    const totalGen = page.locator('[data-testid="metric-total-generations"]');
    const completedReq = page.locator('[data-testid="metric-completed-requests"]');
    const interruptedReq = page.locator('[data-testid="metric-interrupted-requests"]');
    const stopLatency = page.locator('[data-testid="metric-stop-latency"]');
    const staleBlocked = page.locator('[data-testid="metric-stale-blocked"]');
    const staleSpoken = page.locator('[data-testid="metric-stale-spoken"]');
    const audioResurrections = page.locator('[data-testid="metric-audio-resurrections"]');
    const transcriptCorruptions = page.locator('[data-testid="metric-transcript-corruptions"]');

    // Controls
    const btnNormal = page.locator('[data-testid="btn-demo-normal-flow"]');
    const btnDelayed = page.locator('[data-testid="btn-demo-delayed-tool-toggle"]');
    const btnInterruption = page.locator('[data-testid="btn-demo-run-interruption"]');
    const btnReset = page.locator('[data-testid="btn-demo-reset"]');

    // ====================================================
    // STEP 1: Capture initial metric values (Clean baseline)
    // ====================================================
    await expect(totalGen).toHaveText("0");
    await expect(completedReq).toHaveText("0");
    await expect(interruptedReq).toHaveText("0");
    await expect(stopLatency).toHaveText("—");
    await expect(staleBlocked).toHaveText("0");
    await expect(staleSpoken).toHaveText("0");
    await expect(audioResurrections).toHaveText("0");
    await expect(transcriptCorruptions).toHaveText("0");

    // ====================================================
    // STEP 2: Click [Normal Flow]
    // ====================================================
    await expect(btnNormal).toBeEnabled();
    await btnNormal.click();

    // ====================================================
    // STEP 3: Verify appropriate metrics update
    // ====================================================
    // Wait for the generation turn to commit
    await page.waitForSelector(".turn-card", { timeout: 8000 });

    // Total generations started must now be >= 1
    await expect(totalGen).not.toHaveText("0");
    // Completed requests should advance to >= 1 once synthesis & turn wrap up
    await expect(completedReq).toHaveText(/^[1-9]\d*$/, { timeout: 8000 });

    // Correctness invariants must remain strictly 0
    await expect(staleSpoken).toHaveText("0");
    await expect(audioResurrections).toHaveText("0");
    await expect(transcriptCorruptions).toHaveText("0");

    // ====================================================
    // STEP 4: Enable [Delayed Tool: ON]
    // ====================================================
    await btnDelayed.click();
    await expect(btnDelayed).toContainText("Delayed Tool: ON (4s)");

    // ====================================================
    // STEP 5: Run Interruption Scenario
    // ====================================================
    await btnInterruption.click();

    // Wait for the deterministic race to conclude (4s delay + boundary checks)
    const resultCard = page.locator(".demo-result-card").filter({ hasText: "DETERMINISTIC RACE RESULT" });
    await expect(resultCard).toBeVisible({ timeout: 15000 });

    // ====================================================
    // STEP 6: Verify interruption and stale-result metrics
    // ====================================================
    // Interrupted requests must have incremented (>= 1)
    await expect(interruptedReq).not.toHaveText("0");

    // Stop latency must now show a measured latency value (e.g. "X ms")
    await expect(stopLatency).toContainText("ms");

    // Stale results blocked must have incremented (>= 1)
    await expect(staleBlocked).not.toHaveText("0");

    // Total generations must be >= 2 (Gen 1 interrupted + Gen 2 authoritative)
    const totalGenText = await totalGen.textContent();
    expect(parseInt(totalGenText || "0", 10)).toBeGreaterThanOrEqual(2);

    // ====================================================
    // STEP 7: Verify Stale Results Spoken strictly remains 0
    // ====================================================
    await expect(staleSpoken).toHaveText("0");

    // ====================================================
    // STEP 8: Verify Audio Resurrections strictly remains 0
    // ====================================================
    await expect(audioResurrections).toHaveText("0");
    await expect(transcriptCorruptions).toHaveText("0");

    // ====================================================
    // STEP 9: Click [Reset Demo]
    // ====================================================
    await btnReset.click();

    // ====================================================
    // STEP 10: Verify clean baseline values
    // ====================================================
    await expect(totalGen).toHaveText("0");
    await expect(completedReq).toHaveText("0");
    await expect(interruptedReq).toHaveText("0");
    await expect(stopLatency).toHaveText("—");
    await expect(staleBlocked).toHaveText("0");
    await expect(staleSpoken).toHaveText("0");
    await expect(audioResurrections).toHaveText("0");
    await expect(transcriptCorruptions).toHaveText("0");

    // Verify delayed tool toggle returned to OFF
    await expect(btnDelayed).toContainText("Delayed Tool: OFF");

    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });
});
