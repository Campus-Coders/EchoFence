"use client";

import React from "react";
import { Mic, MicOff, Sparkles, Loader2, Volume2, ShieldAlert, Clock } from "lucide-react";
import type { VoiceState } from "@/types/voice";

export type VoiceControlsProps = {
  voiceState: VoiceState;
  isListening: boolean;
  isSpeechSupported: boolean;
  onStartListening: () => void;
  onStopListening: () => void;
  onQuickTurn: (prompt: string) => void;
  onSimulateRace?: () => void;
  onTestBargeIn?: () => void;
  onTestDelayedRace?: () => void;
  isBargeInMonitoring?: boolean;
  bargeInStatus?: string;
  disabled?: boolean;
};

export function VoiceControls({
  voiceState,
  isListening,
  isSpeechSupported,
  onStartListening,
  onStopListening,
  onQuickTurn,
  onSimulateRace,
  onTestBargeIn,
  onTestDelayedRace,
  isBargeInMonitoring = false,
  bargeInStatus = "idle",
  disabled = false,
}: VoiceControlsProps): React.JSX.Element {
  const isBusy = voiceState === "THINKING" || voiceState === "SPEAKING";

  const handleTalkClick = (): void => {
    if (isListening) {
      onStopListening();
    } else {
      onStartListening();
    }
  };

  return (
    <div className="voice-controls-panel">
      <div className="voice-actions-row">
        {/* Primary Interactive Talk Button */}
        <button
          type="button"
          className={
            isListening
              ? "btn-talk btn-talk-listening"
              : "btn-talk"
          }
          onClick={handleTalkClick}
          disabled={disabled || isBusy}
          aria-label={isListening ? "Stop listening" : "Click to speak"}
        >
          {isListening ? (
            <>
              <Mic size={18} />
              <span>Listening... Click to Finish</span>
            </>
          ) : voiceState === "THINKING" ? (
            <>
              <Loader2 size={18} className="status-dot-pulse" />
              <span>Thinking...</span>
            </>
          ) : voiceState === "SPEAKING" ? (
            <>
              <Volume2 size={18} className="status-dot-pulse" />
              <span>Speaking Response...</span>
            </>
          ) : (
            <>
              <Mic size={18} />
              <span>Click to Talk</span>
            </>
          )}
        </button>

        {/* Realtime VAD Barge-In Indicator */}
        {isBargeInMonitoring && (
          <span className="status-pill status-pill-active" title={`VAD status: ${bargeInStatus}`}>
            <span className="status-dot status-dot-pulse" />
            VAD Barge-In: {bargeInStatus ? bargeInStatus.toUpperCase() : "ACTIVE"}
          </span>
        )}

        {/* Quick Demo Turn Triggers for Reproducible Testing */}
        <button
          type="button"
          className="btn-quick-prompt"
          disabled={disabled || isListening || isBusy}
          onClick={() => onQuickTurn("Find me a hotel in Mumbai for Friday.")}
        >
          <Sparkles size={14} />
          Mumbai (Friday)
        </button>

        <button
          type="button"
          className="btn-quick-prompt"
          disabled={disabled || isListening || isBusy}
          onClick={() => onQuickTurn("Make that Saturday under 5000 rupees.")}
        >
          <Sparkles size={14} />
          Saturday (&lt; ₹5000)
        </button>

        {/* Deterministic Barge-In Interruption Button */}
        {onTestBargeIn && (
          <button
            type="button"
            className="btn-quick-prompt"
            disabled={disabled || isListening}
            onClick={onTestBargeIn}
            title="Starts Gen 1 speech then barge-in interrupts with Gen 2 to verify immediate audio stop and no resurrection"
          >
            <ShieldAlert size={14} />
            Test Barge-In (Interrupt Speaking)
          </button>
        )}

        {/* Deterministic 4s Delayed Tool Race Fixture */}
        {onTestDelayedRace && (
          <button
            type="button"
            className="btn-quick-prompt"
            disabled={disabled || isListening}
            onClick={onTestDelayedRace}
            title="Starts Gen 1 with 4s delayed tool, interrupts at 700ms, runs Gen 2, and verifies late Gen 1 tool arrival is fenced"
          >
            <Clock size={14} />
            Test 4s Delayed Race
          </button>
        )}

        {/* Deterministic Race Condition Simulation Button */}
        {onSimulateRace && (
          <button
            type="button"
            className="btn-quick-prompt"
            disabled={disabled || isListening || isBusy}
            onClick={onSimulateRace}
            title="Simulate slow Gen 1 interrupted by fast Gen 2 to test stale result blocking"
          >
            <ShieldAlert size={14} />
            Test Stale Race (Gen 1 vs Gen 2)
          </button>
        )}
      </div>

      <div className="voice-notice">
        {isSpeechSupported ? (
          <>
            <Mic size={13} />
            <span>Browser speech recognition available. Click to talk or use demo triggers.</span>
          </>
        ) : (
          <>
            <MicOff size={13} />
            <span>Browser speech recognition unavailable in this environment. Quick prompts run the full voice loop.</span>
          </>
        )}
      </div>
    </div>
  );
}
