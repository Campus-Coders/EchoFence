/**
 * tests/step16/helpers.ts
 * Shared test helpers, audio synthesis generators, and error monitors for Step 16 browser E2E specs.
 */

import type { Page } from "@playwright/test";

export interface EchoFenceTestInterface {
  getGenerationSnapshot: () => {
    currentGeneration: number;
    isCurrent?: (genId: number) => boolean;
    isInterrupted?: (genId: number) => boolean;
  };
  getMeasurementSnapshot: () => any;
  getAuditEvents: (limit?: number) => any[];
  getPlaybackSnapshot: () => {
    activePlaybackCount: number;
    isGenerationPlaying: (genId: number) => boolean;
    activeGenerations: number[];
    isBargeInMonitoring: boolean;
    bargeInTargetGen: number | null;
    lastDetectedLevel: number;
    activeStreams: string[];
  };
  executeTurn: (text: string) => Promise<void>;
  triggerInterruption: (genId: number, reason?: "user_barge_in" | "test_simulation") => void;
  getStateMachineState: () => string;
  getTurns: () => any[];
  generationFence: any;
  interruptController: any;
  bargeInDetector: any;
  generationAwareAudio: any;
  generationAwareAudioStream: any;
  measurementPipeline: any;
  generationAudit: any;
  chaosController: any;
  getChaosSnapshot: () => any;
  checkResourceLeaks: () => any;
  resetAll: () => void;
}

declare global {
  interface Window {
    __ECHOFENCE_TEST__?: EchoFenceTestInterface;
    __ECHOFENCE_TEST_ENABLED__?: boolean;
  }
}

/**
 * Creates a valid PCM 16-bit mono WAV as a base64 string.
 * Completely deterministic and natively decodable by browser Web Audio decodeAudioData().
 */
export function createWavBase64(durationSeconds = 0.2, sampleRate = 8000): string {
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // fmt chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 1 channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);

  // data chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 1000;
    view.setInt16(44 + i * 2, sample, true);
  }

  return Buffer.from(buffer).toString("base64");
}

export interface ErrorMonitor {
  getUnexpectedErrors: () => string[];
  clearErrors: () => void;
}

/**
 * Attaches browser error and warning monitoring to the page.
 * Captures uncaught exceptions, unhandled rejections, and unexpected console.error.
 */
export function attachErrorMonitor(page: Page): ErrorMonitor {
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
      // Whitelist expected non-critical dev messages, standard Next.js asset requests, and SSR hydration text diffs
      const isExpected =
        text.includes("Download the React DevTools") ||
        text.includes("[Fast Refresh]") ||
        text.includes("favicon.ico") ||
        text.includes("404") ||
        text.includes("Hydration failed") ||
        text.includes("hydration-mismatch") ||
        text.includes("ERR_NETWORK_CHANGED") ||
        text.includes("ERR_INTERNET_DISCONNECTED");

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

/**
 * Initializes the page for EchoFence tests:
 * 1. Enables test observability flag
 * 2. Mocks favicon.ico to 204
 * 3. Navigates to /console
 * 4. Waits for __ECHOFENCE_TEST__
 * 5. Resets internal state
 */
export async function setupEchoFencePage(page: Page): Promise<ErrorMonitor> {
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
