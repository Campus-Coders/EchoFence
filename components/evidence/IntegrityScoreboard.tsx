"use client";

import React from "react";
import { CheckCircle, XCircle, MinusCircle, Shield } from "lucide-react";
import type { MeasurementSnapshot } from "@/lib/measurement-types";

interface IntegrityScoreboardProps {
  measurement: MeasurementSnapshot;
}

export function IntegrityScoreboard({
  measurement,
}: IntegrityScoreboardProps): React.JSX.Element {
  const { fence, transcript, audio, staleResults, generation } = measurement;

  // Evaluate row invariants
  // 1. Generation Ownership
  const ownershipObserved = (generation.generationsStarted > 1 && generation.activeGeneration !== null);
  const ownershipPassed = ownershipObserved && (generation.activeGeneration !== null && generation.activeGeneration >= 2);
  const ownershipStatus = !ownershipObserved ? "NOT_YET_OBSERVED" : (ownershipPassed ? "PASS" : "FAIL");

  // 2. Transcript Integrity
  const transcriptPassed = transcript.corruptionCount === 0;
  const transcriptStatus = transcriptPassed ? "PASS" : "FAIL";

  // 3. Audio Integrity
  const audioPassed = audio.resurrectionCount === 0;
  const audioStatus = audioPassed ? "PASS" : "FAIL";

  // 4. Stale Result Protection
  const staleObserved = staleResults.attempted > 0;
  const stalePassed = staleObserved && staleResults.blocked === staleResults.attempted;
  const staleStatus = !staleObserved ? "NOT_YET_OBSERVED" : (stalePassed ? "PASS" : "FAIL");

  // 5. Generation Fence Status
  const fencePassed = fence.active;
  const fenceStatus = fencePassed ? "PASS" : "FAIL";

  const renderStatusBadge = (status: "PASS" | "FAIL" | "NOT_YET_OBSERVED") => {
    switch (status) {
      case "PASS":
        return (
          <span className="status-pill status-pill-ready font-mono text-xs">
            <CheckCircle size={12} className="inline mr-1" />
            PASS
          </span>
        );
      case "FAIL":
        return (
          <span className="status-pill status-pill-error font-mono text-xs">
            <XCircle size={12} className="inline mr-1" />
            FAIL
          </span>
        );
      case "NOT_YET_OBSERVED":
      default:
        return (
          <span className="status-pill font-mono text-xs text-muted">
            <MinusCircle size={12} className="inline mr-1" />
            NOT YET OBSERVED
          </span>
        );
    }
  };

  return (
    <div className="integrity-scoreboard-card console-card">
      <div className="scoreboard-header">
        <div className="scoreboard-title-group">
          <Shield size={16} className="text-accent" />
          <span className="scoreboard-title">Core Correctness & Integrity Scoreboard</span>
        </div>
        <span className="scoreboard-subtitle">
          Real-time enforcement of conversational and state invariants
        </span>
      </div>

      <div className="scoreboard-table-wrapper">
        <table className="scoreboard-table">
          <thead>
            <tr>
              <th>Invariant Guarantee</th>
              <th>Expected Behavior</th>
              <th>Runtime Evidence</th>
              <th className="text-right">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {/* Row 1: Generation Ownership */}
            <tr className="scoreboard-row" data-testid="scoreboard-row-ownership">
              <td className="font-semibold text-primary">Generation Ownership</td>
              <td className="text-secondary">Only active generation may commit output</td>
              <td className="font-mono text-xs text-muted">
                {generation.activeGeneration !== null
                  ? `Active: Gen #${generation.activeGeneration} | Superseded: ${generation.generationsInterrupted}`
                  : "No generation started"}
              </td>
              <td className="text-right">{renderStatusBadge(ownershipStatus)}</td>
            </tr>

            {/* Row 2: Transcript Integrity */}
            <tr className="scoreboard-row" data-testid="scoreboard-row-transcript">
              <td className="font-semibold text-primary">Transcript Integrity</td>
              <td className="text-secondary">No stale assistant message enters transcript</td>
              <td className="font-mono text-xs">
                <span className={transcript.corruptionCount === 0 ? "text-success" : "text-error"}>
                  Corruption Count: {transcript.corruptionCount}
                </span>
                <span className="text-muted ml-2">
                  (Blocked Stale Msgs: {transcript.staleAssistantMessagesBlocked})
                </span>
              </td>
              <td className="text-right">{renderStatusBadge(transcriptStatus)}</td>
            </tr>

            {/* Row 3: Audio Integrity */}
            <tr className="scoreboard-row" data-testid="scoreboard-row-audio">
              <td className="font-semibold text-primary">Audio Integrity</td>
              <td className="text-secondary">Stale generations cannot start or restart audio</td>
              <td className="font-mono text-xs">
                <span className={audio.resurrectionCount === 0 ? "text-success" : "text-error"}>
                  Resurrections: {audio.resurrectionCount}
                </span>
                <span className="text-muted ml-2">
                  (Blocked Starts: {audio.staleAudioStartsBlocked})
                </span>
              </td>
              <td className="text-right">{renderStatusBadge(audioStatus)}</td>
            </tr>

            {/* Row 4: Stale Result Protection */}
            <tr className="scoreboard-row" data-testid="scoreboard-row-stale">
              <td className="font-semibold text-primary">Stale Result Protection</td>
              <td className="text-secondary">All late async results reaching guard are blocked</td>
              <td className="font-mono text-xs text-muted">
                {staleObserved ? (
                  <span className="text-success font-semibold">
                    {staleResults.blocked} / {staleResults.attempted} Blocked ({staleResults.protectionRate}%)
                  </span>
                ) : (
                  "NO STALE RESULT OBSERVED"
                )}
              </td>
              <td className="text-right">{renderStatusBadge(staleStatus)}</td>
            </tr>

            {/* Row 5: Generation Fence Status */}
            <tr className="scoreboard-row" data-testid="scoreboard-row-fence">
              <td className="font-semibold text-primary">Generation Fence</td>
              <td className="text-secondary">Monotonic boundary active and validating calls</td>
              <td className="font-mono text-xs text-muted">
                Status: {fence.active ? "ACTIVE" : "DISABLED"} | Stale Operations Blocked: {fence.staleBlockedCount}
              </td>
              <td className="text-right">{renderStatusBadge(fenceStatus)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
