import { NextResponse } from "next/server";
import { getSpokenProviderStatus } from "@/agent/rime";
import { rimeProviderAdapter } from "@/lib/rime-provider";
import type { SafeProviderStatus } from "@/types/provider";

/**
 * GET /api/voice/status
 * Returns safe provider metadata and configuration readiness.
 * NEVER returns secrets, API keys, or raw provider errors.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const baseStatus = getSpokenProviderStatus();
    const diag = rimeProviderAdapter.getDiagnostics();
    const effectiveMode = rimeProviderAdapter.getMode();

    const status: SafeProviderStatus = {
      ...baseStatus,
      configured: baseStatus.configured,
      provider: "Rime",
      mode: effectiveMode === "real" ? "real" : "fallback",
      selectedModel: baseStatus.selectedModel || "mist",
      selectedVoice: baseStatus.selectedVoice || "amber",
      selectedLanguage: baseStatus.selectedLanguage || "eng",
      lastProviderStatus: diag.lastProviderStatus,
      lastProviderStatusCode: diag.lastProviderStatusCode,
      lastProviderError: diag.lastProviderError,
      lastAudioSource: diag.lastAudioSource,
    };

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
