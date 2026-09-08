"use client";

import React from "react";
import { CheckCircle2, XCircle, ShieldCheck, Cpu } from "lucide-react";

export function BenchmarkCard(): React.JSX.Element {
  return (
    <div className="console-card benchmark-card" data-testid="benchmark-evidence-card">
      <div className="console-card-header">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-accent" />
          <span className="console-card-title">Deterministic Synthetic Benchmark</span>
        </div>
        <span className="benchmark-badge-offline">
          <Cpu size={12} />
          Offline Benchmark · 0 External API Calls
        </span>
      </div>

      <p className="benchmark-description">
        One race demonstrates the mechanism. 100 controlled races measure whether the
        behavior holds repeatedly under identical asynchronous timing conditions.
      </p>

      <div className="benchmark-table-wrapper">
        <table className="benchmark-table" aria-label="Deterministic Synthetic Benchmark Results">
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: "left" }}>Metric (100 Runs)</th>
              <th scope="col" style={{ textAlign: "center" }}>Naive Baseline</th>
              <th scope="col" style={{ textAlign: "center" }}>EchoFence</th>
              <th scope="col" style={{ textAlign: "right" }}>Delta / Impact</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="benchmark-metric-name">
                <div>
                  <strong>Stale speech rate</strong>
                  <span className="benchmark-metric-subtext">Obsolete audio played after user mind-change</span>
                </div>
              </td>
              <td className="benchmark-val-naive">
                <span className="flex items-center justify-center gap-1">
                  <XCircle size={14} className="text-error" />
                  100%
                </span>
              </td>
              <td className="benchmark-val-echofence">
                <span className="flex items-center justify-center gap-1 font-bold text-success">
                  <CheckCircle2 size={14} className="text-success" />
                  0%
                </span>
              </td>
              <td className="benchmark-val-delta">
                <span className="delta-pill-success">-100% (Zero Leaks)</span>
              </td>
            </tr>

            <tr>
              <td className="benchmark-metric-name">
                <div>
                  <strong>Stale state commits</strong>
                  <span className="benchmark-metric-subtext">Obsolete tool results saved to conversation</span>
                </div>
              </td>
              <td className="benchmark-val-naive">
                <span className="flex items-center justify-center gap-1">
                  <XCircle size={14} className="text-error" />
                  100%
                </span>
              </td>
              <td className="benchmark-val-echofence">
                <span className="flex items-center justify-center gap-1 font-bold text-success">
                  <CheckCircle2 size={14} className="text-success" />
                  0%
                </span>
              </td>
              <td className="benchmark-val-delta">
                <span className="delta-pill-success">-100% (Zero Corruption)</span>
              </td>
            </tr>

            <tr>
              <td className="benchmark-metric-name">
                <div>
                  <strong>Interruption recovery rate</strong>
                  <span className="benchmark-metric-subtext">Updated request accepted and spoken correctly</span>
                </div>
              </td>
              <td className="benchmark-val-naive">
                <span className="flex items-center justify-center gap-1">
                  50%
                </span>
              </td>
              <td className="benchmark-val-echofence">
                <span className="flex items-center justify-center gap-1 font-bold text-success">
                  <CheckCircle2 size={14} className="text-success" />
                  100%
                </span>
              </td>
              <td className="benchmark-val-delta">
                <span className="delta-pill-success">+50% (Deterministic)</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="benchmark-footer">
        <div className="benchmark-footer-stat">
          <span className="benchmark-stat-label">Audio stop latency:</span>
          <span className="benchmark-stat-value">&lt; 15 ms</span>
        </div>
        <div className="benchmark-footer-stat">
          <span className="benchmark-stat-label">Late tool guard:</span>
          <span className="benchmark-stat-value">100% Fenced</span>
        </div>
        <div className="benchmark-footer-stat">
          <span className="benchmark-stat-label">Methodology:</span>
          <span className="benchmark-stat-value">Deterministic Event Loop Harness</span>
        </div>
      </div>
    </div>
  );
}
