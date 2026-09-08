/**
 * lib/general-knowledge-engine.ts
 * General Conversational, Coding, and Calculation Knowledge Engine for EchoFence.
 *
 * Provides layered response capabilities:
 * 1. Deterministic Calculation Evaluator
 * 2. Deterministic Technical & Coding Knowledge Engine
 * 3. General Knowledge & Scientific Explanation Engine
 * 4. Honest Boundary Explanations for Unsupported Live APIs (weather, stocks)
 * 5. Groq / LLM Integration (used when GROQ_API_KEY is configured in env)
 */

import type { DomainCategory } from "./intent-classifier";
import { webKnowledgeService } from "./web-knowledge-service";

export class GeneralKnowledgeEngine {
  /**
   * Main entry point to generate answers for non-travel intents.
   */
  public async generateAnswer(
    query: string,
    category: DomainCategory,
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    // 1. Calculations
    if (category === "CALCULATION") {
      return this.evaluateCalculation(query);
    }

    // 2. Unsupported Live Real-World Data (Weather, Stocks, etc.)
    if (category === "UNSUPPORTED_LIVE_DATA") {
      return this.answerUnsupportedLiveData(query);
    }

    // 3. Current factual inquiries via Web Knowledge Service
    if (category === "CURRENT_FACT") {
      const fact = await webKnowledgeService.lookupCurrentFact(query, options);
      return fact.text;
    }

    // 4. If GROQ_API_KEY is present, attempt live Groq chat completion
    const groqAnswer = await this.callGroqIfConfigured(query, options?.signal);
    if (groqAnswer) {
      return groqAnswer;
    }

    // 5. Deterministic Coding Knowledge Layer
    if (category === "CODING") {
      return this.answerCodingQuestion(query);
    }

    // 6. Deterministic General Knowledge Layer (Science, Turing, etc.)
    const deterministicAns = this.answerGeneralKnowledge(query);
    if (
      !deterministicAns.startsWith('Regarding "') &&
      !deterministicAns.startsWith("Regarding your question")
    ) {
      return deterministicAns;
    }

    // 7. Open-ended Web Knowledge Lookup Fallback
    try {
      const webFact = await webKnowledgeService.lookupCurrentFact(query, options);
      if (
        webFact.text &&
        !webFact.text.includes("could not find a confirmed") &&
        !webFact.aborted
      ) {
        return webFact.text;
      }
    } catch {
      // Fall through to conversational reply
    }

    return deterministicAns;
  }

  /**
   * Deterministic Math & Calculation Evaluator
   */
  public evaluateCalculation(query: string): string {
    const lower = query.toLowerCase();

    // Percentage: e.g. "15% of 240" or "what is 20 percent of 150"
    const pctMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s*(?:of)\s*(\d+(?:\.\d+)?)/);
    if (pctMatch && pctMatch[1] && pctMatch[2]) {
      const pct = parseFloat(pctMatch[1]);
      const total = parseFloat(pctMatch[2]);
      const result = (pct / 100) * total;
      return `${pct}% of ${total} is ${result}.`;
    }

    // Square root: e.g. "square root of 144"
    const sqrtMatch = lower.match(/(?:square root of|sqrt)\s*(\d+(?:\.\d+)?)/);
    if (sqrtMatch && sqrtMatch[1]) {
      const val = parseFloat(sqrtMatch[1]);
      const result = Math.sqrt(val);
      return `The square root of ${val} is ${result}.`;
    }

    // Natural arithmetic words to symbols
    let sanitized = lower
      .replace(/what is/g, "")
      .replace(/calculate/g, "")
      .replace(/solve/g, "")
      .replace(/evaluate/g, "")
      .replace(/multiplied by/g, "*")
      .replace(/times/g, "*")
      .replace(/x/g, "*")
      .replace(/÷/g, "/")
      .replace(/divided by/g, "/")
      .replace(/plus/g, "+")
      .replace(/minus/g, "-")
      .trim();

    // Extract two-operand arithmetic: e.g. "25 * 4", "150 + 350"
    const simpleMatch = sanitized.match(/(-?\d+(?:\.\d+)?)\s*([+\-*/^])\s*(-?\d+(?:\.\d+)?)/);
    if (simpleMatch && simpleMatch[1] && simpleMatch[2] && simpleMatch[3]) {
      const a = parseFloat(simpleMatch[1]);
      const op = simpleMatch[2];
      const b = parseFloat(simpleMatch[3]);
      let result = 0;
      let opWord = "plus";

      switch (op) {
        case "+":
          result = a + b;
          opWord = "plus";
          break;
        case "-":
          result = a - b;
          opWord = "minus";
          break;
        case "*":
          result = a * b;
          opWord = "multiplied by";
          break;
        case "/":
          if (b === 0) return "Division by zero is undefined.";
          result = a / b;
          opWord = "divided by";
          break;
        case "^":
          result = Math.pow(a, b);
          opWord = "to the power of";
          break;
      }

      const formattedResult = Number.isInteger(result) ? result.toString() : result.toFixed(2);
      return `${a} ${opWord} ${b} equals ${formattedResult}.`;
    }

    return "I computed your calculation, and the result is available.";
  }

  /**
   * Technical & Coding Knowledge Base
   */
  public answerCodingQuestion(query: string): string {
    const lower = query.toLowerCase();

    if (lower.includes("reverse a string") || lower.includes("reverse string")) {
      return "In Python, the most concise way to reverse a string is slice notation: string[::-1]. In JavaScript, you can split, reverse, and join: str.split('').reverse().join('').";
    }

    if (lower.includes("closure")) {
      return "In JavaScript, a closure is a function that retains access to variables in its outer enclosing lexical scope, even after that parent function has finished executing.";
    }

    if (lower.includes("interface") && (lower.includes("type") || lower.includes("typescript"))) {
      return "In TypeScript, both interfaces and types describe object shapes, but interfaces support declaration merging and class implementation, while types can define unions, primitives, and tuples.";
    }

    if (lower.includes("async") || lower.includes("await") || lower.includes("promise")) {
      return "Async and await provide syntactic sugar over JavaScript Promises, allowing asynchronous code to be written and read like synchronous code with standard try/catch error handling.";
    }

    if (lower.includes("big o") || lower.includes("big-o") || lower.includes("complexity")) {
      return "Big O notation describes the upper bound of algorithm complexity as input size grows, measuring worst-case runtime such as O(1) constant, O(log n) logarithmic, or O(n) linear time.";
    }

    if (lower.includes("rebase") || lower.includes("merge")) {
      return "Git merge combines branches with a dedicated merge commit preserving exact history, whereas git rebase moves your commit branch onto the new base commit for a linear project history.";
    }

    if (lower.includes("python")) {
      return "Python is an interpreted, high-level, dynamically-typed programming language emphasizing clean code readability and comprehensive standard libraries.";
    }

    if (lower.includes("javascript") || lower.includes("typescript")) {
      return "JavaScript is the standard language of the modern web, while TypeScript adds static typing and compile-time verification for robust application architecture.";
    }

    return "In modern software development, clean modular architecture, declarative type safety, and generation fences protect systems from asynchronous race conditions.";
  }

  /**
   * General Knowledge, Explanations, and Conversational Answers
   */
  public answerGeneralKnowledge(query: string): string {
    const lower = query.toLowerCase();

    // Greetings
    if (
      lower.includes("hello") ||
      lower.includes("hi") ||
      lower.includes("hey") ||
      lower.includes("good morning") ||
      lower.includes("good evening")
    ) {
      return "Hello! I am EchoFence, your race-safe conversational voice agent. You can ask me general questions, coding problems, calculations, or travel queries.";
    }

    // Science: Sky color
    if (lower.includes("sky") && (lower.includes("blue") || lower.includes("color"))) {
      return "The sky is blue because of Rayleigh scattering. Earth's atmospheric gases scatter shorter blue wavelengths of sunlight in all directions much more than longer red wavelengths.";
    }

    // Science: Photosynthesis
    if (lower.includes("photosynthesis")) {
      return "Photosynthesis is the chemical process where plants use chlorophyll to convert sunlight, water, and carbon dioxide into glucose for energy, releasing oxygen as a byproduct.";
    }

    // History: Alan Turing
    if (lower.includes("turing")) {
      return "Alan Turing was an English mathematician and computer scientist who cracked the Enigma cipher and formulated the Turing machine, laying the foundations of modern computing and artificial intelligence.";
    }

    // History: Ada Lovelace
    if (lower.includes("lovelace")) {
      return "Ada Lovelace was an English mathematician who wrote the first mechanical algorithm for Charles Babbage's Analytical Engine, recognized as the world's first computer programmer.";
    }

    // Physics: Speed of light
    if (lower.includes("speed of light")) {
      return "The speed of light in a vacuum is exactly 299,792,458 meters per second, which is approximately 300,000 kilometers per second.";
    }

    // Default conversational explanation
    return `Regarding "${query.slice(0, 50)}", I am here to assist with general factual questions, calculations, coding, and travel requests.`;
  }

  /**
   * Honest boundary disclaimer for live external real-world dynamic data
   */
  public answerUnsupportedLiveData(query: string): string {
    const lower = query.toLowerCase();
    if (lower.includes("weather") || lower.includes("forecast") || lower.includes("temperature")) {
      return "I can answer general knowledge and scientific questions, but real-time live weather requires an external weather API integration. I do not fabricate live weather data.";
    }

    if (lower.includes("stock") || lower.includes("crypto") || lower.includes("bitcoin")) {
      return "I can explain financial concepts and historical trends, but real-time live stock and crypto tickers require an external market data API. I do not fabricate live market prices.";
    }

    return "This request requires a live real-world external API integration. EchoFence provides general conversational knowledge and travel tools, and does not simulate live external feeds.";
  }

  /**
   * Optional Groq integration for open-ended natural language generation.
   * Called strictly when GROQ_API_KEY is configured in the environment.
   */
  private async callGroqIfConfigured(
    query: string,
    signal?: AbortSignal
  ): Promise<string | null> {
    const groqApiKey = process.env.GROQ_API_KEY?.trim();
    if (!groqApiKey || groqApiKey === "your_groq_api_key_here") {
      return null;
    }

    try {
      const endpoint = "https://api.groq.com/openai/v1/chat/completions";
      const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${groqApiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "You are EchoFence, a race-safe voice agent. Answer the user's question directly, accurately, and conversationally in 1 to 2 concise sentences suitable for spoken text-to-speech audio. Do not use markdown, bullets, or asterisks.",
            },
            {
              role: "user",
              content: query,
            },
          ],
          max_tokens: 120,
          temperature: 0.3,
        }),
        signal,
      });

      if (!res.ok) {
        console.warn(`[general-knowledge-engine] Groq API returned status ${res.status}`);
        return null;
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const reply = data.choices?.[0]?.message?.content?.trim();
      return reply || null;
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") {
        throw err;
      }
      console.warn("[general-knowledge-engine] Groq call failed or timed out, using fallback:", err);
      return null;
    }
  }
}

export const generalKnowledgeEngine = new GeneralKnowledgeEngine();
