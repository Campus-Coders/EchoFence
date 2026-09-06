# RIME EVIDENCE & PROVIDER CONTRACT
**EchoFence — Interruption-Safe Voice Intelligence**

---

## 1. Executive Summary

### The Hard Voice Problem EchoFence Solves
Voice assistants operate in an inherently asynchronous, multi-tier execution environment. When a user speaks, the assistant begins a logical turn that may involve remote Large Language Model inference, external API and tool execution, and neural text-to-speech (TTS) synthesis.

If the user interrupts the assistant and issues a new command, asynchronous operations from the previous turn are frequently already in flight across network boundaries. Without deterministic concurrency controls, these obsolete operations eventually resolve and attempt to commit their results, leading to critical failure modes:
- **Obsolete speech resurrection**: Stale audio synthesis streams start playing over the user's new request.
- **Transcript corruption**: Delayed responses from invalidated turns are appended to the conversational history out of order.
- **State machine desynchronization**: Late asynchronous callbacks revert the voice state (e.g., forcing `IDLE` or `SPEAKING` when the system should be `LISTENING`).

EchoFence eliminates this failure class by enforcing a monotonic **Generation Fence**. Every logical turn is assigned a monotonically increasing numeric Generation ID ($1, 2, 3, \dots$). 

### Core Architectural Principle: Arrival $\neq$ Authority
```
┌─────────────────────────────────────────────────────────────┐
│                    ARRIVAL ≠ AUTHORITY                      │
│                                                             │
│   The physical arrival of an asynchronous network result    │
│   does NOT grant it the right to mutate system state.       │
│   Every result must pass the Generation Fence guard first.  │
└─────────────────────────────────────────────────────────────┘
```

Rime is integrated strictly as a speech synthesis provider behind EchoFence. Rime is **never** the authority for generation ownership, transcript mutation, voice state transitions, or audio playback. Only the active generation is authoritative.

---

## 2. The Exact Race Condition

EchoFence features a deterministic, reproducible stress test fixture (`searchHotelsDelayed`) with a fixed 4000ms delay that models the exact race condition encountered with remote voice and tool execution.

### The Deterministic Race Lifecycle

| Timestamp | Entity | Lifecycle Event | System Action / State |
|---|---|---|---|
| **$T = 0\text{ ms}$** | **Generation 1** | User asks: *"Book a hotel in Paris for 3 nights"* | Generation 1 allocated monotonically (`gen = 1`). State: `THINKING`. |
| **$T \approx 100\text{ ms}$** | **Generation 1** | Starts 4000ms delayed asynchronous work | Asynchronous tool timer begins running in background. |
| **$T \approx 500\text{ ms}$** | **User Barge-in** | User interrupts: *"Cancel that, tell me the weather in Tokyo"* | `interruptController.interrupt(1)` triggered immediately. Audio halted, `AbortController` signaled. |
| **$T \approx 510\text{ ms}$** | **EchoFence** | Generation 1 invalidated | Gen 1 marked `interrupted`. State transitions to `RECOVERING`. |
| **$T \approx 550\text{ ms}$** | **Generation 2** | Generation 2 becomes authoritative | `fence.beginGeneration()` allocates monotonic ID `2`. State: `LISTENING` $\to$ `THINKING`. |
| **$T \approx 750\text{ ms}$** | **Generation 2** | Assistant responds: *"Tokyo is sunny and 18°C"* | Generation 2 commits assistant turn to transcript. State: `SPEAKING` $\to$ `IDLE`. |
| **$T \approx 4100\text{ ms}$** | **Generation 1** | 4-second delayed Gen 1 result arrives late | Delayed tool returns Paris hotel data (`completedLate: true`). |
| **$T \approx 4102\text{ ms}$** | **Guarded Boundary** | Gen 1 result attempts to commit | **FENCE INTERCEPTS**: Guard evaluates $1 < 2$. Result is strictly **BLOCKED**. |

### Verified Outcome (Runtime Evidence)
All metrics originate directly from the `MeasurementPipeline` and `GenerationFence` runtime:
- **Stale Results Attempted**: `1`
- **Stale Results Blocked**: `1`
- **Stale Protection Rate**: `100%`
- **Transcript Corruption Count**: `0`
- **Audio Resurrections**: `0`
- **Active Generation Authority**: `#2` (Preserved)

*(Note: Latency values such as 1ms abort latency and 2ms audio stop latency are runtime measurements captured by `PerformanceClock`, not fabricated constants).*

---

## 3. Current System Architecture

```mermaid
flowchart TD
    User["User Speech / Turn Input"]
        |
        v
    Fence["GenerationFence (Single Authority)"]
        |
        +-------------------+-------------------+
        |                                       |
        v                                       v
    Gen1["Generation 1 (Obsolete)"]         Gen2["Generation 2 (Authoritative)"]
        |                                       |
        v                                       v
    AsyncWork["Async Tool / TTS Synthesis"]    NewTurn["Active Conversational Turn"]
        |
        v
    ProviderBoundary["Rime Provider Boundary"]
        |
        v
    LateResult["Late Asynchronous Result"]
        |
        v
    Guard{"GenerationFence Guard"}
        |
        +-----------------------+-----------------------+
        |                                               |
        v (if candidate == active)                      v (if candidate < active)
    CommitOutput["AUTHORITATIVE COMMIT"]            BlockOutput["STRICTLY BLOCKED"]
        |                                               |
        +--> Transcript Appended                        +--> GenerationAudit Logged
        +--> Audio Playback Started                     +--> MeasurementPipeline Incremented
        +--> State Machine Transitioned                 +--> Zero Transcript Mutation
                                                        +--> Zero Audio Playback
                                                        +--> Zero State Machine Change
```

Rime operates exclusively at the **Provider Boundary**. It receives synthesis requests with associated Generation IDs and returns audio buffers, but can never directly mutate the conversation, audio element, or state machine without passing through the `GenerationFence Guard`.

---

## 4. Rime Provider Contract

Phase 3 introduces real Rime neural voice synthesis. The integration must strictly satisfy the following strongly-typed contracts:

```typescript
export interface VoiceProviderRequest {
  /** Monotonic turn generation ID issued by GenerationFence */
  generationId: number;
  /** Unique request tracking identifier */
  requestId: string;
  /** Text prompt for speech synthesis */
  text: string;
  /** Request dispatch timestamp from PerformanceClock */
  startedAt: number;
  /** Optional cancellation signal from InterruptController */
  signal?: AbortSignal;
  /** Selected Rime model identifier */
  model?: string;
  /** Selected Rime voice/speaker identifier */
  voice?: string;
}

export interface VoiceProviderResult {
  /** Generation ID associated with this operation */
  generationId: number;
  /** Tracking identifier corresponding to request */
  requestId: string;
  /** Completion timestamp from PerformanceClock */
  completedAt: number;
  /** Execution status */
  status: "completed" | "cancelled" | "failed";
  /** Synthesized audio payload (ArrayBuffer or Base64 audio stream) */
  audioData?: ArrayBuffer | string;
  /** Normalized error code */
  errorCode?: VoiceProviderErrorCode;
  /** Error message if synthesis failed */
  error?: string;
}
```

### Implemented Provider Boundary (`lib/rime-provider.ts`)
The server-side `RimeProviderAdapter` provides a robust, isolated provider boundary:
- **Mode Isolation**:
  - `real`: Dispatches HTTP POST requests to official Rime TTS endpoint using server-held credentials.
  - `mock`: Generates deterministic synthetic audio buffers for offline testing without external API credentials.
- **Request Traceability**: Every request preserves `generationId` and issues or retains a unique `requestId` (`rime-req-*`), with millisecond timing tracking (`startedAt`, `completedAt`, `latencyMs`).
- **AbortSignal Forwarding**: External abort signals (triggered by user interruption via `InterruptController`) are propagated to the HTTP fetch call and mock delay timers, returning normalized `status: "cancelled"` with `errorCode: "ABORTED"`.
- **Timeout Protection**: Internal timeout guards (configurable, default 8000ms) prevent dangling socket connections, cleaning up timers and listeners upon resolution.
- **Error Normalization**:

| Error Code | Trigger Condition | System Behavior |
|---|---|---|
| `NOT_CONFIGURED` | Server API key missing or invalid | Graceful fallback metadata, no crash |
| `ABORTED` | User interrupted generation before/during call | Synthesis cleanly cancelled, zero side effects |
| `TIMEOUT` | Synthesis exceeded configured timeout | Normalized failure, listeners cleaned up |
| `NETWORK_ERROR` | Transport/socket failure | Server connection failure reported safely |
| `PROVIDER_ERROR` | Rime HTTP 4xx/5xx status code | Sanitized status code, zero secret leakage |
| `INVALID_RESPONSE` | Empty or malformed audio buffer | Rejected before buffer parsing |

### Security Contract
The provider layer must **never** expose credentials:
- `RIME_API_KEY` remains strictly on the server side (`lib/config.ts`, `lib/rime-provider.ts`, Next.js Route Handlers).
- The browser client never receives raw API keys, bearer tokens, or authorization headers.
- Telemetry endpoints (`/api/evidence/*`) expose only sanitized metadata (booleans, monotonic IDs, event types, latencies).

---

## 5. The Critical Asynchronous Boundary

The single most critical architectural invariant in EchoFence is:

> **Every asynchronous provider completion must perform a generation ownership check immediately before executing any externally visible side effect.**

Side effects requiring generation guarding include:
1. Appending assistant messages to the conversation transcript.
2. Transitioning the `VoiceStateMachine` (e.g. to `SPEAKING` or `IDLE`).
3. Allocating or initializing Web Audio contexts or HTMLAudioElements.
4. Calling `audio.play()` or streaming audio chunks to speakers.
5. Emitting completion callbacks to the UI.

### Implemented Authorization Boundary (`lib/generation-aware-synthesis.ts`)
The `GenerationAwareSynthesis` orchestrator enforces the authorization boundary between `RimeProviderAdapter` and the system:
1. **Pre-Dispatch Guard**: Rejects synthesis requests immediately if the requested generation has already been superseded by a newer active generation.
2. **Per-Generation AbortController Management**: Tracks `AbortController` instances keyed by `generationId` and `requestId`. Interruption triggers immediate cancellation without clobbering controllers belonging to newer generations.
3. **Authorization Evaluation**: Upon provider result arrival, checks `generationFence.isCurrent(result.generationId)`:
   - **Authorized (`kind: "authorized"`)**: Permitted ONLY if `generationId === activeGeneration`. Yields `AuthorizedSynthesisResult` with audio buffer and provider latency.
   - **Stale Blocked (`kind: "stale"`)**: If `generationId < activeGeneration`, strictly intercepts the result, increments `measurementPipeline.recordStaleResultAttempted` and `recordStaleResultBlocked`, and emits `stale_synthesis_result_blocked` and `stale_audio_blocked`.
   - **Zero Downstream Side Effects**: Stale audio never enters the playback queue; transcript mutation is completely barred.

---

## 6. Audio Resurrection Prevention

### The Failure Mode
1. Generation 1 begins speaking synthesized audio.
2. User interrupts by speaking a new command.
3. Active audio playback is immediately stopped.
4. Generation 2 is allocated and begins processing.
5. A delayed audio packet or completion callback from Generation 1 arrives late.
6. If unguarded, Generation 1 audio restarts, speaking obsolete information over the user's new request.

### Invariant & Measurement
$$\text{Candidate Generation} < \text{Authoritative Generation} \implies \text{Playback Strictly Forbidden}$$

- `audio.resurrectionCount` must strictly equal `0`.
- Stale audio attempts increment `audio.staleAudioStartsBlocked`.
- If an interrupted audio buffer ever plays after a newer generation becomes active, `recordAudioResurrection()` fires, immediately failing the system verdict.

---

## 7. Interruption Contract

When a user interrupts ongoing speech or processing:
1. `InterruptController` is invoked with the active Generation ID and reason (`user_barge_in`).
2. Active audio output is silenced immediately (within $\approx 1\text{–}3\text{ ms}$).
3. An `AbortSignal` is dispatched to in-flight cancellable requests.
4. The generation is marked `interrupted` in `InterruptController`.
5. `GenerationFence.invalidate()` is executed.
6. `VoiceStateMachine` transitions from `SPEAKING`/`THINKING` $\to$ `INTERRUPTED` $\to$ `RECOVERING`.
7. `GenerationFence.beginGeneration()` issues a new monotonic ID, advancing to `LISTENING`.

### Fundamental Rule
```
┌─────────────────────────────────────────────────────────────┐
│          CANCELLATION IS AN OPTIMIZATION.                   │
│          GENERATION VALIDATION IS THE SAFETY GUARANTEE.     │
└─────────────────────────────────────────────────────────────┘
```
Network cancellations can fail, arrive late, or be ignored by third-party APIs. EchoFence never relies on cancellation alone to prevent race conditions. The Generation Fence guarantees correctness even when cancellation is impossible or ignored.

---

## 8. Event and Measurement Contract

Phase 3 Rime integration feeds the existing telemetry subsystems:
- **`GenerationAudit`**: Chronological log of granular lifecycle events.
- **`MeasurementPipeline`**: Normalized quantitative performance and correctness metrics.
- **`EvidenceDashboard`**: Real-time visual scoreboard and system verdict.

### Standard Provider Event Types
- `rime_request_started`: Dispatched when synthesis request begins.
- `rime_request_completed`: Dispatched when synthesis finishes.
- `rime_request_cancelled`: Dispatched when `AbortController` terminates synthesis.
- `rime_request_failed`: Dispatched on network or provider error.
- `rime_result_current`: Dispatched when authoritative audio is approved for playback.
- `rime_result_stale_blocked`: Dispatched when stale audio is intercepted and blocked by the fence.

---

## 9. Security Contract

1. **Server-Side Isolation**: All calls using `RIME_API_KEY` occur exclusively in server-side Next.js route handlers (`/api/voice/synthesize`) or server modules (`agent/rime.ts`).
2. **Safe Observable Metadata**: The public endpoint `/api/voice/status` returns only:
   - `configured: boolean`
   - `provider: "rime"`
   - `selectedModel: string`
   - `selectedVoice: string`
   - `audioFormat: string`
   - `transport: string`
3. **Zero Secret Leakage**: The strings `apiKey`, `secret`, `rawKey`, and raw tokens are excluded from all evidence responses (`/api/evidence/*`).

---

## 10. Evidence Surfaces

| Surface / Endpoint | Plane | Operational Proof |
|---|---|---|
| **`/console`** | Presentation | User console featuring `RaceDemoPanel`, `MeasurementDashboard`, and `EvidenceDashboard`. |
| **`/api/evidence/generation`** | Evidence Plane | Real-time generation fence telemetry, monotonic IDs, and delayed tool metrics. |
| **`/api/evidence/interrupt`** | Evidence Plane | Interruption counts, audio stop latencies, and recovery durations. |
| **`/api/evidence/metrics`** | Evidence Plane | Canonical `MeasurementSnapshot` with protection rates and corruption counts. |
| **`/api/evidence/dashboard`** | Evidence Plane | Unified composite payload delivering system verdict, runs, metrics, and event log. |
| **`/api/voice/status`** | Configuration | Verifiable active provider status (Rime model/voice configuration without secrets). |

---

## 11. Judge Reproduction Guide

Hackathon judges can independently verify the EchoFence race protection guarantee in seconds:

1. Launch the application: `npm run dev` (or `npm start`).
2. Open `http://localhost:3000/console` in any modern web browser.
3. Locate the prominent hero section at the top of the page:
   ```
   ECHO FENCE — Race-Safe Voice Agent Demonstration
   [ RUN FULL RACE DEMO ]
   ```
4. Click **[ RUN FULL RACE DEMO ]**.
5. Observe the automated sequence:
   - **Generation 1 Starts**: User query for Mumbai hotels dispatched ($T = 0\text{ ms}$).
   - **Delayed Tool Initiated**: 4000ms background operation begins ($T \approx 100\text{ ms}$).
   - **Barge-In Interruption**: User interrupts with Nariman Point query ($T \approx 500\text{ ms}$).
   - **Generation 2 Authoritative**: Gen 2 initiates, executes, and completes normally ($T \approx 750\text{ ms}$).
   - **Late Stale Completion**: At $T \approx 4100\text{ ms}$, Gen 1 completes late.
   - **Fence Interception**: The Generation Fence rejects Gen 1, logging `STALE RESULT BLOCKED`.
6. Verify the **Unified Evidence Dashboard**:
   - **Verdict**: **`PASS`**
   - **Transcript Corruption**: **`0`**
   - **Audio Resurrection**: **`0`**
   - **Protection Rate**: **`100%`**
   - **Fence Status**: **`ACTIVE`**

---

## 12. Phase 3 Implementation Plan

Phase 3 introduces live Rime voice integration across 5 disciplined steps:

### Step 11: Rime Provider Adapter
- Implement server-side Rime API client (`agent/rime.ts` / `lib/rime-client.ts`).
- Securely load `RIME_API_KEY` from environment variables.
- Attach Generation IDs to all outgoing requests.
- Return structured audio buffers without client-side side effects.

### Step 12: Generation-Aware Rime Synthesis (COMPLETE)
- Implemented `lib/generation-aware-synthesis.ts` connecting `RimeProviderAdapter` to `GenerationFence`.
- Attached monotonic `generationId` and traceable `requestId` through entire synthesis lifecycle.
- Guarded boundary intercepts stale completions before side effects; emits `synthesis_result_authorized` or `stale_synthesis_result_blocked`.
- Managed per-generation `AbortController` lifecycles preventing cross-generation clobbering.
- *Status*: IMPLEMENTED NOW (Authorization & Fencing). Browser audio playback is scheduled for Step 13.

### Step 13: Generation-Aware Audio Playback (COMPLETE)
- **Module**: Implemented `lib/generation-aware-audio.ts` coordinating `GenerationFence`, `InterruptController`, `MeasurementPipeline`, and Web Audio.
- **Authorized Input Only**: Public API `playAuthorizedAudio` strictly consumes `AuthorizedSynthesisResult` from Step 12; unauthenticated or raw inputs are rejected with `UNAUTHORIZED_INPUT`.
- **AudioContext Lifecycle**: SSR-safe lazy instantiation and reuse; suspended context resumption handling with normalized error `AUDIO_CONTEXT_RESUME_FAILED`.
- **Four Mandatory Generation Checkpoints**:
  1. *Checkpoint 1 (Pre-Flight)*: Evaluates `fence.isCurrent(genId)` before calling `decodeAudioData()`. Stale attempts blocked immediately (`PRE_PLAYBACK_STALE`).
  2. *Checkpoint 2 (Post-Decode)*: After asynchronous `decodeAudioData()` resolves, re-checks `fence.isCurrent(genId)`. If superseded or barged-in during decode, source creation is aborted (`STALE_DURING_DECODE`).
  3. *Checkpoint 3 (Pre-Start)*: Final authority check immediately before `source.start(0)`. If stale, disconnects node and blocks start (`PRE_START_STALE`).
  4. *Checkpoint 4 (Interruption Stop)*: `stopGeneration(N)` immediately halts active nodes belonging strictly to generation $N$, detaches `onended` handlers, disconnects nodes, and records stop latency without disturbing generation $N+1$.
- **Playback Registry Isolation**: Multi-level map `activePlaybacks: Map<number, Map<string, PlaybackHandle>>` isolates active handles by `(generationId, requestId)`. Stopping Gen 1 never stops Gen 2.
- **Audio Resurrection Prevention**: All blocked attempts increment `staleAudioStartsBlocked` and update `MeasurementPipeline` stale metrics while strictly preserving `audio.resurrectionCount === 0`.
- **Audit & Measurement**: Emits `audio_decode_started`, `audio_decode_completed`, `audio_playback_started`, `audio_playback_stopped`, `stale_audio_start_blocked`, and `audio_playback_failed`.
- **Implementation Status**:
  - *Implemented & Verified*: Generation-aware playback architecture, AudioContext guarded lifecycle, decode race protection, source.start authority check, generation-specific interruption barrier, and deterministic mock browser audio tests (`test-step13.mjs`: 85 passed assertions).
  - *Not Yet Verified*: Live microphone acoustic barge-in against a human speaker (scheduled for Step 14).

### Step 14: Real Barge-In Validation (COMPLETE)
- **Core Principle**:
  ```
  ┌─────────────────────────────────────────────────────────────┐
  │         VOICE ACTIVITY ≠ INTERRUPTION AUTHORITY             │
  │                                                             │
  │   Detection of speech energy indicates a candidate barge-in.│
  │   It does NOT grant authority to advance generations,       │
  │   mutate transcripts, or interrupt newer generations.       │
  └─────────────────────────────────────────────────────────────┘
  ```
- **Architecture & Module**:
  - Implemented `lib/barge-in-detector.ts` and strongly-typed contracts in `types/barge-in.ts`.
  - Browser VAD uses Web Audio `AnalyserNode` connected to `MediaStreamAudioSourceNode` from `navigator.mediaDevices.getUserMedia()`.
  - Normalized audio energy calculation (RMS / spectral average) with safe index bounds.
  - Stabilization constraints:
    - `threshold: 0.05`: Ignores ambient room noise below audio energy threshold.
    - `minActiveDurationMs: 80`: Transient spikes and mic pops do not trigger interrupts.
    - `cooldownMs: 400`: Continuous speech does not trigger duplicate rapid interrupts for the same generation.
    - `sampleIntervalMs: 20`: Responsive polling interval.
- **Authority Boundary & Stale Callback Protection**:
  - Voice Activity Detection operates strictly as an interruption request.
  - When speech is sustained and confirmed for a target generation $G$, the detector verifies `fence.isCurrent(G)` immediately before taking action.
  - If generation $G$ was already superseded (e.g. by another user interaction or turn transition), the delayed callback is dropped as stale (`stale_barge_in_ignored`), increments `bargeIn.staleIgnoredCount`, and NEVER touches or interrupts the newer generation $G+1$.
- **Unified Interruption Flow**:
  - If authoritative, detection triggers `InterruptController.interrupt(G, "user_barge_in")`.
  - Interruption immediately halts active browser playback (`GenerationAwareAudio.stopGeneration(G)`).
  - Interruption cancels in-flight provider synthesis (`GenerationAwareSynthesis.abortGeneration(G)`).
  - Interruption invalidates generation authority in `GenerationFence`.
- **Measurement Pipeline Integration (`lib/measurement-types.ts` & `lib/measurement-pipeline.ts`)**:
  - `bargeIn.detectedCount`: Total candidate speech events detected.
  - `bargeIn.confirmedCount`: Total speech events sustained past minimum duration.
  - `bargeIn.interruptTriggeredCount`: Confirmed barge-in events routed to `InterruptController`.
  - `bargeIn.staleIgnoredCount`: Stale barge-in callbacks dropped because generation was already superseded.
  - `bargeIn.falseDuplicateSuppressedCount`: Repeated triggers during active cooldown suppressed.
  - `bargeIn.detectionLatencyMs` & `bargeIn.interruptLatencyMs`: Empirically tracked latencies.
  - `bargeIn.microphoneErrors`: Microphone capability / permission error counter.
  - Invariants strictly preserved: `confirmedCount <= detectedCount`, `interruptTriggeredCount <= confirmedCount`, `staleIgnoredCount >= 0`, `resurrectionCount === 0`, `corruptionCount === 0`.
- **Generation Audit Events**:
  - `barge_in_monitoring_started`: Monitoring started for active generation.
  - `barge_in_monitoring_stopped`: Monitoring detached / unmounted.
  - `barge_in_activity_detected`: Initial candidate audio activity above threshold.
  - `barge_in_confirmed`: Sustained speech confirmed past duration threshold.
  - `barge_in_interrupt_triggered`: Authoritative interrupt dispatched to InterruptController.
  - `stale_barge_in_ignored`: Delayed barge-in dropped because target generation was superseded.
  - `barge_in_detection_failed`: Normalized error (e.g. permission denied or audio context failure).
- **VoiceConsole Integration (`components/voice/VoiceConsole.tsx` & `components/voice/VoiceControls.tsx`)**:
  - Automatically begins monitoring when speech playback begins for active turn generation.
  - Automatically stops monitoring upon turn completion or component unmount.
  - UI exposes real-time VAD pill (`VAD Barge-In: ACTIVE`) so judges can see microphone monitoring state.
- **Deterministic Test Coverage (`test-step14.mjs`)**:
  - 19 test groups verifying: class existence, threshold filtering, spike rejection, sustained speech confirmation, active audio stoppage, in-flight synthesis cancellation, new generation isolation, stale barge-in callback dropping, late synthesis/decode blocking, stop latency tracking, duplicate suppression, capability/permission error normalization, cleanup safety, audit logging, measurement invariants, and zero exposed secrets (75 passing assertions).
- **Manual Demonstration Procedure**:
  1. Open VoiceConsole at `/console` or `/`.
  2. Click "Mumbai (Friday)" prompt or speak into the microphone to initiate a turn.
  3. While EchoFence is speaking, speak into the microphone.
  4. Observe that active audio stops immediately, the VAD indicator triggers, and the generation is invalidated.
  5. Issue a new command; verify the new generation plays cleanly and no late speech from the previous generation resurrects.
- **Remaining Limitations**:
  - Browser echo cancellation depends on device hardware / operating system AEC when output audio plays through external speakers into the microphone.

### Step 15: Streaming Audio Stress and Failure Testing & Adversarial Race Validation (COMPLETE)
- **Core Principle**:
  ```
  ┌─────────────────────────────────────────────────────────────┐
  │         STREAM ARRIVAL ORDER ≠ PLAYBACK AUTHORITY           │
  │         MORE AUDIO CHUNKS ≠ MORE PERMISSION TO PLAY         │
  │         INTERRUPTED GENERATION ≠ ALLOWED TO RESURRECT       │
  │         CONCURRENT REQUESTS ≠ SHARED OWNERSHIP              │
  └─────────────────────────────────────────────────────────────┘
  ```
- **Architecture & Module**:
  - Implemented `lib/generation-aware-audio-stream.ts` and strongly-typed contracts in `types/streaming-audio.ts`.
  - Multi-tier ownership model: `generationId -> streamId -> StreamState`, preventing cross-generation or cross-stream state corruption.
  - Independent active source node tracking per generation (`Map<GenerationId, Map<string, AudioBufferSourceNode>>`).
- **Five Mandatory Authority Checkpoints**:
  1. *Checkpoint 1 (Arrival)*: Evaluates `fence.isCurrent(genId) && !interruptCtrl.isInterrupted(genId)`. Stale or interrupted chunks are rejected immediately (`STREAM_STALE_GENERATION`), recording `staleChunksBlocked` and emitting `stale_audio_chunk_blocked`.
  2. *Checkpoint 2 (Pre-Decode)*: Validates authority before calling `decodeAudioData()`. If stale, decode is avoided.
  3. *Checkpoint 3 (Post-Decode Barrier)*: Re-validates authority after asynchronous `decodeAudioData()` resolves. If the generation was barged-in or superseded during decode, audio source creation is blocked.
  4. *Checkpoint 4 (Pre-Start)*: Final check immediately before `source.start(0)`. If stale, source is disconnected and start is blocked.
  5. *Checkpoint 5 (Interruption Stop Barrier)*: `stopGeneration(N)` immediately halts active playing source nodes for generation $N$, detaches `onended` handlers, purges all buffered/queued chunks, and cancels in-flight streams strictly for generation $N$ without disturbing generation $N+1$.
- **Ordering Strategy & Duplicate Protection**:
  - Out-of-order chunks (`sequenceNumber > nextExpectedSequence`) are deterministically buffered in memory (`outOfOrderChunksBuffered++`, `audio_stream_chunk_buffered`).
  - When the expected sequence arrives, it plays and consecutively buffered chunks are automatically drained in order.
  - Duplicate chunk arrivals are identified via `stream.seenChunkIds` and suppressed (`duplicateChunksSuppressed++`, `duplicate_audio_chunk_suppressed`).
  - Stale `onended` callbacks from interrupted or superseded generations are intercepted and safely ignored (`stale_stream_completion_ignored`).
- **Measurement Pipeline Integration (`lib/measurement-types.ts` & `lib/measurement-pipeline.ts`)**:
  - `streamingAudio.streamingChunksReceived`: Total incoming chunks received.
  - `streamingAudio.streamingChunksAccepted`: Chunks passing Checkpoint 1.
  - `streamingAudio.streamingChunksRejected`: Chunks rejected due to stale generation or interruption.
  - `streamingAudio.staleChunksBlocked`: Total stale streaming chunks blocked across all checkpoints.
  - `streamingAudio.duplicateChunksSuppressed`: Chunks suppressed due to duplicate sequence or chunk ID.
  - `streamingAudio.outOfOrderChunksBuffered`: Out-of-order chunks buffered.
  - `streamingAudio.chunksDecoded`: Chunks decoded.
  - `streamingAudio.chunksPlayed`: Chunks played.
  - `streamingAudio.queuedChunksCancelled`: Queued/buffered chunks purged during interruption.
  - `streamingAudio.activeStreams` / `completedStreams` / `cancelledStreams`: Stream lifecycle counters.
  - Invariants strictly preserved: `chunksPlayed <= chunksDecoded`, `streamingChunksAccepted <= received`, `staleResults.protectionRate === 100%`, `audio.resurrectionCount === 0`, `transcript.corruptionCount === 0`.
- **Generation Audit Events**:
  - `audio_stream_started`, `audio_stream_chunk_received`, `audio_stream_chunk_buffered`, `audio_stream_chunk_decoded`, `audio_stream_chunk_playback_started`, `audio_stream_chunk_playback_completed`, `audio_stream_chunk_rejected`, `stale_audio_chunk_blocked`, `duplicate_audio_chunk_suppressed`, `audio_stream_interrupted`, `audio_stream_cancelled`, `stale_stream_completion_ignored`, `audio_stream_failed`.
- **Deterministic Test Coverage (`test-step15.mjs`)**:
  - 21 test groups covering: ordered playback, out-of-order sequencing, duplicate suppression, interrupted generation rejection, new generation isolation, decode race interruption, pre-start interception, concurrent streams per generation, multi-generation interleaved traffic, rapid interruption storms, rapid generation advancement (G8-G12), queued chunk cancellation, late onended callbacks, stream isolation, stream completion after cancellation, measurement metrics, audit logging, zero secrets, and full adversarial stress simulation (96 passing assertions).
- **Remaining Limitations**:
  - Web Audio decoders in headless Node.js environments require mock AudioContext implementations for unit tests, while real browsers execute native `AudioContext.decodeAudioData`.

### Step 16: Real Browser End-to-End Race Validation (COMPLETE)
- **Why Browser Validation Was Essential**:
  Deterministic Node mocks and simulated timers test algorithm logic, but cannot validate real browser execution thread behavior: native Web Audio thread scheduling, asynchronous `decodeAudioData()` promises, microtask vs macrotask interleaving across `fetch` `AbortController` signals, React 19 reconciliation lifecycle during rapid updates, and DOM unmount teardown when voice activity is in flight.
- **Browser Testing Architecture**:
  - Test runner: `@playwright/test` operating against native Chromium / Chrome headless (`channel: 'chrome'`).
  - Isolated test directory: `tests/step16/` containing 5 spec suites:
    - `generation-race.spec.ts` (Scenarios 1, 4, 5)
    - `barge-in-race.spec.ts` (Scenarios 2, 3)
    - `streaming-race.spec.ts` (Scenarios 6, 7)
    - `lifecycle-race.spec.ts` (Scenarios 8, 9)
    - `adversarial-timeline.spec.ts` (Scenario 10)
  - Verification wrapper: `test-step16.mjs`.
- **Controlled Mocking Boundaries**:
  - **Audio Payload**: Valid 16-bit mono PCM WAV buffers generated deterministically without cloud TTS latency or quota dependencies, allowing 100% native Web Audio `decodeAudioData()` decoding.
  - **Microphone / Media**: Playwright launched with `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, and `--autoplay-policy=no-user-gesture-required`. VAD energy level injection exercises exact thresholds and duration filters.
  - **Singletons & State Machine**: Unmocked! `GenerationFence`, `InterruptController`, `BargeInDetector`, `GenerationAwareAudio`, `GenerationAwareAudioStream`, `MeasurementPipeline`, and React UI components run completely live.
- **10 Verified Browser Scenarios**:
  1. *Normal Authoritative Turn*: Generation advances monotonically, audio plays once, transcript updates, 0 stale results blocked.
  2. *Barge-In During Playback*: VAD sustained speech confirmed -> `InterruptController` halts audio playback promptly, monitoring cleans up safely.
  3. *Stale Barge-In Callback vs New Generation*: $G_1$ candidate voice activity resolves delayed confirmation after $G_2$ starts -> safely classified as `stale_barge_in_ignored`, leaving $G_2$ completely uninhibited.
  4. *Interrupt During Synthesis*: Pending synthesis request aborted -> late response dropped -> $G_2$ proceeds without corruption.
  5. *Interrupt During Audio Decode*: Checkpoint 3 post-decode barrier blocks source node creation when generation is interrupted mid-decode (`STALE_DURING_DECODE`).
  6. *Out-of-Order Streaming*: Chunks 0, 2, 1 arrive -> Chunk 2 buffers as `"queued"`, Chunk 1 unlocks sequential draining -> plays 0 -> 1 -> 2.
  7. *Stale Streaming Arrival*: Late $G_1$ chunks blocked as `STREAM_STALE_GENERATION` (`stale_audio_chunk_blocked`), valid $G_2$ chunks play.
  8. *Rapid Interruption Storm*: Bursts of rapid interrupts deduplicated idempotently (`interruptionCount === 1`), no crashes or duplicate stop errors.
  9. *Component Unmount Safety*: Navigating away from `VoiceConsole` during active playback/VAD cleanly disconnects nodes, stops tracks, and generates zero uncaught errors or React warnings.
  10. *Full Adversarial Multi-Turn Timeline ($T_0-T_{10}$)*: Interleaved synthesis, streaming audio, VAD candidates, generation advancement, late chunks, and old completion callbacks preserves single-generation authority.
- **Browser Error Monitoring**:
  - `attachErrorMonitor` detects uncaught exceptions, unhandled rejections, React hydration/state update warnings, and unexpected `console.error` output.
  - Result: `unexpectedBrowserErrors === 0`.
- **Verified Invariants**:
  - `audio.resurrectionCount === 0`
  - `transcript.corruptionCount === 0`
  - `staleResults.protectionRate === 100%`
  - `bargeIn.confirmedCount <= bargeIn.detectedCount`
  - `bargeIn.interruptTriggeredCount <= bargeIn.confirmedCount`
  - `streamingAudio.streamingChunksAccepted <= streamingAudio.streamingChunksReceived`
  - `streamingAudio.chunksPlayed <= streamingAudio.chunksDecoded`
  - `staleResults.blocked <= staleResults.attempted`

### Step 17: Chaos Engineering & Fault-Injection Validation (COMPLETE)
- **Core Principle**:
  ```
  ┌─────────────────────────────────────────────────────────────┐
  │        CHAOS MAY BREAK EXECUTION.                           │
  │        CHAOS MUST NOT BREAK OWNERSHIP.                      │
  │        FAILURE ≠ LOSS OF GENERATION AUTHORITY               │
  └─────────────────────────────────────────────────────────────┘
  ```
- **Architecture & Contracts**:
  - Implemented `lib/chaos-controller.ts` and `types/chaos.ts`.
  - 16 strongly typed fault types: `NETWORK_DELAY`, `NETWORK_TIMEOUT`, `NETWORK_FAILURE`, `ABORT_RACE`, `DUPLICATE_RESPONSE`, `STALE_RESPONSE`, `MALFORMED_AUDIO`, `AUDIO_DECODE_FAILURE`, `STREAM_REORDER`, `STREAM_DUPLICATION`, `STREAM_DROP`, `INTERRUPT_STORM`, `RAPID_GENERATION_ADVANCEMENT`, `LATE_COMPLETION`, `COMPONENT_UNMOUNT`, `RESOURCE_CLEANUP_RACE`.
  - 10 deterministic injection points: `before_network_request`, `during_network_request`, `after_network_response`, `before_audio_decode`, `during_audio_decode`, `after_audio_decode`, `before_source_start`, `during_streaming`, `during_barge_in`, `component_lifecycle`.
- **Resource Leak Detection**:
  - Runtime leak verification via `checkResourceLeaks()`:
    - `activeAudioNodes === 0` (no orphaned source nodes or nodes belonging to stale generations)
    - `activeStreams === 0` (no cancelled streams remaining marked active)
    - `activeAbortControllers === 0` (no orphaned abort controllers for completed/superseded generations)
    - `microphoneTracks === 0` (all media stream tracks released on unmount)
    - `pendingAuthorityCallbacks === 0` (no callbacks capable of mutating stale generation state)
  - Exposed for test observability via `window.__ECHOFENCE_TEST__.checkResourceLeaks()` and `getChaosSnapshot()` with zero secret exposure.
- **15 Mandatory Deterministic Scenarios**:
  1. *Network Response Timeout*: Request aborted on timeout; generation enters safe normalized failure path; 0 audio plays; 0 unhandled rejections.
  2. *Network Response Arrives After Interruption*: G1 interrupted while fetch is pending; late response rejected by fence; stale blocked counter incremented.
  3. *Duplicate Synthesis Response*: First playback authorized; duplicate callback suppressed; exactly one active playback handle.
  4. *Malformed Audio Response*: Decode failure normalized into safe failure path; newer generations uninhibited.
  5. *Interruption During Audio Decode*: Post-decode authority barrier blocks audio playback; resurrection count remains strictly 0.
  6. *Generation Switch Before source.start()*: Pre-start checkpoint blocks playback for superseded generation; resurrection count remains 0.
  7. *Streaming Packet Reordering*: Chunks arriving out of order (0, 2, 1) deterministically buffered and sequentially drained in order 0 -> 1 -> 2.
  8. *Streaming Duplicate Packet Storm*: Redundant chunks suppressed via seen chunk registry; no duplicate audio replay.
  9. *Streaming Packet Drop Followed by Interruption*: Buffered chunks purged immediately; no permanently active or stuck streams.
  10. *Rapid Interruption Storm*: Bursts of repeated interrupts deduplicated idempotently; no double-cleanup errors; no negative counters.
  11. *Rapid Generation Advancement (G10 -> G14)*: Delayed responses from G10-G13 arrive concurrently; all blocked as stale; only G14 mutates authoritative state.
  12. *Stale Barge-In Confirmation*: Delayed VAD confirmation from G1 ignored as `stale_barge_in_ignored`; G2 active playback untouched.
  13. *Component Unmount During Active Operations*: Active playback silenced, microphone released, streams cancelled; 0 unhandled promise rejections or React warnings.
  14. *Late Completion Callback After Cleanup*: Intercepted as stale state transition; authority preserved.
  15. *Full Adversarial Chaos Timeline (T0-T10)*: Synthesis delay + VAD candidate + generation advance + stale arrival + stale decode + stream reorder + late VAD + interrupt storm + rapid advance + late completion; single generation authority preserved; ONLY current generation plays.
- **Measurement Pipeline & Chaos Invariants**:
  - `chaos.scenariosExecuted`: Total chaos scenarios executed.
  - `chaos.faultsInjected`: Total faults introduced across all boundaries.
  - `chaos.faultsRecovered`: Faults successfully handled by recovery paths.
  - `chaos.safeFailures`: Failures normalized without violating authority.
  - `chaos.unsafeFailures === 0`: Strict zero tolerance for authority violations.
  - `chaos.resourceLeaksDetected === 0`: Zero orphaned nodes, streams, or abort controllers.
  - `chaos.unhandledErrorsDetected === 0`: Zero unhandled promise rejections or uncaught errors.
  - `chaos.chaosSafetyRate === 100%`: Normalized safety rate clamped to $[0, 100]$.
  - `audio.resurrectionCount === 0`: Zero stale audio playbacks.
  - `transcript.corruptionCount === 0`: Zero stale transcript mutations.
  - `staleResults.protectionRate === 100%`: 100% of stale results intercepted and blocked.
- **Audit Logging**:
  - Typed audit events: `chaos_scenario_started`, `chaos_fault_injected`, `chaos_network_fault`, `chaos_audio_fault`, `chaos_stream_fault`, `chaos_interrupt_fault`, `chaos_lifecycle_fault`, `chaos_fault_recovered`, `chaos_safe_failure`, `chaos_unsafe_failure`, `chaos_scenario_completed`.
  - Zero sensitive data logged: No API keys, authorization headers/tokens, or raw payload dumps.
- **Deterministic & Browser Test Validation**:
  - `test-step17.mjs`: 104 assertions across 24 test groups passing cleanly with 0 failures.
  - `tests/step17/*`: 15 Playwright browser chaos specs passing with 0 unexpected browser errors.
  - `run-all-tests.mjs`: 14 test suites across Steps 4–17 passing with 820 total assertions.

### Step 18: Final Evidence Consolidation, Judge Demo Hardening & Release Candidate Validation (COMPLETE)
- **Core Principle**:
  ```
  ┌─────────────────────────────────────────────────────────────┐
  │        EVIDENCE MUST BE DERIVED, NOT PERFORMED.             │
  │        CHAOS MAY BREAK EXECUTION.                           │
  │        CHAOS MUST NOT BREAK OWNERSHIP.                      │
  │        ACTIVE GENERATION IS THE SOLE AUTHORITY.             │
  └─────────────────────────────────────────────────────────────┘
  ```
- **Unified Judge Evidence Architecture**:
  - **Dedicated Route**: `/evidence` provides a standalone, distraction-free cockpit for hackathon judges with full-width telemetry panels, visual authority flowchart, machine-derived invariant checks, and interactive chaos replay.
  - **Console Integration**: Embedded directly as an accessible tab within `/console` (`Evidence & Audit`), ensuring zero context switching during live multi-turn voice sessions.
  - **Pure Projection Engine**: Implemented `lib/evidence-projection.ts` and `types/evidence.ts`. All displayed figures, timeline nodes, and invariant verdicts are dynamically derived via pure mathematical projection from underlying system singletons (`GenerationFence`, `InterruptController`, `MeasurementPipeline`, `GenerationAudit`, `ChaosController`, `RimeProviderAdapter`). No hardcoded percentages, mocked outcomes, or manufactured stats exist anywhere in the pipeline.
- **13 Live Telemetry Metrics (System Status Panel)**:
  1. *Active Generation*: Current monotonic generation ID authoritative over audio and transcript.
  2. *Voice State*: Live state machine phase (`IDLE`, `LISTENING`, `THINKING`, `SPEAKING`, `RECOVERING`).
  3. *Interrupt Latency*: Measured microsecond-precision audio stop barrier latency (`performance.now()`).
  4. *Stale Results Blocked*: Exact count of obsolete provider/tool responses intercepted and stopped (`attempted` vs `blocked`).
  5. *Audio Resurrections*: Strictly 0. Any nonzero value triggers immediate critical red invariant failure.
  6. *Transcript Corruptions*: Strictly 0. Prevents late text insertions from obsolete turns.
  7. *Audio Chunks (Recv / Dec / Play)*: End-to-end streaming audio chunk lifecycle telemetry.
  8. *Active Audio Nodes*: Verified count of live `AudioBufferSourceNode` handles in Web Audio thread (`=== 0` when idle).
  9. *Memory / Resource Leaks*: Leak detector scanning orphaned nodes, active streams, abort controllers, and microphone tracks (`=== 0`).
  10. *Barge-in Triggers*: Confirmed voice activity threshold events that initiated generation interruptions.
  11. *Chaos Scenarios Run*: Total deterministic fault plans executed across test and demo runs.
  12. *Chaos Safety Rate*: Mathematically clamped safe failure percentage ($100.0\%$).
  13. *Active Provider & Model*: Real-time Rime provider binding (`rime`, `mist/v1`, English, low-latency audio/pcm).
- **Machine-Derived Invariant Verification (Core Invariant Panel)**:
  - Evaluates 6 non-negotiable architectural predicates against live telemetry:
    - `AUDIO_RESURRECTION_ZERO`: `audio.resurrectionCount === 0` `[PASS]`
    - `TRANSCRIPT_CORRUPTION_ZERO`: `transcript.corruptionCount === 0` `[PASS]`
    - `STALE_PROTECTION_PERFECT`: `staleResults.protectionRate === 100%` `[PASS]`
    - `CHAOS_SAFETY_PERFECT`: `chaos.chaosSafetyRate === 100%` `[PASS]`
    - `RESOURCE_LEAKS_ZERO`: `chaos.resourceLeaksDetected === 0` `[PASS]`
    - `GENERATION_MONOTONIC`: `activeGen >= highestAllocated` `[PASS]`
- **Visual Generation Authority Timeline**:
  - Live chronological visualization derived directly from `GenerationAudit.getEvents()`.
  - Color-coded badges: Green for authoritative commits, Amber for generation advancement/interruptions, Red for blocked stale arrivals, Cyan for streaming audio chunks, Purple for chaos fault injections.
  - Exposes exact microsecond timestamps, generation IDs, event types, and structured metadata.
- **Deterministic Chaos Scenario Demonstration & Replay**:
  - Exposes 7 curated, representative chaos scenarios for interactive judge evaluation:
    - *Scenario 1: Network Response Timeout* (Network abort, safe failure normalization, 0 audio)
    - *Scenario 2: Stale Response After Interruption* (G1 fetch arrives late, fence blocks commit)
    - *Scenario 5: Interruption During Audio Decode* (Web Audio decode barrier intercepts playback)
    - *Scenario 7: Streaming Packet Reordering* (Out-of-order chunks 0, 2, 1 buffered and played in sequence)
    - *Scenario 10: Rapid Interruption Storm* (Burst interrupts deduplicated idempotently, 0 leaks)
    - *Scenario 13: Component Unmount During Active Ops* (Teardown stops playback and tracks cleanly)
    - *Scenario 15: Full Adversarial Chaos Timeline* (Multi-turn stress race preserving single-generation authority)
  - Interactive runner via `POST /api/evidence/chaos-run`: Judges trigger scenarios with one click and observe immediate before/after snapshot transitions with formal classification (`SAFE`, `UNSAFE`, or `INCOMPLETE`).
- **Deterministic & Browser Test Verification**:
  - `test-step18.mjs`: Standalone runner with 89 assertions across 20 test groups passing cleanly with 0 failures.
  - `tests/step18/judge-dashboard.spec.ts`: 10 Playwright browser specs validating DOM rendering, metric binding, live scenario triggering, zero credential leakage, and client-side navigation passing cleanly.
  - Full regression across all Steps 4–18 (`run-all-tests.mjs`): 909 assertions across 15 test suites passing with 100% success.
  - Full Playwright browser regression across Steps 16, 17, and 18: 35/35 browser specs passing with 0 unexpected browser errors.
- **Credential Protection**:
  - Server-only credentials strictly preserved: `RIME_API_KEY` never returned in `/api/evidence/dashboard`, `/api/evidence/chaos-run`, or rendered into any DOM element. Verified by automated browser assertions.

---

## 13. Phase 3 & Phase 4 Non-Negotiable Invariants

1. **Monotonic Generations**: Generation IDs are strictly increasing and immutable once issued.
2. **Authority Exclusivity**: Only the active generation may commit assistant transcript turns.
3. **Irreversible Invalidation**: An interrupted generation can never regain authority.
4. **Cancellation Independence**: Cancellation is an optimization; generation validation is the safety guarantee.
5. **Guard Precedence**: Every provider result must pass the Generation Fence before audio playback.
6. **Transcript Purity**: Stale results must never append to or mutate the transcript (`corruptionCount = 0`).
7. **Zero Resurrection**: Stale audio must never play after a newer generation becomes active (`resurrectionCount = 0`).
8. **Empirical Measurement**: All evidence metrics must derive from real runtime events and timestamps.
9. **Credential Protection**: Provider credentials remain strictly server-side; zero secrets exposed.
10. **Zero Regression**: Step 4–17 contracts and passing tests must never be regressed.
11. **Fault Ownership**: Chaos may break execution, but chaos must never break ownership (`chaosSafetyRate = 100%`).
12. **Zero Resource Leaks**: All audio nodes, streams, controllers, and tracks must be cleanly released (`resourceLeaksDetected = 0`).
13. **Derived Evidence**: Evidence must be derived from underlying runtime facts, never performed or fabricated (`[PASS/FAIL]` checks purely computed).
