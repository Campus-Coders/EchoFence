"use client";

import React from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, Clock } from "lucide-react";
import type { RaceDemoTimelineStep } from "@/lib/race-demo-controller";

export type RaceTimelineProps = {
  timeline: RaceDemoTimelineStep[];
  activeGen1?: number | null;
  activeGen2?: number | null;
};

export function RaceTimeline({
  timeline,
  activeGen1,
  activeGen2,
}: RaceTimelineProps): React.JSX.Element {
  const gen1Steps = timeline.filter((s) => s.generation === 1);
  const gen2Steps = timeline.filter((s) => s.generation === 2);

  const getStepIcon = (type: RaceDemoTimelineStep["type"]) => {
    switch (type) {
      case "SUCCESS":
        return <CheckCircle2 size={15} style={{ color: "var(--color-success)" }} />;
      case "BLOCKED":
        return <XCircle size={15} style={{ color: "var(--color-error)" }} />;
      case "INTERRUPTED":
        return <AlertTriangle size={15} style={{ color: "var(--color-warning)" }} />;
      case "INFO":
      default:
        return <Info size={15} style={{ color: "var(--color-info)" }} />;
    }
  };

  const getStepBadgeClass = (type: RaceDemoTimelineStep["type"]) => {
    switch (type) {
      case "SUCCESS":
        return "timeline-badge timeline-badge-success";
      case "BLOCKED":
        return "timeline-badge timeline-badge-blocked";
      case "INTERRUPTED":
        return "timeline-badge timeline-badge-interrupted";
      case "INFO":
      default:
        return "timeline-badge timeline-badge-info";
    }
  };

  return (
    <div className="race-timeline-container">
      <div className="race-timeline-grid">
        {/* Generation 1 Column */}
        <div className="race-timeline-col">
          <div className="race-timeline-header">
            <span className="race-timeline-col-title">
              <Clock size={14} />
              GENERATION 1 {activeGen1 ? `(ID: ${activeGen1})` : ""}
            </span>
            <span className="timeline-badge timeline-badge-interrupted">
              SUPERSEDED
            </span>
          </div>

          <div className="race-timeline-steps">
            {gen1Steps.length === 0 ? (
              <div className="timeline-empty-step">Waiting for Generation 1...</div>
            ) : (
              gen1Steps.map((step) => (
                <div key={step.id} className="race-timeline-step-row">
                  <div className="race-timeline-step-icon">
                    {getStepIcon(step.type)}
                  </div>
                  <div className="race-timeline-step-body">
                    <div className="race-timeline-step-title-row">
                      <span className={getStepBadgeClass(step.type)}>
                        {step.title}
                      </span>
                      <span className="timeline-timestamp">
                        {new Date(step.timestamp).toLocaleTimeString([], {
                          hour12: false,
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                    </div>
                    {step.subtitle && (
                      <span className="race-timeline-step-sub">
                        {step.subtitle}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Generation 2 Column */}
        <div className="race-timeline-col">
          <div className="race-timeline-header">
            <span className="race-timeline-col-title">
              <CheckCircle2 size={14} style={{ color: "var(--color-success)" }} />
              GENERATION 2 {activeGen2 ? `(ID: ${activeGen2})` : ""}
            </span>
            <span className="timeline-badge timeline-badge-success">
              AUTHORITATIVE
            </span>
          </div>

          <div className="race-timeline-steps">
            {gen2Steps.length === 0 ? (
              <div className="timeline-empty-step">Waiting for Generation 2...</div>
            ) : (
              gen2Steps.map((step) => (
                <div key={step.id} className="race-timeline-step-row">
                  <div className="race-timeline-step-icon">
                    {getStepIcon(step.type)}
                  </div>
                  <div className="race-timeline-step-body">
                    <div className="race-timeline-step-title-row">
                      <span className={getStepBadgeClass(step.type)}>
                        {step.title}
                      </span>
                      <span className="timeline-timestamp">
                        {new Date(step.timestamp).toLocaleTimeString([], {
                          hour12: false,
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                    </div>
                    {step.subtitle && (
                      <span className="race-timeline-step-sub">
                        {step.subtitle}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
