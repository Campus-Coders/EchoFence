"use client";

import React from "react";
import { XCircle, CheckCircle2, Flame } from "lucide-react";
import type { MachineInvariantCheck } from "@/types/evidence";

interface CoreInvariantPanelProps {
  invariants: MachineInvariantCheck[];
}

export function CoreInvariantPanel({ invariants }: CoreInvariantPanelProps): React.JSX.Element {
  const allPassed = invariants.every((i) => i.status === "PASS");

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl backdrop-blur">
      {/* Banner Motto */}
      <div className="mb-4 rounded-lg border border-cyan-500/30 bg-gradient-to-r from-cyan-950/40 via-slate-950 to-indigo-950/40 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Flame size={22} className="animate-pulse" />
            </div>
            <div>
              <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">
                Core Architectural Invariant
              </span>
              <h2 className="text-lg sm:text-xl font-black tracking-tight text-slate-100">
                CHAOS MAY BREAK EXECUTION. CHAOS MUST NOT BREAK OWNERSHIP.
              </h2>
              <p className="text-xs text-cyan-300/80 font-mono mt-1">
                Central Rule: Only the currently authoritative generation may affect transcript, audio, or voice state.
              </p>
            </div>
          </div>
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-xs text-slate-400">System Verdict</span>
            <span
              className={`text-sm font-bold uppercase tracking-wider ${
                allPassed ? "text-emerald-400" : "text-rose-400"
              }`}
              data-testid="invariants-overall-badge"
            >
              {allPassed ? "All Invariants Preserved" : "Invariant Violation"}
            </span>
          </div>
        </div>
      </div>

      {/* Machine-derived Status Checks */}
      <div className="space-y-2.5">
        {invariants.map((inv) => {
          const isPass = inv.status === "PASS";
          return (
            <div
              key={inv.id}
              className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border p-3.5 transition-colors ${
                isPass
                  ? "border-emerald-500/20 bg-emerald-950/10 hover:border-emerald-500/40"
                  : "border-rose-500/40 bg-rose-950/20 hover:border-rose-500/60"
              }`}
              data-testid={`invariant-card-${inv.id}`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  {isPass ? (
                    <CheckCircle2 size={18} className="text-emerald-400" />
                  ) : (
                    <XCircle size={18} className="text-rose-400" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-mono font-bold tracking-wider ${
                        isPass
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                      }`}
                      data-testid={`invariant-status-${inv.id}`}
                    >
                      [{inv.status}]
                    </span>
                    <h4 className="text-sm font-semibold text-slate-100">
                      {inv.description}
                    </h4>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{inv.principle}</p>
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs font-mono self-end sm:self-center">
                <div className="text-right">
                  <span className="text-slate-400 block text-[10px] uppercase tracking-wider">
                    Observed / Formula
                  </span>
                  <span
                    className={`font-semibold ${
                      isPass ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {inv.observedValue}
                  </span>
                </div>
                <div className="hidden md:block rounded border border-slate-800 bg-slate-950/80 px-2.5 py-1 text-slate-400">
                  <code>{inv.formula}</code>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
