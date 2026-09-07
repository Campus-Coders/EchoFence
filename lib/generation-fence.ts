import type {
  GenerationId,
  GenerationAuditEventType,
} from "@/types/generation";
import { generationAudit } from "./generation-audit";
import { measurementPipeline } from "./measurement-pipeline";

export type GenerationChangeListener = (
  activeGen: GenerationId,
  previousGen: GenerationId
) => void;

/**
 * GenerationFence: Core race-condition prevention mechanism.
 * Enforces monotonically increasing numeric generation IDs.
 * Strictly guarantees that stale asynchronous results from older generations
 * are rejected before affecting conversational state, audio, or metrics.
 */
export class GenerationFence {
  private currentGeneration: GenerationId = 0;
  private listeners: Set<GenerationChangeListener> = new Set();

  constructor(initialGeneration: GenerationId = 0) {
    this.currentGeneration = initialGeneration;
  }

  /**
   * Returns the currently active generation ID.
   */
  public getCurrentGeneration(): GenerationId {
    return this.currentGeneration;
  }

  /**
   * Begins a new logical turn.
   * Monotonically increments the generation ID and invalidates all prior generations.
   */
  public beginGeneration(source = "user_turn", details?: string): GenerationId {
    const previous = this.currentGeneration;
    this.currentGeneration += 1;
    const newGen = this.currentGeneration;

    measurementPipeline.startGeneration(newGen);
    measurementPipeline.recordGenerationActivated(newGen);

    if (previous > 0) {
      generationAudit.record(
        previous,
        "generation_invalidated",
        newGen,
        source,
        `Superseded by generation ${newGen}`
      );
    }

    generationAudit.record(
      newGen,
      "generation_started",
      newGen,
      source,
      details || `Generation ${newGen} active`
    );

    for (const listener of this.listeners) {
      try {
        listener(newGen, previous);
      } catch (err) {
        console.error("[generation-fence] Listener error:", err);
      }
    }

    return newGen;
  }

  /**
   * Deterministic guard: Checks if the candidate generation is the currently active generation.
   * Older generations (< currentGeneration) are strictly stale.
   * Invariant: candidateGenId === activeGenId
   */
  public isCurrent(generationId: GenerationId): boolean {
    if (this.currentGeneration === 0) {
      return false;
    }
    return generationId === this.currentGeneration;
  }

  /**
   * Asserts that a generation is current.
   * If stale, records an audit event and returns false.
   */
  public assertCurrent(
    generationId: GenerationId,
    source = "async_boundary",
    details?: string
  ): boolean {
    if (this.isCurrent(generationId)) {
      return true;
    }

    this.recordStaleBlocked(
      generationId,
      "stale_result_blocked",
      source,
      details || `Result from Gen ${generationId} blocked by active Gen ${this.currentGeneration}`
    );
    return false;
  }

  /**
   * Explicitly records that a stale result, audio, or transition was blocked.
   */
  public recordStaleBlocked(
    generationId: GenerationId,
    eventType: GenerationAuditEventType = "stale_result_blocked",
    source?: string,
    details?: string
  ): void {
    measurementPipeline.recordStaleResultAttempted(generationId);
    measurementPipeline.recordStaleResultBlocked(generationId);
    if (eventType === "stale_audio_blocked") {
      measurementPipeline.recordStaleAudioBlocked(generationId);
    }
    generationAudit.record(
      generationId,
      eventType,
      this.currentGeneration,
      source,
      details || `Stale operation from Gen ${generationId} blocked by active Gen ${this.currentGeneration}`
    );
  }

  /**
   * Marks current generation completed.
   */
  public completeGeneration(generationId: GenerationId, source?: string): void {
    if (this.isCurrent(generationId)) {
      measurementPipeline.recordGenerationCompleted(generationId);
      generationAudit.record(
        generationId,
        "generation_completed",
        this.currentGeneration,
        source,
        `Generation ${generationId} successfully completed`
      );
    } else {
      this.recordStaleBlocked(
        generationId,
        "stale_state_transition_blocked",
        source || "completion_callback",
        `Late completion callback for superseded Gen ${generationId} blocked by active Gen ${this.currentGeneration}`
      );
    }
  }

  /**
   * Invalidates active generation explicitly (e.g. on early abort or error).
   */
  public invalidate(source = "invalidation", reason?: string): void {
    if (this.currentGeneration > 0) {
      measurementPipeline.recordGenerationInvalidated(this.currentGeneration);
      generationAudit.record(
        this.currentGeneration,
        "generation_invalidated",
        this.currentGeneration,
        source,
        reason || "Explicit invalidation"
      );
    }
  }

  public subscribe(listener: GenerationChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public reset(): void {
    this.currentGeneration = 0;
    generationAudit.reset();
    measurementPipeline.reset();
  }
}

// Canonical Singleton Anchor on globalThis across all client bundles and HMR
const globalForFence = globalThis as unknown as {
  __ECHOFENCE_GENERATION_FENCE__?: GenerationFence;
};

export const generationFence: GenerationFence =
  globalForFence.__ECHOFENCE_GENERATION_FENCE__ ?? new GenerationFence();

if (!globalForFence.__ECHOFENCE_GENERATION_FENCE__) {
  globalForFence.__ECHOFENCE_GENERATION_FENCE__ = generationFence;
}

if (typeof window !== "undefined") {
  console.log("[generation-fence-singleton-ref]", {
    pipelineInstanceId: measurementPipeline.instanceId,
  });
}

