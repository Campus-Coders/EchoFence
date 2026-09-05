# Build Plan

## Core Principle

Build the smallest convincing voice-native product first.

Every phase must end with a visible, testable result.

Do not add broad assistant features before the interruption problem works.

## Phase 1 — Foundation

### 01 Project Shell

Build:

- Next.js app
- global tokens
- base layout
- `/console`
- health/status UI

Acceptance:

- app starts cleanly
- TypeScript passes
- no console errors
- console route renders

### 02 Rime Configuration

Build:

- server-side Rime client
- environment validation
- observable provider configuration
- basic text-to-speech path

Acceptance:

- a real Rime-generated response can be heard
- exact model/speaker/language/endpoint/audio format/transport are captured for evidence
- no secret is exposed

### 03 Realtime Voice Loop

Build:

- microphone input
- ASR
- turn detection
- LLM response
- Rime speech
- transcript

Acceptance:

- user can complete a normal end-to-end voice interaction

## Phase 2 — Hard Voice Problem

### 04 Generation Fence

Implement:

- monotonically increasing generation IDs
- active generation state
- stale result guard
- event logging

Acceptance:

- an old tool result cannot commit to the active generation

### 05 Interrupt Controller

Implement:

- interruption event
- audio stop request
- queued-audio invalidation
- abort signals for cancellable work
- stale generation marking

Acceptance:

- interrupting a spoken response stops obsolete queued speech
- new user input is accepted without restarting the entire application

### 06 Delayed Tool Fixture

Build deterministic tool fixtures with configurable delay.

Example:

```text
tool: searchHotels
delay: 4000 ms
request: Mumbai Friday
```

Acceptance:

- delay is reproducible
- old result can intentionally arrive after interruption
- stale-result behavior is visible in the event timeline

### 07 Full Stress Case

Acceptance test:

1. start normal request
2. introduce fixed tool delay
3. let agent speak/wait
4. interrupt
5. change one request constraint
6. verify audio stop
7. verify old result is fenced
8. verify new request is processed
9. verify only the current generation is spoken

This is the central judging demo.

## Phase 3 — Evidence

### 08 Measurement Pipeline

Record:

- timestamps
- generation IDs
- audio lifecycle
- tool lifecycle
- stale result lifecycle
- provider
- final spoken generation

Acceptance:

- one command can run the stress test
- output is machine-readable
- results can be inspected by a judge

### 09 Evidence Dashboard

Show:

- current provider
- active generation
- current voice state
- event timeline
- stop latency
- stale results blocked
- stale results spoken
- pass/fail acceptance result

Acceptance:

- judge can understand the technical claim without reading source code

### 10 `RIME_EVIDENCE.md`

Document:

- claim
- acceptance test
- exact procedure
- environment/configuration
- results
- limitations
- reproducibility command
- representative fixture

Do not publish unsupported performance numbers.

## Phase 4 — Product/Demo Polish

### 11 Normal Flow

Make the normal voice interaction concise and easy to understand.

### 12 Deliberate Failure Demo

Add one deterministic stress button/fixture that reproduces the stale-result race.

### 13 Provider Visibility

Display:

```text
SPEECH PROVIDER
Rime

MODEL
<exact live model ID>

VOICE
<exact speaker>

LANGUAGE
<exact language>

TRANSPORT
<exact transport>
```

### 14 Demo Recording

Target structure:

**0:00–0:30** problem and user

**0:30–1:30** normal interaction

**1:30–3:00** deliberate interruption stress case

**3:00–4:00** event timeline and measurements

**4:00–4:30** architecture/Rime role

Keep total demo at or below the challenge's 4–5 minute requirement.

## Phase 5 — Submission Hardening

Checklist:

- [ ] working repository
- [ ] README setup
- [ ] exact Rime configuration recorded
- [ ] environment example with placeholders only
- [ ] Rime is primary judged provider
- [ ] no credentials committed
- [ ] `RIME_EVIDENCE.md`
- [ ] deterministic stress fixture
- [ ] normal flow works
- [ ] interruption flow works
- [ ] stale result cannot be spoken
- [ ] evidence numbers are verified
- [ ] limitations documented
- [ ] final demo <= 5 minutes
