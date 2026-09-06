/**
 * types/evidence.ts
 * Strongly typed contracts for the EchoFence Judge-Facing Evidence Layer.
 *
 * Core Principle:
 *   EVIDENCE MUST BE DERIVED, NOT PERFORMED.
 *   CHAOS MAY BREAK EXECUTION.
 *   CHAOS MUST NOT BREAK OWNERSHIP.
 */

import type { ResourceLeakReport, ChaosScenario, ChaosExecutionRecord } from "./chaos";
import type { MeasurementSnapshot, MeasurementRun } from "@/lib/measurement-types";
import type { RaceDemoResult } from "@/lib/race-demo-controller";

export type InvariantStatus = "PASS" | "FAIL";
export type ScenarioOutcome = "SAFE" | "UNSAFE" | "INCOMPLETE";
export type AuthorityState = "AUTHORITATIVE" | "INTERRUPTED" | "STALE" | "COMPLETED";

export interface SystemStatusMetrics {
  currentGeneration: number;
  generationAuthorityStatus: "ACTIVE" | "IDLE" | "INTERRUPTED" | "RECOVERING";
  activeAudioPlaybackCount: number;
  activeStreamingCount: number;
  activeAbortControllerCount: number;
  microphoneMonitoringState: "LISTENING" | "SPEAKING" | "IDLE" | "MUTED";
  staleResultAttempts: number;
  staleResultsBlocked: number;
  staleResultProtectionRate: number; // 0..100
  audioResurrectionCount: number;
  transcriptCorruptionCount: number;
  resourceLeakCount: number;
  chaosSafetyRate: number; // 0..100
  timestamp: number;
}

export interface MachineInvariantCheck {
  id: string;
  name: string;
  description: string;
  principle: string;
  status: InvariantStatus;
  observedValue: string | number;
  threshold: string;
  formula: string;
}

export interface TimelineGenerationEvent {
  id: string;
  generationId: number;
  timestamp: number;
  relativeOffsetMs: number;
  eventType: string;
  authorityState: AuthorityState;
  allowed: boolean;
  blockingReason?: string;
  source: string;
  details?: string;
}

export interface DemoScenarioCard {
  id: string;
  scenarioNumber: number;
  name: string;
  fault: string;
  injectionPoint: string;
  preState: string;
  failureEvent: string;
  protectionMechanism: string;
  newerGenerationState: string;
  outcome: ScenarioOutcome;
  scenario: ChaosScenario;
  lastRecord?: ChaosExecutionRecord;
}

export interface JudgeDashboardPayload {
  systemStatus: SystemStatusMetrics;
  invariants: MachineInvariantCheck[];
  allInvariantsPassed: boolean;
  timeline: TimelineGenerationEvent[];
  scenarios: DemoScenarioCard[];
  resourceLeaks: ResourceLeakReport;
  measurement: MeasurementSnapshot;
  runs: MeasurementRun[];
  raceDemo?: RaceDemoResult;
  timestamp: number;
  demoModeEnabled: boolean;
}

export interface ChaosRunRequest {
  scenarioId: string;
}

export interface ChaosRunResponse {
  success: boolean;
  scenarioId: string;
  outcome: ScenarioOutcome;
  record: ChaosExecutionRecord;
  leaks: ResourceLeakReport;
  timestamp: number;
  error?: string;
}
