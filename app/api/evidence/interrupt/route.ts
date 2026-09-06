import { NextResponse } from "next/server";
import { interruptController } from "@/lib/interrupt-controller";
import type { InterruptEvidenceData } from "@/types/interrupt";

/**
 * GET /api/evidence/interrupt
 * Returns safe, strongly typed interruption telemetry and history.
 * Strictly sanitized: zero secrets or credentials exposed.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const evidenceData: InterruptEvidenceData = {
      metrics: interruptController.getMetrics(),
      history: interruptController.getHistory(),
    };

    return NextResponse.json({
      success: true,
      data: evidenceData,
    });
  } catch (error) {
    console.error("[evidence/interrupt] Error fetching interruption telemetry:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to retrieve interruption telemetry",
      },
      { status: 500 }
    );
  }
}
