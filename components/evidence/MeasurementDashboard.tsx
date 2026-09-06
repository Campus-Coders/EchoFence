"use client";

import React, { useState, useEffect } from "react";
import {
  Activity,
  Zap,
  RotateCcw,
  ShieldCheck,
  FileText,
  Cpu,
} from "lucide-react";
import { measurementPipeline } from "@/lib/measurement-pipeline";
import type { MeasurementSnapshot } from "@/lib/measurement-types";

interface MeasurementDashboardProps {
  customSnapshot?: MeasurementSnapshot;
}

export function MeasurementDashboard({
  customSnapshot,
}: MeasurementDashboardProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<MeasurementSnapshot>(() =>
    customSnapshot || measurementPipeline.getSnapshot()
  );

  useEffect(() => {
    if (customSnapshot) {
      setSnapshot(customSnapshot);
      return;
    }

    const unsubscribe = measurementPipeline.subscribe((newSnapshot) => {
      setSnapshot(newSnapshot);
    });

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/evidence/metrics");
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            setSnapshot(json.data);
          }
        }
      } catch {
        // Fall back to local subscription
      }
    }, 1000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [customSnapshot]);

  const formatMs = (val: number | null): string => {
    if (val === null || val === undefined) return "—";
    return `${val} ms`;
  };

  const {
    interruption,
    recovery,
    staleResults,
    transcript,
    audio,
    fence,
    generation,
  } = snapshot;

  return (
    <section className="measurement-dashboard console-card" aria-label="Measurement Dashboard">
      <div className="measurement-dashboard-header">
        <div className="dashboard-title-group">
          <Activity size={18} className="dashboard-icon" />
          <h3 className="dashboard-title">Quantitative Measurement Pipeline</h3>
        </div>
        <span className="measurement-session-pill">
          Session: <code className="metric-mono" suppressHydrationWarning>{snapshot.sessionId.slice(0, 16)}</code>
        </span>
      </div>

      <div className="measurement-grid">
        {/* Category 1: Interruption Latencies */}
        <div className="measurement-category-card">
          <div className="category-header">
            <Zap size={14} className="category-icon" />
            <span className="category-title">Interruption Latencies</span>
          </div>
          <div className="category-metrics">
            <div className="metric-row">
              <span className="metric-label">Detection Latency</span>
              <span className="metric-value metric-mono">
                {formatMs(interruption.detectionLatencyMs)}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Abort Signal Latency</span>
              <span className="metric-value metric-mono">
                {formatMs(interruption.abortLatencyMs)}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Audio Stop Latency</span>
              <span className="metric-value metric-mono">
                {formatMs(interruption.audioStopLatencyMs)}
              </span>
            </div>
            <div className="metric-row metric-row-highlight">
              <span className="metric-label">Interruption → Silence</span>
              <span className="metric-value metric-mono">
                {formatMs(interruption.totalInterruptionToSilenceMs)}
              </span>
            </div>
          </div>
        </div>

        {/* Category 2: Recovery Latencies */}
        <div className="measurement-category-card">
          <div className="category-header">
            <RotateCcw size={14} className="category-icon" />
            <span className="category-title">Recovery Latencies</span>
          </div>
          <div className="category-metrics">
            <div className="metric-row">
              <span className="metric-label">Generation Switch</span>
              <span className="metric-value metric-mono">
                {formatMs(recovery.generationSwitchTimeMs)}
              </span>
            </div>
            <div className="metric-row metric-row-highlight">
              <span className="metric-label">Full Turn Recovery</span>
              <span className="metric-value metric-mono">
                {formatMs(recovery.recoveryTimeMs)}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Interruption Count</span>
              <span className="metric-value metric-mono">
                {interruption.count}
              </span>
            </div>
          </div>
        </div>

        {/* Category 3: Stale Result Correctness */}
        <div className="measurement-category-card">
          <div className="category-header">
            <ShieldCheck size={14} className="category-icon" />
            <span className="category-title">Stale Result Correctness</span>
          </div>
          <div className="category-metrics">
            <div className="metric-row">
              <span className="metric-label">Stale Attempts</span>
              <span className="metric-value metric-mono">
                {staleResults.attempted}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Stale Results Blocked</span>
              <span className="metric-value metric-mono text-error">
                {staleResults.blocked}
              </span>
            </div>
            <div className="metric-row metric-row-highlight">
              <span className="metric-label">Protection Rate</span>
              <span className="metric-value metric-mono text-success">
                {staleResults.protectionRate}%
              </span>
            </div>
          </div>
        </div>

        {/* Category 4: Integrity Verification */}
        <div className="measurement-category-card">
          <div className="category-header">
            <FileText size={14} className="category-icon" />
            <span className="category-title">Integrity Verification</span>
          </div>
          <div className="category-metrics">
            <div className="metric-row">
              <span className="metric-label">Transcript Corruption</span>
              <span className={`metric-value metric-mono ${transcript.corruptionCount === 0 ? "text-success" : "text-error"}`}>
                {transcript.corruptionCount}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Audio Resurrections</span>
              <span className={`metric-value metric-mono ${audio.resurrectionCount === 0 ? "text-success" : "text-error"}`}>
                {audio.resurrectionCount}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Stale Audio Blocked</span>
              <span className="metric-value metric-mono">
                {audio.staleAudioStartsBlocked}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Fence Guard Status</span>
              <span className={`status-pill ${fence.active ? "status-pill-ready" : "status-pill-error"}`}>
                {fence.active ? "ACTIVE" : "INACTIVE"}
              </span>
            </div>
          </div>
        </div>

        {/* Category 5: Generation Lifecycle */}
        <div className="measurement-category-card">
          <div className="category-header">
            <Cpu size={14} className="category-icon" />
            <span className="category-title">Generation Lifecycle</span>
          </div>
          <div className="category-metrics">
            <div className="metric-row">
              <span className="metric-label">Active Generation ID</span>
              <span className="metric-value metric-mono">
                {generation.activeGeneration !== null ? `#${generation.activeGeneration}` : "—"}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Generations Started</span>
              <span className="metric-value metric-mono">
                {generation.generationsStarted}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Generations Interrupted</span>
              <span className="metric-value metric-mono text-warning">
                {generation.generationsInterrupted}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Generations Completed</span>
              <span className="metric-value metric-mono text-success">
                {generation.generationsCompleted}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
