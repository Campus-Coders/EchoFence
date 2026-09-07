import React from "react";

export type MetricItem = {
  label: string;
  value: string;
  hint?: string;
  testId?: string;
  highlight?: "good" | "bad" | "info";
};

export type MetricsCardsProps = {
  activeGeneration?: string;
  previousGeneration?: string;
  interruptions?: string;
  staleResultsBlocked?: string;
  staleResultsSpoken?: string;
  finalSpokenGeneration?: string;
  audioStopLatency?: string;
  recoveryTime?: string;
};

export function MetricsCards({
  activeGeneration = "—",
  previousGeneration = "—",
  interruptions = "0",
  staleResultsBlocked = "—",
  staleResultsSpoken = "0",
  finalSpokenGeneration = "—",
  audioStopLatency = "—",
  recoveryTime = "—",
}: MetricsCardsProps): React.JSX.Element {
  const metrics: readonly MetricItem[] = [
    {
      label: "Active Generation",
      value: activeGeneration,
      hint: "Monotonic fence authority",
      testId: "metric-card-active-gen",
    },
    {
      label: "Previous / Stale Gen",
      value: previousGeneration,
      hint: "Invalidated generation",
      testId: "metric-card-previous-gen",
    },
    {
      label: "Stop Observed",
      value: audioStopLatency,
      hint: "Requested to stopped",
      testId: "metric-card-stop-latency",
    },
    {
      label: "Stale Results Blocked",
      value: staleResultsBlocked,
      hint: "Fenced late tool/audio",
      testId: "metric-card-stale-blocked",
      highlight: "good",
    },
    {
      label: "Stale Results Spoken",
      value: staleResultsSpoken,
      hint: "Strictly 0 (zero resurrection)",
      testId: "metric-card-stale-spoken",
      highlight: "good",
    },
    {
      label: "Spoken Generation",
      value: finalSpokenGeneration,
      hint: "Current audio generation",
      testId: "metric-card-spoken-gen",
    },
    {
      label: "Recovery Time",
      value: recoveryTime,
      hint: "Interrupt to new turn",
      testId: "metric-card-recovery-time",
    },
    {
      label: "Interruptions",
      value: interruptions,
      hint: "Barge-in events",
      testId: "metric-card-interruptions",
    },
  ] as const;

  return (
    <div className="metrics-grid">
      {metrics.map((item) => (
        <div key={item.label} className="metric-card" data-testid={item.testId}>
          <span className="metric-label">{item.label}</span>
          <span
            className={`metric-value ${
              item.highlight === "good" ? "text-emerald-400 font-bold" : ""
            }`}
          >
            {item.value}
          </span>
          {item.hint && <span className="metric-hint">{item.hint}</span>}
        </div>
      ))}
    </div>
  );
}
