export type ConversationRole = "user" | "assistant" | "system";

export type ConversationTurn = {
  id: string;
  role: ConversationRole;
  text: string;
  timestamp: number;
  generationId: number;
  audioAvailable?: boolean;
  durationMs?: number;
};
