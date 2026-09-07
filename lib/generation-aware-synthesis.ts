import { generationFence, GenerationFence } from "./generation-fence";
import { rimeProviderAdapter, RimeProviderAdapter } from "./rime-provider";
import { interruptController, InterruptController } from "./interrupt-controller";
import { generationAudit } from "./generation-audit";
import { measurementPipeline, MeasurementPipeline } from "./measurement-pipeline";
import type {
  VoiceProviderRequest,
  VoiceProviderResult,
  AuthorizedSynthesisResult,
  GenerationAwareSynthesisOutcome,
} from "@/types/provider";

export interface SynthesisRequestOptions {
  requestId?: string;
  voice?: string;
  model?: string;
  language?: string;
  timeoutMs?: number;
  externalSignal?: AbortSignal;
}

/**
 * Generation-Aware Synthesis Orchestrator.
 *
 * Implements the core EchoFence principle:
 * ARRIVAL != AUTHORITY
 *
 * Coordinates RimeProviderAdapter with GenerationFence, InterruptController,
 * and MeasurementPipeline.
 *
 * Guarantees that:
 * 1. Only provider results belonging to the currently active generation can become authorized.
 * 2. Stale results (result.generationId < activeGeneration) are strictly intercepted,
 *    blocked, and logged to audit/measurement BEFORE any downstream side effects.
 * 3. AbortController lifecycles are strictly managed per generation to prevent cross-generation clobbering.
 * 4. Step 12 does NOT directly initiate browser audio playback (delegated to Step 13).
 */
export class GenerationAwareSynthesis {
  private fence: GenerationFence;
  private adapter: RimeProviderAdapter;
  private interrupt: InterruptController;
  private measurement: MeasurementPipeline;

  // Active requests tracked by generationId -> Map<requestId, AbortController>
  private activeControllers: Map<number, Map<string, AbortController>> = new Map();

  constructor(options?: {
    fence?: GenerationFence;
    adapter?: RimeProviderAdapter;
    interrupt?: InterruptController;
    measurement?: MeasurementPipeline;
  }) {
    this.fence = options?.fence ?? generationFence;
    this.adapter = options?.adapter ?? rimeProviderAdapter;
    this.interrupt = options?.interrupt ?? interruptController;
    this.measurement = options?.measurement ?? measurementPipeline;

    // Register synthesis abort hook with InterruptController
    this.interrupt.registerSynthesisAborter((genId: number) => {
      this.abortGeneration(genId, "InterruptController: generation interrupted");
    });
  }

  /**
   * Synthesizes speech for a specific generation and enforces the GenerationFence
   * authorization boundary upon provider completion.
   */
  public async synthesizeForGeneration(
    generationId: number,
    text: string,
    options?: SynthesisRequestOptions
  ): Promise<GenerationAwareSynthesisOutcome> {
    const startedAt = Date.now();
    const requestId =
      options?.requestId ||
      `synth-req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const currentActiveGen = this.fence.getCurrentGeneration();

    // 1. Pre-dispatch check: If generation is already superseded, reject immediately
    if (generationId < currentActiveGen) {
      this.measurement.recordStaleResultAttempted(generationId);
      this.fence.recordStaleBlocked(
        generationId,
        "stale_synthesis_result_blocked",
        "generation_aware_synthesis",
        `Pre-dispatch rejection: Gen ${generationId} is already superseded by active Gen ${currentActiveGen}`
      );

      return {
        kind: "stale",
        generationId,
        requestId,
        reason: "STALE_GENERATION",
        blockedAt: Date.now(),
        activeGeneration: currentActiveGen,
      };
    }

    // 2. Setup AbortController for this generation request
    const requestAbortController = new AbortController();

    if (!this.activeControllers.has(generationId)) {
      this.activeControllers.set(generationId, new Map());
    }
    this.activeControllers.get(generationId)!.set(requestId, requestAbortController);

    // Register with InterruptController so barge-in immediately signals abort
    this.interrupt.registerAbortController(generationId, requestAbortController);

    // Forward external signal if supplied
    if (options?.externalSignal) {
      if (options.externalSignal.aborted) {
        requestAbortController.abort();
      } else {
        options.externalSignal.addEventListener(
          "abort",
          () => requestAbortController.abort(),
          { once: true }
        );
      }
    }

    // 3. Audit: synthesis request started
    try {
      generationAudit.record(
        generationId,
        "synthesis_request_started",
        this.fence.getCurrentGeneration(),
        "generation_aware_synthesis",
        `Synthesis dispatch [${requestId}], textLen: ${text.length}`
      );
    } catch {
      // Non-fatal audit log
    }

    // 4. Construct provider request and dispatch through adapter
    const providerRequest: VoiceProviderRequest = {
      generationId,
      requestId,
      text,
      startedAt,
      signal: requestAbortController.signal,
      voice: options?.voice,
      model: options?.model,
      language: options?.language,
    };

    let providerResult: VoiceProviderResult;

    try {
      providerResult = await this.adapter.synthesize(providerRequest, {
        timeoutMs: options?.timeoutMs,
      });
    } finally {
      // Clean up controller tracking without deleting other requests
      const genControllers = this.activeControllers.get(generationId);
      if (genControllers) {
        genControllers.delete(requestId);
        if (genControllers.size === 0) {
          this.activeControllers.delete(generationId);
        }
      }
      this.interrupt.unregisterAbortController(generationId, requestAbortController);
    }

    // 5. CRITICAL AUTHORIZATION BOUNDARY (ARRIVAL != AUTHORITY)
    const isCurrent = this.fence.isCurrent(providerResult.generationId);
    const activeGenAtArrival = this.fence.getCurrentGeneration();

    // PATH A: Stale Generation (Rejected)
    if (!isCurrent || providerResult.generationId < activeGenAtArrival) {
      this.measurement.recordStaleResultAttempted(providerResult.generationId);
      this.fence.recordStaleBlocked(
        providerResult.generationId,
        "stale_synthesis_result_blocked",
        "generation_aware_synthesis",
        `Stale synthesis result for Gen ${providerResult.generationId} blocked by active Gen ${activeGenAtArrival}`
      );

      // If stale result produced audio, ensure it is recorded as blocked from audio queue
      if (providerResult.audioBuffer) {
        this.measurement.recordStaleAudioBlocked(providerResult.generationId);
        try {
          generationAudit.record(
            providerResult.generationId,
            "stale_audio_blocked",
            activeGenAtArrival,
            "generation_aware_synthesis",
            `Stale synthesized audio prevented from entering playback queue for Gen ${providerResult.generationId}`
          );
        } catch {
          // Non-fatal
        }
      }

      return {
        kind: "stale",
        generationId: providerResult.generationId,
        requestId: providerResult.requestId,
        reason: "STALE_GENERATION",
        blockedAt: Date.now(),
        activeGeneration: activeGenAtArrival,
      };
    }

    // PATH B: Current Generation & Cancelled
    if (providerResult.status === "cancelled") {
      return {
        kind: "cancelled",
        generationId: providerResult.generationId,
        requestId: providerResult.requestId,
        reason: providerResult.error || "Synthesis cancelled",
        cancelledAt: Date.now(),
      };
    }

    // PATH C: Current Generation & Failed
    if (providerResult.status === "failed" || !providerResult.audioBuffer) {
      return {
        kind: "failed",
        generationId: providerResult.generationId,
        requestId: providerResult.requestId,
        errorCode: providerResult.errorCode,
        error: providerResult.error || "Synthesis failed or returned empty buffer",
        failedAt: Date.now(),
      };
    }

    // PATH D: Current Generation & Authorized (Success)
    const authorizedResult: AuthorizedSynthesisResult = {
      authorized: true,
      generationId: providerResult.generationId,
      requestId: providerResult.requestId,
      audioBuffer: providerResult.audioBuffer,
      audioData: providerResult.audioData || providerResult.audioBuffer,
      contentType: providerResult.contentType || "audio/mpeg",
      provider: providerResult.provider || "Rime",
      audioSource: providerResult.audioSource || "REAL_RIME_AUDIO",
      model: providerResult.model,
      voice: providerResult.voice,
      providerLatencyMs: providerResult.latencyMs ?? (Date.now() - startedAt),
      authorizedAt: Date.now(),
    };

    try {
      generationAudit.record(
        generationId,
        "synthesis_result_authorized",
        activeGenAtArrival,
        "generation_aware_synthesis",
        `Result authorized [${providerResult.requestId}], latency: ${authorizedResult.providerLatencyMs}ms, bytes: ${providerResult.audioBuffer.byteLength}`
      );
    } catch {
      // Non-fatal
    }

    return {
      kind: "authorized",
      result: authorizedResult,
    };
  }

  /**
   * Explicitly abort all in-flight synthesis requests belonging to a generation.
   */
  public abortGeneration(generationId: number, reason?: string): void {
    const genControllers = this.activeControllers.get(generationId);
    if (genControllers) {
      for (const controller of genControllers.values()) {
        if (!controller.signal.aborted) {
          controller.abort(reason || `Generation ${generationId} explicitly aborted`);
        }
      }
      this.activeControllers.delete(generationId);
    }
  }

  /**
   * Returns whether any synthesis request for the given generation is currently pending.
   */
  public isPending(generationId: number): boolean {
    const genControllers = this.activeControllers.get(generationId);
    return Boolean(genControllers && genControllers.size > 0);
  }

  /**
   * Cleans up all tracked controller references.
   */
  public reset(): void {
    for (const genControllers of this.activeControllers.values()) {
      for (const controller of genControllers.values()) {
        if (!controller.signal.aborted) {
          controller.abort("GenerationAwareSynthesis reset");
        }
      }
    }
    this.activeControllers.clear();
  }
}

// Global default singleton instance
export const generationAwareSynthesis = new GenerationAwareSynthesis();
