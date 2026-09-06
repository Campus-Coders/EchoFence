import { getActiveSpeechProvider } from "@/lib/provider-registry";
import type { SafeProviderStatus, SpeechSynthesisRequest, SpeechSynthesisResult } from "@/types/provider";

/**
 * Agent-layer interface for Rime speech synthesis.
 * Bridges orchestrators and speech providers while maintaining generation fence invariants.
 */
export async function synthesizeSpokenTurn(
  request: SpeechSynthesisRequest
): Promise<SpeechSynthesisResult> {
  const provider = getActiveSpeechProvider();
  return provider.synthesize(request);
}

/**
 * Safe status getter for UI and diagnostics.
 */
export function getSpokenProviderStatus(): SafeProviderStatus {
  const provider = getActiveSpeechProvider();
  return provider.getStatus();
}
