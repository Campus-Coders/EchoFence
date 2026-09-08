"use client";

import React, { useState, useEffect } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Volume2,
  Clock,
  XCircle,
  Zap,
} from "lucide-react";
import {
  raceDemoController,
  createInitialRaceResult,
  type RaceDemoResult,
} from "@/lib/race-demo-controller";
import { generationFence } from "@/lib/generation-fence";
import { interruptController } from "@/lib/interrupt-controller";
import { generationAudit } from "@/lib/generation-audit";

export interface GenerationTakeoverProps {
  onRunScenario?: () => void;
  delayedToolEnabled?: boolean;
}

export function GenerationTakeover({
  onRunScenario,
  delayedToolEnabled = false,
}: GenerationTakeoverProps): React.JSX.Element {
  const [mounted, setMounted] = useState<boolean>(false);
  const [raceState, setRaceState] = useState<RaceDemoResult>(() =>
    createInitialRaceResult()
  );
  const [currentGen, setCurrentGen] = useState<number>(0);
  const [staleBlocked, setStaleBlocked] = useState<number>(0);
  const [interruptionCount, setInterruptionCount] = useState<number>(0);

  useEffect(() => {
    setMounted(true);
    setRaceState(raceDemoController.getState());
    setCurrentGen(generationFence.getCurrentGeneration());
    setStaleBlocked(generationAudit.getStaleBlockedCount());
    setInterruptionCount(interruptController.getMetrics().interruptionCount);

    const unsubDemo = raceDemoController.subscribe((newState) => {
      setRaceState(newState);
    });

    const unsubFence = generationFence.subscribe((gen) => {
      setCurrentGen(gen);
    });

    const unsubAudit = generationAudit.subscribe(() => {
      setStaleBlocked(generationAudit.getStaleBlockedCount());
    });

    const unsubInterrupt = interruptController.subscribe((_res, metrics) => {
      setInterruptionCount(metrics.interruptionCount);
    });

    return () => {
      unsubDemo();
      unsubFence();
      unsubAudit();
      unsubInterrupt();
    };
  }, []);

  const isDemoRunning =
    mounted &&
    (raceState.status === "RUNNING" ||
      raceState.status === "WAITING_FOR_LATE_RESULT");
  const isDemoPassed = mounted && raceState.status === "PASSED";
  const hasInterruption =
    mounted &&
    (interruptionCount > 0 || raceState.interruptionTimestamp !== null);
  const hasBlockedStale =
    mounted && (staleBlocked > 0 || raceState.staleResultsBlocked > 0);
  const activeCurrentGen = mounted ? currentGen : 0;

  // Determine active step (0 = Clean Ready, 1 = G1 Working, 2 = Mind Change, 3 = G2 Active, 4 = G2 Speaking, 5 = G1 Late Blocked)
  let activeStep = 0;
  if (isDemoRunning) {
    if (raceState.status === "WAITING_FOR_LATE_RESULT") {
      activeStep = 4;
    } else if (raceState.generation2 !== null) {
      activeStep = 3;
    } else if (raceState.interruptionTimestamp !== null) {
      activeStep = 2;
    } else {
      activeStep = 1;
    }
  } else if (isDemoPassed || hasBlockedStale) {
    activeStep = 5;
  } else if (hasInterruption) {
    activeStep = 3;
  } else if (activeCurrentGen > 0) {
    activeStep = 1;
  }

  return (
    <div className="console-card generation-takeover-card" data-testid="generation-takeover-card">
      <div className="console-card-header">
        <div className="flex items-center gap-2">
          <div className="takeover-header-icon">
            <Zap size={16} className="text-accent" />
          </div>
          <div>
            <span className="console-card-title">Real-Time Generation Takeover</span>
            <span className="takeover-header-sub">
              Run the demo to watch authority transfer in real time.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isDemoRunning ? (
            <span className="status-pill status-pill-active">
              <span className="status-dot status-dot-pulse" />
              DEMO IN PROGRESS
            </span>
          ) : isDemoPassed || hasBlockedStale ? (
            <span className="status-pill status-pill-ready">
              <span className="status-dot" />
              FENCE VERIFIED · 0 LEAKS
            </span>
          ) : (
            <span className="status-pill">
              <span className="status-dot" />
              READY FOR A MIND CHANGE
            </span>
          )}

          {onRunScenario && (
            <button
              type="button"
              className="btn-takeover-run"
              onClick={onRunScenario}
              disabled={isDemoRunning}
              title="Run 4-second race demo to see Generation Takeover in action"
            >
              <Sparkles size={13} />
              <span>{isDemoRunning ? "Simulating..." : "Run Mind Change Demo"}</span>
            </button>
          )}
        </div>
      </div>

      {/* 5-Step Visual Flow Progression */}
      <div className="takeover-timeline" aria-label="Takeover Sequence Steps">
        <div className={`takeover-step ${activeStep >= 1 ? "takeover-step-active" : ""}`}>
          <div className="takeover-step-badge">1</div>
          <div className="takeover-step-content">
            <span className="takeover-step-title">G1 Working</span>
            <span className="takeover-step-desc">Mumbai hotel query</span>
          </div>
        </div>

        <div className="takeover-step-connector" />

        <div className={`takeover-step ${activeStep >= 2 ? "takeover-step-active" : ""}`}>
          <div className="takeover-step-badge">2</div>
          <div className="takeover-step-content">
            <span className="takeover-step-title">User Changes Mind</span>
            <span className="takeover-step-desc">Saturday query arrives</span>
          </div>
        </div>

        <div className="takeover-step-connector" />

        <div className={`takeover-step ${activeStep >= 3 ? "takeover-step-active" : ""}`}>
          <div className="takeover-step-badge">3</div>
          <div className="takeover-step-content">
            <span className="takeover-step-title">G1 Superseded &middot; G2 Active</span>
            <span className="takeover-step-desc">Authority transfers</span>
          </div>
        </div>

        <div className="takeover-step-connector" />

        <div className={`takeover-step ${activeStep >= 4 ? "takeover-step-active" : ""}`}>
          <div className="takeover-step-badge">4</div>
          <div className="takeover-step-content">
            <span className="takeover-step-title">G2 Speaking</span>
            <span className="takeover-step-desc">Real Rime voice</span>
          </div>
        </div>

        <div className="takeover-step-connector" />

        <div className={`takeover-step ${activeStep >= 5 ? "takeover-step-active" : ""}`}>
          <div className="takeover-step-badge">5</div>
          <div className="takeover-step-content">
            <span className="takeover-step-title">G1 Late Result Blocked</span>
            <span className="takeover-step-desc">Zero audio / state leak</span>
          </div>
        </div>
      </div>

      {/* Side-by-Side Generation Authority Cards */}
      <div className="takeover-cards-grid">
        {/* Generation 1 Card */}
        <div
          className={`takeover-gen-box ${
            activeStep >= 2
              ? "takeover-gen-box-superseded"
              : activeStep === 1
              ? "takeover-gen-box-working"
              : ""
          }`}
        >
          <div className="takeover-box-header">
            <div className="flex items-center gap-2">
              <span className="takeover-gen-pill gen-pill-g1">
                {raceState.generation1 ? `G${raceState.generation1}` : "G1"}
              </span>
              <span className="takeover-box-title">
                {activeStep >= 2
                  ? "Initial Request (Superseded)"
                  : activeStep === 1
                  ? "Initial Request (Working)"
                  : "Initial Request"}
              </span>
            </div>
            {activeStep >= 5 ? (
              <span className="badge-takeover-blocked">
                <XCircle size={12} />
                LATE RESULT BLOCKED
              </span>
            ) : activeStep >= 2 ? (
              <span className="badge-takeover-superseded">
                <ShieldAlert size={12} />
                SUPERSEDED
              </span>
            ) : activeStep === 1 ? (
              <span className="badge-takeover-working">
                <Clock size={12} />
                IN FLIGHT
              </span>
            ) : (
              <span className="badge-takeover-idle">READY TO START</span>
            )}
          </div>

          <div className="takeover-box-prompt">
            &ldquo;Find me a hotel in Mumbai for Friday.&rdquo;
          </div>

          <div className="takeover-box-details">
            <div className="takeover-detail-row">
              <span className="takeover-detail-label">Asynchronous Tool:</span>
              <span className="takeover-detail-value font-mono">
                searchHotelsDelayed {delayedToolEnabled ? "(4,000ms delay active)" : "(4,000ms)"}
              </span>
            </div>
            <div className="takeover-detail-row">
              <span className="takeover-detail-label">Fence Disposition:</span>
              <span className="takeover-detail-value">
                {activeStep >= 5 ? (
                  <strong className="text-error">100% Rejected at Boundary</strong>
                ) : activeStep >= 2 ? (
                  <span className="text-warning">Marked Stale &middot; Interrupted</span>
                ) : activeStep === 1 ? (
                  <span>Executing remote query...</span>
                ) : (
                  <span>Awaiting execution</span>
                )}
              </span>
            </div>
            <div className="takeover-detail-row">
              <span className="takeover-detail-label">Spoken Audio:</span>
              <span className="takeover-detail-value">
                {activeStep >= 2 ? (
                  <span className="text-error font-semibold">0 ms Spoken (Halted)</span>
                ) : (
                  <span>Pending tool arrival</span>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Takeover Transition Indicator */}
        <div className="takeover-arrow-column" aria-hidden="true">
          <div className="takeover-arrow-badge">
            <ArrowRight size={18} />
          </div>
          <span className="takeover-arrow-text">
            {activeStep >= 3 ? "Authority Transferred" : "Authority Transfer"}
          </span>
        </div>

        {/* Generation 2 Card */}
        <div
          className={`takeover-gen-box ${
            activeStep >= 3
              ? "takeover-gen-box-authoritative"
              : "takeover-gen-box-inactive"
          }`}
        >
          <div className="takeover-box-header">
            <div className="flex items-center gap-2">
              <span className="takeover-gen-pill gen-pill-g2">
                {raceState.generation2 ? `G${raceState.generation2}` : "G2"}
              </span>
              <span className="takeover-box-title">
                {activeStep >= 3 ? "Mind Change (Authoritative)" : "Mind Change Request"}
              </span>
            </div>
            {activeStep >= 5 ? (
              <span className="badge-takeover-authoritative">
                <CheckCircle2 size={12} />
                SPOKEN &amp; SECURED
              </span>
            ) : activeStep === 4 ? (
              <span className="badge-takeover-authoritative">
                <Volume2 size={12} className="animate-pulse" />
                SPEAKING REAL RIME AUDIO
              </span>
            ) : activeStep === 3 ? (
              <span className="badge-takeover-authoritative">
                <CheckCircle2 size={12} />
                ACTIVE AUTHORITY
              </span>
            ) : (
              <span className="badge-takeover-idle">STANDBY</span>
            )}
          </div>

          <div className="takeover-box-prompt">
            &ldquo;Actually, find me a flight to Mumbai on Saturday.&rdquo;
          </div>

          <div className="takeover-box-details">
            <div className="takeover-detail-row">
              <span className="takeover-detail-label">Voice Synthesis:</span>
              <span className="takeover-detail-value font-mono">
                Rime TTS &middot; Coda &middot; Astra
              </span>
            </div>
            <div className="takeover-detail-row">
              <span className="takeover-detail-label">Monotonic Authority:</span>
              <span className="takeover-detail-value">
                {activeStep >= 3 ? (
                  <strong className="text-success">G2 Authoritative (100% Owned)</strong>
                ) : (
                  <span>Awaiting user mind change</span>
                )}
              </span>
            </div>
            <div className="takeover-detail-row">
              <span className="takeover-detail-label">Transcript Safety:</span>
              <span className="takeover-detail-value">
                {activeStep >= 3 ? (
                  <span className="text-success font-semibold">0% Corruption &middot; Clean Commit</span>
                ) : (
                  <span>Guarded</span>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Outcome Banner */}
      <div className="takeover-outcome-bar">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-success" />
          <span className="takeover-outcome-text">
            <strong>EchoFence Invariant:</strong> Late results from superseded generations are
            fenced before reaching speech synthesis or conversational state.
          </span>
        </div>
        <div className="takeover-metrics-mini">
          <span>Stale Spoken: <strong className="text-success">0</strong></span>
          <span>&middot;</span>
          <span>Stale Blocked: <strong className="text-success">{mounted ? staleBlocked : 0}</strong></span>
          <span>&middot;</span>
          <span>Audio Resurrections: <strong className="text-success">0</strong></span>
        </div>
      </div>
    </div>
  );
}
