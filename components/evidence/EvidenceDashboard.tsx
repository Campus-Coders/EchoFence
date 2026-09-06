"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Shield, RefreshCw, ExternalLink } from "lucide-react";
import { EvidenceVerdict } from "./EvidenceVerdict";
import { EvidenceMetricGrid } from "./EvidenceMetricGrid";
import { IntegrityScoreboard } from "./IntegrityScoreboard";
import { RunHistory } from "./RunHistory";
import { EvidenceEventLog } from "./EvidenceEventLog";
import { SystemStatusPanel } from "./SystemStatusPanel";
import { CoreInvariantPanel } from "./CoreInvariantPanel";
import { GenerationTimeline } from "./GenerationTimeline";
import { ChaosScenarioReplay } from "./ChaosScenarioReplay";
import { measurementPipeline } from "@/lib/measurement-pipeline";
import { raceDemoController } from "@/lib/race-demo-controller";
import { generationAudit } from "@/lib/generation-audit";
import { evidenceProjection } from "@/lib/evidence-projection";
import type { DashboardData } from "./types";

interface EvidenceDashboardProps {
  initialData?: DashboardData;
}

export function EvidenceDashboard({
  initialData,
}: EvidenceDashboardProps): React.JSX.Element {
  const [data, setData] = useState<DashboardData | null>(initialData || null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchDashboardData = async () => {
    try {
      setIsRefreshing(true);
      const res = await fetch("/api/evidence/dashboard");
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setData(json.data);
        }
      }
    } catch (err) {
      console.warn("[EvidenceDashboard] Error fetching dashboard data:", err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchDashboardData();

    // Subscribe to local singletons for immediate instant reactivity
    const unsubPipeline = measurementPipeline.subscribe(() => {
      fetchDashboardData();
    });

    const unsubDemo = raceDemoController.subscribe(() => {
      fetchDashboardData();
    });

    const unsubAudit = generationAudit.subscribe(() => {
      fetchDashboardData();
    });

    // Fallback polling interval (1000ms)
    const interval = setInterval(fetchDashboardData, 1000);

    return () => {
      unsubPipeline();
      unsubDemo();
      unsubAudit();
      clearInterval(interval);
    };
  }, []);

  // Fallback state if initial fetch has not completed yet
  const measurement = data?.measurement || measurementPipeline.getSnapshot();
  const verdict = data?.verdict || {
    status: "NOT_RUN",
    headline: "NO STRESS RUN RECORDED",
    subhead: "Run the full race demo to evaluate system invariants and latency metrics.",
    evaluatedAt: Date.now(),
  };
  const runs = data?.runs || measurementPipeline.getHistory();
  const events = data?.generation?.events || generationAudit.getEvents(15);
  const judge = data?.judge || evidenceProjection.getJudgeDashboardPayload();

  return (
    <section className="evidence-dashboard-container space-y-6" aria-label="Unified Evidence Dashboard">
      {/* Dashboard Section Header */}
      <div className="evidence-dashboard-header">
        <div className="dashboard-header-brand">
          <div className="brand-icon">
            <Shield size={22} className="text-accent" />
          </div>
          <div>
            <h2 className="dashboard-main-title">
              ECHOFENCE — UNIFIED EVIDENCE DASHBOARD
            </h2>
            <p className="dashboard-main-subtitle">
              Authoritative system proof: live verification that stale speech and late tool results never compromise conversational integrity.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/evidence"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"
            data-testid="link-evidence-full"
          >
            <span>Full Evidence View</span>
            <ExternalLink size={13} />
          </Link>

          <button
            onClick={fetchDashboardData}
            className="btn-dashboard-refresh"
            title="Refresh Dashboard"
            disabled={isRefreshing}
            data-testid="btn-dashboard-refresh"
          >
            <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
            <span>Sync Evidence</span>
          </button>
        </div>
      </div>

      {/* 1. Core Invariant Panel (Motto & Machine-Derived Checks) */}
      <CoreInvariantPanel invariants={judge.invariants} />

      {/* 2. System Status Panel (Real-time authority & telemetry) */}
      <SystemStatusPanel status={judge.systemStatus} />

      {/* 3. Generation Authority Timeline */}
      <GenerationTimeline timeline={judge.timeline} />

      {/* 4. Chaos Scenario Replay & Live Runner */}
      <ChaosScenarioReplay
        scenarios={judge.scenarios}
        onScenarioExecuted={fetchDashboardData}
        demoModeEnabled={judge.demoModeEnabled}
      />

      {/* 5. Overall System Verdict */}
      <EvidenceVerdict
        verdict={verdict}
        fenceActive={measurement.fence.active}
        activeGeneration={measurement.generation.activeGeneration}
        protectionRate={measurement.staleResults.protectionRate}
      />

      {/* 6. Critical Metric Grid */}
      <EvidenceMetricGrid measurement={measurement} />

      {/* 7. Core Integrity Scoreboard */}
      <IntegrityScoreboard measurement={measurement} />

      {/* 8. Completed Run History */}
      <RunHistory runs={runs} />

      {/* 9. Chronological Audit Proof Trace */}
      <EvidenceEventLog events={events} />
    </section>
  );
}
