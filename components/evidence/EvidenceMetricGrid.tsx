"use client";

import React from "react";
import { Zap, RotateCcw, Cpu, ShieldAlert } from "lucide-react";
import type { MeasurementSnapshot } from "@/lib/measurement-types";

interface EvidenceMetricGridProps {
  measurement: MeasurementSnapshot;
}

export function EvidenceMetricGrid({
  measurement,
}: EvidenceMetricGridProps): React.JSX.Element {
  const { interruption, recovery, generation, staleResults } = measurement;

  const formatMs = (val: number | null | undefined): string => {
    if (val === null || val === undefined) return "—";
    return `${val} ms`;
  };

  return (
    <div className="evidence-metrics-grid-container">
      <div className="section-subtitle-bar">
        CRITICAL PERFORMANCE & CORRECTNESS METRICS
      </div>

      <div className="evidence-metrics-four-column">
        {/* Category 1: Interruption */}
        <div className="metric-group-card">
          <div className="metric-group-header">
            <Zap size={14} className="group-header-icon text-warning" />
            <span className="group-header-title">Interruption Latency</span>
          </div>
          <div className="metric-group-body">
            <div className="metric-item-row">
              <span className="metric-name">Detection</span>
              <span className="metric-stat font-mono" data-testid="metric-detection-latency">
                {formatMs(interruption.detectionLatencyMs)}
              </span>
            </div>
            <div className="metric-item-row">
              <span className="metric-name">Abort Signal</span>
              <span className="metric-stat font-mono" data-testid="metric-abort-latency">
                {formatMs(interruption.abortLatencyMs)}
              </span>
            </div>
            <div className="metric-item-row">
              <span className="metric-name">Audio Stop</span>
              <span className="metric-stat font-mono" data-testid="metric-stop-latency">
                {formatMs(interruption.audioStopLatencyMs)}
              </span>
            </div>
            <div className="metric-item-row metric-item-highlight">
              <span className="metric-name">Silence Total</span>
              <span className="metric-stat font-mono text-accent" data-testid="metric-silence-total">
                {formatMs(interruption.totalInterruptionToSilenceMs)}
              </span>
            </div>
          </div>
        </div>

        {/* Category 2: Recovery */}
        <div className="metric-group-card">
          <div className="metric-group-header">
            <RotateCcw size={14} className="group-header-icon text-accent" />
            <span className="group-header-title">Recovery Latency</span>
          </div>
          <div className="metric-group-body">
            <div className="metric-item-row">
              <span className="metric-name">Generation Switch</span>
              <span className="metric-stat font-mono" data-testid="metric-generation-switch">
                {formatMs(recovery.generationSwitchTimeMs)}
              </span>
            </div>
            <div className="metric-item-row metric-item-highlight">
              <span className="metric-name">Full Recovery</span>
              <span className="metric-stat font-mono text-accent" data-testid="metric-recovery-time">
                {formatMs(recovery.recoveryTimeMs)}
              </span>
            </div>
            <div className="metric-item-row">
              <span className="metric-name">Interruption Count</span>
              <span className="metric-stat font-mono" data-testid="metric-interruption-count">
                {interruption.count}
              </span>
            </div>
          </div>
        </div>

        {/* Category 3: Generation */}
        <div className="metric-group-card">
          <div className="metric-group-header">
            <Cpu size={14} className="group-header-icon text-secondary" />
            <span className="group-header-title">Generation Lifecycle</span>
          </div>
          <div className="metric-group-body">
            <div className="metric-item-row">
              <span className="metric-name">Active Generation</span>
              <span className="metric-stat font-mono" data-testid="metric-active-generation">
                {generation.activeGeneration !== null ? `#${generation.activeGeneration}` : "—"}
              </span>
            </div>
            <div className="metric-item-row">
              <span className="metric-name">Started</span>
              <span className="metric-stat font-mono" data-testid="metric-total-generations">
                {generation.generationsStarted}
              </span>
            </div>
            <div className="metric-item-row">
              <span className="metric-name">Interrupted</span>
              <span className="metric-stat font-mono text-warning" data-testid="metric-interrupted-requests">
                {generation.generationsInterrupted}
              </span>
            </div>
            <div className="metric-item-row">
              <span className="metric-name">Completed</span>
              <span className="metric-stat font-mono text-success" data-testid="metric-completed-requests">
                {generation.generationsCompleted}
              </span>
            </div>
          </div>
        </div>

        {/* Category 4: Stale Result Protection */}
        <div className="metric-group-card">
          <div className="metric-group-header">
            <ShieldAlert size={14} className="group-header-icon text-success" />
            <span className="group-header-title">Stale Result Protection</span>
          </div>
          <div className="metric-group-body">
            <div className="metric-item-row">
              <span className="metric-name">Stale Attempted</span>
              <span className="metric-stat font-mono" data-testid="metric-grid-stale-attempted">
                {staleResults.attempted}
              </span>
            </div>
            <div className="metric-item-row">
              <span className="metric-name">Stale Blocked</span>
              <span className="metric-stat font-mono text-error" data-testid="metric-grid-stale-blocked">
                {staleResults.blocked}
              </span>
            </div>
            <div className="metric-item-row">
              <span className="metric-name">Stale Spoken</span>
              <span
                className={`metric-stat font-mono ${measurement.transcript.corruptionCount === 0 ? "text-success" : "text-error"}`}
                data-testid="metric-stale-spoken"
              >
                0
              </span>
            </div>
            <div className="metric-item-row">
              <span className="metric-name">Resurrections</span>
              <span
                className={`metric-stat font-mono ${measurement.audio.resurrectionCount === 0 ? "text-success" : "text-error"}`}
                data-testid="metric-grid-audio-resurrections"
              >
                {measurement.audio.resurrectionCount}
              </span>
            </div>
            <div className="metric-item-row">
              <span className="metric-name">Corruptions</span>
              <span
                className={`metric-stat font-mono ${measurement.transcript.corruptionCount === 0 ? "text-success" : "text-error"}`}
                data-testid="metric-grid-transcript-corruptions"
              >
                {measurement.transcript.corruptionCount}
              </span>
            </div>
            <div className="metric-item-row metric-item-highlight">
              <span className="metric-name">Protection Rate</span>
              <span className="metric-stat font-mono text-success" data-testid="metric-grid-protection-rate">
                {staleResults.protectionRate}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
