import React from "react";
import { ShieldCheck, History } from "lucide-react";
import { MetricsCards, type MetricsCardsProps } from "./MetricsCards";
import type { GenerationAuditEvent } from "@/types/generation";

export type EvidencePanelProps = MetricsCardsProps & {
  title?: string;
  isInterrupted?: boolean;
  recentEvents?: readonly GenerationAuditEvent[];
};

export function EvidencePanel({
  title = "Evidence & Measurements",
  isInterrupted = false,
  activeGeneration,
  interruptions,
  staleResultsBlocked,
  audioStopLatency,
  recoveryTime,
  recentEvents = [],
}: EvidencePanelProps): React.JSX.Element {
  const hasEvents = recentEvents.length > 0;

  return (
    <div className="console-card">
      <div className="console-card-header">
        <span className="console-card-title">
          <ShieldCheck size={16} />
          {title}
        </span>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {isInterrupted ? (
            <span className="status-pill status-pill-error" style={{ color: "var(--color-error)", borderColor: "rgba(239, 68, 68, 0.4)" }}>
              <span className="status-dot status-dot-pulse" style={{ backgroundColor: "var(--color-error)" }} />
              INTERRUPTED
            </span>
          ) : (
            <span className="status-pill status-pill-ready">
              <span className="status-dot status-dot-pulse" />
              FENCE ARMED
            </span>
          )}
          <span className="status-pill">
            {hasEvents ? `${recentEvents.length} Events` : "Evidence Feed"}
          </span>
        </div>
      </div>

      <MetricsCards
        activeGeneration={activeGeneration}
        interruptions={interruptions}
        staleResultsBlocked={staleResultsBlocked}
        audioStopLatency={audioStopLatency}
        recoveryTime={recoveryTime}
      />

      {hasEvents && (
        <div className="evidence-feed-section">
          <div className="evidence-feed-title">
            <History size={12} />
            Recent Fence Audit Events
          </div>
          <div className="evidence-feed-list">
            {recentEvents.slice(0, 6).map((evt) => {
              const isBlocked = evt.event.includes("blocked");
              const isLate = evt.event === "tool_completed_late";
              return (
                <div
                  key={evt.id}
                  className={
                    isBlocked || isLate
                      ? "evidence-feed-item evidence-feed-item-blocked"
                      : "evidence-feed-item"
                  }
                  title={evt.details}
                >
                  <span className="voice-notice">
                    <span
                      className={
                        isBlocked || isLate
                          ? "evidence-feed-badge evidence-feed-badge-blocked"
                          : "evidence-feed-badge"
                      }
                    >
                      Gen {evt.generationId}
                    </span>
                    <span className={isBlocked || isLate ? "evidence-feed-text-blocked" : undefined}>
                      {evt.event}
                    </span>
                  </span>
                  <span>
                    {new Date(evt.timestamp).toLocaleTimeString([], {
                      hour12: false,
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
