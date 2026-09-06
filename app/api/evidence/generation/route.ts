import { NextResponse } from "next/server";
import { generationAudit } from "@/lib/generation-audit";

/**
 * GET /api/evidence/generation
 * Delivers real-time generation fence telemetry and audit events.
 * Strictly sanitized: exposes only monotonic IDs, event types, and timestamps.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const evidenceData = generationAudit.getEvidenceData();

    return NextResponse.json({
      success: true,
      data: evidenceData,
    });
  } catch (error) {
    console.error("[evidence/generation] Error fetching evidence:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to retrieve generation evidence",
      },
      { status: 500 }
    );
  }
}
