"use client";

import React from "react";
import { Terminal, ShieldAlert, CheckCircle, AlertTriangle, Info } from "lucide-react";
import type { GenerationAuditEvent } from "@/types/generation";

interface EvidenceEventLogProps {
  events: GenerationAuditEvent[];
}

export function EvidenceEventLog({ events }: EvidenceEventLogProps): React.JSX.Element {
  if (!events || events.length === 0) {
    return (
      <div className="event-log-card console-card">
        <div className="event-log-header">
          <div className="flex items-center gap-2">
            <Terminal size={16} className="text-accent" />
            <span className="event-log-title">Chronological Audit Event Trace</span>
          </div>
          <span className="status-pill text-xs">0 Events</span>
        </div>
        <div className="event-log-empty text-muted text-sm py-4 text-center">
          No audit events recorded yet.
        </div>
      </div>
    );
  }

  const renderBadge = (eventType: string) => {
    if (eventType.includes("blocked")) {
      return (
        <span className="status-pill status-pill-error font-mono text-[11px]">
          <ShieldAlert size={12} className="inline mr-1" />
          {eventType.toUpperCase()}
        </span>
      );
    }
    if (eventType.includes("interrupted") || eventType.includes("invalidated")) {
      return (
        <span className="status-pill status-pill-active font-mono text-[11px] text-warning">
          <AlertTriangle size={12} className="inline mr-1" />
          {eventType.toUpperCase()}
        </span>
      );
    }
    if (eventType.includes("completed") || eventType.includes("recovered")) {
      return (
        <span className="status-pill status-pill-ready font-mono text-[11px]">
          <CheckCircle size={12} className="inline mr-1" />
          {eventType.toUpperCase()}
        </span>
      );
    }
    return (
      <span className="status-pill font-mono text-[11px] text-muted">
        <Info size={12} className="inline mr-1" />
        {eventType.toUpperCase()}
      </span>
    );
  };

  return (
    <div className="event-log-card console-card">
      <div className="event-log-header">
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-accent" />
          <span className="event-log-title">Chronological Audit Event Trace</span>
        </div>
        <span className="status-pill text-xs font-mono">
          {events.length} Events Logged
        </span>
      </div>

      <div className="event-log-table-wrapper">
        <table className="event-log-table">
          <thead>
            <tr>
              <th style={{ width: "100px" }}>Time</th>
              <th style={{ width: "80px" }}>Gen ID</th>
              <th style={{ width: "240px" }}>Event Type</th>
              <th>Operational Details</th>
            </tr>
          </thead>
          <tbody>
            {events.slice(0, 15).map((evt) => (
              <tr key={evt.id} className="event-log-row">
                <td className="font-mono text-xs text-muted">
                  {new Date(evt.timestamp).toLocaleTimeString()}
                </td>
                <td className="font-mono text-xs font-semibold">
                  Gen #{evt.generationId}
                </td>
                <td>{renderBadge(evt.event)}</td>
                <td className="font-mono text-xs text-secondary truncate max-w-md">
                  {evt.details || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
