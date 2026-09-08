/**
 * lib/conversation-service.ts
 * Layered Conversation Service for EchoFence General-Purpose Voice Agent.
 *
 * Routes requests across:
 * 1. Deterministic Travel Intent Handlers (Hotels, Flights, Cinema, Budget, Race Demo)
 * 2. Mathematical Calculation Engine
 * 3. Technical & Coding Knowledge Engine
 * 4. General Knowledge & Conversational Groq LLM Fallback
 * 5. Honest Boundaries for Unsupported Real-World Live Data
 *
 * All pathways are governed by Monotonic Generation Authority via GenerationFence.
 */

import { classifyIntent, type ClassificationResult } from "./intent-classifier";
import { executeTravelTool, type IntentDetectionResult, type TravelIntentType } from "./travel-intent-router";
import { generalKnowledgeEngine } from "./general-knowledge-engine";
import { generationFence } from "./generation-fence";
import { generationAudit } from "./generation-audit";

export interface ConversationOptions {
  generationId?: number;
  delayedTool?: boolean;
  delayMs?: number;
  respectAbort?: boolean;
  signal?: AbortSignal;
}

export interface ConversationResponse {
  spokenText: string;
  category: string;
  intent?: string;
  generationId: number;
}

export interface IConversationService {
  generateResponse(
    userPrompt: string,
    options?: ConversationOptions
  ): Promise<string>;

  processTurn(
    userPrompt: string,
    options?: ConversationOptions
  ): Promise<ConversationResponse>;
}

export class DefaultConversationService implements IConversationService {
  public async generateResponse(
    userPrompt: string,
    options?: ConversationOptions
  ): Promise<string> {
    const res = await this.processTurn(userPrompt, options);
    return res.spokenText;
  }

  public async processTurn(
    userPrompt: string,
    options?: ConversationOptions
  ): Promise<ConversationResponse> {
    const trimmed = userPrompt.trim();
    const lower = trimmed.toLowerCase();
    const genId = options?.generationId ?? generationFence.getCurrentGeneration();

    // 1. Layered Intent Classification
    const classification: ClassificationResult = classifyIntent(trimmed);

    // 2. Route TRAVEL category to existing deterministic travel handlers
    if (classification.category === "TRAVEL") {
      const isDelayed =
        Boolean(options?.delayedTool) ||
        lower.includes("delayed") ||
        lower.includes("hotel with delayed search");

      const travelIntentResult: IntentDetectionResult = {
        intent: (classification.travelIntent || "GENERAL_TRAVEL") as TravelIntentType,
        entities: classification.travelEntities || {},
        rawText: trimmed,
      };

      const toolResult = await executeTravelTool(travelIntentResult, {
        ...options,
        generationId: genId,
        delayedTool: isDelayed,
        delayMs: options?.delayMs ?? (isDelayed ? 4000 : 600),
      });

      return {
        spokenText: toolResult.spokenText,
        category: "TRAVEL",
        intent: toolResult.intent,
        generationId: genId,
      };
    }

    // 3. Route Non-Travel (CALCULATION, CODING, CURRENT_FACT, GENERAL, UNSUPPORTED_LIVE_DATA)
    generationAudit.record(
      genId,
      "tool_started",
      generationFence.getCurrentGeneration(),
      classification.category.toLowerCase(),
      `Processing ${classification.category} query for Gen ${genId}: "${trimmed.slice(0, 45)}..."`
    );

    // Realistic conversational latency (~300ms) for local calculations/coding/general with AbortSignal cancellation
    if (classification.category !== "CURRENT_FACT") {
      if (options?.signal) {
        if (options.signal.aborted && options.respectAbort) {
          throw new Error(`Execution aborted for generation ${genId}`);
        }
      }

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 300);
        if (options?.signal) {
          options.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              if (options.respectAbort) {
                reject(new Error(`General query aborted for generation ${genId}`));
              } else {
                resolve();
              }
            },
            { once: true }
          );
        }
      });
    }

    const isCurrentBefore = generationFence.isCurrent(genId);
    if (!isCurrentBefore) {
      generationAudit.record(
        genId,
        "tool_completed_late",
        generationFence.getCurrentGeneration(),
        classification.category.toLowerCase(),
        `Gen ${genId} ${classification.category} response finished after generation was superseded`
      );
    }

    const spokenText = await generalKnowledgeEngine.generateAnswer(
      trimmed,
      classification.category,
      { signal: options?.signal }
    );

    const isCurrentAfter = generationFence.isCurrent(genId);
    if (isCurrentAfter) {
      generationAudit.record(
        genId,
        "tool_completed",
        generationFence.getCurrentGeneration(),
        classification.category.toLowerCase(),
        `Gen ${genId} ${classification.category} completed successfully`
      );
    } else {
      generationAudit.record(
        genId,
        "stale_result_blocked",
        generationFence.getCurrentGeneration(),
        classification.category.toLowerCase(),
        `Gen ${genId} result blocked at fence: active generation is ${generationFence.getCurrentGeneration()}`
      );
    }

    return {
      spokenText,
      category: classification.category,
      generationId: genId,
    };
  }
}

export const conversationService = new DefaultConversationService();
