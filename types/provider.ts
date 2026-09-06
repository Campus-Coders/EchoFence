/**
 * Speech provider abstraction contracts.
 * Allows EchoFence to decouple TTS providers from orchestrator and UI layers.
 */

export type SpeechSynthesisRequest = {
  text: string;
  generationId?: number;
  voice?: string;
  model?: string;
  language?: string;
};

export type SpeechSynthesisResult = {
  audioBuffer: ArrayBuffer;
  contentType: string;
  provider: string;
  model: string;
  voice: string;
  durationMs?: number;
};

export type VoiceProviderErrorCode =
  | "NOT_CONFIGURED"
  | "ABORTED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "PROVIDER_ERROR"
  | "INVALID_RESPONSE"
  | "UNKNOWN";

export type SafeProviderStatus = {
  configured: boolean;
  provider: string;
  mode?: "real" | "mock";
  selectedModel: string;
  selectedVoice: string;
  language: string;
  audioFormat: string;
  transport: string;
  note?: string;
};

export interface SpeechProvider {
  readonly id: string;
  readonly name: string;
  getStatus(): SafeProviderStatus;
  synthesize(request: SpeechSynthesisRequest): Promise<SpeechSynthesisResult>;
}

/**
 * Phase 3 Rime provider integration contracts.
 * Enforces monotonic generation attachment and async lifecycle status tracking.
 */
export interface VoiceProviderRequest {
  generationId: number;
  requestId: string;
  text: string;
  startedAt: number;
  signal?: AbortSignal;
  model?: string;
  voice?: string;
  language?: string;
}

export interface VoiceProviderResult {
  generationId: number;
  requestId: string;
  completedAt: number;
  status: "completed" | "cancelled" | "failed";
  audioBuffer?: ArrayBuffer;
  audioData?: ArrayBuffer | string;
  contentType?: string;
  provider?: string;
  model?: string;
  voice?: string;
  latencyMs?: number;
  errorCode?: VoiceProviderErrorCode;
  error?: string;
}

export interface AuthorizedSynthesisResult {
  authorized: true;
  generationId: number;
  requestId: string;
  audioBuffer: ArrayBuffer;
  audioData?: ArrayBuffer | string;
  contentType: string;
  provider: string;
  model?: string;
  voice?: string;
  providerLatencyMs: number;
  authorizedAt: number;
}

export type GenerationAwareSynthesisOutcome =
  | {
      kind: "authorized";
      result: AuthorizedSynthesisResult;
    }
  | {
      kind: "stale";
      generationId: number;
      requestId: string;
      reason: "STALE_GENERATION";
      blockedAt: number;
      activeGeneration: number;
    }
  | {
      kind: "cancelled";
      generationId: number;
      requestId: string;
      reason: string;
      cancelledAt: number;
    }
  | {
      kind: "failed";
      generationId: number;
      requestId: string;
      errorCode?: VoiceProviderErrorCode;
      error: string;
      failedAt: number;
    };

export type AudioPlaybackErrorCode =
  | "AUDIO_CONTEXT_UNAVAILABLE"
  | "AUDIO_CONTEXT_RESUME_FAILED"
  | "AUDIO_DECODE_FAILED"
  | "AUDIO_START_FAILED"
  | "AUDIO_STOP_FAILED"
  | "UNKNOWN";

export type AudioPlaybackOutcome =
  | {
      kind: "started";
      generationId: number;
      requestId: string;
      startedAt: number;
      durationSeconds?: number;
    }
  | {
      kind: "completed";
      generationId: number;
      requestId: string;
      completedAt: number;
    }
  | {
      kind: "blocked";
      generationId: number;
      requestId: string;
      reason:
        | "PRE_PLAYBACK_STALE"
        | "PRE_START_STALE"
        | "STALE_DURING_DECODE"
        | "STALE_PLAYBACK_ATTEMPT"
        | "UNAUTHORIZED_INPUT";
      blockedAt: number;
      activeGeneration: number;
    }
  | {
      kind: "stopped";
      generationId: number;
      requestId?: string;
      stoppedAt: number;
      reason: "INTERRUPTED" | "SUPERSEDED" | "MANUAL";
    }
  | {
      kind: "failed";
      generationId: number;
      requestId: string;
      errorCode: AudioPlaybackErrorCode;
      error: string;
      failedAt: number;
    };

export interface PlaybackHandle {
  generationId: number;
  requestId: string;
  source: AudioBufferSourceNode;
  audioBuffer: AudioBuffer;
  startedAt: number;
  stopped: boolean;
  onEndedCleanup?: () => void;
}

