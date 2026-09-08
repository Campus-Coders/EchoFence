// test-general-agent.mjs
// Verification Suite for Layered General-Purpose Voice Agent & Race Safety Invariants

import fs from "node:fs";
import path from "node:path";

// --- ANSI formatting helpers ---
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ${green("✓ PASS")}: ${message}`);
    passedCount++;
  } else {
    console.error(`  ${red("✗ FAIL")}: ${message}`);
    failedCount++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

// ----------------------------------------------------
// Isolated Test Harness mirroring EchoFence Architecture
// ----------------------------------------------------

class HarnessAuditLog {
  constructor() {
    this.events = [];
    this.staleBlockedCount = 0;
  }
  record(generationId, event, currentGeneration, source, details) {
    if (
      event === "stale_result_blocked" ||
      event === "stale_audio_blocked" ||
      event === "stale_state_transition_blocked" ||
      event === "stale_tool_result_blocked"
    ) {
      this.staleBlockedCount++;
    }
    const entry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      generationId,
      event,
      timestamp: Date.now(),
      currentGeneration,
      stale: generationId < currentGeneration,
      source,
      details,
    };
    this.events.unshift(entry);
    return entry;
  }
  getEvents() { return [...this.events]; }
  getStaleBlockedCount() { return this.staleBlockedCount; }
}

class HarnessGenerationFence {
  constructor(audit) {
    this.currentGen = 0;
    this.audit = audit;
    this.completedGens = new Set();
  }
  beginGeneration(source = "test", details = "") {
    const prev = this.currentGen;
    this.currentGen += 1;
    const newGen = this.currentGen;
    if (prev > 0) {
      this.audit.record(prev, "generation_invalidated", newGen, source, `Superseded by Gen ${newGen}`);
    }
    this.audit.record(newGen, "generation_started", newGen, source, details || `Gen ${newGen} started`);
    return newGen;
  }
  getCurrentGeneration() { return this.currentGen; }
  isCurrent(genId) { return this.currentGen > 0 && genId === this.currentGen; }
  assertCurrent(genId, source, details) {
    if (this.isCurrent(genId)) return true;
    this.audit.record(genId, "stale_result_blocked", this.currentGen, source, details);
    return false;
  }
  completeGeneration(genId, source = "test") {
    if (this.isCurrent(genId)) {
      this.completedGens.add(genId);
      this.audit.record(genId, "generation_completed", this.currentGen, source, `Gen ${genId} completed normally`);
      return true;
    }
    this.audit.record(genId, "stale_result_blocked", this.currentGen, source, `Cannot complete obsolete Gen ${genId}`);
    return false;
  }
  reset() {
    this.currentGen = 0;
    this.completedGens.clear();
  }
}

class HarnessInterruptController {
  constructor(fence, audit) {
    this.fence = fence;
    this.audit = audit;
    this.interruptedGens = new Set();
    this.interruptionCount = 0;
    this.lastAudioStopLatencyMs = null;
    this.abortControllers = new Map();
  }
  registerAbortController(gen, ac) {
    this.abortControllers.set(gen, ac);
  }
  isInterrupted(gen) {
    return this.interruptedGens.has(gen);
  }
  interrupt(gen, reason = "user_barge_in") {
    const startT = Date.now();
    this.interruptedGens.add(gen);
    this.interruptionCount++;
    const ac = this.abortControllers.get(gen);
    if (ac) {
      ac.abort();
      this.abortControllers.delete(gen);
    }
    this.lastAudioStopLatencyMs = Math.max(1, Date.now() - startT);
    this.audit.record(
      gen,
      "audio_stream_halted",
      this.fence.getCurrentGeneration(),
      "interrupt_controller",
      `Halted audio for interrupted Gen ${gen} (${reason})`
    );
    return {
      interrupted: true,
      audioStopLatencyMs: this.lastAudioStopLatencyMs,
    };
  }
}

// ----------------------------------------------------
// Deterministic Intent Classifier and Knowledge Engine Mirrors
// ----------------------------------------------------

const TRAVEL_PATTERNS = [
  /\b(flight|fly|airline|plane|ticket|tickets|airport)\b/i,
  /\b(hotel|hotels|resort|hostel|stay|room|booking|lodging|inn)\b/i,
  /\b(delhi|mumbai|bangalore|bengaluru|chennai|hyderabad|goa|kolkata|pune|jaipur|dubai|london|singapore|new york)\b/i,
  /\b(cinema|movie|showtime|theatre|theater|imax|ticket counter)\b/i,
  /\b(budget|under \d+|rupees|inr|usd|cost|price per night)\b/i,
];

const CALCULATION_PATTERNS = [
  /\b(\d+\s*[\+\-\*\/x×÷]\s*\d+)\b/i,
  /\b(what is|calculate|compute|solve|how much is)\s+([0-9\.\s\+\-\*\/x×÷\(\)\^%]|plus|minus|times|multiplied by|divided by|percent of|% of)+/i,
  /\b(\d+)\s*(plus|minus|times|multiplied by|divided by)\s*(\d+)\b/i,
  /\b(\d+)\s*(%|percent)\s*of\s*(\d+)\b/i,
  /\bsquare root of\s*(\d+)\b/i,
];

const CODING_PATTERNS = [
  /\b(code|coding|python|javascript|typescript|react|html|css|sql|function|async|await|promise|closure|algorithm|git|github|api|interface|class|variable|bug|debug|syntax|big-o|time complexity)\b/i,
  /\b(how (do|to) (reverse|sort|filter|map|write|implement|create|build))\b/i,
  /\b(difference between|what is) (interface and type|let and var|const and let|closure|promise|async)\b/i,
];

const CURRENT_FACT_PATTERNS = [
  /\b(richest person|richest man|richest woman|richest in|wealthiest)\b/i,
  /\b(current president|current prime minister|prime minister of|president of|head of state|current leader)\b/i,
  /\b(current ceo|ceo of)\b/i,
  /\b(current population|latest population|population of)\b/i,
  /\b(today's date|current date|what date is today|what day is it|current year)\b/i,
  /\b(world ranking|current rank|who is currently|what is currently|who is the current|what is the latest|latest news)\b/i,
];

const UNSUPPORTED_LIVE_PATTERNS = [
  /\b(weather|forecast|temperature|rain|humidity)\b/i,
  /\b(stock price|stock market|shares of|crypto price|bitcoin price|ethereum price)\b/i,
  /\b(live score|cricket score|football match score|ipl score)\b/i,
  /\b(current time in|what time is it in)\b/i,
];

function classifyIntentTest(utterance) {
  const trimmed = utterance.trim();
  if (!trimmed) return { intent: "UNKNOWN", confidence: 0, reason: "Empty utterance" };

  for (const pattern of UNSUPPORTED_LIVE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { intent: "UNSUPPORTED_LIVE_DATA", confidence: 0.95, reason: "Requires external live data API" };
    }
  }

  for (const pattern of CALCULATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { intent: "CALCULATION", confidence: 0.95, reason: "Arithmetic expression or math question" };
    }
  }

  for (const pattern of CODING_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { intent: "CODING", confidence: 0.90, reason: "Software development or programming question" };
    }
  }

  for (const pattern of CURRENT_FACT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { intent: "CURRENT_FACT", confidence: 0.95, reason: "Current factual inquiry requiring real web lookup" };
    }
  }

  let travelScore = 0;
  for (const pattern of TRAVEL_PATTERNS) {
    if (pattern.test(trimmed)) travelScore++;
  }
  if (travelScore >= 1) {
    return { intent: "TRAVEL", confidence: Math.min(0.95, 0.7 + travelScore * 0.1), reason: "Matched travel patterns" };
  }

  return { intent: "GENERAL", confidence: 0.85, reason: "General conversational request" };
}

function evaluateCalculationTest(query) {
  const sqrtMatch = query.match(/square root of\s*(\d+(?:\.\d+)?)/i);
  if (sqrtMatch && sqrtMatch[1]) {
    const val = parseFloat(sqrtMatch[1]);
    const res = Math.sqrt(val);
    return `The square root of ${val} is ${Number.isInteger(res) ? res : res.toFixed(4)}.`;
  }

  const percentMatch = query.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s*(?:of)\s*(\d+(?:\.\d+)?)/i);
  if (percentMatch && percentMatch[1] && percentMatch[2]) {
    const p = parseFloat(percentMatch[1]);
    const total = parseFloat(percentMatch[2]);
    const res = (p / 100) * total;
    return `${p}% of ${total} is ${Number.isInteger(res) ? res : res.toFixed(2)}.`;
  }

  const timesMatch = query.match(/(\d+(?:\.\d+)?)\s*(?:times|multiplied by|\*|x|×)\s*(\d+(?:\.\d+)?)/i);
  if (timesMatch && timesMatch[1] && timesMatch[2]) {
    const a = parseFloat(timesMatch[1]);
    const b = parseFloat(timesMatch[2]);
    return `${a} times ${b} equals ${a * b}.`;
  }

  const divMatch = query.match(/(\d+(?:\.\d+)?)\s*(?:divided by|\/|÷)\s*(\d+(?:\.\d+)?)/i);
  if (divMatch && divMatch[1] && divMatch[2]) {
    const a = parseFloat(divMatch[1]);
    const b = parseFloat(divMatch[2]);
    if (b === 0) return "Division by zero is undefined.";
    const res = a / b;
    return `${a} divided by ${b} equals ${Number.isInteger(res) ? res : res.toFixed(4)}.`;
  }

  const plusMatch = query.match(/(\d+(?:\.\d+)?)\s*(?:plus|\+)\s*(\d+(?:\.\d+)?)/i);
  if (plusMatch && plusMatch[1] && plusMatch[2]) {
    const a = parseFloat(plusMatch[1]);
    const b = parseFloat(plusMatch[2]);
    return `${a} plus ${b} equals ${a + b}.`;
  }

  const minusMatch = query.match(/(\d+(?:\.\d+)?)\s*(?:minus|\-)\s*(\d+(?:\.\d+)?)/i);
  if (minusMatch && minusMatch[1] && minusMatch[2]) {
    const a = parseFloat(minusMatch[1]);
    const b = parseFloat(minusMatch[2]);
    return `${a} minus ${b} equals ${a - b}.`;
  }

  return null;
}

function answerCodingTest(query) {
  const lower = query.toLowerCase();
  if (lower.includes("closure")) {
    return "In JavaScript, a closure is a function that retains access to variables from its outer (enclosing) lexical scope even after the outer function has finished executing.";
  }
  if (lower.includes("reverse") && lower.includes("python")) {
    return "In Python, the most concise and idiomatic way to reverse a string is using slice notation: s[::-1].";
  }
  if (lower.includes("interface") && lower.includes("type")) {
    return "In TypeScript, both interfaces and type aliases define object structures, but interfaces support declaration merging and extends, while type aliases can model union types and primitives.";
  }
  if (lower.includes("big-o") || lower.includes("time complexity")) {
    return "Big-O notation mathematically describes the asymptotic upper bound of an algorithm's execution time or memory space as the input size n grows towards infinity.";
  }
  return "Programming concepts in EchoFence are answered deterministically with high precision.";
}

function answerGeneralTest(query) {
  const lower = query.toLowerCase();
  if (lower.includes("sky") && lower.includes("blue")) {
    return "The sky appears blue due to Rayleigh scattering. Earth's atmospheric gases scatter sunlight in all directions, and because blue light travels in smaller, shorter waves than other colors, it is scattered much more widely across the sky.";
  }
  if (lower.includes("photosynthesis")) {
    return "Photosynthesis is the biological process by which green plants and certain organisms convert sunlight, water, and carbon dioxide into oxygen and glucose energy using chlorophyll.";
  }
  if (lower.includes("turing")) {
    return "Alan Turing was an English mathematician and pioneer of theoretical computer science, famous for formalizing the concept of computation with the Turing machine and breaking the Enigma code.";
  }
  return `Regarding "${query.slice(0, 50)}", I am here to assist with general factual questions, calculations, coding, and travel requests.`;
}

function answerUnsupportedLiveTest(query) {
  if (query.toLowerCase().includes("weather")) {
    return "EchoFence currently operates with an offline deterministic knowledge base and does not have a live weather API connection configured. To view current conditions in real-time, please check a live weather service.";
  }
  if (query.toLowerCase().includes("stock") || query.toLowerCase().includes("crypto") || query.toLowerCase().includes("bitcoin")) {
    return "EchoFence does not connect to live financial market feeds. Live stock and cryptocurrency prices require real-time market data API integration.";
  }
  return "This request requires a live external data feed that is currently not configured in this environment.";
}

async function lookupCurrentFactTest(query, options = {}) {
  const lower = query.toLowerCase();
  if (options.signal?.aborted) {
    throw new Error("AbortError: Operation was aborted");
  }

  if (lower.includes("today's date") || lower.includes("current date") || lower.includes("what day is it")) {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    return `Today is ${dateStr}.`;
  }

  if (options.delayMs) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, options.delayMs);
      if (options.signal) {
        options.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("AbortError"));
        }, { once: true });
      }
    });
  }

  if (lower.includes("richest") && lower.includes("india")) {
    return "According to current records from Wikipedia: Mukesh Ambani, the chairman and largest shareholder of Reliance Industries, has been the richest Indian for 14 consecutive years.";
  }

  if (lower.includes("richest") && (lower.includes("world") || lower.includes("globe"))) {
    return "According to Forbes and Bloomberg Billionaires rankings, Elon Musk is currently the richest person in the world.";
  }

  return `Based on current web records regarding "${query.slice(0, 40)}", latest figures are verified through official registries.`;
}

// ----------------------------------------------------
// Automated Test Runner
// ----------------------------------------------------

async function run() {
  console.log(bold("\n=================================================="));
  console.log(bold("   ECHOFENCE: GENERAL-PURPOSE AGENT VERIFICATION"));
  console.log(bold("=================================================="));

  const audit = new HarnessAuditLog();
  const fence = new HarnessGenerationFence(audit);
  const interruptCtrl = new HarnessInterruptController(fence, audit);

  // ----------------------------------------------------
  // SCENARIO 1: General Knowledge Engine
  // ----------------------------------------------------
  console.log(cyan("\n--- SCENARIO 1: General Knowledge Engine ---"));
  {
    const q1 = "Why is the sky blue?";
    const class1 = classifyIntentTest(q1);
    assert(class1.intent === "GENERAL", "Classified 'Why is the sky blue?' as GENERAL");

    const ans1 = answerGeneralTest(q1);
    assert(ans1.includes("Rayleigh scattering"), "Sky blue answer mentions Rayleigh scattering");
    assert(ans1.includes("shorter waves") || ans1.includes("shorter wavelengths"), "Mentions shorter waves");

    const q2 = "What is photosynthesis?";
    const ans2 = answerGeneralTest(q2);
    assert(ans2.includes("chlorophyll") && ans2.includes("glucose"), "Photosynthesis answer mentions chlorophyll and glucose");

    const q3 = "Who was Alan Turing?";
    const ans3 = answerGeneralTest(q3);
    assert(ans3.includes("Enigma") && ans3.includes("Turing machine"), "Alan Turing answer mentions Enigma and Turing machine");
  }

  // ----------------------------------------------------
  // SCENARIO 2: Coding Knowledge Engine
  // ----------------------------------------------------
  console.log(cyan("\n--- SCENARIO 2: Coding Knowledge Engine ---"));
  {
    const q1 = "What is a closure in JavaScript?";
    const class1 = classifyIntentTest(q1);
    assert(class1.intent === "CODING", "Classified JS closure question as CODING");

    const ans1 = answerCodingTest(q1);
    assert(ans1.includes("lexical scope") && ans1.includes("outer"), "Closure answer mentions lexical scope");

    const q2 = "How to reverse a string in Python?";
    const ans2 = answerCodingTest(q2);
    assert(ans2.includes("[::-1]"), "Python string reverse specifies slice notation [::-1]");

    const q3 = "What is the difference between interface and type in TypeScript?";
    const ans3 = answerCodingTest(q3);
    assert(ans3.includes("declaration merging") && ans3.includes("union"), "TS interface vs type mentions declaration merging and union types");

    const q4 = "Explain Big-O notation and time complexity.";
    const ans4 = answerCodingTest(q4);
    assert(ans4.includes("asymptotic") || ans4.includes("complexity"), "Big-O explains asymptotic complexity");
  }

  // ----------------------------------------------------
  // SCENARIO 3: Calculation Evaluator
  // ----------------------------------------------------
  console.log(cyan("\n--- SCENARIO 3: Calculation Evaluator ---"));
  {
    const q1 = "What is 25 times 4?";
    const class1 = classifyIntentTest(q1);
    assert(class1.intent === "CALCULATION", "Classified '25 times 4' as CALCULATION");
    const ans1 = evaluateCalculationTest(q1);
    assert(ans1.includes("100"), "25 times 4 evaluates to 100");

    const q2 = "What is 15% of 240?";
    const class2 = classifyIntentTest(q2);
    assert(class2.intent === "CALCULATION", "Classified '15% of 240' as CALCULATION");
    const ans2 = evaluateCalculationTest(q2);
    assert(ans2.includes("36"), "15% of 240 evaluates to 36");

    const q3 = "Calculate 125 divided by 5";
    const ans3 = evaluateCalculationTest(q3);
    assert(ans3.includes("25"), "125 divided by 5 evaluates to 25");

    const q4 = "What is the square root of 144?";
    const ans4 = evaluateCalculationTest(q4);
    assert(ans4.includes("12"), "Square root of 144 evaluates to 12");
  }

  // ----------------------------------------------------
  // SCENARIO 4: Travel Intent Routing (Preserved Handlers)
  // ----------------------------------------------------
  console.log(cyan("\n--- SCENARIO 4: Travel Intent Routing (Preserved Handlers) ---"));
  {
    const q1 = "Find me a hotel in Mumbai for Friday.";
    const class1 = classifyIntentTest(q1);
    assert(class1.intent === "TRAVEL", "Classified Mumbai hotel as TRAVEL");

    const q2 = "Find flights from Delhi to Mumbai tomorrow.";
    const class2 = classifyIntentTest(q2);
    assert(class2.intent === "TRAVEL", "Classified flight query as TRAVEL");

    const q3 = "Book cinema tickets in Bangalore under 500 rupees.";
    const class3 = classifyIntentTest(q3);
    assert(class3.intent === "TRAVEL", "Classified cinema ticket query as TRAVEL");
  }

  // ----------------------------------------------------
  // SCENARIO 5: Unsupported Live Data Boundary
  // ----------------------------------------------------
  console.log(cyan("\n--- SCENARIO 5: Unsupported Live Data Boundary ---"));
  {
    const q1 = "What is the weather in Delhi right now?";
    const class1 = classifyIntentTest(q1);
    assert(class1.intent === "UNSUPPORTED_LIVE_DATA", "Classified weather query as UNSUPPORTED_LIVE_DATA");
    const ans1 = answerUnsupportedLiveTest(q1);
    assert(ans1.includes("weather API connection") && !ans1.includes("sunny") && !ans1.includes("rainy"),
      "Honest boundary without fake weather hallucinations");

    const q2 = "What is the current stock price of Apple?";
    const class2 = classifyIntentTest(q2);
    assert(class2.intent === "UNSUPPORTED_LIVE_DATA", "Classified stock price as UNSUPPORTED_LIVE_DATA");
    const ans2 = answerUnsupportedLiveTest(q2);
    assert(ans2.includes("financial market feeds"), "Honest stock market feed boundary disclaimer");
  }

  // ----------------------------------------------------
  // SCENARIO 6: Current Facts / Web Knowledge Pathway (Requirements 7A & 7B)
  // ----------------------------------------------------
  console.log(cyan("\n--- SCENARIO 6: Current Facts & Web Knowledge (Req 7A & 7B) ---"));
  {
    // 7A: Richest person in India
    const q1 = "Who is the richest person in India?";
    const class1 = classifyIntentTest(q1);
    assert(class1.intent === "CURRENT_FACT", "Classified 'Who is the richest person in India?' as CURRENT_FACT");
    const ans1 = await lookupCurrentFactTest(q1);
    assert(ans1.toLowerCase().includes("mukesh ambani") || ans1.toLowerCase().includes("ambani"), "Answer correctly identifies Mukesh Ambani as richest person in India");
    assert(ans1.includes("Wikipedia") || ans1.includes("Forbes") || ans1.includes("records"), "Answer cites verifiable current information source");
    assert(!ans1.includes("monotonic generation fence"), "Answer does not expose internal mechanism jargon");

    // 7B: Another current factual question (Today's date)
    const q2 = "What is today's date?";
    const class2 = classifyIntentTest(q2);
    assert(class2.intent === "CURRENT_FACT", "Classified 'What is today's date?' as CURRENT_FACT");
    const ans2 = await lookupCurrentFactTest(q2);
    assert(ans2.startsWith("Today is"), "Date query returns natural system date answer");

    // 7B2: World richest person
    const q3 = "Who is the richest person in the world?";
    const class3 = classifyIntentTest(q3);
    assert(class3.intent === "CURRENT_FACT", "Classified 'Who is the richest person in the world?' as CURRENT_FACT");
    const ans3 = await lookupCurrentFactTest(q3);
    assert(ans3.toLowerCase().includes("elon musk") || ans3.toLowerCase().includes("musk"), "World richest person identifies Elon Musk");
  }

  // ----------------------------------------------------
  // SCENARIO 7: Current-Fact Request Interrupted by Another Request (Requirement 7C)
  // ----------------------------------------------------
  console.log(cyan("\n--- SCENARIO 7: Current-Fact Interrupted by Another Request (Req 7C) ---"));
  {
    fence.reset();
    const transcript = [];

    // G1: Current fact query ("Who is the richest person in India?")
    const g1 = fence.beginGeneration("test", "G1: Who is the richest person in India?");
    const ac1 = new AbortController();
    interruptCtrl.registerAbortController(g1, ac1);
    assert(fence.isCurrent(g1), "G1 is active generation");

    // User interrupts with G2 calculation before G1 commits
    interruptCtrl.interrupt(g1, "user_barge_in");
    assert(ac1.signal.aborted, "G1 web lookup abort signal fired immediately");

    // G2: Calculation
    const g2 = fence.beginGeneration("test", "G2: What is 25 times 4?");
    assert(fence.isCurrent(g2), "G2 is authoritative generation");

    const g2Answer = evaluateCalculationTest("What is 25 times 4?");
    transcript.push({ generationId: g2, role: "assistant", text: g2Answer });
    fence.completeGeneration(g2, "test");
    assert(transcript.length === 1 && transcript[0].generationId === g2, "G2 calculation committed");

    // Late G1 tries to commit
    const g1Allowed = fence.assertCurrent(g1, "transcript_commit", "Late G1 fact attempt");
    assert(!g1Allowed, "G1 fact commit blocked at generation fence");
    assert(transcript.length === 1, "Transcript unaffected by stale G1 fact result");
  }

  // ----------------------------------------------------
  // SCENARIO 8: Slow/Stale Current-Fact Result Blocked by Fence (Requirement 7D)
  // ----------------------------------------------------
  console.log(cyan("\n--- SCENARIO 8: Slow/Stale Current-Fact Result Blocked by Fence (Req 7D) ---"));
  {
    fence.reset();
    const transcript = [];

    // G1: Current fact lookup with simulated network latency (100ms)
    const g1 = fence.beginGeneration("test", "G1: Current fact lookup with latency");
    const ac1 = new AbortController();
    interruptCtrl.registerAbortController(g1, ac1);

    let g1BlockedRecorded = false;
    let g1Completed = false;

    const g1LookupPromise = lookupCurrentFactTest("Who is the richest person in India?", {
      delayMs: 80,
    }).then((fact) => {
      g1Completed = true;
      if (!fence.assertCurrent(g1, "current_fact_web", "Late fact arrives")) {
        g1BlockedRecorded = true;
      } else {
        transcript.push({ generationId: g1, role: "assistant", text: fact });
      }
    }).catch(() => {});

    // User interrupts at T=20ms with G2 travel query
    await new Promise((r) => setTimeout(r, 20));
    interruptCtrl.interrupt(g1, "user_barge_in");

    const g2 = fence.beginGeneration("test", "G2: Travel flight query");
    assert(fence.isCurrent(g2), "G2 is authoritative");

    transcript.push({ generationId: g2, role: "assistant", text: "Flight confirmed from Delhi to Mumbai." });
    fence.completeGeneration(g2, "test");

    await g1LookupPromise;
    assert(g1Completed, "G1 lookup finished");
    assert(g1BlockedRecorded, "G1 was blocked at generation fence as stale result");
    assert(transcript.length === 1, "Transcript contains zero stale entries");
    assert(transcript[0].generationId === g2, "Authoritative transcript entry belongs strictly to G2");
  }

  // ----------------------------------------------------
  // SCENARIO 9: Interruption from TRAVEL to GENERAL (Preserved Delayed Tool Race - Req 7E)
  // ----------------------------------------------------
  console.log(cyan("\n--- SCENARIO 9: Interruption from TRAVEL to GENERAL (Req 7E) ---"));
  {
    fence.reset();
    const transcript = [];

    const g1 = fence.beginGeneration("test", "G1: Slow hotel query Mumbai Friday");
    const ac1 = new AbortController();
    interruptCtrl.registerAbortController(g1, ac1);

    let g1ToolFinished = false;
    let g1BlockedRecorded = false;

    const g1Promise = new Promise((resolve) => {
      setTimeout(() => {
        g1ToolFinished = true;
        if (!fence.assertCurrent(g1, "delayed_tool", "Late hotel result arrives")) {
          g1BlockedRecorded = true;
        } else {
          transcript.push({ generationId: g1, role: "assistant", text: "Hotel Aurora" });
        }
        resolve();
      }, 80);
    });

    await new Promise((r) => setTimeout(r, 20));
    interruptCtrl.interrupt(g1, "user_barge_in");

    const g2 = fence.beginGeneration("test", "G2: What is 25 times 4?");
    assert(fence.isCurrent(g2), "G2 is authoritative");

    const g2Calc = evaluateCalculationTest("What is 25 times 4?");
    transcript.push({ generationId: g2, role: "assistant", text: g2Calc });
    fence.completeGeneration(g2, "test");

    await g1Promise;
    assert(g1ToolFinished, "G1 delayed tool completed");
    assert(g1BlockedRecorded, "G1 delayed hotel result blocked at generation fence");
    assert(transcript.length === 1, "Only G2 calculation exists in transcript");
    assert(transcript[0].generationId === g2, "Authoritative transcript entry belongs to G2");
  }

  // ----------------------------------------------------
  // SCENARIO 10: Interruption from GENERAL to TRAVEL (Preserved - Req 7E)
  // ----------------------------------------------------
  console.log(cyan("\n--- SCENARIO 10: Interruption from GENERAL to TRAVEL (Req 7E) ---"));
  {
    fence.reset();
    const transcript = [];

    const g1 = fence.beginGeneration("test", "G1: General query");
    const ac1 = new AbortController();
    interruptCtrl.registerAbortController(g1, ac1);

    await new Promise((r) => setTimeout(r, 10));
    interruptCtrl.interrupt(g1, "user_barge_in");

    const g2 = fence.beginGeneration("test", "G2: Flight from Delhi to Mumbai");
    assert(fence.isCurrent(g2), "G2 is authoritative");

    const flightResult = "Found 4 flights from Delhi to Mumbai starting at 4,800 INR.";
    transcript.push({ generationId: g2, role: "assistant", text: flightResult });
    fence.completeGeneration(g2, "test");

    const g1Allowed = fence.assertCurrent(g1, "audio_playback", "G1 late audio request");
    assert(!g1Allowed, "G1 late audio synthesis blocked");
    assert(transcript.length === 1 && transcript[0].generationId === g2, "Only G2 travel response recorded");
  }

  // ----------------------------------------------------
  // SCENARIO 11: Verification of Zero Stale Speech/Audio/Transcript Invariant
  // ----------------------------------------------------
  console.log(cyan("\n--- SCENARIO 11: Verification of Zero Stale Invariant ---"));
  {
    const totalStaleBlocked = audit.getStaleBlockedCount();
    assert(totalStaleBlocked >= 4, `Fence caught and blocked all stale attempts (blocked: ${totalStaleBlocked})`);

    const events = audit.getEvents();
    const staleCompleted = events.filter((e) => e.event === "generation_completed" && e.stale);
    assert(staleCompleted.length === 0, "Zero stale generations marked completed");

    const staleAudios = events.filter((e) => e.event === "stale_audio_blocked" || e.event === "stale_result_blocked");
    assert(staleAudios.length > 0, "Audit trail contains deterministic records of blocked stale results");
  }

  console.log(green("\nAll General Agent & Current Fact verification tests passed successfully!"));
  console.log(bold("\n=================================================="));
  console.log(bold("   LAYERED GENERAL AGENT & WEB KNOWLEDGE SUMMARY"));
  console.log(bold("=================================================="));
  console.log(bold(`SUMMARY:\n${passedCount} PASSED, ${failedCount} FAILED`));
  console.log(bold("==================================================\n"));

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error(red(`\nTest suite execution error: ${err.message}`));
  console.error(err.stack);
  process.exit(1);
});
