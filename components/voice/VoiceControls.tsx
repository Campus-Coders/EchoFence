"use client";

import React from "react";
import { Mic, MicOff, Sparkles, Loader2, Volume2, ShieldAlert, Clock, RotateCcw } from "lucide-react";
import type { VoiceState } from "@/types/voice";

export type VoiceControlsProps = {
  voiceState: VoiceState;
  isListening: boolean;
  isSpeechSupported: boolean;
  onStartListening: () => void;
  onStopListening: () => void;
  onQuickTurn: (prompt: string) => void;
  onNormalFlow?: () => void;
  delayedToolEnabled?: boolean;
  onToggleDelayedTool?: () => void;
  onRunInterruptionScenario?: () => void;
  onInterrupt?: () => void;
  onResetDemo?: () => void;
  onSimulateRace?: () => void;
  onTestBargeIn?: () => void;
  onTestDelayedRace?: () => void;
  isBargeInMonitoring?: boolean;
  bargeInStatus?: string;
  disabled?: boolean;
  mode?: "all" | "talk" | "demo";
};

export function VoiceControls({
  voiceState,
  isListening,
  isSpeechSupported,
  onStartListening,
  onStopListening,
  onQuickTurn,
  onNormalFlow,
  delayedToolEnabled = false,
  onToggleDelayedTool,
  onRunInterruptionScenario,
  onInterrupt,
  onResetDemo,
  onSimulateRace,
  onTestBargeIn,
  onTestDelayedRace,
  isBargeInMonitoring = false,
  bargeInStatus = "idle",
  disabled = false,
  mode = "all",
}: VoiceControlsProps): React.JSX.Element {
  const isBusy = voiceState === "THINKING" || voiceState === "SPEAKING";

  const handleTalkClick = (): void => {
    if (isListening) {
      onStopListening();
    } else {
      onStartListening();
    }
  };

  const renderDemoControls = () => (
    <div
      className="demo-controls-bar console-card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "16px",
        backgroundColor: "rgba(15, 23, 42, 0.85)",
        border: "1px solid rgba(56, 189, 248, 0.3)",
        borderRadius: "12px",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.25)",
      }}
      aria-label="Hackathon Demo Controls"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid rgba(56, 189, 248, 0.15)",
          paddingBottom: "10px",
        }}
      >
        <span
          style={{
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.06em",
            color: "var(--color-accent, #38bdf8)",
            textTransform: "uppercase",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <Sparkles size={14} /> DEMO CONTROLS
        </span>
        <span
          style={{
            fontSize: "10px",
            fontFamily: "ui-monospace, monospace",
            color: "var(--color-text-muted, #94a3b8)",
            backgroundColor: "rgba(56, 189, 248, 0.08)",
            border: "1px solid rgba(56, 189, 248, 0.2)",
            padding: "2px 8px",
            borderRadius: "9999px",
          }}
        >
          STEP 19 VERIFIED
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px" }}>
        {/* 1. Normal Flow */}
        <button
          type="button"
          className="btn-quick-prompt"
          disabled={disabled || isListening || isBusy}
          onClick={onNormalFlow || (() => onQuickTurn("Find me a hotel in Mumbai for Friday."))}
          data-testid="btn-demo-normal-flow"
          title="Normal Flow: 'Find me a hotel in Mumbai for Friday.'"
          style={{ justifyContent: "center", margin: 0, padding: "10px 14px", fontSize: "12.5px" }}
        >
          <Sparkles size={14} className="text-cyan-400" />
          Normal Flow
        </button>

        {/* 2. Enable/Disable Delayed Tool */}
        <button
          type="button"
          className={`btn-quick-prompt ${delayedToolEnabled ? "btn-delayed-tool-active" : ""}`}
          style={{
            justifyContent: "center",
            margin: 0,
            padding: "10px 14px",
            fontSize: "12.5px",
            ...(delayedToolEnabled
              ? {
                  borderColor: "var(--color-accent, #38bdf8)",
                  backgroundColor: "rgba(56, 189, 248, 0.2)",
                  color: "#38bdf8",
                  fontWeight: 600,
                }
              : {}),
          }}
          onClick={onToggleDelayedTool}
          data-testid="btn-demo-delayed-tool-toggle"
          title={
            delayedToolEnabled
              ? "Delayed Tool is ON (4000ms delay active on subsequent turn)"
              : "Delayed Tool is OFF (click to enable 4000ms slow tool)"
          }
        >
          <Clock size={14} />
          {delayedToolEnabled ? "Delayed Tool: ON (4s)" : "Delayed Tool: OFF"}
        </button>

        {/* 3. Run Interruption Scenario */}
        <button
          type="button"
          className="btn-quick-prompt"
          disabled={disabled || isListening}
          onClick={onRunInterruptionScenario || onTestDelayedRace}
          data-testid="btn-demo-run-interruption"
          title="Run Interruption Scenario: Gen 1 Mumbai with 4s tool, interrupted by Gen 2 Saturday, fences late tool"
          style={{ justifyContent: "center", margin: 0, padding: "10px 14px", fontSize: "12.5px" }}
        >
          <ShieldAlert size={14} className="text-amber-400" />
          Run Interruption Scenario
        </button>

        {/* 4. Interrupt (Barge-In) */}
        <button
          type="button"
          className="btn-quick-prompt"
          disabled={disabled || !isBusy}
          onClick={onInterrupt}
          data-testid="btn-demo-interrupt"
          style={{
            justifyContent: "center",
            margin: 0,
            padding: "10px 14px",
            fontSize: "12.5px",
            ...(isBusy
              ? {
                  borderColor: "var(--color-error, #ef4444)",
                  color: "#ef4444",
                  backgroundColor: "rgba(239, 68, 68, 0.2)",
                  fontWeight: 600,
                }
              : {}),
          }}
          title={
            isBusy
              ? "Interrupt active speech or tool execution immediately (Barge-in)"
              : "Interrupt (enabled during speaking/thinking)"
          }
        >
          <ShieldAlert size={14} />
          Interrupt
        </button>

        {/* 5. Reset Demo */}
        <button
          type="button"
          className="btn-quick-prompt"
          onClick={onResetDemo}
          data-testid="btn-demo-reset"
          title="Reset demo state back to clean baseline"
          style={{ justifyContent: "center", margin: 0, padding: "10px 14px", fontSize: "12.5px" }}
        >
          <RotateCcw size={14} />
          Reset Demo
        </button>
      </div>
    </div>
  );

  const renderTalkControls = () => (
    <div
      className="voice-talk-panel console-card"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "20px 16px",
        backgroundColor: "rgba(15, 23, 42, 0.8)",
        border: "1px solid rgba(56, 189, 248, 0.25)",
        borderRadius: "12px",
        gap: "16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <span
          style={{
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.06em",
            color: "var(--color-text-secondary, #94a3b8)",
            textTransform: "uppercase",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <Mic size={14} className="text-cyan-400" /> CLICK TO TALK
        </span>
        {isBargeInMonitoring && (
          <span className="status-pill status-pill-active" title={`VAD status: ${bargeInStatus}`} style={{ fontSize: "11px", padding: "3px 8px" }}>
            <span className="status-dot status-dot-pulse" />
            VAD: {bargeInStatus ? bargeInStatus.toUpperCase() : "ACTIVE"}
          </span>
        )}
      </div>

      {/* Primary Prominent Interactive Talk Button */}
      <button
        type="button"
        className={isListening ? "btn-talk btn-talk-listening" : "btn-talk"}
        onClick={handleTalkClick}
        disabled={disabled || isBusy}
        aria-label={isListening ? "Stop listening" : "Click to speak"}
        style={{
          padding: "16px 36px",
          fontSize: "15px",
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          gap: "10px",
          borderRadius: "9999px",
          boxShadow: isListening
            ? "0 0 24px rgba(239, 68, 68, 0.4)"
            : "0 0 24px rgba(56, 189, 248, 0.35)",
          transform: "scale(1)",
          transition: "all 0.2s ease",
        }}
      >
        {isListening ? (
          <>
            <Mic size={22} className="animate-pulse" />
            <span>Listening... Click to Finish</span>
          </>
        ) : voiceState === "THINKING" ? (
          <>
            <Loader2 size={22} className="animate-spin text-amber-400" />
            <span>Thinking...</span>
          </>
        ) : voiceState === "SPEAKING" ? (
          <>
            <Volume2 size={22} className="animate-bounce text-emerald-400" />
            <span>Speaking Response...</span>
          </>
        ) : (
          <>
            <Mic size={22} />
            <span>Click to Talk</span>
          </>
        )}
      </button>

      {/* Quick Demo Turn Triggers */}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px", width: "100%" }}>
        <button
          type="button"
          className="btn-quick-prompt"
          disabled={disabled || isListening}
          onClick={() => onQuickTurn("Find me a hotel in Mumbai for Friday.")}
          style={{ fontSize: "12px", padding: "6px 12px" }}
        >
          <Sparkles size={13} className="text-cyan-400" />
          Mumbai (Friday)
        </button>

        <button
          type="button"
          className="btn-quick-prompt"
          disabled={disabled || isListening}
          onClick={() => onQuickTurn("Find something for Saturday under ₹5000")}
          style={{ fontSize: "12px", padding: "6px 12px" }}
        >
          <Sparkles size={13} className="text-cyan-400" />
          Saturday (&lt; ₹5000)
        </button>

        <button
          type="button"
          className="btn-quick-prompt"
          disabled={disabled || isListening}
          onClick={() => onQuickTurn("Can you find flights from Chennai to Mumbai on Tuesday?")}
          style={{ fontSize: "12px", padding: "6px 12px" }}
        >
          <Sparkles size={13} className="text-cyan-400" />
          Flight Search
        </button>

        <button
          type="button"
          className="btn-quick-prompt"
          disabled={disabled || isListening}
          onClick={() => onQuickTurn("Can you book a cinema ticket in Mumbai?")}
          style={{ fontSize: "12px", padding: "6px 12px" }}
        >
          <Sparkles size={13} className="text-cyan-400" />
          Cinema Ticket
        </button>

        {onTestBargeIn && (
          <button
            type="button"
            className="btn-quick-prompt"
            disabled={disabled || isListening}
            onClick={onTestBargeIn}
            title="Starts Gen 1 speech then barge-in interrupts with Gen 2 to verify immediate audio stop and no resurrection"
            style={{ fontSize: "12px", padding: "6px 12px" }}
          >
            <ShieldAlert size={13} className="text-amber-400" />
            Barge-In Test
          </button>
        )}

        {onTestDelayedRace && (
          <button
            type="button"
            className="btn-quick-prompt"
            disabled={disabled || isListening}
            onClick={onTestDelayedRace}
            title="Starts Gen 1 with 4s delayed tool, interrupts at 700ms, runs Gen 2, and verifies late Gen 1 tool arrival is fenced"
            style={{ fontSize: "12px", padding: "6px 12px" }}
          >
            <Clock size={13} className="text-purple-400" />
            Race Scenario (4s)
          </button>
        )}

        {onSimulateRace && (
          <button
            type="button"
            className="btn-quick-prompt"
            disabled={disabled || isListening || isBusy}
            onClick={onSimulateRace}
            title="Simulate slow Gen 1 interrupted by fast Gen 2 to test stale result blocking"
            style={{ fontSize: "12px", padding: "6px 12px" }}
          >
            <ShieldAlert size={13} className="text-rose-400" />
            Stale Race Test
          </button>
        )}
      </div>

      <div className="voice-notice" style={{ fontSize: "11.5px", color: "var(--color-text-muted)" }}>
        {isSpeechSupported ? (
          <span className="flex items-center gap-1.5">
            <Mic size={12} className="text-emerald-400" />
            Browser speech recognition active. Click microphone or use quick prompts.
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <MicOff size={12} className="text-amber-400" />
            Native microphone unavailable in this browser. Quick prompts run full voice flow.
          </span>
        )}
      </div>
    </div>
  );

  if (mode === "demo") {
    return <div className="voice-controls-panel voice-controls-demo-only">{renderDemoControls()}</div>;
  }

  if (mode === "talk") {
    return <div className="voice-controls-panel voice-controls-talk-only">{renderTalkControls()}</div>;
  }

  return (
    <div className="voice-controls-deck" style={{ display: "flex", flexDirection: "column", gap: "14px", width: "100%" }}>
      {renderTalkControls()}
      {renderDemoControls()}
    </div>
  );
}

