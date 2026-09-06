import React from "react";
import { Activity } from "lucide-react";
import type { VoiceState } from "@/types/voice";

export type AudioStateProps = {
  currentState?: VoiceState;
};

const ALL_STATES: readonly VoiceState[] = [
  "IDLE",
  "LISTENING",
  "THINKING",
  "SPEAKING",
  "INTERRUPTED",
  "RECOVERING",
] as const;

function getActiveChipClass(state: VoiceState): string {
  switch (state) {
    case "LISTENING":
      return "state-chip state-chip-active-listening";
    case "THINKING":
      return "state-chip state-chip-active-thinking";
    case "SPEAKING":
      return "state-chip state-chip-active-speaking";
    case "INTERRUPTED":
      return "state-chip state-chip-active-interrupted";
    case "RECOVERING":
      return "state-chip state-chip-active-recovering";
    case "IDLE":
    default:
      return "state-chip state-chip-active-idle";
  }
}

export function AudioState({
  currentState = "IDLE",
}: AudioStateProps): React.JSX.Element {
  return (
    <div className="console-card">
      <div className="console-card-header">
        <span className="console-card-title">
          <Activity size={16} />
          Voice State Machine
        </span>
        <span className="status-pill status-pill-ready">
          <span className="status-dot status-dot-pulse" />
          State: {currentState}
        </span>
      </div>

      <div className="state-chip-group">
        {ALL_STATES.map((state) => {
          const isActive = state === currentState;
          return (
            <span
              key={state}
              className={isActive ? getActiveChipClass(state) : "state-chip state-chip-inactive"}
            >
              <span className="status-dot" />
              {state}
            </span>
          );
        })}
      </div>
    </div>
  );
}
