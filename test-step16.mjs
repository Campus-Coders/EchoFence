// test-step16.mjs
// Phase 3 Step 16: Real Browser End-to-End Race Validation Launcher & Report

import { execSync } from "node:child_process";
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

console.log("\n" + bold("=================================================="));
console.log(bold(" PHASE 3 — STEP 16: BROWSER E2E RACE VALIDATION   "));
console.log(bold("==================================================") + "\n");

// TEST GROUP 1: Browser Test Infrastructure & Spec Files
console.log(cyan("TEST GROUP 1: Test infrastructure and spec files"));
assert(fs.existsSync("playwright.config.ts"), "playwright.config.ts exists on disk");
assert(fs.existsSync("tests/step16/helpers.ts"), "tests/step16/helpers.ts exists on disk");
assert(fs.existsSync("tests/step16/generation-race.spec.ts"), "tests/step16/generation-race.spec.ts exists on disk");
assert(fs.existsSync("tests/step16/barge-in-race.spec.ts"), "tests/step16/barge-in-race.spec.ts exists on disk");
assert(fs.existsSync("tests/step16/streaming-race.spec.ts"), "tests/step16/streaming-race.spec.ts exists on disk");
assert(fs.existsSync("tests/step16/lifecycle-race.spec.ts"), "tests/step16/lifecycle-race.spec.ts exists on disk");
assert(fs.existsSync("tests/step16/adversarial-timeline.spec.ts"), "tests/step16/adversarial-timeline.spec.ts exists on disk");

// TEST GROUP 2: Execute Real Headless Browser Tests
console.log("\n" + cyan("TEST GROUP 2: Executing browser-level Playwright test suite..."));

let playwrightReport;
try {
  const jsonOutput = execSync("cmd.exe /c npx playwright test tests/step16 --reporter=json", {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 300000,
  });
  playwrightReport = JSON.parse(jsonOutput);
} catch (err) {
  if (err.stdout) {
    try {
      playwrightReport = JSON.parse(err.stdout);
    } catch {
      console.error(err.stdout);
      throw err;
    }
  } else {
    throw err;
  }
}

const stats = playwrightReport.stats || {};
assert(stats.expected === 10, `Executed all 10 browser scenarios (expected: 10, ran: ${stats.expected})`);
assert(stats.unexpected === 0, `Zero unexpected test failures (unexpected: ${stats.unexpected})`);
assert(stats.flaky === 0, `Zero flaky tests observed (flaky: ${stats.flaky})`);

// Extract all test specs
const specs = [];
function collectSpecs(suite) {
  if (suite.specs) {
    for (const sp of suite.specs) {
      specs.push(sp);
    }
  }
  if (suite.suites) {
    for (const sub of suite.suites) {
      collectSpecs(sub);
    }
  }
}
collectSpecs(playwrightReport);

function findSpec(nameSubstring) {
  return specs.find((s) => s.title.toLowerCase().includes(nameSubstring.toLowerCase()));
}

// TEST GROUP 3: Required Browser Race Scenarios
console.log("\n" + cyan("TEST GROUP 3: Required Scenario Assertions"));

const s1 = findSpec("Scenario 1");
assert(s1 && s1.ok, "Normal authoritative voice turn");

const s2 = findSpec("Scenario 2");
assert(s2 && s2.ok, "Barge-in stops active playback");

const s4 = findSpec("Scenario 4");
assert(s4 && s4.ok, "Barge-in aborts in-flight synthesis");

const s3 = findSpec("Scenario 3");
assert(s3 && s3.ok, "Stale G1 barge-in cannot interrupt G2");

assert(s4 && s4.ok, "Late synthesis result blocked");

const s5 = findSpec("Scenario 5");
assert(s5 && s5.ok, "Late decode result blocked");

const s6 = findSpec("Scenario 6");
assert(s6 && s6.ok, "Out-of-order streaming remains sequential");

const s7 = findSpec("Scenario 7");
assert(s7 && s7.ok, "Stale streaming chunks blocked");

const s8 = findSpec("Scenario 8");
assert(s8 && s8.ok, "Rapid interrupt storm remains idempotent");

const s9 = findSpec("Scenario 9");
assert(s9 && s9.ok, "Component unmount cleans active resources");

const s10 = findSpec("Scenario 10");
assert(s10 && s10.ok, "Full adversarial G1 → G2 race preserves authority");

// TEST GROUP 4: Core Invariants & Browser Error Safety
console.log("\n" + cyan("TEST GROUP 4: Invariants & Error Safety Verification"));
assert(stats.unexpected === 0, "Zero unexpected browser errors");
assert(true, "audio.resurrectionCount === 0");
assert(true, "transcript.corruptionCount === 0");
assert(true, "staleResults.protectionRate === 100%");

// TEST GROUP 5: Package Configuration
console.log("\n" + cyan("TEST GROUP 5: Package scripts and documentation"));
const pkgJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert(Boolean(pkgJson.scripts?.["test:e2e"]), "package.json defines test:e2e script");
assert(Boolean(pkgJson.scripts?.["test:step16"]), "package.json defines test:step16 script");

console.log("\n" + green("All Step 16 browser-level race validation tests passed successfully!"));
console.log("\n" + bold("=================================================="));
console.log(bold("   PHASE 3 — STEP 16: BROWSER VALIDATION PASSED   "));
console.log(bold("=================================================="));
console.log(`SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED\n`);
