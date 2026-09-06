import { NextResponse } from "next/server";
import { getSpokenProviderStatus } from "@/agent/rime";

/**
 * GET /api/voice/status
 * Returns safe provider metadata and configuration readiness.
 * NEVER returns secrets, API keys, or raw provider errors.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const status = getSpokenProviderStatus();

    return NextResponse.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error("[voice/status] Failed to retrieve provider status:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to retrieve provider status",
      },
      { status: 500 }
    );
  }
}
