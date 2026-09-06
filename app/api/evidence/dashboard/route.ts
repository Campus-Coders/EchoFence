import { NextResponse } from "next/server";
import { measurementPipeline } from "@/lib/measurement-pipeline";
import { generationAudit } from "@/lib/generation-audit";
import { interruptController } from "@/lib/interrupt-controller";
import { raceDemoController } from "@/lib/race-demo-controller";
import { evidenceProjection } from "@/lib/evidence-projection";
import type { DashboardData, DashboardVerdict, OverallVerdictStatus } from "@/components/evidence/types";

/**
 * GET /api/evidence/dashboard
 * Aggregates all authoritative runtime evidence into one unified dashboard payload.
 * Strictly sanitized: zero credentials, API keys, or private tokens exposed.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const measurement = measurementPipeline.getSnapshot();
    const generation = generationAudit.getEvidenceData();
    const interruptMetrics = interruptController.getMetrics();
    const interruptHistory = interruptController.getHistory();
    const runs = measurementPipeline.getHistory();
    const raceDemo = raceDemoController.getState();

    // Determine authoritative system verdict
    let status: OverallVerdictStatus = "NOT_RUN";
    let headline = "NO STRESS RUN RECORDED";
    let subhead = "Run the full race demo to evaluate system invariants and latency metrics.";

    const isRunning =
      raceDemo.status === "RUNNING" ||
      raceDemo.status === "WAITING_FOR_LATE_RESULT";

    if (isRunning) {
      status = "RUNNING";
      headline = "EVALUATION IN PROGRESS";
      subhead = "Generation 1 delayed tool active; awaiting barge-in and stale result boundary.";
    } else {
      const hasCompletedRun = runs.length > 0 || raceDemo.status === "PASSED" || raceDemo.status === "FAILED";
      const hasExecutedTurn = measurement.generation.generationsStarted > 0;

      if (!hasCompletedRun && !hasExecutedTurn) {
        status = "NOT_RUN";
        headline = "NO RUN EVALUATED YET";
        subhead = "Execute the deterministic race demo to observe real-time fence interception.";
      } else {
        const hasViolations =
          !measurement.fence.active ||
          measurement.transcript.corruptionCount > 0 ||
          measurement.audio.resurrectionCount > 0 ||
          (measurement.staleResults.attempted > 0 &&
            measurement.staleResults.blocked < measurement.staleResults.attempted) ||
          raceDemo.status === "FAILED";

        if (hasViolations) {
          status = "FAIL";
          headline = "INVARIANT VIOLATION DETECTED";
          subhead = "One or more invariants failed during execution. Inspect the integrity scoreboard.";
        } else if (hasCompletedRun && raceDemo.status === "PASSED") {
          status = "PASS";
          headline = "ALL SYSTEM INVARIANTS PASSED";
          subhead = "Stale async results blocked with 0% transcript corruption and 0 audio resurrections.";
        } else if (hasCompletedRun || measurement.staleResults.blocked > 0) {
          status = "PASS";
          headline = "ALL SYSTEM INVARIANTS PASSED";
          subhead = "Generation Fence verified: 100% protection rate across active turns.";
        } else {
          status = "NOT_RUN";
          headline = "AWAITING FULL RACE DEMO";
          subhead = "Partial turns observed. Trigger the full race demo for complete verification.";
        }
      }
    }

    const verdict: DashboardVerdict = {
      status,
      headline,
      subhead,
      evaluatedAt: Date.now(),
    };

    const responseData: DashboardData = {
      verdict,
      measurement,
      generation,
      interrupt: {
        metrics: interruptMetrics,
        history: interruptHistory,
      },
      runs,
      raceDemo,
      judge: evidenceProjection.getJudgeDashboardPayload(),
      generatedAt: Date.now(),
    };

    return NextResponse.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error("[evidence/dashboard] Error aggregating dashboard evidence:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to retrieve unified evidence dashboard data",
      },
      { status: 500 }
    );
  }
}
