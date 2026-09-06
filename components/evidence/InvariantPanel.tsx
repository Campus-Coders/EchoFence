"use client";

import React from "react";
import { ShieldCheck, CheckCircle2, AlertCircle } from "lucide-react";
import type { SystemInvariants, RaceDemoStatus } from "@/lib/race-demo-controller";

export type InvariantPanelProps = {
  invariants: SystemInvariants;
  status: RaceDemoStatus;
};

export function InvariantPanel({
  invariants,
  status,
}: InvariantPanelProps): React.JSX.Element {
  const isPassed = status === "PASSED";

  return (
    <div className="invariant-panel">
      <div className="invariant-header">
        <span className="invariant-title">
          <ShieldCheck size={16} />
          SYSTEM INVARIANTS
        </span>
        <span className="status-pill status-pill-ready">
          <span className="status-dot status-dot-pulse" />
          FENCE: {invariants.fenceActive ? "ACTIVE & ENFORCING" : "OFFLINE"}
        </span>
      </div>

      <div className="invariant-grid">
        {/* Invariant 1: Generation Ownership */}
        <div className="invariant-card">
          <div className="invariant-card-title">
            {invariants.generationOwnership || isPassed ? (
              <CheckCircle2 size={16} style={{ color: "var(--color-success)" }} />
            ) : (
              <AlertCircle size={16} style={{ color: "var(--color-text-muted)" }} />
            )}
            <span>Generation Ownership</span>
          </div>
          <span className="invariant-desc">
            Only active generation may commit output
          </span>
          <span className="invariant-badge invariant-badge-active">
            {isPassed ? "GEN 2 AUTHORITATIVE" : "MONOTONIC CHECK"}
          </span>
        </div>

        {/* Invariant 2: Transcript Integrity */}
        <div className="invariant-card">
          <div className="invariant-card-title">
            {invariants.transcriptIntegrity || isPassed ? (
              <CheckCircle2 size={16} style={{ color: "var(--color-success)" }} />
            ) : (
              <AlertCircle size={16} style={{ color: "var(--color-text-muted)" }} />
            )}
            <span>Transcript Integrity</span>
          </div>
          <span className="invariant-desc">
            Gen 1 stale result did not modify transcript
          </span>
          <span className="invariant-badge invariant-badge-success">
            {isPassed ? "GENERATION 2 ONLY" : "ZERO CORRUPTION"}
          </span>
        </div>

        {/* Invariant 3: Audio Integrity */}
        <div className="invariant-card">
          <div className="invariant-card-title">
            {invariants.audioIntegrity || isPassed ? (
              <CheckCircle2 size={16} style={{ color: "var(--color-success)" }} />
            ) : (
              <AlertCircle size={16} style={{ color: "var(--color-text-muted)" }} />
            )}
            <span>Audio Integrity</span>
          </div>
          <span className="invariant-desc">
            Interrupted audio cannot restart
          </span>
          <span className="invariant-badge invariant-badge-success">
            {isPassed ? "NO RESURRECTION" : "PLAYBACK GUARDED"}
          </span>
        </div>

        {/* Invariant 4: State Integrity */}
        <div className="invariant-card">
          <div className="invariant-card-title">
            {invariants.stateIntegrity || isPassed ? (
              <CheckCircle2 size={16} style={{ color: "var(--color-success)" }} />
            ) : (
              <AlertCircle size={16} style={{ color: "var(--color-text-muted)" }} />
            )}
            <span>State Integrity</span>
          </div>
          <span className="invariant-desc">
            Gen 1 cannot overwrite Gen 2 state
          </span>
          <span className="invariant-badge invariant-badge-success">
            {isPassed ? "GENERATION 2 PRESERVED" : "TRANSITION SAFE"}
          </span>
        </div>
      </div>
    </div>
  );
}
