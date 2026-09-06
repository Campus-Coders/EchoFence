import { searchHotelsDelayed } from "./delayed-tool";

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

    // Check for explicit delayed tool request or deterministic trigger
    if (
      options?.delayedTool ||
      lower.includes("delayed") ||
      lower.includes("hotel with delayed search")
    ) {
      const genId = options?.generationId ?? 1;
      const delayMs = options?.delayMs ?? 4000;
      const respectAbort = options?.respectAbort ?? false;

      const toolResult = await searchHotelsDelayed({
        generationId: genId,
        delayMs,
        signal: options?.signal,
        respectAbort,
        city: lower.includes("pune") ? "Pune" : "Mumbai",
      });

      return toolResult.data.searchSummary;
    }

    // Check if OPENAI_API_KEY is configured on the server
    const openAiKey = process.env.OPENAI_API_KEY?.trim();
    const hasOpenAi =
      Boolean(openAiKey) &&
      openAiKey !== "your_openai_api_key_here" &&
      (openAiKey?.length ?? 0) > 15;

    if (hasOpenAi) {
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openAiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "You are EchoFence, a concise, voice-native AI travel and task assistant. Keep responses short and conversational (1-2 sentences max).",
              },
              { role: "user", content: trimmed },
            ],
            max_tokens: 100,
            temperature: 0.7,
          }),
        });

        if (res.ok) {
          const json = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const content = json.choices?.[0]?.message?.content?.trim();
          if (content) {
            return content;
          }
        }
      } catch (err) {
        console.warn("[conversation-service] OpenAI call failed, falling back to deterministic engine:", err);
      }
    }

    // Deterministic simulation responses matching project demo context
    // Simulate natural thinking delay (300ms)
    await new Promise((resolve) => setTimeout(resolve, 300));

    if (lower.includes("mumbai") && (lower.includes("friday") || lower.includes("hotel"))) {
      return "I found 3 hotels in Mumbai for Friday, starting at 4,200 rupees per night at The Taj Mahal Tower.";
    }

    if (lower.includes("saturday") || lower.includes("5000")) {
      return "Updated for Saturday under 5,000 rupees: Found Trident Nariman Point at 4,800 rupees per night.";
    }

    if (lower.includes("hello") || lower.includes("hi") || lower.includes("hey")) {
      return "Hello! EchoFence voice system is ready. How can I assist you today?";
    }

    return `I received: "${trimmed}". EchoFence processed your turn successfully.`;
  }
}

export const conversationService = new DefaultConversationService();
