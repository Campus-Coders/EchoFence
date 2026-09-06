/**
 * types/chaos.ts
 * Strongly typed contracts for EchoFence Chaos Engineering & Fault Injection.
 *
 * Core Principle:
 *   CHAOS MAY BREAK EXECUTION.
 *   CHAOS MUST NOT BREAK OWNERSHIP.
 *   FAILURE != LOSS OF GENERATION AUTHORITY.
 */

export type FaultType =
  | "NETWORK_DELAY"
  | "NETWORK_TIMEOUT"
  | "NETWORK_FAILURE"
  | "ABORT_RACE"
  | "DUPLICATE_RESPONSE"
  | "STALE_RESPONSE"
  | "MALFORMED_AUDIO"
  | "AUDIO_DECODE_FAILURE"
  | "STREAM_REORDER"
  | "STREAM_DUPLICATION"
  | "STREAM_DROP"
  | "INTERRUPT_STORM"
  | "RAPID_GENERATION_ADVANCEMENT"
  | "LATE_COMPLETION"
  | "COMPONENT_UNMOUNT"
  | "RESOURCE_CLEANUP_RACE";

export type FaultInjectionPoint =
  | "before_network_request"
  | "during_network_request"
  | "after_network_response"
  | "before_audio_decode"
  | "during_audio_decode"
  | "after_audio_decode"
  | "before_source_start"
  | "during_streaming"
  | "during_barge_in"
  | "component_lifecycle";

export interface FaultContext {
  generationId?: number;
  requestId?: string;
  streamId?: string;
  chunkIndex?: number;
  point: FaultInjectionPoint;
  data?: unknown;
}

export interface FaultPlanItem {
  point: FaultInjectionPoint;
  fault: FaultType;
  generationId?: number;
  delayMs?: number;
  parameters?: Record<string, unknown>;
  triggerCondition?: (context: FaultContext) => boolean;
}

export type FaultPlan = FaultPlanItem[];

export interface FaultOutcome {
  injected: boolean;
  faultType?: FaultType;
  point: FaultInjectionPoint;
  actionTaken: string;
  safeRecovery: boolean;
  timestamp: number;
  error?: string;
}

export interface ChaosScenario {
  id: string;
  name: string;
  description: string;
  plan: FaultPlan;
  expectedOutcome: {
    audioResurrectionCount: 0;
    transcriptCorruptionCount: 0;
    staleProtectionRate: 100;
    chaosSafetyRate: 100;
    resourceLeaksDetected: 0;
  };
}

export interface ChaosExecutionRecord {
  scenarioId: string;
  startedAt: number;
  completedAt: number;
  faultsInjected: number;
  faultsRecovered: number;
  outcomes: FaultOutcome[];
  passed: boolean;
  invariantsPreserved: boolean;
  error?: string;
}

export interface ChaosMeasurement {
  scenariosExecuted: number;
  faultsInjected: number;
  faultsRecovered: number;
  safeFailures: number;
  unsafeFailures: number;

  networkFaults: number;
  audioFaults: number;
  streamingFaults: number;
  interruptionFaults: number;
  lifecycleFaults: number;

  staleResultsBlockedDuringChaos: number;

  resourceLeaksDetected: number;
  unhandledErrorsDetected: number;

  chaosSafetyRate: number;
}

export interface ResourceLeakReport {
  hasLeaks: boolean;
  activeAudioNodes: number;
  activeAudioNodesStale: number;
  activeStreams: number;
  staleActiveStreams: number;
  activeAbortControllers: number;
  staleAbortControllers: number;
  activeMicrophoneTracks: number;
  details: string[];
}

export interface ChaosRunSummary {
  scenariosExecuted: number;
  scenariosPassed: number;
  scenariosFailed: number;
  totalFaultsInjected: number;
  totalFaultsRecovered: number;
  safeFailures: number;
  unsafeFailures: number;
  resourceLeaksDetected: number;
  unhandledErrorsDetected: number;
  chaosSafetyRate: number;
  records: ChaosExecutionRecord[];
}
