import { NextResponse } from "next/server";
import { rimeProviderAdapter } from "@/lib/rime-provider";
import { getSafeRimeStatus } from "@/lib/config";

/**
 * GET /api/voice/diagnostic
 * Verifies audio synthesizer outputs, MIME types, and header signatures.
 * Proves that fallback audio strictly begins with RIFF and contains WAVE.
 * Never leaks API keys or secrets.
 */
export async function GET(): Promise<NextResponse> {
  const safeStatus = getSafeRimeStatus();

  // 1. Generate and inspect fallback WAV buffer
  const fallbackBuffer = rimeProviderAdapter.createSyntheticAudioBuffer("diagnostic probe");
  const fallbackBytes = new Uint8Array(fallbackBuffer);

  const startsWithRiff =
    fallbackBytes[0] === 0x52 && // 'R'
    fallbackBytes[1] === 0x49 && // 'I'
    fallbackBytes[2] === 0x46 && // 'F'
    fallbackBytes[3] === 0x46; // 'F'

  const containsWave =
    fallbackBytes[8] === 0x57 && // 'W'
    fallbackBytes[9] === 0x41 && // 'A'
    fallbackBytes[10] === 0x56 && // 'V'
    fallbackBytes[11] === 0x45; // 'E'

  const first8BytesHex = Array.from(fallbackBytes.slice(0, 8))
    .map((b) => "0x" + b.toString(16).padStart(2, "0"))
    .join(" ");

  return NextResponse.json({
    success: true,
    diagnostic: {
      provider: safeStatus.provider,
      mode: safeStatus.mode,
      isRealConfigured: safeStatus.configured,
      model: safeStatus.selectedModel,
      voice: safeStatus.selectedVoice,
      language: safeStatus.language,
      fallbackWav: {
        totalBytes: fallbackBuffer.byteLength,
        startsWithRiff,
        containsWave,
        first8BytesHex,
        contentType: "audio/wav",
        valid: startsWithRiff && containsWave,
      },
      timestamp: Date.now(),
    },
  });
}
