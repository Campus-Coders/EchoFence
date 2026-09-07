import { test, expect } from "@playwright/test";

test.describe("Travel Voice Agent Demonstration & Race Fencing", () => {
  test.beforeEach(async ({ page }) => {
    // Reset controllers before each test
    await page.goto("http://localhost:3000/console");
    await page.waitForLoadState("networkidle");

    const btnReset = page.locator('[data-testid="btn-demo-reset"]');
    if (await btnReset.isVisible()) {
      await btnReset.click();
      await page.waitForTimeout(200);
    }
  });

  test("1. Flight Search quick prompt produces realistic flight response with zero canned echo", async ({ page }) => {
    // Locate Flight Search quick prompt
    const btnFlight = page.getByRole("button", { name: "Flight Search" });
    await expect(btnFlight).toBeVisible();
    await btnFlight.click();

    // Verify User turn in transcript
    const userTurn = page.locator(".turn-card", {
      hasText: "Can you find flights from Chennai to Mumbai on Tuesday?",
    });
    await expect(userTurn).toBeVisible({ timeout: 5000 });

    // Verify realistic Assistant response in transcript
    const asstTurn = page.locator(".turn-card", {
      hasText: "Indigo",
    });
    await expect(asstTurn).toBeVisible({ timeout: 10000 });

    // Assert that the assistant response contains realistic flight details
    const text = await asstTurn.textContent();
    expect(text).toContain("Chennai");
    expect(text).toContain("Mumbai");
    expect(text).toContain("5,240");

    // Strictly verify no canned echo response anywhere in the transcript
    const transcriptText = await page.locator(".transcript-list").textContent();
    expect(transcriptText).not.toContain("EchoFence processed your turn successfully");
    expect(transcriptText).not.toContain("I received:");
  });

  test("2. Mumbai Friday hotel search produces realistic hotel response with zero canned echo", async ({ page }) => {
    const btnMumbai = page.getByRole("button", { name: "Mumbai (Friday)" });
    await expect(btnMumbai).toBeVisible();
    await btnMumbai.click();

    // Verify User turn in transcript
    const userTurn = page.locator(".turn-card", {
      hasText: "Find me a hotel in Mumbai for Friday.",
    });
    await expect(userTurn).toBeVisible({ timeout: 5000 });

    // Verify realistic Assistant hotel response
    const asstTurn = page.locator(".turn-card", {
      hasText: "Hotel Aurora",
    });
    await expect(asstTurn).toBeVisible({ timeout: 10000 });

    const text = await asstTurn.textContent();
    expect(text).toContain("Mumbai");
    expect(text).toContain("4,200");

    // Strictly verify no canned echo response
    const transcriptText = await page.locator(".transcript-list").textContent();
    expect(transcriptText).not.toContain("EchoFence processed your turn successfully");
    expect(transcriptText).not.toContain("I received:");
  });

  test("3. Deterministic race scenario executes realistic travel story and fences stale hotel tool", async ({ page }) => {
    const btnScenario = page.locator('[data-testid="btn-demo-run-interruption"]');
    await expect(btnScenario).toBeVisible();
    await btnScenario.click();

    // Wait for the deterministic race scenario to complete
    const resultCard = page.locator(".demo-result-card").filter({ hasText: "DETERMINISTIC RACE RESULT" });
    await expect(resultCard).toBeVisible({ timeout: 15000 });
    await expect(resultCard).toContainText("PASS");

    // Verify transcript structure:
    // Gen 1 user: "Find me a hotel in Mumbai for Friday."
    // Gen 2 user: "Actually, find me a flight to Mumbai on Saturday."
    // Gen 2 asst: "I found two Saturday flights to Mumbai. The earliest is Indigo at 8:20 AM for ₹5,240."
    const userTurn1 = page.locator(".turn-card", { hasText: "Find me a hotel in Mumbai for Friday." });
    await expect(userTurn1).toBeVisible();

    const userTurn2 = page.locator(".turn-card", { hasText: "Actually, find me a flight to Mumbai on Saturday." });
    await expect(userTurn2).toBeVisible();

    const asstTurn2 = page.locator(".turn-card", { hasText: "Saturday flights to Mumbai" });
    await expect(asstTurn2).toBeVisible();

    // CRITICAL: Ensure NO assistant response exists for stale Gen 1 (Hotel Aurora / Taj)
    const turnCount = await page.locator(".turn-card").count();
    expect(turnCount).toBe(3); // 2 user turns + 1 assistant turn only!

    // Verify metrics panel shows stale results blocked and zero stale spoken
    const staleBlockedCard = page.locator('[data-testid="metric-card-stale-blocked"]');
    await expect(staleBlockedCard).toBeVisible();
    const staleBlockedVal = await staleBlockedCard.locator(".metric-value").textContent();
    expect(Number(staleBlockedVal)).toBeGreaterThanOrEqual(1);

    const staleSpokenCard = page.locator('[data-testid="metric-card-stale-spoken"]');
    await expect(staleSpokenCard).toBeVisible();
    await expect(staleSpokenCard.locator(".metric-value")).toHaveText("0");
  });

  test("4. Delayed Tool toggle enables asynchronous race condition where late tool is blocked", async ({ page }) => {
    const btnDelayed = page.locator('[data-testid="btn-demo-delayed-tool-toggle"]');
    await expect(btnDelayed).toContainText("Delayed Tool: OFF");

    // Enable 4s delayed tool
    await btnDelayed.click();
    await expect(btnDelayed).toContainText("Delayed Tool: ON (4s)");

    // Trigger Gen 1 hotel search
    const btnMumbai = page.getByRole("button", { name: "Mumbai (Friday)" });
    await btnMumbai.click();

    // Gen 1 user turn appears
    await expect(page.locator(".turn-card", { hasText: "Find me a hotel in Mumbai for Friday." })).toBeVisible({ timeout: 4000 });

    // Wait 500ms while Gen 1 tool is asynchronously executing in background, then trigger Gen 2
    await page.waitForTimeout(500);

    const btnFlight = page.getByRole("button", { name: "Flight Search" });
    await btnFlight.click();

    // Gen 2 user turn appears
    await expect(page.locator(".turn-card", { hasText: "Can you find flights from Chennai to Mumbai on Tuesday?" })).toBeVisible({ timeout: 4000 });

    // Gen 2 completes and speaks
    await expect(page.locator(".turn-card", { hasText: "Indigo" })).toBeVisible({ timeout: 8000 });

    // Wait for the 4-second delayed Gen 1 tool to finish and reach the boundary
    await page.waitForTimeout(4000);

    // Stale Gen 1 tool must NOT appear in the transcript
    const allTurns = await page.locator(".turn-card").allTextContents();
    const asstHotelTurn = allTurns.filter((t) => t.includes("Hotel Aurora") || t.includes("Taj Mahal"));
    expect(asstHotelTurn).toHaveLength(0);

    // Stale Results Blocked metric must be at least 1
    const staleBlockedCard = page.locator('[data-testid="metric-card-stale-blocked"]');
    const staleBlockedVal = await staleBlockedCard.locator(".metric-value").textContent();
    expect(Number(staleBlockedVal)).toBeGreaterThanOrEqual(1);

    // Stale Results Spoken must be strictly 0
    const staleSpokenCard = page.locator('[data-testid="metric-card-stale-spoken"]');
    await expect(staleSpokenCard.locator(".metric-value")).toHaveText("0");
  });
});
