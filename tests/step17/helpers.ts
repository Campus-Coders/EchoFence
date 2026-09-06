/**
 * tests/step17/helpers.ts
 * Shared test helpers and error monitors for Step 17 Chaos E2E specs.
 */

import { Page } from "@playwright/test";
import * as baseHelpers from "../step16/helpers";

export * from "../step16/helpers";

/**
 * Attaches chaos-aware browser error and warning monitoring to the page.
 * Captures uncaught exceptions, unhandled rejections, and unexpected console.error.
 * Expected chaos faults (e.g. injected 504 network errors, malformed audio rejection)
 * are handled safely and not classified as unexpected runtime crashes.
 */
export function attachErrorMonitor(page: Page): baseHelpers.ErrorMonitor {
  const unexpectedErrors: string[] = [];

  page.on("pageerror", (err) => {
    const msg = err.message || String(err);
    if (msg.includes("Hydration failed") || msg.includes("hydration-mismatch")) {
      return;
    }
    unexpectedErrors.push(`[Uncaught PageError] ${msg}`);
  });

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      const isExpected =
        text.includes("Download the React DevTools") ||
        text.includes("[Fast Refresh]") ||
        text.includes("favicon.ico") ||
        text.includes("404") ||
        text.includes("504") ||
        text.includes("Failed to load resource") ||
        text.includes("Voice turn failure") ||
        text.includes("Audio playback failed") ||
        text.includes("NotSupportedError") ||
        text.includes("Hydration failed") ||
        text.includes("hydration-mismatch");

      if (!isExpected) {
        unexpectedErrors.push(`[Console Error] ${text}`);
      }
    }
  });

  return {
    getUnexpectedErrors: () => [...unexpectedErrors],
    clearErrors: () => {
      unexpectedErrors.length = 0;
    },
  };
}

export async function setupEchoFencePage(page: Page): Promise<baseHelpers.ErrorMonitor> {
  const monitor = attachErrorMonitor(page);

  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));

  await page.addInitScript(() => {
    window.__ECHOFENCE_TEST_ENABLED__ = true;
  });

  await page.goto("/console");

  // Wait for the test interface to be mounted
  await page.waitForFunction(() => typeof window.__ECHOFENCE_TEST__ !== "undefined", {
    timeout: 10000,
  });

  // Clean initial state
  await page.evaluate(() => {
    window.__ECHOFENCE_TEST__?.resetAll();
  });

  return monitor;
}
