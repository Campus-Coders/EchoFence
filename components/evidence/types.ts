/**
 * components/evidence/types.ts
 * Type definitions for the Step 9 Unified Evidence Dashboard.
 */

import type { MeasurementSnapshot, MeasurementRun } from "@/lib/measurement-types";
import type { GenerationEvidenceData } from "@/types/generation";
import type { InterruptEvidenceData } from "@/types/interrupt";
import type { RaceDemoResult } from "@/lib/race-demo-controller";
import type { JudgeDashboardPayload } from "@/types/evidence";

export type OverallVerdictStatus = "NOT_RUN" | "RUNNING" | "PASS" | "FAIL";

export interface DashboardVerdict {
  status: OverallVerdictStatus;
  headline: string;
  subhead: string;
  evaluatedAt: number;
}

export interface DashboardData {
  verdict: DashboardVerdict;
  measurement: MeasurementSnapshot;
  generation: GenerationEvidenceData;
  interrupt: InterruptEvidenceData;
  runs: MeasurementRun[];
  raceDemo?: RaceDemoResult;
  generatedAt: number;
  judge?: JudgeDashboardPayload;
}
