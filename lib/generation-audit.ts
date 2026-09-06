import type {
  GenerationAuditEvent,
  GenerationAuditEventType,
  GenerationEvidenceData,
  GenerationId,
} from "@/types/generation";
import { delayedToolRegistry } from "./delayed-tool";

export type AuditEventListener = (event: GenerationAuditEvent) => void;

export class GenerationAuditLog {
  private events: GenerationAuditEvent[] = [];
  private maxEvents: number = 100;
  private staleBlockedCount: number = 0;
  private currentActiveGeneration: GenerationId = 0;
  private listeners: Set<AuditEventListener> = new Set();

  public record(
    generationId: GenerationId,
    event: GenerationAuditEventType,
    currentGeneration: GenerationId,
    source?: string,
    details?: string
  ): GenerationAuditEvent {
    const isStale = generationId < currentGeneration;

    if (
      event === "stale_result_blocked" ||
      event === "stale_audio_blocked" ||
      event === "stale_state_transition_blocked" ||
      event === "stale_tool_result_blocked" ||
      event === "stale_synthesis_result_blocked" ||
      event === "stale_audio_start_blocked" ||
      event === "stale_barge_in_ignored" ||
      event === "stale_audio_chunk_blocked"
    ) {
      this.staleBlockedCount++;
    }

    if (event === "generation_started") {
      this.currentActiveGeneration = currentGeneration;
    }

    const auditEntry: GenerationAuditEvent = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      generationId,
      event,
      timestamp: Date.now(),
      currentGeneration,
      stale: isStale,
      source,
      details,
    };

    this.events.unshift(auditEntry);
    if (this.events.length > this.maxEvents) {
      this.events.pop();
    }

    for (const listener of this.listeners) {
      try {
        listener(auditEntry);
      } catch (err) {
        console.error("[generation-audit] Listener error:", err);
      }
    }

    return auditEntry;
  }

  public getEvents(limit?: number): GenerationAuditEvent[] {
    if (limit && limit > 0) {
      return this.events.slice(0, limit);
    }
    return [...this.events];
  }

  public getStaleBlockedCount(): number {
    return this.staleBlockedCount;
  }

  public getActiveGeneration(): GenerationId {
    return this.currentActiveGeneration;
  }

  public getEvidenceData(): GenerationEvidenceData {
    return {
      activeGeneration: this.currentActiveGeneration,
      staleResultsBlocked: this.staleBlockedCount,
      toolMetrics: delayedToolRegistry.getMetrics(),
      events: this.getEvents(50),
    };
  }

  public subscribe(listener: AuditEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public reset(): void {
    this.events = [];
    this.staleBlockedCount = 0;
    this.currentActiveGeneration = 0;
    delayedToolRegistry.reset();
  }
}

export const generationAudit = new GenerationAuditLog();
