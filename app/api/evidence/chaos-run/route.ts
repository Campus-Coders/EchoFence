/**
 * app/api/evidence/chaos-run/route.ts
 * POST /api/evidence/chaos-run
 * Deterministic Live Chaos Scenario Runner for Judge Demos.
 *
 * Core Principle:
 *   CHAOS MAY BREAK EXECUTION.
 *   CHAOS MUST NOT BREAK OWNERSHIP.
 *   FAILURE != LOSS OF GENERATION AUTHORITY.
 *
 * Requirements:
 * 1. Safe development/demo runner: executes explicit deterministic fault scenarios.
 * 2. Uses ChaosController and GenerationFence singletons.
 * 3. Returns explicit SAFE / UNSAFE / INCOMPLETE classification.
 * 4. Zero credentials, API keys, or private tokens exposed.
 */

import { NextResponse } from "next/server";
import { evidenceProjection } from "@/lib/evidence-projection";
import type { ChaosRunRequest, ChaosRunResponse } from "@/types/evidence";

export async function POST(req: Request): Promise<NextResponse> {
  try {
    let body: ChaosRunRequest;
    try {
      body = (await req.json()) as ChaosRunRequest;
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON request body" },
        { status: 400 }
      );
    }

    const { scenarioId } = body;
    if (!scenarioId || typeof scenarioId !== "string") {
      return NextResponse.json(
        { success: false, error: "scenarioId is required" },
        { status: 400 }
      );
    }

    const result = await evidenceProjection.runScenario(scenarioId);

    const responseData: ChaosRunResponse = {
      success: true,
      scenarioId,
      outcome: result.outcome,
      record: result.scenario.lastRecord || {
        scenarioId,
        startedAt: Date.now(),
        completedAt: Date.now(),
        faultsInjected: 0,
        faultsRecovered: 0,
        outcomes: [],
        passed: result.outcome === "SAFE",
        invariantsPreserved: result.outcome === "SAFE",
      },
      leaks: result.leaks,
      timestamp: Date.now(),
    };

    return NextResponse.json(responseData);
  } catch (error) {
    console.error("[evidence/chaos-run] Execution error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to execute chaos scenario",
      },
      { status: 500 }
    );
  }
}
