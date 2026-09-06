import { getRimeConfig } from "./config";
import type {
  SpeechProvider,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
  SafeProviderStatus,
} from "@/types/provider";
import { getSafeRimeStatus } from "./config";

/**
 * Concrete implementation of SpeechProvider for Rime TTS.
 * Handles synthesis and safe status reporting.
 */
export class RimeSpeechProvider implements SpeechProvider {
  public readonly id = "rime";
  public readonly name = "Rime";

  /**
   * Returns safe provider metadata without exposing credentials.
   */
  public getStatus(): SafeProviderStatus {
    return getSafeRimeStatus();
  }

  /**
   * Synthesize speech using Rime's HTTP API.
   * Throws a descriptive server error if not configured or if the request fails.
   */
  public async synthesize(
    request: SpeechSynthesisRequest
  ): Promise<SpeechSynthesisResult> {
    const config = getRimeConfig();

    if (!config.isConfigured || !config.apiKey) {
      throw new Error(
        "Rime speech synthesis unavailable: RIME_API_KEY is not configured"
      );
    }

    const speaker = request.voice || config.voice;
    const model = request.model || config.model;

    const payload = {
      speaker,
      text: request.text,
      modelId: model,
      samplingRate: 22050,
      speedAlpha: 1.0,
      audioFormat: config.audioFormat,
      lang: request.language || config.language,
    };

    const startTime = Date.now();

    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          Accept: config.audioFormat === "pcm" ? "audio/pcm" : "audio/mp3",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
          `Rime API responded with status ${response.status}: ${errorText}`
        );
      }

      const audioBuffer = await response.arrayBuffer();
      const durationMs = Date.now() - startTime;

      return {
        audioBuffer,
        contentType:
          response.headers.get("content-type") ||
          (config.audioFormat === "pcm" ? "audio/pcm" : "audio/mpeg"),
        provider: this.name,
        model,
        voice: speaker,
        durationMs,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[rime/client] Synthesis error: ${message}`);
      throw new Error(`Speech synthesis failed: ${message}`);
    }
  }
}

// Singleton instance of the Rime speech provider
export const rimeProvider = new RimeSpeechProvider();
