import React from "react";

export type MetricItem = {
  label: string;
  value: string;
  hint?: string;
};

export type MetricsCardsProps = {
  activeGeneration?: string;
  interruptions?: string;
  staleResultsBlocked?: string;
  audioStopLatency?: string;
  recoveryTime?: string;
};

export function MetricsCards({
  activeGeneration = "—",
  interruptions = "0",
  staleResultsBlocked = "—",
  audioStopLatency = "—",
  recoveryTime = "—",
}: MetricsCardsProps): React.JSX.Element {
  const metrics: readonly MetricItem[] = [
    {
      label: "Active Generation",
      value: activeGeneration,
      hint: "Monotonic fence ID",
    },
    {
      label: "Interruptions",
      value: interruptions,
      hint: "Barge-in events",
    },
    {
      label: "Audio Stop Latency",
      value: audioStopLatency,
      hint: "Requested to stopped",
    },
    {
      label: "Recovery Time",
      value: recoveryTime,
      hint: "Interrupt to new turn",
    },
    {
      label: "Stale Results Blocked",
      value: staleResultsBlocked,
      hint: "Stale async results fenced",
    },
  ] as const;

  return (
    <div className="metrics-grid">
      {metrics.map((item) => (
        <div key={item.label} className="metric-card">
          <span className="metric-label">{item.label}</span>
          <span className="metric-value">{item.value}</span>
          {item.hint && <span className="metric-hint">{item.hint}</span>}
        </div>
      ))}
    </div>
  );
}
