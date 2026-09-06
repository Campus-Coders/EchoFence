"use client";

import React from "react";
import { History, CheckCircle2, XCircle } from "lucide-react";
import type { MeasurementRun } from "@/lib/measurement-types";

interface RunHistoryProps {
  runs: MeasurementRun[];
}

export function RunHistory({ runs }: RunHistoryProps): React.JSX.Element {
  if (!runs || runs.length === 0) {
    return (
      <div className="run-history-card console-card">
        <div className="run-history-header">
          <div className="flex items-center gap-2">
            <History size={16} className="text-accent" />
            <span className="run-history-title">Completed Stress Run History</span>
          </div>
          <span className="status-pill text-xs">0 Recorded Runs</span>
        </div>
        <div className="run-history-empty text-muted text-sm py-4 text-center">
          No runs recorded yet. Click <strong>[ Run Full Race Demo ]</strong> to execute the deterministic failure scenario.
        </div>
      </div>
    );
  }

  return (
    <div className="run-history-card console-card">
      <div className="run-history-header">
        <div className="flex items-center gap-2">
          <History size={16} className="text-accent" />
          <span className="run-history-title">Completed Stress Run History</span>
        </div>
        <span className="status-pill status-pill-ready text-xs">
          {runs.length} {runs.length === 1 ? "Run" : "Runs"} Retained
        </span>
      </div>

      <div className="run-history-table-wrapper">
        <table className="run-history-table">
          <thead>
            <tr>
              <th>Run ID</th>
              <th>Timestamp</th>
              <th>Status</th>
              <th>Authoritative Gen</th>
              <th>Protection</th>
              <th>Recovery</th>
              <th>Corruption</th>
              <th>Resurrection</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run, idx) => {
              const { snapshot } = run;
              const isLatest = idx === 0;
              const isPassed =
                snapshot.fence.active &&
                snapshot.transcript.corruptionCount === 0 &&
                snapshot.audio.resurrectionCount === 0 &&
                snapshot.staleResults.protectionRate === 100;

              return (
                <tr
                  key={run.runId}
                  className={`run-history-row ${isLatest ? "run-history-row-latest" : ""}`}
                >
                  <td className="font-mono text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-primary">{run.runId}</span>
                      {isLatest && (
                        <span className="status-pill status-pill-active text-[10px] py-0 px-1.5 font-sans">
                          LATEST
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="font-mono text-xs text-muted">
                    {new Date(run.startedAt).toLocaleTimeString()}
                  </td>
                  <td>
                    {isPassed ? (
                      <span className="status-pill status-pill-ready text-xs font-mono">
                        <CheckCircle2 size={11} className="inline mr-1 text-success" />
                        PASSED
                      </span>
                    ) : (
                      <span className="status-pill status-pill-error text-xs font-mono">
                        <XCircle size={11} className="inline mr-1 text-error" />
                        FAILED
                      </span>
                    )}
                  </td>
                  <td className="font-mono text-xs">
                    {snapshot.generation.activeGeneration !== null
                      ? `#${snapshot.generation.activeGeneration}`
                      : "—"}
                  </td>
                  <td className="font-mono text-xs text-success font-semibold">
                    {snapshot.staleResults.protectionRate}%
                  </td>
                  <td className="font-mono text-xs">
                    {snapshot.recovery.recoveryTimeMs !== null
                      ? `${snapshot.recovery.recoveryTimeMs} ms`
                      : "—"}
                  </td>
                  <td className="font-mono text-xs">
                    <span
                      className={
                        snapshot.transcript.corruptionCount === 0
                          ? "text-success"
                          : "text-error font-bold"
                      }
                    >
                      {snapshot.transcript.corruptionCount}
                    </span>
                  </td>
                  <td className="font-mono text-xs">
                    <span
                      className={
                        snapshot.audio.resurrectionCount === 0
                          ? "text-success"
                          : "text-error font-bold"
                      }
                    >
                      {snapshot.audio.resurrectionCount}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
