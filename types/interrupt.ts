import type { GenerationId } from "./generation";

export type InterruptReason =
  | "user_barge_in"
  | "user_click"
  | "session_abort"
  | "test_simulation";

export type AudioStopResult = {
  stopped: boolean;
  stopLatencyMs: number;
  timestamp: number;
  playbackPositionSeconds?: number;
};

export type InterruptResult = {
  interruptedGenerationId: GenerationId;
  audioStopped: boolean;
  audioStopLatencyMs: number;
  asyncAborted: boolean;
  timestamp: number;
  reason: InterruptReason;
  recoveryTimeMs: number;
};

export type InterruptMetrics = {
  interruptionCount: number;
  lastInterruptedGeneration: GenerationId | null;
  lastAudioStopLatencyMs: number | null;
  lastRecoveryTimeMs: number | null;
  lastInterruptTimestamp: number | null;
  lastReason?: InterruptReason;
};

export type InterruptEvidenceData = {
  metrics: InterruptMetrics;
  history: InterruptResult[];
};
