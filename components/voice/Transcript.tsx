import React from "react";
import { MessageSquare, Mic, Volume2 } from "lucide-react";
import type { ConversationTurn } from "@/types/conversation";

export type TranscriptProps = {
  items?: readonly ConversationTurn[];
};

export function Transcript({ items = [] }: TranscriptProps): React.JSX.Element {
  const hasItems = items.length > 0;
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [items]);

  return (
    <div className="console-card transcript-card">
      <div className="console-card-header">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-cyan-400" />
          <span className="console-card-title">Conversation Transcript</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="status-pill status-pill-ready" style={{ fontSize: "11px", padding: "4px 10px" }}>
            <span className="status-dot status-dot-pulse" />
            Provider: Rime
          </span>
          <span className="status-pill" style={{ fontSize: "11px", padding: "4px 10px" }}>
            {hasItems ? `${items.length} ${items.length === 1 ? "turn" : "turns"}` : "0 Turns"}
          </span>
        </div>
      </div>

      {!hasItems ? (
        <div className="transcript-empty-state">
          <div className="transcript-empty-icon">
            <Mic size={22} />
          </div>
          <h3 className="transcript-empty-title">Conversation Ready</h3>
          <p className="transcript-empty-desc">
            EchoFence is initialized and ready. Spoken turns, generation tags, and real-time responses will appear here.
          </p>
        </div>
      ) : (
        <div className="transcript-list" ref={listRef}>
          {items.map((turn) => {
            const isUser = turn.role === "user";
            const dateStr = new Date(turn.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });

            return (
              <div
                key={turn.id}
                className={isUser ? "turn-card turn-card-user" : "turn-card turn-card-assistant"}
              >
                <div className="turn-header">
                  <span
                    className={
                      isUser
                        ? "turn-role-pill turn-role-user"
                        : "turn-role-pill turn-role-assistant"
                    }
                  >
                    {turn.role}
                  </span>
                  <span className="turn-gen-badge">Gen {turn.generationId}</span>
                </div>

                <div className="turn-text">{turn.text}</div>

                <div className="turn-footer">
                  <span>{dateStr}</span>
                  {turn.audioAvailable && (
                    <span className="voice-notice">
                      <Volume2 size={12} />
                      Audio played
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
