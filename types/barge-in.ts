/**
 * types/barge-in.ts
 * Strongly typed contracts for Step 14 Real Barge-In Detection.
 */

export type BargeInErrorCode =
  | "MICROPHONE_UNAVAILABLE"
  | "MICROPHONE_PERMISSION_DENIED"
  | "MICROPHONE_ACCESS_FAILED"
  | "AUDIO_CONTEXT_UNAVAILABLE"
  | "AUDIO_ANALYSER_UNAVAILABLE"
  | "BARGE_IN_DETECTION_FAILED";

export interface BargeInConfig {
  enabled: boolean;
  threshold: number;             // Audio energy / RMS threshold (0.0 to 1.0)
  minActiveDurationMs: number;   // Minimum sustained speech before confirmation
  cooldownMs: number;            // Cooldown between barge-in triggers
  sampleIntervalMs: number;      // Level polling interval
}

export type BargeInEvent = {
  id: string;
  generationId: number;
  timestamp: number;
  level: number;
  durationMs: number;
  confirmed: boolean;
  interrupted: boolean;
  stale: boolean;
};

export type BargeInOutcome =
  | {
      kind: "interrupted";
      targetGenerationId: number;
      detectedLevel: number;
      activeDurationMs: number;
      timestamp: number;
    }
  | {
      kind: "stale_ignored";
      targetGenerationId: number;
      activeGenerationId: number;
      detectedLevel: number;
      timestamp: number;
      reason: "TARGET_GENERATION_SUPERSEDED";
    }
  | {
      kind: "suppressed_duplicate";
      targetGenerationId: number;
      detectedLevel: number;
      timestamp: number;
      reason: "COOLDOWN_ACTIVE";
    }
  | {
      kind: "insufficient_duration";
      targetGenerationId: number;
      detectedLevel: number;
      durationMs: number;
      timestamp: number;
    }
  | {
      kind: "below_threshold";
      targetGenerationId: number;
      detectedLevel: number;
      timestamp: number;
    }
  | {
      kind: "failed";
      errorCode: BargeInErrorCode;
      error: string;
      timestamp: number;
    };
