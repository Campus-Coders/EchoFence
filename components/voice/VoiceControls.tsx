"use client";

import React, { useState } from "react";
import {
  Mic,
  MicOff,
  Sparkles,
  Loader2,
  Volume2,
  ShieldAlert,
  Clock,
  RotateCcw,
  Send,
  Square,
  Zap,
} from "lucide-react";
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
  const [textInput, setTextInput] = useState("");
  const isBusy = voiceState === "THINKING" || voiceState === "SPEAKING";

  const handleTalkClick = (): void => {
    if (isListening) {
      onStopListening();
    } else {
      onStartListening();
    }
  };

  const handleTextSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const query = textInput.trim();
    if (!query) return;
    setTextInput("");
    onQuickTurn(query);
  };

  const renderDemoControls = () => (
    <div
      className="demo-controls-bar console-card"
      aria-label="Try the Safety Demo"
    >
      <div className="demo-controls-header">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-accent" />
          <span className="demo-controls-title">TRY THE SAFETY DEMO</span>
        </div>
        <span className="demo-verified-pill" title="Step 19 Invariants Verified">VERIFIED</span>
      </div>
      <p className="demo-controls-subtitle">
        Experience how EchoFence halts obsolete speech and fences late tool results when you change your mind.
      </p>

      {/* Dominant Primary Action */}
      <div className="demo-primary-action-wrap">
        <button
          type="button"
          className="btn-demo-dominant"
          disabled={disabled || isListening}
          onClick={onRunInterruptionScenario || onTestDelayedRace}
          data-testid="btn-demo-run-interruption"
          title="Run full interruption race: Gen 1 Mumbai with 4s tool, interrupted by Gen 2 Saturday, fences late tool"
        >
          <Zap size={18} className="fill-current text-amber-300" />
          <span>RUN INTERRUPTION DEMO</span>
        </button>
      </div>

      {/* Secondary / Advanced Controls */}
      <div className="demo-secondary-controls">
        <span className="secondary-controls-label">Advanced controls:</span>
        <div className="secondary-buttons-wrap">
          {/* Normal Flow */}
          <button
            type="button"
            className="btn-demo-action-secondary"
            disabled={disabled || isListening || isBusy}
            onClick={onNormalFlow || (() => onQuickTurn("Find me a hotel in Mumbai for Friday."))}
            data-testid="btn-demo-normal-flow"
            title="Normal Flow: 'Find me a hotel in Mumbai for Friday.'"
          >
            <Sparkles size={13} className="text-accent" />
            <span>Normal Flow</span>
          </button>

          {/* Enable/Disable Delayed Tool */}
          <button
            type="button"
            className={`btn-demo-action-secondary ${delayedToolEnabled ? "btn-delayed-tool-active" : ""}`}
            onClick={onToggleDelayedTool}
            data-testid="btn-demo-delayed-tool-toggle"
            title={
              delayedToolEnabled
                ? "Delayed Tool is ON (4,000ms delay active on subsequent turn)"
                : "Delayed Tool is OFF (click to enable 4,000ms slow tool)"
            }
          >
            <Clock size={13} className={delayedToolEnabled ? "text-accent" : ""} />
            <span>{delayedToolEnabled ? "Delayed Tool: ON (4s)" : "Delayed Tool: OFF"}</span>
          </button>

          {/* Interrupt (Barge-In) */}
          <button
            type="button"
            className={`btn-demo-action-secondary ${isBusy ? "btn-interrupt-active" : ""}`}
            disabled={disabled || !isBusy}
            onClick={onInterrupt}
            data-testid="btn-demo-interrupt"
            title={
              isBusy
                ? "Interrupt active speech or tool execution immediately (Barge-in)"
                : "Interrupt (enabled during speaking/thinking)"
            }
          >
            <Square size={12} className={isBusy ? "fill-current text-error" : ""} />
            <span>Interrupt Spoken</span>
          </button>

          {/* Reset Demo */}
          <button
            type="button"
            className="btn-demo-action-secondary btn-demo-reset"
            onClick={onResetDemo}
            data-testid="btn-demo-reset"
            title="Reset demo state back to clean baseline"
          >
            <RotateCcw size={13} />
            <span>Reset Demo</span>
          </button>
        </div>
      </div>
    </div>
  );

  const renderTalkControls = () => (
    <div className="voice-talk-panel console-card" aria-label="Interactive Voice Controls">
      <div className="talk-panel-header">
        <div className="flex items-center gap-2">
          <Mic size={16} className="text-accent" />
          <span className="talk-panel-title">Speak or Type Your Request</span>
        </div>
        {isBargeInMonitoring && (
          <span
            className="status-pill status-pill-active"
            title={`Barge-in VAD status: ${bargeInStatus}`}
          >
            <span className="status-dot status-dot-pulse" />
            VAD: {bargeInStatus ? bargeInStatus.toUpperCase() : "LISTENING"}
          </span>
        )}
      </div>

      <div className="talk-main-actions">
        {/* Primary Interactive Talk Button */}
        <button
          type="button"
          className={`btn-talk-primary ${
            isListening
              ? "btn-talk-listening"
              : voiceState === "SPEAKING"
              ? "btn-talk-speaking"
              : voiceState === "THINKING"
              ? "btn-talk-thinking"
              : ""
          }`}
          onClick={handleTalkClick}
          disabled={disabled || isBusy}
          aria-label={isListening ? "Stop listening" : "Click to speak"}
        >
          {isListening ? (
            <>
              <div className="talk-pulse-ring" />
              <Mic size={22} className="talk-icon-listening" />
              <span>Listening... Click to Finish</span>
            </>
          ) : voiceState === "THINKING" ? (
            <>
              <Loader2 size={22} className="animate-spin text-warning" />
              <span>Thinking &middot; Preparing Rime Voice...</span>
            </>
          ) : voiceState === "SPEAKING" ? (
            <>
              <Volume2 size={22} className="text-success animate-bounce" />
              <span>Speaking via Rime...</span>
            </>
          ) : (
            <>
              <Mic size={22} />
              <span>CLICK TO SPEAK</span>
            </>
          )}
        </button>

        {/* Real Interrupt Action when busy */}
        {isBusy && onInterrupt && (
          <button
            type="button"
            className="btn-talk-interrupt"
            onClick={onInterrupt}
            title="Interrupt active voice response immediately (Barge-in)"
          >
            <Square size={15} className="fill-current text-error" />
            <span>INTERRUPT</span>
          </button>
        )}

        {/* Text Input Fallback */}
        <form onSubmit={handleTextSubmit} className="talk-text-form" aria-label="Text Input Fallback">
          <input
            type="text"
            className="talk-text-input"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Ask any question, coding query, or travel request... (e.g. 'What is a closure in JS?')"
            disabled={disabled || isListening}
            aria-label="Text request input"
          />
          <button
            type="submit"
            className="btn-talk-send"
            disabled={disabled || isListening || !textInput.trim()}
            aria-label="Send message"
            title="Send query to agent"
          >
            <Send size={15} />
            <span>Send</span>
          </button>
        </form>
      </div>

      {/* Quick Prompts */}
      <div className="talk-quick-prompts" aria-label="Quick Conversation Prompts">
        <span className="quick-prompts-label">Quick Prompts:</span>

        <button
          type="button"
          className="btn-quick-pill"
          disabled={disabled || isListening}
          onClick={() => onQuickTurn("Find me a hotel in Mumbai for Friday.")}
          title="Ask for a hotel in Mumbai for Friday"
        >
          Mumbai Hotel (Friday)
        </button>

        <button
          type="button"
          className="btn-quick-pill"
          disabled={disabled || isListening}
          onClick={() => onQuickTurn("What is a closure in JavaScript?")}
          title="Ask coding question: What is a closure in JavaScript?"
        >
          What is a closure in JS?
        </button>

        <button
          type="button"
          className="btn-quick-pill"
          disabled={disabled || isListening}
          onClick={() => onQuickTurn("What is 25 times 4?")}
          title="Calculation query: 25 * 4"
        >
          25 &times; 4
        </button>

        <button
          type="button"
          className="btn-quick-pill"
          disabled={disabled || isListening}
          onClick={() => onQuickTurn("Why is the sky blue?")}
          title="General science question: Why is the sky blue?"
        >
          Why is the sky blue?
        </button>

        <button
          type="button"
          className="btn-quick-pill"
          disabled={disabled || isListening}
          onClick={() => onQuickTurn("Can you find flights from Chennai to Mumbai on Tuesday?")}
          title="Flight inquiry"
        >
          Flight to Mumbai
        </button>

        {onTestBargeIn && (
          <button
            type="button"
            className="btn-quick-pill btn-quick-pill-highlight"
            disabled={disabled || isListening}
            onClick={onTestBargeIn}
            title="Start speech then barge-in interrupt with Gen 2 to verify immediate stop and zero resurrection"
          >
            <ShieldAlert size={12} className="text-warning" />
            Barge-In Audio Test
          </button>
        )}

        {onSimulateRace && (
          <button
            type="button"
            className="btn-quick-pill"
            disabled={disabled || isListening || isBusy}
            onClick={onSimulateRace}
            title="Simulate slow Gen 1 interrupted by fast Gen 2 to test stale result blocking"
          >
            <ShieldAlert size={12} className="text-error" />
            Stale Race Test
          </button>
        )}
      </div>

      <div className="talk-notice-footer">
        {isSpeechSupported ? (
          <span className="flex items-center gap-1.5 text-slate-500">
            <Mic size={12} className="text-success" />
            Browser Speech Recognition &amp; Rime Speech Synthesis active.
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-slate-500">
            <MicOff size={12} className="text-warning" />
            Mic recognition unavailable. Use quick prompts or type any request.
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
    <div className="voice-controls-deck">
      {renderTalkControls()}
      {renderDemoControls()}
    </div>
  );
}
