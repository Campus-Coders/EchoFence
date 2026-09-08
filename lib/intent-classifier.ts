/**
 * lib/intent-classifier.ts
 * Layered Intent Classification Engine for EchoFence General-Purpose Voice Agent.
 *
 * Categorizes user utterances into domain categories:
 * - TRAVEL (hotel search, flight search, cinema ticket, budget query, race demo)
 * - CALCULATION (math expressions, percentages, unit conversions)
 * - CODING (programming languages, algorithms, syntax, debug explanations)
 * - GENERAL (science, general knowledge, explanations, definitions, casual conversation)
 * - UNSUPPORTED_LIVE_DATA (real-time data like live weather, stocks that require external APIs)
 * - UNKNOWN (fallback for open-ended conversational processing)
 */

import { detectTravelIntent, type TravelIntentType, type TravelEntities } from "./travel-intent-router";

export type DomainCategory =
  | "TRAVEL"
  | "CALCULATION"
  | "CODING"
  | "CURRENT_FACT"
  | "GENERAL"
  | "UNSUPPORTED_LIVE_DATA"
  | "UNKNOWN";

export type ClassificationResult = {
  category: DomainCategory;
  travelIntent?: TravelIntentType;
  travelEntities?: TravelEntities;
  calculationExpression?: string;
  codingTopic?: string;
  rawText: string;
};

/**
 * Deterministically classifies incoming user prompt into a domain category.
 */
export function classifyIntent(userPrompt: string): ClassificationResult {
  const trimmed = userPrompt.trim();
  const lower = trimmed.toLowerCase();

  // 1. Check for explicit unsupported live real-world queries (weather, live stock market)
  if (
    lower.includes("weather") ||
    lower.includes("temperature outside") ||
    lower.includes("forecast") ||
    lower.includes("stock price") ||
    lower.includes("share price") ||
    lower.includes("crypto price") ||
    lower.includes("bitcoin price")
  ) {
    return {
      category: "UNSUPPORTED_LIVE_DATA",
      rawText: trimmed,
    };
  }

  // 2. Check for Travel intent first if travel keywords exist
  const travelCheck = detectTravelIntent(trimmed);
  if (
    travelCheck.intent !== "UNKNOWN" &&
    travelCheck.intent !== "GREETING" &&
    travelCheck.intent !== "GENERAL_TRAVEL"
  ) {
    return {
      category: "TRAVEL",
      travelIntent: travelCheck.intent,
      travelEntities: travelCheck.entities,
      rawText: trimmed,
    };
  }

  // Explicit race scenario trigger
  if (lower.includes("race scenario") || lower.includes("simulate race") || lower.includes("run interruption demo")) {
    return {
      category: "TRAVEL",
      travelIntent: "RACE_SCENARIO",
      travelEntities: travelCheck.entities,
      rawText: trimmed,
    };
  }

  // 3. Check for Calculation / Math intents
  const isMath =
    /^(?:what is|calculate|solve|evaluate)?\s*[\d\s+\-*/().%^x×÷=]+$/i.test(trimmed) ||
    lower.includes("calculate") ||
    lower.includes("plus") ||
    lower.includes("minus") ||
    lower.includes("divided by") ||
    lower.includes("times") ||
    lower.includes("multiplied by") ||
    /\d+\s*[%]\s*of\s*\d+/i.test(lower) ||
    /what is\s*\d+\s*[+*\-x/]\s*\d+/i.test(lower) ||
    /square root of\s*\d+/i.test(lower);

  if (isMath) {
    return {
      category: "CALCULATION",
      calculationExpression: trimmed,
      rawText: trimmed,
    };
  }

  // 4. Check for Coding / Technical Programming intents
  const isCoding =
    lower.includes("python") ||
    lower.includes("javascript") ||
    lower.includes("typescript") ||
    lower.includes("react") ||
    lower.includes("coding") ||
    lower.includes("programming") ||
    lower.includes("closure") ||
    lower.includes("async/await") ||
    lower.includes("promise") ||
    lower.includes("reverse a string") ||
    lower.includes("array") ||
    lower.includes("function") ||
    lower.includes("recursion") ||
    lower.includes("big-o") ||
    lower.includes("big o") ||
    lower.includes("git merge") ||
    lower.includes("git rebase") ||
    lower.includes("sql") ||
    lower.includes("database") ||
    lower.includes("compiler") ||
    lower.includes("regex");

  if (isCoding) {
    return {
      category: "CODING",
      codingTopic: trimmed,
      rawText: trimmed,
    };
  }

  // 5. Check if it was general travel assistance
  if (travelCheck.intent === "GENERAL_TRAVEL") {
    return {
      category: "TRAVEL",
      travelIntent: "GENERAL_TRAVEL",
      travelEntities: travelCheck.entities,
      rawText: trimmed,
    };
  }

  // 6. Check for Current Factual / Web Knowledge queries
  const isCurrentFact =
    lower.includes("richest person") ||
    lower.includes("richest man") ||
    lower.includes("richest woman") ||
    lower.includes("richest in") ||
    lower.includes("wealthiest") ||
    lower.includes("current president") ||
    lower.includes("current prime minister") ||
    lower.includes("prime minister of") ||
    lower.includes("president of") ||
    lower.includes("head of state") ||
    lower.includes("current leader") ||
    lower.includes("current ceo") ||
    lower.includes("ceo of") ||
    lower.includes("current population") ||
    lower.includes("latest population") ||
    lower.includes("population of") ||
    lower.includes("today's date") ||
    lower.includes("current date") ||
    lower.includes("what date is today") ||
    lower.includes("what day is it") ||
    lower.includes("current year") ||
    lower.includes("world ranking") ||
    lower.includes("current rank") ||
    lower.includes("who is currently") ||
    lower.includes("what is currently") ||
    lower.includes("who is the current") ||
    lower.includes("what is the latest") ||
    lower.includes("latest news") ||
    lower.includes("current champion") ||
    lower.includes("who won the last") ||
    lower.includes("who won the latest");

  if (isCurrentFact) {
    return {
      category: "CURRENT_FACT",
      rawText: trimmed,
    };
  }

  // 7. Check for general knowledge, greetings, explanations
  if (
    lower.startsWith("why ") ||
    lower.startsWith("what is ") ||
    lower.startsWith("who is ") ||
    lower.startsWith("who was ") ||
    lower.startsWith("how does ") ||
    lower.startsWith("explain ") ||
    lower.startsWith("tell me about ") ||
    lower.includes("photosynthesis") ||
    lower.includes("turing") ||
    lower.includes("sky blue") ||
    lower.includes("hello") ||
    lower.includes("hi") ||
    lower.includes("hey")
  ) {
    return {
      category: "GENERAL",
      rawText: trimmed,
    };
  }

  // 7. General fallback for open-ended questions
  return {
    category: "GENERAL",
    rawText: trimmed,
  };
}
