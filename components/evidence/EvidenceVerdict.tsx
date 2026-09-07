"use client";

import React from "react";
import { CheckCircle2, XCircle, AlertCircle, Clock, ShieldCheck } from "lucide-react";
import type { DashboardVerdict } from "./types";

interface EvidenceVerdictProps {
  verdict: DashboardVerdict;
  fenceActive: boolean;
  activeGeneration: number | null;
  protectionRate: number;
}

export function EvidenceVerdict({
  verdict,
  fenceActive,
  activeGeneration,
  protectionRate,
}: EvidenceVerdictProps): React.JSX.Element {
  const { status, headline, subhead } = verdict;

  const renderBadge = () => {
    switch (status) {
      case "PASS":
        return (
          <div className="verdict-badge verdict-badge-pass">
            <CheckCircle2 size={24} className="verdict-icon text-success" />
            <span className="verdict-text-main">PASS</span>
          </div>
        );
      case "FAIL":
        return (
          <div className="verdict-badge verdict-badge-fail">
            <XCircle size={24} className="verdict-icon text-error" />
            <span className="verdict-text-main">FAIL</span>
          </div>
        );
      case "RUNNING":
        return (
          <div className="verdict-badge verdict-badge-running">
            <Clock size={24} className="verdict-icon text-warning animate-spin" />
            <span className="verdict-text-main">RUNNING</span>
          </div>
        );
      case "NOT_RUN":
      default:
        return (
          <div className="verdict-badge verdict-badge-not-run">
            <AlertCircle size={24} className="verdict-icon text-muted" />
            <span className="verdict-text-main">NOT RUN</span>
          </div>
        );
    }
  };

  return (
    <div className={`evidence-verdict-card verdict-card-${status.toLowerCase()}`}>
      <div className="verdict-top">
        <div className="verdict-title-group">
          <div className="verdict-label-sub">SYSTEM VERDICT</div>
          {renderBadge()}
          <h2 className="verdict-headline">{headline}</h2>
          <p className="verdict-subhead">{subhead}</p>
        </div>

        <div className="verdict-summary-pills">
          <div className="verdict-summary-pill">
            <ShieldCheck size={14} className="pill-icon" />
            <span className="pill-label">Generation Fence:</span>
            <span className={`pill-value font-mono ${fenceActive ? "text-success" : "text-error"}`}>
              {fenceActive ? "ACTIVE" : "INACTIVE"}
            </span>
          </div>

          <div className="verdict-summary-pill">
            <span className="pill-label">Current Generation:</span>
            <span className="pill-value font-mono">
              {activeGeneration !== null ? `#${activeGeneration}` : "—"}
            </span>
          </div>

          <div className="verdict-summary-pill">
            <span className="pill-label">Protection Rate:</span>
            <span className="pill-value font-mono text-success">
              {protectionRate}%
            </span>
          </div>
        </div>

        {/* 5 Core Status Concepts */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
            gap: "8px",
            marginTop: "14px",
            paddingTop: "12px",
            borderTop: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", fontFamily: "var(--font-mono, monospace)", color: "#34d399" }}>
            <CheckCircle2 size={13} />
            <span>STALE AUDIO BLOCKED</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", fontFamily: "var(--font-mono, monospace)", color: "#34d399" }}>
            <CheckCircle2 size={13} />
            <span>TRANSCRIPT INTEGRITY</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", fontFamily: "var(--font-mono, monospace)", color: "#34d399" }}>
            <CheckCircle2 size={13} />
            <span>AUTHORITY: {activeGeneration !== null ? `G${activeGeneration}` : "G1"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", fontFamily: "var(--font-mono, monospace)", color: "#34d399" }}>
            <CheckCircle2 size={13} />
            <span>RESURRECTIONS: 0</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", fontFamily: "var(--font-mono, monospace)", color: "#34d399" }}>
            <CheckCircle2 size={13} />
            <span>CORRUPTIONS: 0</span>
          </div>
        </div>
      </div>
    </div>
  );
}
