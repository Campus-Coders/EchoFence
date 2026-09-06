/**
 * Explicit voice states for EchoFence state machine.
 */
export type VoiceState =
  | "IDLE"
  | "LISTENING"
  | "THINKING"
  | "SPEAKING"
  | "INTERRUPTED"
  | "RECOVERING";

export type VoiceEventType =
  | "user_turn_started"
  | "user_turn_final"
  | "assistant_started"
  | "assistant_spoken"
  | "audio_playback_started"
  | "audio_playback_finished"
  | "state_transition"
  | "error";

export type VoiceEvent = {
  id: string;
  sessionId: string;
  generationId: number;
  type: VoiceEventType;
  timestamp: number;
  metadata?: Record<string, string | number | boolean | null>;
};

/**
 * Transition rules defining strictly permitted transitions between VoiceStates.
 */
export const VALID_VOICE_TRANSITIONS: Readonly<Record<VoiceState, readonly VoiceState[]>> = {
  IDLE: ["LISTENING", "THINKING"],
  LISTENING: ["THINKING", "IDLE"],
  THINKING: ["SPEAKING", "INTERRUPTED", "IDLE"],
  SPEAKING: ["IDLE", "INTERRUPTED"],
  INTERRUPTED: ["RECOVERING", "LISTENING", "IDLE"],
  RECOVERING: ["LISTENING", "IDLE"],
} as const;
