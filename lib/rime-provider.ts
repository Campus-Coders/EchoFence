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
  private mode: "real" | "mock";
  private defaultTimeoutMs: number;
  private mockLatencyMs: number;
  private mockFailureCode?: VoiceProviderErrorCode;

  constructor(options?: RimeProviderOptions) {
    const envMode = process.env.RIME_PROVIDER_MODE?.toLowerCase().trim();
    this.mode =
      options?.mode ??
      (envMode === "mock" ? "mock" : envMode === "real" ? "real" : "mock");
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 8000;
    this.mockLatencyMs = options?.mockLatencyMs ?? 25;
    this.mockFailureCode = options?.mockFailureCode;
  }

  public getMode(): "real" | "mock" {
    return this.mode;
  }

  public setMode(mode: "real" | "mock"): void {
    this.mode = mode;
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
    if (this.mode === "mock") {
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
        // Generate deterministic synthetic audio buffer (WAV header or test MP3 frames)
        const mockBuffer = this.createSyntheticAudioBuffer(request.text);
        const completedAt = Date.now();
        const latencyMs = completedAt - startedAt;

        this.recordAudit(generationId, "provider_request_completed", requestId);

        resolve({
          generationId,
          requestId,
          completedAt,
          status: "completed",
          audioBuffer: mockBuffer,
          audioData: mockBuffer,
          contentType: "audio/mpeg",
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
    const language = request.language || config.language;

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

      this.recordAudit(generationId, "provider_request_completed", requestId);

      return {
        generationId,
        requestId,
        completedAt,
        status: "completed",
        audioBuffer,
        audioData: audioBuffer,
        contentType:
          response.headers.get("content-type") ||
          (config.audioFormat === "pcm" ? "audio/pcm" : "audio/mpeg"),
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
   * Generates a deterministic synthetic audio buffer for mock execution.
   */
  private createSyntheticAudioBuffer(text: string): ArrayBuffer {
    const headerBytes = [0xff, 0xfb, 0x90, 0x64]; // MP3 frame header
    const payloadLength = Math.min(1024, Math.max(128, text.length * 16));
    const buffer = new ArrayBuffer(headerBytes.length + payloadLength);
    const view = new Uint8Array(buffer);

    for (let i = 0; i < headerBytes.length; i++) {
      view[i] = headerBytes[i] ?? 0;
    }
    for (let i = headerBytes.length; i < view.length; i++) {
      view[i] = (i * 31 + text.charCodeAt(i % text.length)) % 256;
    }

    return buffer;
  }
}

// Global default singleton instance
export const rimeProviderAdapter = new RimeProviderAdapter();
