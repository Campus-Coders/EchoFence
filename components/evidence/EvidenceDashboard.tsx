"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
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
import { MeasurementDashboard } from "./MeasurementDashboard";
import type { MeasurementSnapshot } from "@/lib/measurement-types";
import type { GenerationAuditEvent } from "@/types/generation";
import type { DashboardData } from "./types";

interface EvidenceDashboardProps {
  initialData?: DashboardData;
  raceDemoPanel?: React.ReactNode;
  evidencePanel?: React.ReactNode;
  measurementDashboard?: React.ReactNode;
  eventTimelineFooter?: React.ReactNode;
}

function SectionFlowConnector({ label }: { label?: string }): React.JSX.Element {
  return (
    <div className="section-flow-divider" aria-hidden="true">
      <div className="flow-line" />
      <div className="flow-indicator">
        <span className="flow-arrow">↓</span>
        {label && <span className="flow-label">{label}</span>}
      </div>
      <div className="flow-line" />
    </div>
  );
}

export function EvidenceDashboard({
  initialData,
  raceDemoPanel,
  evidencePanel,
  measurementDashboard,
  eventTimelineFooter,
}: EvidenceDashboardProps): React.JSX.Element {
  const [data, setData] = useState<DashboardData | null>(initialData || null);
  const [measurement, setMeasurement] = useState<MeasurementSnapshot>(() =>
    initialData?.measurement || measurementPipeline.getSnapshot()
  );
  const [events, setEvents] = useState<GenerationAuditEvent[]>(() =>
    initialData?.generation?.events || generationAudit.getEvents(15)
  );
  const [judge, setJudge] = useState(() =>
    initialData?.judge || evidenceProjection.getJudgeDashboardPayload()
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isMountedRef = useRef<boolean>(true);
  const inFlightRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchDashboardData = useCallback(async (): Promise<void> => {
    if (!isMountedRef.current || inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    if (isMountedRef.current) {
      setIsRefreshing(true);
    }

    // Cancel any previous in-flight request cleanly
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const ac = new AbortController();
    abortControllerRef.current = ac;

    try {
      const res = await fetch("/api/evidence/dashboard", {
        signal: ac.signal,
        headers: { "Cache-Control": "no-cache" },
      });

      if (res.ok && isMountedRef.current) {
        const json = await res.json();
        if (json.success && json.data) {
          setData(json.data);

          // The browser's measurementPipeline is authoritative for live execution.
          // Server data must NEVER overwrite the live client measurement snapshot.
          const clientSnap = measurementPipeline.getSnapshot();
          const clientHasActivity =
            clientSnap.generation.generationsStarted > 0 ||
            clientSnap.interruption.count > 0 ||
            clientSnap.staleResults.attempted > 0;

          if (typeof window === "undefined" && !clientHasActivity && json.data.measurement) {
            setMeasurement(json.data.measurement);
          }
          if (typeof window === "undefined" && !clientHasActivity && json.data.judge) {
            setJudge(json.data.judge);
          }
          if (typeof window === "undefined" && !clientHasActivity && json.data.generation?.events) {
            setEvents(json.data.generation.events);
          }
        }
      }
    } catch (err: unknown) {
      // Suppress AbortError cleanly during unmount or request supersession
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      if (isMountedRef.current) {
        console.warn("[EvidenceDashboard] Error fetching dashboard data:", err);
      }
    } finally {
      inFlightRef.current = false;
      if (isMountedRef.current) {
        setIsRefreshing(false);
      }
    }
  }, []);

  // Coalesced debounce handler for high-frequency singleton subscriptions
  const triggerDebouncedFetch = useCallback((): void => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        void fetchDashboardData();
      }
    }, 250);
  }, [fetchDashboardData]);

  useEffect(() => {
    isMountedRef.current = true;

    if (typeof window !== "undefined") {
      console.log("[EvidenceDashboard-singleton-ref]", {
        pipelineInstanceId: measurementPipeline.instanceId,
      });
    }

    // Initial safe fetch
    void fetchDashboardData();

    // Subscribe directly to local singletons to guarantee instant reactive UI updates
    const unsubPipeline = measurementPipeline.subscribe((newSnap) => {
      if (isMountedRef.current) {
        setMeasurement(newSnap);
        setJudge(evidenceProjection.getJudgeDashboardPayload());
      }
      triggerDebouncedFetch();
    });

    const unsubDemo = raceDemoController.subscribe(() => {
      if (isMountedRef.current) {
        setMeasurement(measurementPipeline.getSnapshot());
        setJudge(evidenceProjection.getJudgeDashboardPayload());
      }
      triggerDebouncedFetch();
    });

    const unsubAudit = generationAudit.subscribe(() => {
      if (isMountedRef.current) {
        setEvents(generationAudit.getEvents(15));
        setJudge(evidenceProjection.getJudgeDashboardPayload());
      }
      triggerDebouncedFetch();
    });

    // Reasonable fallback interval (2500ms) with visibility check
    const interval = setInterval(() => {
      if (
        isMountedRef.current &&
        !inFlightRef.current &&
        typeof document !== "undefined" &&
        document.visibilityState !== "hidden"
      ) {
        void fetchDashboardData();
      }
    }, 2500);

    return () => {
      isMountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      clearInterval(interval);
      unsubPipeline();
      unsubDemo();
      unsubAudit();
    };
  }, [fetchDashboardData, triggerDebouncedFetch]);

  // Derive authoritative verdict dynamically from live runtime state
  const activeVerdict = (() => {
    const snap = measurement;
    const raceDemo = raceDemoController.getState();
    const runsList = measurementPipeline.getHistory();
    const isRunning =
      raceDemo.status === "RUNNING" ||
      raceDemo.status === "WAITING_FOR_LATE_RESULT";

    if (isRunning) {
      return {
        status: "RUNNING" as const,
        headline: "EVALUATION IN PROGRESS",
        subhead: "Generation 1 delayed tool active; awaiting barge-in and stale result boundary.",
        evaluatedAt: Date.now(),
      };
    }

    const hasCompletedRun = runsList.length > 0 || raceDemo.status === "PASSED" || raceDemo.status === "FAILED";
    const hasExecutedTurn = snap.generation.generationsStarted > 0;

    if (!hasCompletedRun && !hasExecutedTurn) {
      return data?.verdict || {
        status: "NOT_RUN" as const,
        headline: "NO STRESS RUN RECORDED",
        subhead: "Run the full race demo to evaluate system invariants and latency metrics.",
        evaluatedAt: Date.now(),
      };
    }

    const hasViolations =
      !snap.fence.active ||
      snap.transcript.corruptionCount > 0 ||
      snap.audio.resurrectionCount > 0 ||
      (snap.staleResults.attempted > 0 &&
        snap.staleResults.blocked < snap.staleResults.attempted) ||
      raceDemo.status === "FAILED";

    if (hasViolations) {
      return {
        status: "FAIL" as const,
        headline: "INVARIANT VIOLATION DETECTED",
        subhead: "One or more invariants failed during execution. Inspect the integrity scoreboard.",
        evaluatedAt: Date.now(),
      };
    }

    if (hasCompletedRun && raceDemo.status === "PASSED") {
      return {
        status: "PASS" as const,
        headline: "ALL SYSTEM INVARIANTS PASSED",
        subhead: "Stale async results blocked with 0% transcript corruption and 0 audio resurrections.",
        evaluatedAt: Date.now(),
      };
    }

    if (hasCompletedRun || snap.staleResults.blocked > 0) {
      return {
        status: "PASS" as const,
        headline: "ALL SYSTEM INVARIANTS PASSED",
        subhead: "Generation Fence verified: 100% protection rate across active turns.",
        evaluatedAt: Date.now(),
      };
    }

    return data?.verdict || {
      status: "NOT_RUN" as const,
      headline: "AWAITING FULL RACE DEMO",
      subhead: "Partial turns observed. Trigger the full race demo for complete verification.",
      evaluatedAt: Date.now(),
    };
  })();

  const runs = (data?.runs && data.runs.length > 0) ? data.runs : measurementPipeline.getHistory();

  return (
    <section className="evidence-dashboard-container" aria-label="Unified Evidence Dashboard">
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

      {/* SECTION 7 — SYSTEM STATUS & RUNTIME AUTHORITY */}
      <SystemStatusPanel status={judge.systemStatus} />

      <SectionFlowConnector label="Generation Timeline" />

      {/* SECTION 8 — GENERATION AUTHORITY TIMELINE */}
      <GenerationTimeline timeline={judge.timeline} />

      <SectionFlowConnector label="Generation Safety" />

      {/* SECTION 9 — CHRONOLOGICAL AUDIT EVENT TRACE */}
      <EvidenceEventLog events={events} />

      <SectionFlowConnector label="Hackathon Showcase" />

      {/* SECTION 10 — DATA FORGE 2026 x RIME HACKATHON */}
      <div className="hackathon-showcase-card rounded-xl border border-cyan-500/30 bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 p-5 shadow-xl backdrop-blur">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-widest text-cyan-400 font-mono">
              DATA FORGE 2026 × RIME HACKATHON
            </span>
            <h3 className="text-lg font-bold tracking-tight text-slate-100 mt-0.5">
              EchoFence: Race-Safe Voice Agent Demonstration
            </h3>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
              Run the deterministic race to see a late asynchronous tool result attempt to overwrite a newer user request. EchoFence blocks the stale result before it can affect the transcript, audio, or voice state.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 px-3 py-1 text-xs font-semibold text-cyan-300">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
              Live Rime Voice Active
            </span>
          </div>
        </div>
      </div>

      <SectionFlowConnector label="Core Architectural Invariant" />

      {/* SECTION 11 — CORE ARCHITECTURAL INVARIANT */}
      <CoreInvariantPanel invariants={judge.invariants} />

      <SectionFlowConnector label="Chaos Scenario Demonstration & Replay" />

      {/* SECTION 12 — CHAOS SCENARIO DEMONSTRATION & REPLAY */}
      <div className="space-y-4">
        <ChaosScenarioReplay
          scenarios={judge.scenarios}
          onScenarioExecuted={fetchDashboardData}
          demoModeEnabled={judge.demoModeEnabled}
        />
        {raceDemoPanel}
      </div>

      <SectionFlowConnector label="Evidence & Measurements" />

      {/* SECTION 13 — EVIDENCE & MEASUREMENTS */}
      {evidencePanel}

      <SectionFlowConnector label="System Verdict" />

      {/* SECTION 14 — SYSTEM VERDICT */}
      <EvidenceVerdict
        verdict={activeVerdict}
        fenceActive={measurement.fence.active}
        activeGeneration={measurement.generation.activeGeneration}
        protectionRate={measurement.staleResults.protectionRate}
      />

      <SectionFlowConnector label="Critical Performance & Correctness Metrics" />

      {/* SECTION 15 — CRITICAL PERFORMANCE & CORRECTNESS METRICS */}
      <EvidenceMetricGrid measurement={measurement} />

      <SectionFlowConnector label="Core Correctness & Integrity Scoreboard" />

      {/* SECTION 16 — CORE CORRECTNESS & INTEGRITY SCOREBOARD */}
      <IntegrityScoreboard measurement={measurement} />

      <SectionFlowConnector label="Quantitative Measurement Pipeline" />

      {/* SECTION 17 — QUANTITATIVE MEASUREMENT PIPELINE */}
      {measurementDashboard && React.isValidElement(measurementDashboard)
        ? React.cloneElement(
            measurementDashboard as React.ReactElement<{ customSnapshot?: MeasurementSnapshot }>,
            { customSnapshot: measurement }
          )
        : <MeasurementDashboard customSnapshot={measurement} />}

      <SectionFlowConnector label="Completed Stress Run History" />

      {/* SECTION 18 — COMPLETED STRESS RUN HISTORY */}
      <RunHistory runs={runs} />

      {eventTimelineFooter && (
        <>
          <SectionFlowConnector label="Event Timeline & Telemetry" />
          {/* SECTION 19 — EVENT TIMELINE & INTERRUPTION TELEMETRY */}
          {eventTimelineFooter}
        </>
      )}
    </section>
  );
}
