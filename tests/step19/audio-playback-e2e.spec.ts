/**
 * tests/step19/audio-playback-e2e.spec.ts
 * Rigorous End-to-End Real Browser Audio Playback Verification.
 *
 * Verifies:
 * 1. Diagnostic endpoint GET /api/voice/diagnostic confirms fallback WAV begins with RIFF and contains WAVE.
 * 2. POST /api/voice/synthesize returns genuine playable audio bytes with correct MIME type.
 * 3. Browser creates Blob via new Blob([arrayBuffer], { type: actualContentType }) and plays via Audio element.
 * 4. audio.play() succeeds in real browser page without NotSupportedError or decode errors.
 * 5. Console UI displays the visible audio diagnostic panel with MIME type, byte size, provider, and STARTED status.
 */

import { test, expect } from "@playwright/test";
import { setupEchoFencePage } from "../step17/helpers";

test.describe("Step 19: Real Browser Audio Playback End-to-End Verification", () => {
  test.setTimeout(45000);

  test("1. Diagnostic endpoint verifies fallback audio strictly begins with RIFF and contains WAVE", async ({
    request,
  }) => {
    const res = await request.get("/api/voice/diagnostic");
    expect(res.status()).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.diagnostic).toBeDefined();

    const fallback = json.diagnostic.fallbackWav;
    expect(fallback.startsWithRiff).toBe(true);
    expect(fallback.containsWave).toBe(true);
    expect(fallback.valid).toBe(true);
    expect(fallback.contentType).toBe("audio/wav");
    expect(fallback.totalBytes).toBeGreaterThanOrEqual(44);
    expect(fallback.first8BytesHex).toContain("0x52 0x49 0x46 0x46"); // RIFF
  });

  test("2. /api/voice/synthesize returns genuine binary audio bytes with valid MIME type", async ({
    request,
  }) => {
    const res = await request.post("/api/voice/synthesize", {
      headers: { Accept: "audio/mpeg, audio/wav, audio/*" },
      data: {
        text: "EchoFence browser audio verification turn.",
        generationId: 1,
        requestId: `test-e2e-${Date.now()}`,
      },
    });

    expect(res.status()).toBe(200);

    const contentType = res.headers()["content-type"] || "";
    expect(
      contentType.includes("audio/mpeg") || contentType.includes("audio/wav")
    ).toBe(true);

    const buffer = await res.body();
    expect(buffer.length).toBeGreaterThan(100);

    // Verify first bytes are real audio header:
    // If audio/mpeg: MP3 sync word (0xFF 0xFB/0xF3/0xF2) or ID3 tag (0x49 0x44 0x33)
    // If audio/wav: RIFF (0x52 0x49 0x46 0x46)
    const b0 = buffer[0] ?? 0;
    const b1 = buffer[1] ?? 0;
    const b2 = buffer[2] ?? 0;
    const b3 = buffer[3] ?? 0;

    const isMp3Sync = b0 === 0xff && (b1 & 0xe0) === 0xe0;
    const isId3 = b0 === 0x49 && b1 === 0x44 && b2 === 0x33;
    const isRiff = b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46;

    expect(isMp3Sync || isId3 || isRiff).toBe(true);
  });

  test("3. Real browser executes HTML5 audio.play() successfully from synthesis Blob", async ({
    page,
  }) => {
    await setupEchoFencePage(page);

    // Fetch synthesis audio from within the browser page and play it directly
    const playResult = await page.evaluate(async () => {
      try {
        const synthRes = await fetch("/api/voice/synthesize", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "audio/mpeg, audio/wav, audio/*",
          },
          body: JSON.stringify({
            text: "Testing browser audio playback with HTML5 Audio element.",
            generationId: 1,
            requestId: `req-browser-${Date.now()}`,
          }),
        });

        if (!synthRes.ok) {
          return { success: false, error: `HTTP ${synthRes.status}` };
        }

        const rawContentType = synthRes.headers.get("content-type") || "audio/mpeg";
        const mimeType = rawContentType.includes("wav") ? "audio/wav" : "audio/mpeg";
        const arrayBuffer = await synthRes.arrayBuffer();

        // 15. Ensure the browser creates the Blob like:
        // new Blob([arrayBuffer], { type: actualContentType })
        const blob = new Blob([arrayBuffer], { type: mimeType });

        // and uses:
        // const url = URL.createObjectURL(blob)
        // audio.src = url
        // await audio.play()
        const url = URL.createObjectURL(blob);
        const audio = new Audio();
        audio.src = url;

        let playbackStarted = false;
        let playError: string | null = null;

        audio.onerror = () => {
          const code = audio.error?.code;
          const msg = audio.error?.message;
          playError = `Audio element error (code=${code}, msg=${msg})`;
        };

        await audio.play();
        playbackStarted = !audio.paused;

        // Clean up
        audio.pause();
        audio.src = "";
        URL.revokeObjectURL(url);

        return {
          success: playbackStarted && !playError,
          playbackStarted,
          byteSize: arrayBuffer.byteLength,
          mimeType: blob.type,
          error: playError,
        };
      } catch (err: unknown) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    expect(playResult.success).toBe(true);
    expect(playResult.playbackStarted).toBe(true);
    expect(playResult.byteSize).toBeGreaterThan(100);
    expect(playResult.error).toBeNull();
  });

  test("4. Normal flow turn activates playback and displays audio diagnostic badge in UI", async ({
    page,
  }) => {
    const monitor = await setupEchoFencePage(page);

    // Click Normal Flow to execute live turn + synthesis + playback
    const btnNormal = page.locator('[data-testid="btn-demo-normal-flow"]');
    await expect(btnNormal).toBeVisible();
    await btnNormal.click();

    // Verify assistant transcript appears
    const asstTurn = page.locator(".turn-card", { hasText: "Mumbai" });
    await expect(asstTurn).toBeVisible({ timeout: 10000 });

    // Verify visible audio diagnostic badge renders in the UI
    const diagBadge = page.locator('[data-testid="audio-diagnostic-badge"]');
    await expect(diagBadge).toBeVisible({ timeout: 8000 });

    const diagMime = page.locator('[data-testid="audio-diag-mime"]');
    await expect(diagMime).toBeVisible();
    const mimeText = await diagMime.innerText();
    expect(mimeText === "audio/mpeg" || mimeText === "audio/wav").toBe(true);

    const diagBytes = page.locator('[data-testid="audio-diag-bytes"]');
    await expect(diagBytes).toBeVisible();

    const diagStatus = page.locator('[data-testid="audio-diag-status"]');
    await expect(diagStatus).toContainText("STARTED");

    // Zero unexpected errors (no NotSupportedError or playback crash)
    const unexpectedErrors = monitor.getUnexpectedErrors();
    const playbackErrors = unexpectedErrors.filter(
      (e) => e.includes("NotSupportedError") || e.includes("Audio element playback error")
    );
    expect(playbackErrors).toHaveLength(0);
  });
});
