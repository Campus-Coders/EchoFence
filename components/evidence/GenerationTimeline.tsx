"use client";

import React from "react";
import { GitCommit, ShieldAlert, CheckCircle, Clock, Ban } from "lucide-react";
import type { TimelineGenerationEvent } from "@/types/evidence";

interface GenerationTimelineProps {
  timeline: TimelineGenerationEvent[];
}

export function GenerationTimeline({ timeline }: GenerationTimelineProps): React.JSX.Element {
  const [activeTimeline, setActiveTimeline] = React.useState<TimelineGenerationEvent[]>([]);

  React.useEffect(() => {
    setActiveTimeline(timeline || []);
  }, [timeline]);

  const isEmpty = activeTimeline.length === 0;

  return (
    <div className="generation-timeline-panel rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl backdrop-blur">
      <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <GitCommit size={20} className="text-cyan-400" />
          <h3 className="text-base font-semibold tracking-wide text-slate-100">
            GENERATION AUTHORITY TIMELINE
          </h3>
        </div>
        <span className="text-xs font-mono text-slate-400">
          {isEmpty
            ? "Standby: 0 boundaries"
            : `Showing ${activeTimeline.length} recent generation boundaries`}
        </span>
      </div>

      <div className="generation-timeline-list">
        {isEmpty ? (
          <p className="text-sm text-slate-400 py-2">
            No generation events recorded yet. Start a voice turn or execute the race demo to observe timeline transitions.
          </p>
        ) : (
          <div className="space-y-3">
            {activeTimeline.map((item) => {
            const isBlocked = !item.allowed;
            const isInterrupted = item.authorityState === "INTERRUPTED";

            return (
              <div
                key={item.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-slate-800/80 bg-slate-950/70 p-3.5 hover:border-slate-700 transition-colors"
                data-testid={`timeline-event-${item.id}`}
              >
                <div className="flex items-start sm:items-center gap-2.5">
                  {/* Node indicator dot */}
                  <span
                    className={`mt-0.5 sm:mt-0 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                      isBlocked
                        ? "bg-rose-500/20 text-rose-400 ring-2 ring-rose-500/50"
                        : isInterrupted
                        ? "bg-amber-500/20 text-amber-400 ring-2 ring-amber-500/50"
                        : "bg-cyan-500/20 text-cyan-400 ring-2 ring-cyan-500/50"
                    }`}
                  >
                    {isBlocked ? <Ban size={10} /> : <CheckCircle size={10} />}
                  </span>

                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs font-bold text-cyan-300">
                        G{item.generationId}
                      </span>
                      <span className="font-mono text-xs font-semibold text-slate-200">
                        {item.eventType}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.2 text-[10px] font-bold uppercase tracking-wider ${
                          item.authorityState === "AUTHORITATIVE"
                            ? "bg-emerald-500/15 text-emerald-400"
                            : item.authorityState === "INTERRUPTED"
                            ? "bg-amber-500/15 text-amber-400"
                            : "bg-rose-500/15 text-rose-400"
                        }`}
                      >
                        {item.authorityState}
                      </span>
                    </div>

                    {item.blockingReason && (
                      <div className="mt-1.5 flex items-start gap-1.5 text-xs text-rose-400">
                        <ShieldAlert size={14} className="mt-0.5 shrink-0 text-rose-400" />
                        <span>{item.blockingReason}</span>
                      </div>
                    )}

                    {item.details && !item.blockingReason && (
                      <p className="mt-1 text-xs text-slate-400">{item.details}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center font-mono text-[11px] text-slate-400">
                  <Clock size={12} className="text-slate-400" />
                  <span>+{item.relativeOffsetMs}ms</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
