import type { GenerationId } from "./generation";

export type StreamingAudioChunkStatus =
  | "received"
  | "buffered"
  | "decoded"
  | "playing"
  | "completed"
  | "stale_blocked"
  | "duplicate_suppressed"
  | "cancelled"
  | "rejected";

export type AudioStreamErrorCode =
  | "STREAM_STALE_GENERATION"
  | "STREAM_ALREADY_INTERRUPTED"
  | "STREAM_DUPLICATE_CHUNK"
  | "STREAM_DECODE_FAILED"
  | "STREAM_START_FAILED"
  | "STREAM_AUDIO_CONTEXT_UNAVAILABLE"
  | "STREAM_CANCELLED"
  | "STREAM_INVALID_CHUNK";

export interface StreamingAudioChunk {
  generationId: GenerationId;
  requestId: string;
  streamId: string;
  chunkId: string;
  sequenceNumber: number;
  isLastChunk?: boolean;
  audioData: ArrayBuffer;
  timestamp?: number;
}

export interface StreamPlaybackOutcome {
  kind:
    | "accepted"
    | "queued"
    | "playing"
    | "completed"
    | "stale_blocked"
    | "duplicate_suppressed"
    | "cancelled"
    | "failed";
  chunkId: string;
  generationId: GenerationId;
  streamId: string;
  sequenceNumber: number;
  error?: string;
  errorCode?: AudioStreamErrorCode;
  timestamp: number;
}

export interface StreamCancellationOutcome {
  generationId: GenerationId;
  streamId?: string;
  cancelledCount: number;
  activeChunkStopped: boolean;
  latencyMs: number;
  timestamp: number;
}

export interface StreamPlaybackHandle {
  chunkId: string;
  generationId: GenerationId;
  streamId: string;
  sequenceNumber: number;
  sourceNode: AudioBufferSourceNode | null;
  startedAt: number;
  stopped: boolean;
}

export interface StreamState {
  generationId: GenerationId;
  requestId: string;
  streamId: string;
  nextExpectedSequence: number;
  bufferedChunks: Map<number, StreamingAudioChunk>;
  decodedBuffers: Map<number, AudioBuffer>;
  seenChunkIds: Set<string>;
  activeHandle: StreamPlaybackHandle | null;
  isLastReceived: boolean;
  isCompleted: boolean;
  isCancelled: boolean;
  startedAt: number;
}
