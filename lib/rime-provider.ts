import { getRimeConfig } from "./config";
import { generationAudit } from "./generation-audit";
import type {
  VoiceProviderRequest,
  VoiceProviderResult,
  VoiceProviderErrorCode,
} from "@/types/provider";

export interface RimeProviderOptions {
  mode?: "real" | "mock";
  defaultTimeoutMs?: number;
  mockLatencyMs?: number;
  mockFailureCode?: VoiceProviderErrorCode;
}

/**
 * Server-side Rime Provider Adapter.
 *
 * Implements the provider boundary contract:
 * ARRIVAL != AUTHORITY
 *
 * This adapter is responsible ONLY for transport, timeout safety,
 * AbortSignal propagation, and error normalization.
 *
 * It NEVER:
 * - mutates the conversation transcript
 * - starts or controls audio playback
 * - alters the GenerationFence active generation
 * - makes authority decisions for stale or current generations
 */
export class RimeProviderAdapter {
  private modeOverride?: "real" | "mock";
  private defaultTimeoutMs: number;
  private mockLatencyMs: number;
  private mockFailureCode?: VoiceProviderErrorCode;
  private lastProviderStatus: string = "idle";
  private lastProviderStatusCode: number | null = null;
  private lastProviderError: string | null = null;
  private lastAudioSource: "REAL_RIME_AUDIO" | "FALLBACK_SYNTHETIC_AUDIO" | null = null;

  constructor(options?: RimeProviderOptions) {
    if (options?.mode) {
      this.modeOverride = options.mode;
    }
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 8000;
    this.mockLatencyMs = options?.mockLatencyMs ?? 25;
    this.mockFailureCode = options?.mockFailureCode;
  }

  public getMode(): "real" | "mock" {
    if (this.modeOverride) {
      return this.modeOverride;
    }
    const envMode = process.env.RIME_PROVIDER_MODE?.toLowerCase().trim();
    if (envMode === "mock") return "mock";
    if (envMode === "real") return "real";
    return getRimeConfig().isConfigured ? "real" : "mock";
  }

  public setMode(mode?: "real" | "mock"): void {
    this.modeOverride = mode;
  }

  public getDiagnostics() {
    return {
      lastProviderStatus: this.lastProviderStatus,
      lastProviderStatusCode: this.lastProviderStatusCode,
      lastProviderError: this.lastProviderError,
      lastAudioSource: this.lastAudioSource,
    };
  }

  public setMockFailure(code?: VoiceProviderErrorCode): void {
    this.mockFailureCode = code;
  }

  public setMockLatency(ms: number): void {
    this.mockLatencyMs = Math.max(0, ms);
  }

  /**
   * Synthesize speech through the Rime provider.
   * Returns a normalized VoiceProviderResult.
   */
  public async synthesize(
    request: VoiceProviderRequest,
    options?: { timeoutMs?: number }
  ): Promise<VoiceProviderResult> {
    const startedAt = request.startedAt || Date.now();
    const requestId =
      request.requestId ||
      `rime-req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const generationId = request.generationId;

    // 1. Input Validation
    if (typeof generationId !== "number" || isNaN(generationId) || generationId < 0) {
      return this.createFailureResult(
        generationId ?? 0,
        requestId,
        startedAt,
        "INVALID_RESPONSE",
        "Invalid generationId provided to speech provider"
      );
    }

    if (
      typeof request.text !== "string" ||
      request.text.trim().length === 0 ||
      request.text.length > 2000
    ) {
      return this.createFailureResult(
        generationId,
        requestId,
        startedAt,
        "INVALID_RESPONSE",
        "Invalid or oversized text input for speech synthesis"
      );
    }

    // Record audit: request started
    try {
      generationAudit.record(
        generationId,
        "provider_request_started",
        generationId,
        "RimeProviderAdapter",
        `Request dispatched [${requestId}], textLen: ${request.text.length}`
      );
    } catch {
      // Non-fatal audit recording
    }

    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;

    // 2. Dispatch depending on mode
    if (this.getMode() === "mock") {
      return this.synthesizeMock(request, requestId, startedAt, timeoutMs);
    }

    return this.synthesizeReal(request, requestId, startedAt, timeoutMs);
  }

  /**
   * Deterministic mock implementation for offline and hermetic testing.
   */
  private async synthesizeMock(
    request: VoiceProviderRequest,
    requestId: string,
    startedAt: number,
    timeoutMs: number
  ): Promise<VoiceProviderResult> {
    const generationId = request.generationId;

    // Immediate abort check
    if (request.signal?.aborted) {
      this.recordAudit(generationId, "provider_request_aborted", requestId);
      return {
        generationId,
        requestId,
        completedAt: Date.now(),
        status: "cancelled",
        errorCode: "ABORTED",
        error: "Request aborted before provider synthesis started",
        latencyMs: Date.now() - startedAt,
      };
    }

    // Simulated provider failure if requested
    if (this.mockFailureCode) {
      return this.createFailureResult(
        generationId,
        requestId,
        startedAt,
        this.mockFailureCode,
        `Mock simulated error: ${this.mockFailureCode}`
      );
    }

    // Simulate async network delay with abort and timeout listeners
    const delayMs = this.mockLatencyMs;

    if (delayMs > timeoutMs) {
      // Timeout occurs before completion
      this.recordAudit(generationId, "provider_request_timeout", requestId);
      return {
        generationId,
        requestId,
        completedAt: Date.now(),
        status: "failed",
        errorCode: "TIMEOUT",
        error: `Request timed out after ${timeoutMs}ms in mock provider`,
        latencyMs: timeoutMs,
      };
    }

    const abortPromise = new Promise<VoiceProviderResult>((resolve) => {
      if (!request.signal) return;
      const onAbort = () => {
        resolve({
          generationId,
          requestId,
          completedAt: Date.now(),
          status: "cancelled",
          errorCode: "ABORTED",
          error: "Request aborted during mock synthesis delay",
          latencyMs: Date.now() - startedAt,
        });
      };
      request.signal.addEventListener("abort", onAbort, { once: true });
    });

    const workPromise = new Promise<VoiceProviderResult>((resolve) => {
      const timer = setTimeout(() => {
        const mockBuffer = this.createSyntheticAudioBuffer(request.text);
        const completedAt = Date.now();
        const latencyMs = completedAt - startedAt;

        this.recordAudit(generationId, "provider_request_completed", requestId);

        const contentType = "audio/wav";
        const bytes = new Uint8Array(mockBuffer);
        const firstBytesHex = Array.from(bytes.slice(0, 8))
          .map((b) => "0x" + b.toString(16).padStart(2, "0"))
          .join(" ");

        this.lastProviderStatus = "mock_active";
        this.lastProviderStatusCode = 200;
        this.lastAudioSource = "FALLBACK_SYNTHETIC_AUDIO";

        console.log(
          `[rime-provider] Mock/Fallback synthesis completed [${requestId}]: HTTP 200, Content-Type: ${contentType}, Content-Length: ${mockBuffer.byteLength}, First bytes: [${firstBytesHex}], Total: ${mockBuffer.byteLength} bytes`
        );

        resolve({
          generationId,
          requestId,
          completedAt,
          status: "completed",
          audioBuffer: mockBuffer,
          audioData: mockBuffer,
          contentType,
          audioSource: "FALLBACK_SYNTHETIC_AUDIO",
          provider: "Rime (Mock)",
          model: request.model || "mist",
          voice: request.voice || "amber",
          latencyMs,
        });
      }, delayMs);

      // Clean up timer if aborted
      if (request.signal) {
        request.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
          },
          { once: true }
        );
      }
    });

    return Promise.race([workPromise, abortPromise]);
  }

  /**
   * Real Rime HTTP API synthesis execution.
   */
  private async synthesizeReal(
    request: VoiceProviderRequest,
    requestId: string,
    startedAt: number,
    timeoutMs: number
  ): Promise<VoiceProviderResult> {
    const generationId = request.generationId;
    const config = getRimeConfig();

    // Check configuration
    if (!config.isConfigured || !config.apiKey) {
      this.lastProviderStatus = "not_configured";
      this.lastProviderStatusCode = null;
      this.lastProviderError = "Rime API key is not configured on the server";
      this.lastAudioSource = null;

      return this.createFailureResult(
        generationId,
        requestId,
        startedAt,
        "NOT_CONFIGURED",
        "Rime API key is not configured on the server"
      );
    }

    const speaker = request.voice || config.voice;
    const model = request.model || config.model;
    const rawReqLang = request.language || config.language;
    const language = rawReqLang.toLowerCase() === "en" ? "eng" : rawReqLang;

    const payload = {
      speaker,
      text: request.text,
      modelId: model,
      samplingRate: 22050,
      speedAlpha: 1.0,
      audioFormat: config.audioFormat,
      lang: language,
    };

    // Prepare abort and timeout controller
    const internalAbortController = new AbortController();
    let isTimedOut = false;
    let isClientAborted = false;

    const timeoutId = setTimeout(() => {
      isTimedOut = true;
      internalAbortController.abort();
    }, timeoutMs);

    const onClientAbort = () => {
      isClientAborted = true;
      internalAbortController.abort();
    };

    if (request.signal) {
      if (request.signal.aborted) {
        clearTimeout(timeoutId);
        this.recordAudit(generationId, "provider_request_aborted", requestId);
        return {
          generationId,
          requestId,
          completedAt: Date.now(),
          status: "cancelled",
          errorCode: "ABORTED",
          error: "Request aborted before HTTP dispatch",
          latencyMs: Date.now() - startedAt,
        };
      }
      request.signal.addEventListener("abort", onClientAbort, { once: true });
    }

    try {
      this.lastProviderStatus = "fetching";

      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          Accept: config.audioFormat === "pcm" ? "audio/pcm" : "audio/mp3",
        },
        body: JSON.stringify(payload),
        signal: internalAbortController.signal,
      });

      clearTimeout(timeoutId);
      if (request.signal) {
        request.signal.removeEventListener("abort", onClientAbort);
      }

      if (!response.ok) {
        // Do not leak response headers or authorization
        const errorText = await response.text().catch(() => "Unknown error");
        const safeError = errorText.slice(0, 120).replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, "[REDACTED]");

        this.lastProviderStatus = "failed";
        this.lastProviderStatusCode = response.status;
        this.lastProviderError = `Rime API responded with status ${response.status}: ${safeError}`;
        this.lastAudioSource = null;

        console.warn(
          `[rime-provider] Real Rime API error response [${requestId}]: HTTP ${response.status} ${response.statusText}, Content-Type: ${response.headers.get("content-type")}, Error: ${safeError}`
        );

        let errorCode: VoiceProviderErrorCode = "PROVIDER_ERROR";
        if (response.status === 401 || response.status === 403) {
          errorCode = "NOT_CONFIGURED";
        } else if (response.status >= 500) {
          errorCode = "PROVIDER_ERROR";
        }

        return this.createFailureResult(
          generationId,
          requestId,
          startedAt,
          errorCode,
          `Rime API responded with status ${response.status}: ${safeError}`
        );
      }

      const audioBuffer = await response.arrayBuffer();

      if (!audioBuffer || audioBuffer.byteLength === 0) {
        this.lastProviderStatus = "failed";
        this.lastProviderStatusCode = response.status;
        this.lastProviderError = "Received empty audio buffer from Rime API";
        this.lastAudioSource = null;

        return this.createFailureResult(
          generationId,
          requestId,
          startedAt,
          "INVALID_RESPONSE",
          "Received empty audio buffer from Rime API"
        );
      }

      const completedAt = Date.now();
      const latencyMs = completedAt - startedAt;

      const rawContentType = response.headers.get("content-type") || "";
      const contentType =
        rawContentType === "audio/mp3" || rawContentType === "audio/mpeg" || config.audioFormat === "mp3"
          ? "audio/mpeg"
          : rawContentType || (config.audioFormat === "pcm" ? "audio/wav" : "audio/mpeg");

      const bytes = new Uint8Array(audioBuffer);
      const firstBytesHex = Array.from(bytes.slice(0, 8))
        .map((b) => "0x" + b.toString(16).padStart(2, "0"))
        .join(" ");

      this.lastProviderStatus = "connected";
      this.lastProviderStatusCode = response.status;
      this.lastProviderError = null;
      this.lastAudioSource = "REAL_RIME_AUDIO";

      console.log(
        `[rime-provider] Real Rime synthesis completed [${requestId}]: HTTP ${response.status}, Content-Type: ${contentType}, Content-Length: ${audioBuffer.byteLength}, First bytes: [${firstBytesHex}], Total: ${audioBuffer.byteLength} bytes, Latency: ${latencyMs}ms`
      );

      this.recordAudit(generationId, "provider_request_completed", requestId);

      return {
        generationId,
        requestId,
        completedAt,
        status: "completed",
        audioBuffer,
        audioData: audioBuffer,
        contentType,
        audioSource: "REAL_RIME_AUDIO",
        provider: "Rime",
        model,
        voice: speaker,
        latencyMs,
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (request.signal) {
        request.signal.removeEventListener("abort", onClientAbort);
      }

      if (isClientAborted || request.signal?.aborted) {
        this.recordAudit(generationId, "provider_request_aborted", requestId);
        return {
          generationId,
          requestId,
          completedAt: Date.now(),
          status: "cancelled",
          errorCode: "ABORTED",
          error: "Request aborted by client",
          latencyMs: Date.now() - startedAt,
        };
      }

      if (isTimedOut) {
        this.lastProviderStatus = "timeout";
        this.lastProviderStatusCode = 408;
        this.lastProviderError = `Rime API request timed out after ${timeoutMs}ms`;
        this.lastAudioSource = null;

        this.recordAudit(generationId, "provider_request_timeout", requestId);
        return {
          generationId,
          requestId,
          completedAt: Date.now(),
          status: "failed",
          errorCode: "TIMEOUT",
          error: `Rime API request timed out after ${timeoutMs}ms`,
          latencyMs: timeoutMs,
        };
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      const isNetworkError =
        errMsg.toLowerCase().includes("fetch failed") ||
        errMsg.toLowerCase().includes("econnrefused") ||
        errMsg.toLowerCase().includes("network");

      const errorCode: VoiceProviderErrorCode = isNetworkError
        ? "NETWORK_ERROR"
        : "UNKNOWN";

      this.lastProviderStatus = "failed";
      this.lastProviderStatusCode = null;
      this.lastProviderError = `Rime transport failure: ${errMsg.slice(0, 100)}`;
      this.lastAudioSource = null;

      return this.createFailureResult(
        generationId,
        requestId,
        startedAt,
        errorCode,
        `Rime transport failure: ${errMsg.slice(0, 100)}`
      );
    }
  }

  /**
   * Helper to construct safe, normalized failure results.
   */
  private createFailureResult(
    generationId: number,
    requestId: string,
    startedAt: number,
    errorCode: VoiceProviderErrorCode,
    message: string
  ): VoiceProviderResult {
    const completedAt = Date.now();
    const latencyMs = completedAt - startedAt;

    this.recordAudit(
      generationId,
      "provider_request_failed",
      requestId,
      `errorCode: ${errorCode}, error: ${message}`
    );

    return {
      generationId,
      requestId,
      completedAt,
      status: "failed",
      errorCode,
      error: message,
      latencyMs,
    };
  }

  private recordAudit(
    generationId: number,
    event:
      | "provider_request_started"
      | "provider_request_completed"
      | "provider_request_aborted"
      | "provider_request_timeout"
      | "provider_request_failed",
    requestId: string,
    details?: string
  ): void {
    try {
      generationAudit.record(
        generationId,
        event,
        generationId,
        "RimeProviderAdapter",
        `[${requestId}] ${details || ""}`.trim()
      );
    } catch {
      // Non-fatal
    }
  }

  /**
   * Generates a guaranteed valid, standards-compliant WAV PCM audio buffer for mock and fallback execution.
   * Begins with 'RIFF' (0x52, 0x49, 0x46, 0x46) and contains 'WAVE' (0x57, 0x41, 0x56, 0x45).
   * Generates audible, gentle 440 Hz sine wave samples in standard 16-bit PCM (22050 Hz, mono).
   * 100% playable natively by HTML5 Audio elements and Web Audio API across all browsers without codecs.
   */
  public createSyntheticAudioBuffer(text: string): ArrayBuffer {
    const durationSeconds = Math.min(2.0, Math.max(0.3, text.length * 0.04));
    const sampleRate = 22050;
    const numChannels = 1;
    const bitsPerSample = 16;
    const numSamples = Math.floor(sampleRate * durationSeconds);
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // 1. "RIFF" chunk descriptor
    view.setUint32(0, 0x52494646, false); // "RIFF" in big-endian
    view.setUint32(4, 36 + dataSize, true); // Total file size minus 8
    view.setUint32(8, 0x57415645, false); // "WAVE" in big-endian

    // 2. "fmt " subchunk
    view.setUint32(12, 0x666d7420, false); // "fmt " in big-endian
    view.setUint32(16, 16, true); // Subchunk1Size = 16 for PCM
    view.setUint16(20, 1, true); // AudioFormat = 1 (linear PCM)
    view.setUint16(22, numChannels, true); // NumChannels = 1 (mono)
    view.setUint32(24, sampleRate, true); // SampleRate = 22050 Hz
    view.setUint32(28, byteRate, true); // ByteRate = 44100
    view.setUint16(32, blockAlign, true); // BlockAlign = 2
    view.setUint16(34, bitsPerSample, true); // BitsPerSample = 16

    // 3. "data" subchunk
    view.setUint32(36, 0x64617461, false); // "data" in big-endian
    view.setUint32(40, dataSize, true); // Subchunk2Size = numSamples * 2

    // 4. 16-bit PCM audio samples (440 Hz soft sine wave with gentle envelope)
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      // Gentle attack and decay envelope to prevent pops
      const envelope = Math.sin((Math.PI * i) / numSamples);
      const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.25 * envelope;
      const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
      view.setInt16(offset, intSample, true);
      offset += 2;
    }

    return buffer;
  }
}

// Global default singleton instance
export const rimeProviderAdapter = new RimeProviderAdapter();
