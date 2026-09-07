/**
 * test-travel-agent.ts
 * Verification Suite for EchoFence Travel Voice Agent & Intent-Driven Race Safety.
 *
 * Validates:
 * 1. Hotel intent produces hotel response.
 * 2. Flight intent produces flight response.
 * 3. Cinema intent produces cinema response.
 * 4. Unknown intent produces fallback.
 * 5. Normal flow completes.
 * 6. Delayed tool creates asynchronous result.
 * 7. New generation supersedes old generation.
 * 8. Stale result is blocked.
 * 9. Stale result is not spoken.
 * 10. Transcript contains only authoritative assistant response.
 * 11. Metrics update dynamically.
 * 12. Race demo produces Started >= 2.
 * 13. Race demo produces Stale Blocked >= 1.
 * 14. Race demo produces Stale Spoken = 0.
 * 15. Protection Rate remains 100%.
 * 16. Total removal of canned echo strings across all responses.
 */

import { detectTravelIntent, executeTravelTool } from "./lib/travel-intent-router";
import { conversationService } from "./lib/conversation-service";
import { generationFence } from "./lib/generation-fence";
import { interruptController } from "./lib/interrupt-controller";
import { measurementPipeline } from "./lib/measurement-pipeline";
import { delayedToolRegistry } from "./lib/delayed-tool";
import { raceDemoController } from "./lib/race-demo-controller";
import type { ConversationTurn } from "./types/conversation";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    failedCount++;
    throw new Error(`Assertion failed: ${message}`);
  } else {
    console.log(`  ✓ PASS: ${message}`);
    passedCount++;
  }
}

async function runSuite() {
  console.log("==================================================");
  console.log("   ECHOFENCE TRAVEL VOICE AGENT & RACE SUITE      ");
  console.log("==================================================");

  // ----------------------------------------------------
  // TEST GROUP 1: Intent Detection & Entity Extraction
  // ----------------------------------------------------
  console.log("\nTEST GROUP 1: Intent Detection & Entity Extraction");

  const hotelIntent = detectTravelIntent("Find me a hotel in Mumbai for Friday.");
  assert(hotelIntent.intent === "HOTEL_SEARCH", "Hotel query maps to HOTEL_SEARCH");
  assert(hotelIntent.entities.city === "Mumbai", "Extracts city Mumbai");
  assert(hotelIntent.entities.day === "Friday", "Extracts day Friday");

  const flightIntent = detectTravelIntent("Can you find flights from Chennai to Mumbai on Tuesday?");
  assert(flightIntent.intent === "FLIGHT_SEARCH", "Flight query maps to FLIGHT_SEARCH");
  assert(flightIntent.entities.origin === "Chennai", "Extracts origin Chennai");
  assert(flightIntent.entities.destination === "Mumbai", "Extracts destination Mumbai");
  assert(flightIntent.entities.day === "Tuesday", "Extracts day Tuesday");

  const cinemaIntent = detectTravelIntent("Can you book here cinema ticket in Mumbai?");
  assert(cinemaIntent.intent === "CINEMA_TICKET", "Cinema query maps to CINEMA_TICKET");
  assert(cinemaIntent.entities.movie === "Starlight", "Extracts movie Starlight");
  assert(cinemaIntent.entities.time === "7:30 PM", "Extracts showtime 7:30 PM");

  const budgetIntent = detectTravelIntent("Find something for Saturday under ₹5000");
  assert(budgetIntent.intent === "PRICE_BUDGET", "Budget query maps to PRICE_BUDGET");
  assert(budgetIntent.entities.budget === 5000, "Extracts budget 5000");
  assert(budgetIntent.entities.day === "Saturday", "Extracts day Saturday");

  const unknownIntent = detectTravelIntent("What is the quantum spin of an electron?");
  assert(unknownIntent.intent === "UNKNOWN", "Out-of-domain query maps to UNKNOWN");

  // ----------------------------------------------------
  // TEST GROUP 2: Natural Spoken Responses (Zero Canned Echo)
  // ----------------------------------------------------
  console.log("\nTEST GROUP 2: Natural Spoken Responses (Zero Canned Echo)");

  const cannedEcho = "EchoFence processed your turn successfully";
  const cannedPrefix = "I received:";

  // 1. Hotel intent response
  const hotelRes = await conversationService.generateResponse("Find me a hotel in Mumbai for Friday.", { delayMs: 10 });
  assert(hotelRes.includes("Mumbai") && hotelRes.includes("Hotel Aurora"), "Hotel response mentions Mumbai and Hotel Aurora");
  assert(!hotelRes.includes(cannedEcho) && !hotelRes.includes(cannedPrefix), "Hotel response does not use canned echo");

  // 2. Flight intent response
  const flightRes = await conversationService.generateResponse("Can you find flights from Chennai to Mumbai on Tuesday?", { delayMs: 10 });
  assert(flightRes.includes("Chennai") && flightRes.includes("Indigo") && flightRes.includes("5,240"), "Flight response mentions Chennai, Indigo, and price");
  assert(!flightRes.includes(cannedEcho) && !flightRes.includes(cannedPrefix), "Flight response does not use canned echo");

  // 3. Cinema intent response
  const cinemaRes = await conversationService.generateResponse("Can you book here cinema ticket in Mumbai?", { delayMs: 10 });
  assert(cinemaRes.includes("Starlight") && cinemaRes.includes("7:30 PM") && cinemaRes.includes("280"), "Cinema response mentions Starlight, 7:30 PM, and ₹280");
  assert(!cinemaRes.includes(cannedEcho) && !cinemaRes.includes(cannedPrefix), "Cinema response does not use canned echo");

  // 4. Unknown fallback response
  const unknownRes = await conversationService.generateResponse("Completely random question", { delayMs: 10 });
  assert(unknownRes.includes("I can help with hotels, flights, cinema tickets"), "Unknown response provides helpful travel assistant fallback");
  assert(!unknownRes.includes(cannedEcho) && !unknownRes.includes(cannedPrefix), "Unknown response does not echo user input");

  // ----------------------------------------------------
  // TEST GROUP 3: Asynchronous Tool Execution Simulation
  // ----------------------------------------------------
  console.log("\nTEST GROUP 3: Asynchronous Tool Execution Simulation");

  const asyncStart = Date.now();
  const asyncRes = await executeTravelTool(hotelIntent, { generationId: 1, delayMs: 150 });
  const asyncElapsed = Date.now() - asyncStart;
  assert(asyncElapsed >= 140, `Simulated tool execution is asynchronous (took ${asyncElapsed}ms >= 140ms)`);
  assert(asyncRes.success === true, "Tool execution returned success");
  assert(asyncRes.spokenText.length > 0, "Spoken text is present");

  // ----------------------------------------------------
  // TEST GROUP 4: Generation Fencing of Stale Asynchronous Results
  // ----------------------------------------------------
  console.log("\nTEST GROUP 4: Generation Fencing of Stale Asynchronous Results");

  generationFence.reset();
  interruptController.reset();
  measurementPipeline.reset();
  delayedToolRegistry.reset();

  // Step 4.1: Gen 1 starts slow async tool
  const gen1 = generationFence.beginGeneration("test", "Gen 1: Slow hotel tool");
  assert(gen1 === 1, "Gen 1 allocated ID 1");
  assert(generationFence.isCurrent(gen1) === true, "Gen 1 is initially current");

  // Step 4.2: Gen 2 supersedes Gen 1
  const gen2 = generationFence.beginGeneration("test", "Gen 2: Fast flight search");
  assert(gen2 === 2, "Gen 2 allocated ID 2");
  assert(generationFence.isCurrent(gen2) === true, "Gen 2 is current");
  assert(generationFence.isCurrent(gen1) === false, "Gen 1 is superseded (isCurrent === false)");

  // Step 4.3: Late Gen 1 result reaches boundary
  const isGen1Allowed = generationFence.isCurrent(gen1);
  assert(isGen1Allowed === false, "Stale Gen 1 tool result rejected by fence");

  generationFence.recordStaleBlocked(gen1, "stale_tool_result_blocked", "test_fixture", "Blocked late tool");
  const snapAfterBlock = measurementPipeline.getSnapshot();
  assert(snapAfterBlock.staleResults.attempted === 1, "Stale result attempt recorded");
  assert(snapAfterBlock.staleResults.blocked === 1, "Stale result blocked recorded");
  assert(snapAfterBlock.audio.resurrectionCount === 0, "Audio resurrection is 0");
  assert(snapAfterBlock.transcript.corruptionCount === 0, "Transcript corruption is 0");
  assert(snapAfterBlock.staleResults.protectionRate === 100, "Protection rate is 100%");

  // ----------------------------------------------------
  // TEST GROUP 5: Deterministic Race Demo Controller Verification
  // ----------------------------------------------------
  console.log("\nTEST GROUP 5: Deterministic Race Demo Controller Verification");

  const turns: ConversationTurn[] = [];
  const demoResult = await raceDemoController.runDemo({
    setTurns: ((updater: unknown) => {
      if (typeof updater === "function") {
        const next = (updater as (prev: ConversationTurn[]) => ConversationTurn[])(turns);
        turns.length = 0;
        turns.push(...next);
      } else {
        turns.length = 0;
        turns.push(...(updater as ConversationTurn[]));
      }
    }) as React.Dispatch<React.SetStateAction<ConversationTurn[]>>,
  });

  assert(demoResult.status === "PASSED", `Race demo status is PASSED (got ${demoResult.status})`);
  assert(demoResult.invariantsPassed === true, "All invariants passed");
  assert(demoResult.invariants.generationOwnership === true, "Generation ownership invariant passed");
  assert(demoResult.invariants.transcriptIntegrity === true, "Transcript integrity invariant passed");
  assert(demoResult.invariants.audioIntegrity === true, "Audio integrity invariant passed");
  assert(demoResult.staleResultsBlocked >= 1, `Stale results blocked >= 1 (got ${demoResult.staleResultsBlocked})`);
  assert(demoResult.audioResurrections === 0, "Audio resurrections strictly 0");
  assert(demoResult.transcriptCorruption === 0, "Transcript corruption strictly 0");

  // Verify conversation turns in transcript
  const userTurns = turns.filter((t) => t.role === "user");
  const asstTurns = turns.filter((t) => t.role === "assistant");

  assert(userTurns.length === 2, `Transcript has exactly 2 user turns (got ${userTurns.length})`);
  assert(userTurns[0]!.text === "Find me a hotel in Mumbai for Friday.", "User Turn 1 is hotel query");
  assert(userTurns[1]!.text === "Actually, find me a flight to Mumbai on Saturday.", "User Turn 2 is flight barge-in query");

  assert(asstTurns.length === 1, `Transcript has strictly 1 assistant turn (got ${asstTurns.length})`);
  assert(asstTurns[0]!.generationId === demoResult.generation2, "Assistant response belongs strictly to Generation 2");
  assert(asstTurns[0]!.text.includes("Saturday flights to Mumbai"), "Assistant response is for Gen 2 flight search");
  assert(!asstTurns.some((t) => t.generationId === demoResult.generation1), "No assistant response exists for stale Gen 1");

  // Verify measurement snapshot
  const finalSnap = demoResult.measurementSnapshot;
  assert(finalSnap !== undefined, "Measurement snapshot is present in demo result");
  assert(finalSnap!.generation.generationsStarted >= 2, `Generations started >= 2 (got ${finalSnap!.generation.generationsStarted})`);
  assert(finalSnap!.staleResults.blocked >= 1, `Stale blocked >= 1 (got ${finalSnap!.staleResults.blocked})`);
  assert(finalSnap!.audio.resurrectionCount === 0, `Stale spoken (audio resurrections) strictly 0 (got ${finalSnap!.audio.resurrectionCount})`);
  assert(finalSnap!.staleResults.protectionRate === 100, `Protection rate strictly 100% (got ${finalSnap!.staleResults.protectionRate}%)`);

  console.log("\n==================================================");
  console.log("   ALL TRAVEL AGENT & RACE SUITE TESTS PASSED!    ");
  console.log("==================================================");
  console.log(`SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED\n`);
}

runSuite().catch((err) => {
  console.error("FATAL ERROR IN SUITE:", err);
  process.exit(1);
});
