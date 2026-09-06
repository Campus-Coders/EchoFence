/**
 * lib/measurement-types.ts
 * Strongly typed measurement contracts for EchoFence.
 *
 * Defines the canonical snapshot structure, sub-metric categories,
 * and historical run records.
 */

export interface InterruptionMeasurement {
  count: number;
  detectionLatencyMs: number | null;
  abortLatencyMs: number | null;
  audioStopLatencyMs: number | null;
  totalInterruptionToSilenceMs: number | null;
}

export interface RecoveryMeasurement {
  recoveryTimeMs: number | null;
  generationSwitchTimeMs: number | null;
}

export interface GenerationMeasurement {
  activeGeneration: number | null;
  generationsStarted: number;
  generationsCompleted: number;
  generationsInterrupted: number;
}

export interface StaleResultsMeasurement {
  attempted: number;
  blocked: number;
  protectionRate: number;
}

export interface TranscriptMeasurement {
  corruptionCount: number;
  staleAssistantMessagesBlocked: number;
}

export interface AudioMeasurement {
  resurrectionCount: number;
  staleAudioStartsBlocked: number;
  decodeLatencyMs?: number | null;
  startLatencyMs?: number | null;
  stopLatencyMs?: number | null;
  activeGeneration?: number | null;
}

export interface FenceMeasurement {
  active: boolean;
  staleBlockedCount: number;
}

export interface BargeInMeasurement {
  detectedCount: number;
  confirmedCount: number;
  interruptTriggeredCount: number;
  staleIgnoredCount: number;
  falseDuplicateSuppressedCount: number;
  detectionLatencyMs: number | null;
  interruptLatencyMs: number | null;
  microphoneErrors: number;
}

export interface StreamingAudioMeasurement {
  streamingChunksReceived: number;
  streamingChunksAccepted: number;
  streamingChunksRejected: number;
  staleChunksBlocked: number;
  duplicateChunksSuppressed: number;
  outOfOrderChunksBuffered: number;
  chunksDecoded: number;
  chunksPlayed: number;
  queuedChunksCancelled: number;
  activeStreams: number;
  completedStreams: number;
  cancelledStreams: number;
  streamInterruptLatencyMs: number | null;
  chunkDecodeLatencyMs: number | null;
  chunkStartLatencyMs: number | null;
  streamRaceFailures: number;
}

import type { ChaosMeasurement } from "@/types/chaos";
export type { ChaosMeasurement };

export interface MeasurementSnapshot {
  sessionId: string;
  generatedAt: number;
  interruption: InterruptionMeasurement;
  recovery: RecoveryMeasurement;
  generation: GenerationMeasurement;
  staleResults: StaleResultsMeasurement;
  transcript: TranscriptMeasurement;
  audio: AudioMeasurement;
  fence: FenceMeasurement;
  bargeIn: BargeInMeasurement;
  streamingAudio: StreamingAudioMeasurement;
  chaos: ChaosMeasurement;
}

export interface MeasurementRun {
  runId: string;
  startedAt: number;
  completedAt: number | null;
  snapshot: MeasurementSnapshot;
}

export type MeasurementListener = (snapshot: MeasurementSnapshot) => void;
