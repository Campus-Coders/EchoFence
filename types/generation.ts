/**
 * Generation Fence and Audit types.
 */

export type GenerationId = number;

export type GenerationStatus =
  | "active"
  | "completed"
  | "stale"
  | "invalidated"
  | "rejected";

export type GenerationAuditEventType =
  | "generation_started"
  | "generation_completed"
  | "generation_invalidated"
  | "stale_result_blocked"
  | "stale_audio_blocked"
  | "stale_state_transition_blocked"
  | "interruption_requested"
  | "audio_stop_requested"
  | "audio_stopped"
  | "async_work_aborted"
  | "generation_interrupted"
  | "interruption_recovery_started"
  | "interruption_recovered"
  | "tool_started"
  | "tool_completed"
  | "tool_completed_late"
  | "stale_tool_result_blocked"
  | "provider_request_started"
  | "provider_request_completed"
  | "provider_request_aborted"
  | "provider_request_timeout"
  | "provider_request_failed"
  | "synthesis_request_started"
  | "synthesis_result_authorized"
  | "stale_synthesis_result_blocked"
  | "audio_decode_started"
  | "audio_decode_completed"
  | "audio_playback_started"
  | "audio_playback_stopped"
  | "stale_audio_start_blocked"
  | "audio_playback_failed"
  | "barge_in_monitoring_started"
  | "barge_in_monitoring_stopped"
  | "barge_in_activity_detected"
  | "barge_in_confirmed"
  | "barge_in_interrupt_triggered"
  | "stale_barge_in_ignored"
  | "barge_in_detection_failed"
  | "audio_stream_started"
  | "audio_stream_chunk_received"
  | "audio_stream_chunk_buffered"
  | "audio_stream_chunk_decoded"
  | "audio_stream_chunk_playback_started"
  | "audio_stream_chunk_playback_completed"
  | "audio_stream_chunk_rejected"
  | "stale_audio_chunk_blocked"
  | "duplicate_audio_chunk_suppressed"
  | "audio_stream_interrupted"
  | "audio_stream_cancelled"
  | "stale_stream_completion_ignored"
  | "audio_stream_failed"
  | "chaos_scenario_started"
  | "chaos_fault_injected"
  | "chaos_network_fault"
  | "chaos_audio_fault"
  | "chaos_stream_fault"
  | "chaos_interrupt_fault"
  | "chaos_lifecycle_fault"
  | "chaos_fault_recovered"
  | "chaos_safe_failure"
  | "chaos_unsafe_failure"
  | "chaos_scenario_completed";

export type GenerationAuditEvent = {
  id: string;
  generationId: GenerationId;
  event: GenerationAuditEventType;
  timestamp: number;
  currentGeneration: GenerationId;
  stale: boolean;
  source?: string;
  details?: string;
};

export type DelayedToolMetrics = {
  delayedToolRuns: number;
  delayedToolCompletions: number;
  lateToolCompletions: number;
  staleToolResultsBlocked: number;
};

export type GenerationEvidenceData = {
  activeGeneration: GenerationId;
  staleResultsBlocked: number;
  toolMetrics?: DelayedToolMetrics;
  events: GenerationAuditEvent[];
};
