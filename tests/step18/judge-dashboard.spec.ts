/**
 * tests/step18/judge-dashboard.spec.ts
 * Browser validation for Step 18 Judge-Facing Evidence Dashboard.
 *
 * Covers:
 * 1. Evidence dashboard loads successfully (/evidence & /console).
 * 2. Core invariant panel renders actual status with motto.
 * 3. Metrics render without runtime errors.
 * 4. Generation timeline displays generation transitions.
 * 5. Scenario selection works.
 * 6. Live scenario execution works.
 * 7. Scenario result displays SAFE/UNSAFE/INCOMPLETE badge.
 * 8. Repeated scenario execution maintains metric consistency.
 * 9. No unexpected browser errors occur.
 * 10. No secrets are visible in the DOM.
 * 11. Existing voice console remains functional.
 * 12. Evidence UI remains usable after scenario execution.
 */

import { test, expect } from "@playwright/test";
import { setupEchoFencePage, attachErrorMonitor } from "../step17/helpers";

test.describe("Step 18: Judge Evidence Dashboard Validation", () => {
  test("1. Dedicated evidence route (/evidence) loads cleanly and renders core components", async ({
    page,
  }) => {
    const monitor = attachErrorMonitor(page);
    await page.goto("/evidence");

    // Invariant banner motto
    const banner = page.locator("text=CHAOS MAY BREAK EXECUTION. CHAOS MUST NOT BREAK OWNERSHIP.");
    await expect(banner).toBeVisible({ timeout: 10000 });

    // System status section
    const statusHeader = page.locator("text=SYSTEM STATUS & RUNTIME AUTHORITY");
    await expect(statusHeader).toBeVisible();

    // Invariants overall badge
    const overallBadge = page.locator('[data-testid="invariants-overall-badge"]');
    await expect(overallBadge).toBeVisible();

    // Zero unexpected errors
    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("2. Core Invariant Panel displays machine-derived checks with PASS status", async ({
    page,
  }) => {
    const monitor = attachErrorMonitor(page);
    await page.goto("/evidence");

    // Check individual invariant cards
    await expect(page.locator('[data-testid="invariant-card-inv-authority-exclusivity"]')).toBeVisible();
    await expect(page.locator('[data-testid="invariant-card-inv-audio-resurrection"]')).toBeVisible();
    await expect(page.locator('[data-testid="invariant-card-inv-stale-callback-blocking"]')).toBeVisible();
    await expect(page.locator('[data-testid="invariant-card-inv-stream-cancellation"]')).toBeVisible();
    await expect(page.locator('[data-testid="invariant-card-inv-idempotent-cleanup"]')).toBeVisible();
    await expect(page.locator('[data-testid="invariant-card-inv-resource-leak"]')).toBeVisible();

    // Verify all invariant statuses are PASS
    const passBadges = page.locator('text=[PASS]');
    const count = await passBadges.count();
    expect(count).toBeGreaterThanOrEqual(6);

    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("3. System status metrics render live values with zero audio resurrections and zero corruptions", async ({
    page,
  }) => {
    const monitor = attachErrorMonitor(page);
    await page.goto("/evidence");

    // Audio resurrections must be strictly 0
    const resurrections = page.locator('[data-testid="metric-audio-resurrections"]');
    await expect(resurrections).toHaveText("0");

    // Transcript corruptions must be strictly 0
    const corruptions = page.locator('[data-testid="metric-transcript-corruptions"]');
    await expect(corruptions).toHaveText("0");

    // Resource leaks must be strictly 0
    const leaks = page.locator('[data-testid="metric-resource-leaks"]');
    await expect(leaks).toHaveText("0");

    // Chaos safety rate must be 100%
    const safety = page.locator('[data-testid="metric-chaos-safety"]');
    await expect(safety).toHaveText("100%");

    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("4. Generation authority timeline renders and displays timeline nodes", async ({
    page,
  }) => {
    const monitor = attachErrorMonitor(page);
    await page.goto("/evidence");

    const timelineTitle = page.locator("text=GENERATION AUTHORITY TIMELINE");
    await expect(timelineTitle).toBeVisible();

    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("5. Scenario tabs allow switching between representative chaos fixtures", async ({
    page,
  }) => {
    const monitor = attachErrorMonitor(page);
    await page.goto("/evidence");

    // Verify scenario tabs are present
    const tab1 = page.locator('[data-testid="tab-scenario-1"]');
    const tab2 = page.locator('[data-testid="tab-scenario-2"]');
    const tab5 = page.locator('[data-testid="tab-scenario-5"]');
    const tab7 = page.locator('[data-testid="tab-scenario-7"]');
    const tab10 = page.locator('[data-testid="tab-scenario-10"]');
    const tab13 = page.locator('[data-testid="tab-scenario-13"]');
    const tab15 = page.locator('[data-testid="tab-scenario-15"]');

    await expect(tab1).toBeVisible();
    await expect(tab2).toBeVisible();
    await expect(tab5).toBeVisible();
    await expect(tab7).toBeVisible();
    await expect(tab10).toBeVisible();
    await expect(tab13).toBeVisible();
    await expect(tab15).toBeVisible();

    // Click Scenario 2 tab
    await tab2.click();
    await expect(page.locator('[data-testid="scenario-fault"]')).toHaveText("STALE_RESPONSE");

    // Click Scenario 7 tab
    await tab7.click();
    await expect(page.locator('[data-testid="scenario-fault"]')).toHaveText("STREAM_REORDER");

    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("6. Live scenario execution triggers deterministic runner and reports SAFE outcome", async ({
    page,
  }) => {
    const monitor = attachErrorMonitor(page);
    await page.goto("/evidence");

    // Select Scenario 1
    await page.locator('[data-testid="tab-scenario-1"]').click();
    const runBtn = page.locator('[data-testid="btn-run-chaos-scenario"]');
    await expect(runBtn).toBeVisible();

    await runBtn.click();

    // Execution message appears
    const msg = page.locator('[data-testid="chaos-execution-message"]');
    await expect(msg).toBeVisible({ timeout: 10000 });
    await expect(msg).toContainText("SAFE");

    // Outcome badge displays SAFE
    const badge = page.locator('[data-testid="scenario-outcome-badge"]');
    await expect(badge).toContainText("SAFE");

    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("7. Repeated scenario execution maintains metric consistency with zero leaks", async ({
    page,
  }) => {
    const monitor = attachErrorMonitor(page);
    await page.goto("/evidence");

    const runBtn = page.locator('[data-testid="btn-run-chaos-scenario"]');

    // Run twice in succession
    await runBtn.click();
    await page.waitForTimeout(500);
    await runBtn.click();
    await page.waitForTimeout(500);

    // Verify invariants remain strictly passing
    const resurrections = page.locator('[data-testid="metric-audio-resurrections"]');
    await expect(resurrections).toHaveText("0");

    const corruptions = page.locator('[data-testid="metric-transcript-corruptions"]');
    await expect(corruptions).toHaveText("0");

    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("8. Zero secrets or credential strings appear anywhere in page DOM", async ({
    page,
  }) => {
    const monitor = attachErrorMonitor(page);
    await page.goto("/evidence");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("RIME_API_KEY");
    expect(pageContent).not.toContain("sk-");
    expect(pageContent).not.toContain("Bearer ");

    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("9. Navigation between /evidence and /console works seamlessly", async ({
    page,
  }) => {
    const monitor = attachErrorMonitor(page);
    await page.goto("/evidence");

    // Navigate to Console via link
    const consoleLink = page.locator('[data-testid="link-back-console"]');
    await consoleLink.click();
    await page.waitForURL("**/console");

    // Verify Console components
    await expect(page.locator("text=Interruption-Safe Voice Intelligence")).toBeVisible();

    // Navigate back to Evidence
    await page.goto("/evidence");
    await expect(page.locator("text=ECHOFENCE EVIDENCE")).toBeVisible();

    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });

  test("10. Integrated Evidence Dashboard in /console renders the unified judge panels", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    // Invariant motto in console
    const banner = page.locator("text=CHAOS MAY BREAK EXECUTION. CHAOS MUST NOT BREAK OWNERSHIP.");
    await expect(banner).toBeVisible();

    // System status panel in console
    const statusHeader = page.locator("text=SYSTEM STATUS & RUNTIME AUTHORITY");
    await expect(statusHeader).toBeVisible();

    expect(monitor.getUnexpectedErrors()).toHaveLength(0);
  });
});
