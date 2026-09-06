"use client";

import React, { useState, useEffect } from "react";
import { Play, Loader2, Sparkles, RefreshCw } from "lucide-react";
import { raceDemoController, type RaceDemoResult } from "@/lib/race-demo-controller";
import { RaceTimeline } from "./RaceTimeline";
import { InvariantPanel } from "./InvariantPanel";
import { DemoResultCard } from "./DemoResultCard";
import type { VoiceStateMachine } from "@/lib/voice-state-machine";
import type { ConversationTurn } from "@/types/conversation";

export type RaceDemoPanelProps = {
  stateMachine?: VoiceStateMachine;
  setTurns?: React.Dispatch<React.SetStateAction<ConversationTurn[]>>;
};

export function RaceDemoPanel({
  stateMachine,
  setTurns,
}: RaceDemoPanelProps): React.JSX.Element {
  const [demoState, setDemoState] = useState<RaceDemoResult>(() =>
    raceDemoController.getState()
  );

  useEffect(() => {
    const unsub = raceDemoController.subscribe((newResult) => {
      setDemoState(newResult);
    });
    return unsub;
  }, []);

  const isRunning =
    demoState.status === "RUNNING" ||
    demoState.status === "WAITING_FOR_LATE_RESULT";

  const handleRunDemo = async (): Promise<void> => {
    if (isRunning) return;
    await raceDemoController.runDemo({
      stateMachine,
      setTurns,
    });
  };

  const handleResetDemo = (): void => {
    raceDemoController.reset();
  };

  return (
    <div className="race-demo-card">
      {/* Top Banner & Guidance for Judges */}
      <div className="race-demo-hero">
        <div className="race-demo-hero-text">
          <div className="race-demo-tag">
            <Sparkles size={13} />
            DATA FORGE 2026 x RIME HACKATHON
          </div>
          <h2 className="race-demo-heading">
            EchoFence: Race-Safe Voice Agent Demonstration
          </h2>
          <p className="race-demo-subtext">
            Run the deterministic race to see a late asynchronous tool result attempt to overwrite a newer user request. EchoFence blocks the stale result before it can affect the transcript, audio, or voice state.
          </p>
        </div>

        <div className="race-demo-actions">
          <button
            type="button"
            className={`btn-run-race ${isRunning ? "btn-run-race-running" : ""}`}
            onClick={handleRunDemo}
            disabled={isRunning}
            aria-label="Run Full Race Demo"
          >
            {isRunning ? (
              <>
                <Loader2 size={18} className="status-dot-pulse" />
                <span>
                  {demoState.status === "WAITING_FOR_LATE_RESULT"
                    ? "Awaiting Late Tool (4s)..."
                    : "Executing Race..."}
                </span>
              </>
            ) : demoState.status === "PASSED" ? (
              <>
                <RefreshCw size={18} />
                <span>Re-Run Race Demo</span>
              </>
            ) : (
              <>
                <Play size={18} />
                <span>RUN FULL RACE DEMO</span>
              </>
            )}
          </button>

          {demoState.status !== "IDLE" && !isRunning && (
            <button
              type="button"
              className="btn-quick-prompt"
              onClick={handleResetDemo}
              title="Reset race demo view"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Live System Invariants Panel */}
      <InvariantPanel
        invariants={demoState.invariants}
        status={demoState.status}
      />

      {/* Live Visual Timeline of Gen 1 vs Gen 2 */}
      {demoState.timeline.length > 0 && (
        <RaceTimeline
          timeline={demoState.timeline}
          activeGen1={demoState.generation1}
          activeGen2={demoState.generation2}
        />
      )}

      {/* Deterministic Outcome Card when Passed or Failed */}
      {(demoState.status === "PASSED" || demoState.status === "FAILED") && (
        <DemoResultCard result={demoState} />
      )}
    </div>
  );
}
