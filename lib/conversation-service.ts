import { detectTravelIntent, executeTravelTool } from "./travel-intent-router";

export interface ConversationOptions {
  generationId?: number;
  delayedTool?: boolean;
  delayMs?: number;
  respectAbort?: boolean;
  signal?: AbortSignal;
}

export interface IConversationService {
  generateResponse(
    userPrompt: string,
    options?: ConversationOptions
  ): Promise<string>;
}

export class DefaultConversationService implements IConversationService {
  public async generateResponse(
    userPrompt: string,
    options?: ConversationOptions
  ): Promise<string> {
    const trimmed = userPrompt.trim();
    const lower = trimmed.toLowerCase();

    // 1. Detect deterministic travel intent
    const intentResult = detectTravelIntent(trimmed);

    // 2. Check for explicit delayed tool request or delayed trigger
    const isDelayed =
      Boolean(options?.delayedTool) ||
      lower.includes("delayed") ||
      lower.includes("hotel with delayed search");

    // 3. Execute asynchronous travel tool (~600ms natural delay, or 4000ms if delayed)
    const toolResult = await executeTravelTool(intentResult, {
      ...options,
      delayedTool: isDelayed,
      delayMs: options?.delayMs ?? (isDelayed ? 4000 : 600),
    });

    return toolResult.spokenText;
  }
}

export const conversationService = new DefaultConversationService();
