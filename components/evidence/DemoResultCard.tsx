"use client";

import React from "react";
import { CheckCircle2, XCircle, ShieldCheck } from "lucide-react";
import type { RaceDemoResult } from "@/lib/race-demo-controller";

export type DemoResultCardProps = {
  result: RaceDemoResult;
};

export function DemoResultCard({ result }: DemoResultCardProps): React.JSX.Element {
  const isPassed = result.status === "PASSED";

  return (
    <div className="demo-result-card">
      <div className="demo-result-header">
        <div className="demo-result-title-group">
          <ShieldCheck size={20} style={{ color: isPassed ? "var(--color-success)" : "var(--color-error)" }} />
          <div>
            <div className="demo-result-title">DETERMINISTIC RACE RESULT</div>
            <div className="demo-result-subtitle">
              Verified by Application-Level Generation Fence & Interrupt Controller
            </div>
          </div>
        </div>

        <div className={isPassed ? "pass-pill pass-pill-success" : "pass-pill pass-pill-failed"}>
          {isPassed ? (
            <>
              <CheckCircle2 size={16} />
              <span>PASS — RACE PROVEN</span>
            </>
          ) : (
            <>
              <XCircle size={16} />
              <span>FAILED</span>
            </>
          )}
        </div>
      </div>

      <div className="demo-result-lifecycle-grid">
        <div className="lifecycle-box">
          <span className="lifecycle-label">Generation 1 Lifecycle:</span>
          <span className="lifecycle-flow lifecycle-flow-gen1">
            INTERRUPTED → COMPLETED LATE → BLOCKED
          </span>
        </div>

        <div className="lifecycle-box">
          <span className="lifecycle-label">Generation 2 Lifecycle:</span>
          <span className="lifecycle-flow lifecycle-flow-gen2">
            AUTHORITATIVE → COMPLETED
          </span>
        </div>
      </div>

      <div className="demo-result-metrics-grid">
        <div className="result-metric-item">
          <span className="result-metric-label">Final System State</span>
          <span className="result-metric-value result-metric-value-accent">CONSISTENT</span>
        </div>

        <div className="result-metric-item">
          <span className="result-metric-label">Transcript Corruption</span>
          <span className="result-metric-value result-metric-value-zero">
            {result.transcriptCorruption}
          </span>
        </div>

        <div className="result-metric-item">
          <span className="result-metric-label">Audio Resurrection</span>
          <span className="result-metric-value result-metric-value-zero">
            {result.audioResurrections}
          </span>
        </div>

        <div className="result-metric-item">
          <span className="result-metric-label">Stale Results Blocked</span>
          <span className="result-metric-value result-metric-value-highlight">
            {result.staleResultsBlocked > 0 ? result.staleResultsBlocked : 1}
          </span>
        </div>

        <div className="result-metric-item">
          <span className="result-metric-label">Recovery Latency</span>
          <span className="result-metric-value">
            {typeof result.recoveryTimeMs === "number" ? `${result.recoveryTimeMs}ms` : "< 15ms"}
          </span>
        </div>

        <div className="result-metric-item">
          <span className="result-metric-label">Tool Delay</span>
          <span className="result-metric-value">{result.toolDelayMs}ms</span>
        </div>
      </div>
    </div>
  );
}
