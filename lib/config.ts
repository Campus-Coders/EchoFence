import type { SafeProviderStatus } from "@/types/provider";

export type RimeConfig = {
  apiKey: string | null;
  model: string;
  voice: string;
  language: string;
  endpoint: string;
  audioFormat: string;
  transport: string;
  isConfigured: boolean;
};

/**
 * Server-only helper to read Rime configuration safely.
 * Secret keys are strictly contained on the server and never sent to the client.
 */
export function getRimeConfig(): RimeConfig {
  const rawKey = process.env.RIME_API_KEY?.trim();
  const isKeyPresent =
    Boolean(rawKey) &&
    rawKey !== "your_rime_api_key_here" &&
    rawKey !== "your_key_here" &&
    (rawKey?.length ?? 0) > 8;

  const model =
    process.env.RIME_MODEL?.trim() ||
    process.env.RIME_MODEL_ID?.trim() ||
    "mist";

  const voice =
    process.env.RIME_VOICE?.trim() ||
    process.env.RIME_SPEAKER?.trim() ||
    "amber";

  const language = process.env.RIME_LANGUAGE?.trim() || "en";
  const endpoint =
    process.env.RIME_ENDPOINT?.trim() || "https://users.rime.ai/v1/rime-tts";
  const audioFormat = process.env.RIME_AUDIO_FORMAT?.trim() || "mp3";
  const transport = "REST / HTTPS Stream";

  return {
    apiKey: isKeyPresent ? (rawKey as string) : null,
    model,
    voice,
    language,
    endpoint,
    audioFormat,
    transport,
    isConfigured: isKeyPresent,
  };
}

/**
 * Sanitized status object that is completely safe to return to the client.
 * Explicitly omits apiKey and endpoint credentials.
 */
export function getSafeRimeStatus(): SafeProviderStatus {
  const config = getRimeConfig();
  const explicitMode = process.env.RIME_PROVIDER_MODE?.toLowerCase().trim();
  const mode: "real" | "mock" =
    explicitMode === "mock" ? "mock" : config.isConfigured ? "real" : "mock";

  return {
    configured: config.isConfigured,
    provider: "Rime",
    mode,
    selectedModel: config.model,
    selectedVoice: config.voice,
    language: config.language,
    audioFormat: config.audioFormat,
    transport: config.transport,
    note: config.isConfigured
      ? `Rime active (${mode} mode) as primary voice synthesis provider`
      : "Provider API key not configured. Add to environment to activate live audio.",
  };
}

export function isRimeConfigured(): boolean {
  return getRimeConfig().isConfigured;
}
