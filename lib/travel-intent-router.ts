/**
 * lib/travel-intent-router.ts
 * Deterministic Intent Routing & Asynchronous Mock Tool Execution for EchoFence.
 *
 * Implements realistic travel voice-agent capabilities:
 * - Intent Detection (Hotel, Flight, Cinema, Budget, General Travel)
 * - Deterministic Entity Extraction (City, Day, Route, Budget)
 * - Asynchronous Tool Execution with realistic network delay (~600ms, or 4000ms if delayed)
 * - Natural, concise voice-friendly responses for Rime speech playback
 * - Generation-aware safety compliance with GenerationFence & GenerationAudit
 */

import { generationFence } from "./generation-fence";
import { generationAudit } from "./generation-audit";
import { delayedToolRegistry } from "./delayed-tool";

export type TravelIntentType =
  | "HOTEL_SEARCH"
  | "FLIGHT_SEARCH"
  | "CINEMA_TICKET"
  | "PRICE_BUDGET"
  | "RACE_SCENARIO"
  | "GENERAL_TRAVEL"
  | "GREETING"
  | "UNKNOWN";

export type TravelEntities = {
  city?: string;
  origin?: string;
  destination?: string;
  day?: string;
  budget?: number;
  movie?: string;
  time?: string;
};

export type IntentDetectionResult = {
  intent: TravelIntentType;
  entities: TravelEntities;
  rawText: string;
};

export type TravelToolResult = {
  intent: TravelIntentType;
  success: boolean;
  data: Record<string, unknown>;
  spokenText: string;
  executionMs: number;
};

export type TravelToolOptions = {
  generationId?: number;
  delayedTool?: boolean;
  delayMs?: number;
  respectAbort?: boolean;
  signal?: AbortSignal;
};

/**
 * 1. Intent Detection & Entity Extraction
 * Inspects transcript text to extract domain intent and relevant parameters.
 */
export function detectTravelIntent(userPrompt: string): IntentDetectionResult {
  const trimmed = userPrompt.trim();
  const lower = trimmed.toLowerCase();

  const entities: TravelEntities = {};

  // Extract cities
  if (lower.includes("mumbai")) entities.city = "Mumbai";
  else if (lower.includes("chennai")) entities.city = "Chennai";
  else if (lower.includes("delhi")) entities.city = "Delhi";
  else if (lower.includes("pune")) entities.city = "Pune";

  // Extract flight routes
  if (lower.includes("chennai to mumbai") || (lower.includes("chennai") && lower.includes("mumbai") && lower.includes("flight"))) {
    entities.origin = "Chennai";
    entities.destination = "Mumbai";
  } else if (lower.includes("mumbai to delhi")) {
    entities.origin = "Mumbai";
    entities.destination = "Delhi";
  }

  // Extract days
  if (lower.includes("friday")) entities.day = "Friday";
  else if (lower.includes("saturday")) entities.day = "Saturday";
  else if (lower.includes("tuesday")) entities.day = "Tuesday";
  else if (lower.includes("tomorrow")) entities.day = "tomorrow";

  // Extract budget
  const budgetMatch = lower.match(/(?:under|below|less than|max|₹)?\s*(\d{3,5})\s*(?:rupees|rs|inr)?/);
  if (budgetMatch && budgetMatch[1]) {
    entities.budget = parseInt(budgetMatch[1], 10);
  }

  // Explicit race scenario phrases
  if (lower.includes("race scenario") || lower.includes("simulate race") || lower.includes("deterministic race")) {
    return { intent: "RACE_SCENARIO", entities, rawText: trimmed };
  }

  // Cinema ticket intent
  if (
    lower.includes("cinema") ||
    lower.includes("movie") ||
    lower.includes("theater") ||
    lower.includes("theatre") ||
    lower.includes("ticket") ||
    lower.includes("starlight")
  ) {
    entities.movie = "Starlight";
    entities.time = "7:30 PM";
    entities.city = entities.city || "Mumbai";
    return { intent: "CINEMA_TICKET", entities, rawText: trimmed };
  }

  // Flight search intent
  if (
    lower.includes("flight") ||
    lower.includes("flights") ||
    lower.includes("fly") ||
    lower.includes("airline") ||
    lower.includes("indigo") ||
    lower.includes("air india") ||
    lower.includes("vistara")
  ) {
    entities.destination = entities.destination || entities.city || "Mumbai";
    entities.origin = entities.origin || (entities.destination === "Mumbai" ? "Chennai" : "Mumbai");
    entities.day = entities.day || "Tuesday";
    return { intent: "FLIGHT_SEARCH", entities, rawText: trimmed };
  }

  // Hotel search intent
  if (
    lower.includes("hotel") ||
    lower.includes("hotels") ||
    lower.includes("stay") ||
    lower.includes("room") ||
    lower.includes("resort") ||
    lower.includes("taj") ||
    lower.includes("trident") ||
    lower.includes("aurora") ||
    (lower.includes("mumbai") && lower.includes("friday"))
  ) {
    entities.city = entities.city || "Mumbai";
    entities.day = entities.day || "Friday";
    return { intent: "HOTEL_SEARCH", entities, rawText: trimmed };
  }

  // Price budget / standalone budget update
  if (
    (lower.includes("saturday") && (lower.includes("5000") || lower.includes("budget"))) ||
    lower.includes("under 5000") ||
    lower.includes("under 5,000") ||
    (entities.budget !== undefined && lower.includes("saturday"))
  ) {
    entities.day = "Saturday";
    entities.budget = entities.budget || 5000;
    entities.city = entities.city || "Mumbai";
    return { intent: "PRICE_BUDGET", entities, rawText: trimmed };
  }

  // Greeting
  if (
    lower.includes("hello") ||
    lower.includes("hi") ||
    lower.includes("hey") ||
    lower.includes("good morning") ||
    lower.includes("good evening")
  ) {
    return { intent: "GREETING", entities, rawText: trimmed };
  }

  // General travel assistance
  if (lower.includes("travel") || lower.includes("trip") || lower.includes("vacation") || lower.includes("tour")) {
    return { intent: "GENERAL_TRAVEL", entities, rawText: trimmed };
  }

  return { intent: "UNKNOWN", entities, rawText: trimmed };
}

/**
 * 2. Asynchronous Tool Execution with Realistic Delays
 * Simulates genuine async network execution (500–800ms natural, or 4000ms if delayed).
 */
export async function executeTravelTool(
  intentResult: IntentDetectionResult,
  options?: TravelToolOptions
): Promise<TravelToolResult> {
  const genId = options?.generationId ?? 1;
  const isDelayed = Boolean(options?.delayedTool);
  const defaultDelay = isDelayed ? 4000 : 600;
  const delayMs = options?.delayMs ?? defaultDelay;
  const signal = options?.signal;
  const respectAbort = options?.respectAbort ?? false;

  const startedAt = Date.now();
  delayedToolRegistry.recordRun();

  // Audit record: Tool started
  generationAudit.record(
    genId,
    "tool_started",
    generationFence.getCurrentGeneration(),
    "travel_tool",
    `Asynchronous ${intentResult.intent} tool execution started (${delayMs}ms simulated network delay)`
  );

  // Asynchronous wait to simulate real tool execution
  await new Promise<void>((resolve, reject) => {
    let timerId: NodeJS.Timeout | null = null;

    const onAbort = () => {
      if (timerId) clearTimeout(timerId);
      if (respectAbort) {
        reject(new Error(`Tool execution aborted for generation ${genId}`));
      } else {
        resolve();
      }
    };

    if (signal) {
      if (signal.aborted && respectAbort) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    timerId = setTimeout(() => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve();
    }, delayMs);
  });

  const completedAt = Date.now();
  const executionMs = completedAt - startedAt;
  const isCurrent = generationFence.isCurrent(genId);
  const isLate = !isCurrent;

  if (isLate) {
    delayedToolRegistry.recordLateCompletion();
    generationAudit.record(
      genId,
      "tool_completed_late",
      generationFence.getCurrentGeneration(),
      "travel_tool",
      `Gen ${genId} ${intentResult.intent} tool finished after ${executionMs}ms (active Gen is ${generationFence.getCurrentGeneration()})`
    );
  } else {
    delayedToolRegistry.recordNormalCompletion();
    generationAudit.record(
      genId,
      "tool_completed",
      generationFence.getCurrentGeneration(),
      "travel_tool",
      `Gen ${genId} ${intentResult.intent} tool completed normally in ${executionMs}ms`
    );
  }

  // 3. Generate Deterministic Mock Data & Natural Voice Response
  return formatTravelResponse(intentResult, executionMs);
}

/**
 * 3. Generate Natural Spoken Responses & Data Payloads
 */
function formatTravelResponse(
  intentResult: IntentDetectionResult,
  executionMs: number
): TravelToolResult {
  const { intent, entities } = intentResult;

  switch (intent) {
    case "HOTEL_SEARCH": {
      const city = entities.city || "Mumbai";
      const day = entities.day || "Friday";

      if (day.toLowerCase() === "saturday") {
        return {
          intent,
          success: true,
          executionMs,
          data: {
            city,
            day: "Saturday",
            hotels: [
              { name: "Hotel Aurora", price: 4650, rating: 4.3, availableRooms: 2 },
              { name: "Trident Nariman Point", price: 4800, rating: 4.4, availableRooms: 4 },
            ],
          },
          spokenText: `I found two options in ${city} for Saturday. Hotel Aurora is ₹4,650 per night with a 4.3 rating, and it has rooms available.`,
        };
      }

      return {
        intent,
        success: true,
        executionMs,
        data: {
          city,
          day: "Friday",
          hotels: [
            { name: "Hotel Aurora", price: 4200, rating: 4.3, availableRooms: 2 },
            { name: "The Taj Mahal Tower", price: 4800, rating: 4.5, availableRooms: 3 },
          ],
        },
        spokenText: `I found two options in ${city} for Friday. Hotel Aurora is ₹4,200 per night with a 4.3 rating, and it has rooms available.`,
      };
    }

    case "FLIGHT_SEARCH": {
      const origin = entities.origin || "Chennai";
      const destination = entities.destination || "Mumbai";
      const day = entities.day || "Tuesday";

      if (origin.toLowerCase().includes("mumbai") && destination.toLowerCase().includes("delhi")) {
        return {
          intent,
          success: true,
          executionMs,
          data: {
            origin: "Mumbai",
            destination: "Delhi",
            day: entities.day || "tomorrow morning",
            flights: [
              { airline: "Vistara", departure: "07:30", arrival: "09:45", price: 4980 },
              { airline: "Indigo", departure: "10:15", arrival: "12:30", price: 4450 },
            ],
          },
          spokenText: "I found two flights from Mumbai to Delhi. The earliest is Vistara departing at 7:30 AM for ₹4,980.",
        };
      }

      return {
        intent,
        success: true,
        executionMs,
        data: {
          origin,
          destination,
          day,
          flights: [
            { airline: "Indigo", departure: "08:20", arrival: "10:15", price: 5240 },
            { airline: "Air India", departure: "14:10", arrival: "16:05", price: 5680 },
          ],
        },
        spokenText: `Yes. I found two ${day} flights from ${origin} to ${destination}. The earliest is Indigo at 8:20 AM for ₹5,240.`,
      };
    }

    case "CINEMA_TICKET": {
      const city = entities.city || "Mumbai";
      const movie = entities.movie || "Starlight";
      const time = entities.time || "7:30 PM";

      return {
        intent,
        success: true,
        executionMs,
        data: {
          city,
          theater: "PVR Icon",
          movie,
          time,
          pricePerSeat: 280,
          availableSeats: 2,
        },
        spokenText: `I found a ${time} ${movie} show in ${city} for ₹280 per seat, with two seats currently available.`,
      };
    }

    case "PRICE_BUDGET": {
      const budget = entities.budget || 5000;
      const city = entities.city || "Mumbai";
      const day = entities.day || "Saturday";

      return {
        intent,
        success: true,
        executionMs,
        data: {
          city,
          day,
          maxBudget: budget,
          selectedHotel: "Trident Nariman Point",
          price: 4800,
          rating: 4.4,
        },
        spokenText: `Updated for ${day} under ${budget.toLocaleString()} rupees: Found Trident Nariman Point at 4,800 rupees per night.`,
      };
    }

    case "RACE_SCENARIO": {
      return {
        intent,
        success: true,
        executionMs,
        data: { scenario: "deterministic_race" },
        spokenText: "Executing the deterministic race scenario with a four-second delayed hotel search.",
      };
    }

    case "GREETING": {
      return {
        intent,
        success: true,
        executionMs,
        data: { status: "ready" },
        spokenText: "Hello! I can help you find hotels, flights, and cinema tickets. What would you like to book?",
      };
    }

    case "GENERAL_TRAVEL": {
      return {
        intent,
        success: true,
        executionMs,
        data: { category: "travel_assistance" },
        spokenText: "I can assist you with hotel reservations, flight bookings, and cinema tickets across major cities.",
      };
    }

    case "UNKNOWN":
    default: {
      return {
        intent: "UNKNOWN",
        success: true,
        executionMs,
        data: { fallback: true },
        spokenText: "I can help with hotels, flights, cinema tickets, and travel searches. What would you like to find?",
      };
    }
  }
}
