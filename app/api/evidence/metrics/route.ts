import { NextResponse } from "next/server";
import { measurementPipeline } from "@/lib/measurement-pipeline";

/**
 * GET /api/evidence/metrics
 * Delivers canonical performance and correctness measurements for EchoFence.
 * Strictly sanitized: exposes only timing latencies, counts, protection rate,
 * and invariant verification states.
 * No API keys, credentials, or private data are ever exposed.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const snapshot = measurementPipeline.getSnapshot();

    return NextResponse.json({
      success: true,
      data: snapshot,
    });
  } catch (error) {
    console.error("[evidence/metrics] Error retrieving metrics:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to retrieve measurement metrics",
      },
      { status: 500 }
    );
  }
}
