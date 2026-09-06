"use client";

import React, { useState } from "react";
import {
  Flame,
  Play,
  ShieldCheck,
  AlertTriangle,
  HelpCircle,
  RefreshCw,
  Zap,
} from "lucide-react";
import type { DemoScenarioCard, ScenarioOutcome } from "@/types/evidence";

interface ChaosScenarioReplayProps {
  scenarios: DemoScenarioCard[];
  onScenarioExecuted?: () => void;
  demoModeEnabled?: boolean;
}

export function ChaosScenarioReplay({
  scenarios,
  onScenarioExecuted,
  demoModeEnabled = true,
}: ChaosScenarioReplayProps): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string>(scenarios[0]?.id || "");
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [executionMessage, setExecutionMessage] = useState<string | null>(null);

  const selectedScenario = scenarios.find((s) => s.id === selectedId) || scenarios[0];

  const executeScenarioLive = async () => {
    if (!selectedScenario || isRunning) return;

    try {
      setIsRunning(true);
      setExecutionMessage(null);

      const res = await fetch("/api/evidence/chaos-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: selectedScenario.id }),
      });

      const json = await res.json();
      if (json.success) {
        setExecutionMessage(
          `Scenario '${selectedScenario.name}' executed: Result = ${json.outcome}. Authority preserved.`
        );
        selectedScenario.outcome = json.outcome;
        if (onScenarioExecuted) {
          onScenarioExecuted();
        }
      } else {
        setExecutionMessage(`Execution error: ${json.error || "Unknown error"}`);
      }
    } catch (err) {
      setExecutionMessage(
        `Failed to run scenario: ${err instanceof Error ? err.message : "Network error"}`
      );
    } finally {
      setIsRunning(false);
    }
  };

  const getOutcomeBadge = (outcome: ScenarioOutcome) => {
    switch (outcome) {
      case "SAFE":
        return (
          <span
            className="inline-flex items-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-xs font-mono font-bold text-emerald-400"
            data-testid="scenario-outcome-badge"
          >
            <ShieldCheck size={14} /> SAFE — AUTHORITY PRESERVED
          </span>
        );
      case "UNSAFE":
        return (
          <span
            className="inline-flex items-center gap-1 rounded bg-rose-500/20 border border-rose-500/40 px-2.5 py-1 text-xs font-mono font-bold text-rose-400"
            data-testid="scenario-outcome-badge"
          >
            <AlertTriangle size={14} /> UNSAFE — AUTHORITY BREACH
          </span>
        );
      case "INCOMPLETE":
      default:
        return (
          <span
            className="inline-flex items-center gap-1 rounded bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 text-xs font-mono font-bold text-amber-400"
            data-testid="scenario-outcome-badge"
          >
            <HelpCircle size={14} /> INCOMPLETE
          </span>
        );
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl backdrop-blur">
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Flame size={20} className="text-amber-400" />
          <h3 className="text-base font-semibold tracking-wide text-slate-100">
            CHAOS SCENARIO DEMONSTRATION & REPLAY
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {demoModeEnabled && (
            <button
              onClick={executeScenarioLive}
              disabled={isRunning || !selectedScenario}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/25 transition disabled:opacity-50"
              data-testid="btn-run-chaos-scenario"
            >
              {isRunning ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              <span>Execute Scenario Live</span>
            </button>
          )}
        </div>
      </div>

      {executionMessage && (
        <div
          className="mb-4 rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-3 text-xs font-mono text-cyan-300 flex items-center gap-2"
          data-testid="chaos-execution-message"
        >
          <Zap size={14} className="text-cyan-400 shrink-0" />
          <span>{executionMessage}</span>
        </div>
      )}

      {/* Scenario Selector Tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        {scenarios.map((sc) => {
          const isSelected = sc.id === selectedScenario?.id;
          return (
            <button
              key={sc.id}
              onClick={() => {
                setSelectedId(sc.id);
                setExecutionMessage(null);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                isSelected
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                  : "bg-slate-950/60 text-slate-400 border border-slate-800 hover:text-slate-200"
              }`}
              data-testid={`tab-scenario-${sc.scenarioNumber}`}
            >
              Scenario {sc.scenarioNumber}: {sc.name}
            </button>
          );
        })}
      </div>

      {/* Selected Scenario Detailed Breakdown */}
      {selectedScenario && (
        <div
          className="rounded-lg border border-slate-800 bg-slate-950/80 p-4 space-y-4"
          data-testid="scenario-details-card"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
            <div>
              <span className="text-xs font-mono text-cyan-400 uppercase tracking-wider">
                Deterministic Stress Fixture #{selectedScenario.scenarioNumber}
              </span>
              <h4 className="text-base font-bold text-slate-100">
                {selectedScenario.name}
              </h4>
            </div>
            <div>{getOutcomeBadge(selectedScenario.outcome)}</div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
            {/* 1. Fault Injected */}
            <div className="rounded border border-slate-800/80 bg-slate-900/60 p-3">
              <span className="text-slate-400 block font-mono text-[11px] uppercase tracking-wider">
                1. Fault Injected
              </span>
              <span className="mt-1 block font-mono font-bold text-amber-300" data-testid="scenario-fault">
                {selectedScenario.fault}
              </span>
            </div>

            {/* 2. Injection Point */}
            <div className="rounded border border-slate-800/80 bg-slate-900/60 p-3">
              <span className="text-slate-400 block font-mono text-[11px] uppercase tracking-wider">
                2. Boundary Injection Point
              </span>
              <span className="mt-1 block font-mono font-bold text-cyan-300" data-testid="scenario-point">
                {selectedScenario.injectionPoint}
              </span>
            </div>

            {/* 3. Pre-Fault State */}
            <div className="rounded border border-slate-800/80 bg-slate-900/60 p-3">
              <span className="text-slate-400 block font-mono text-[11px] uppercase tracking-wider">
                3. Pre-Fault Authority State
              </span>
              <p className="mt-1 text-slate-300">{selectedScenario.preState}</p>
            </div>

            {/* 4. Failure Event */}
            <div className="rounded border border-slate-800/80 bg-slate-900/60 p-3">
              <span className="text-slate-400 block font-mono text-[11px] uppercase tracking-wider">
                4. Simulated Failure Event
              </span>
              <p className="mt-1 text-rose-300">{selectedScenario.failureEvent}</p>
            </div>

            {/* 5. Protection Mechanism */}
            <div className="rounded border border-slate-800/80 bg-slate-900/60 p-3">
              <span className="text-slate-400 block font-mono text-[11px] uppercase tracking-wider">
                5. Protection Mechanism Activated
              </span>
              <p className="mt-1 text-emerald-300">
                {selectedScenario.protectionMechanism}
              </p>
            </div>

            {/* 6. Newer Generation State */}
            <div className="rounded border border-slate-800/80 bg-slate-900/60 p-3">
              <span className="text-slate-400 block font-mono text-[11px] uppercase tracking-wider">
                6. Subsequent Generation Isolation
              </span>
              <p className="mt-1 text-cyan-300">
                {selectedScenario.newerGenerationState}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
