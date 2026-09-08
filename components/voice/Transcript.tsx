"use client";

import React, { useEffect, useRef, useState } from "react";
import { MessageSquare, Mic, Volume2, ShieldCheck, User, Bot } from "lucide-react";
import type { ConversationTurn } from "@/types/conversation";

export type TranscriptProps = {
  items?: readonly ConversationTurn[];
  activeGenerationId?: number;
};

export function Transcript({ items = [], activeGenerationId }: TranscriptProps): React.JSX.Element {
  const hasItems = items.length > 0;
  const listRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [items]);

  // Determine highest generation present in transcript
  const maxGenInTranscript = items.reduce(
    (max, t) => Math.max(max, t.generationId || 0),
    activeGenerationId || 0
  );

  return (
    <div className="console-card transcript-card" data-testid="conversation-transcript-card">
      <div className="console-card-header">
        <div className="flex items-center gap-2">
          <div className="transcript-header-icon">
            <MessageSquare size={16} className="text-accent" />
          </div>
          <div>
            <span className="console-card-title">Live Conversation</span>
            <span className="transcript-header-sub">
              Every turn is governed by a monotonic generation authority.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="status-pill status-pill-ready">
            <span className="status-dot status-dot-pulse" />
            RIME ACTIVE
          </span>
          <span className="status-pill font-mono">
            {hasItems ? `${items.length} ${items.length === 1 ? "turn" : "turns"}` : "0 Turns"}
          </span>
        </div>
      </div>

      {!hasItems ? (
        <div className="transcript-empty-state transcript-empty-state-compact">
          <div className="flex items-center gap-2">
            <Mic size={18} className="text-accent" />
            <span className="transcript-empty-title">Speak to start</span>
          </div>
          <p className="transcript-empty-desc">
            Try: <span className="font-semibold text-slate-700">&ldquo;Find me a hotel in Mumbai for Friday.&rdquo;</span>
          </p>
        </div>
      ) : (
        <div className="transcript-list" ref={listRef} tabIndex={0} aria-label="Conversation Turns">
          {items.map((turn, index) => {
            const isUser = turn.role === "user";
            const genId = turn.generationId || 1;
            const isSuperseded =
              maxGenInTranscript > genId &&
              items.some((t) => (t.generationId || 0) > genId);

            // Safe formatting
            const timeFormatted = mounted
              ? new Date(turn.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              : "";

            return (
              <div
                key={turn.id || `turn-${index}`}
                className={`turn-card ${
                  isUser ? "turn-card-user" : "turn-card-assistant"
                } ${isSuperseded ? "turn-card-superseded" : "turn-card-current"}`}
              >
                <div className="turn-header">
                  <div className="flex items-center gap-1.5">
                    {isUser ? (
                      <span className="turn-avatar turn-avatar-user">
                        <User size={12} />
                      </span>
                    ) : (
                      <span className="turn-avatar turn-avatar-assistant">
                        <Bot size={12} />
                      </span>
                    )}
                    <span
                      className={`turn-role-pill ${
                        isUser ? "turn-role-user" : "turn-role-assistant"
                      }`}
                    >
                      {isUser ? `YOU · G${genId}` : `ECHOFENCE · G${genId}`}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {isSuperseded ? (
                      <span className="turn-status-badge turn-badge-superseded" title="This request was superseded by a newer barge-in generation">
                        SUPERSEDED
                      </span>
                    ) : (
                      <span className="turn-status-badge turn-badge-authoritative" title="Authoritative generation">
                        AUTHORITATIVE
                      </span>
                    )}
                    <span className="turn-gen-badge">G{genId}</span>
                  </div>
                </div>

                <div className="turn-text">{turn.text}</div>

                <div className="turn-footer">
                  <span className="turn-timestamp">{timeFormatted}</span>
                  {turn.audioAvailable && (
                    <span className="turn-audio-pill">
                      <Volume2 size={12} className="text-success" />
                      Spoken via Rime (Coda &middot; Astra)
                    </span>
                  )}
                  {isSuperseded && !turn.audioAvailable && !isUser && (
                    <span className="turn-blocked-pill">
                      <ShieldCheck size={12} className="text-error" />
                      Late Speech Fenced (0ms played)
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
