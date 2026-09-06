# DataForge 2026 — Rime Challenge Project Overview

## Project Name

**EchoFence — An Interruption-Safe Voice Agent**

Working tagline:

> **Speak. Interrupt. Change your mind. EchoFence never lets stale work speak back.**

## Challenge Alignment

This project is built specifically for the DataForge 2026 x Rime Hackathon Challenge.

The challenge requires a voice-native product where Rime-generated speech is essential, not incidental. The project therefore treats spoken interaction as the primary interface and focuses on one hard voice problem:

**Interruption and recovery during concurrent model/tool work.**

The official challenge explicitly describes this failure mode: while an agent is speaking or waiting on a delayed tool call, the user interrupts and changes part of the request. The application must stop queued Rime audio promptly, prevent stale model/tool results from re-entering the conversation, keep state consistent with what the user actually heard, and produce the final spoken response for the updated request.

## Core Product

EchoFence is a realtime voice agent for situations where users naturally change their mind while an AI agent is speaking or performing a slow operation.

The demo scenario should use a harmless, synthetic task such as:

- travel search
- product lookup
- restaurant search
- document/task lookup

Example:

1. User: "Find me a hotel in Mumbai for Friday."
2. Agent starts a deliberately delayed search.
3. Agent begins speaking or waiting.
4. User interrupts: "Actually, make that Saturday and keep it under 5000 rupees."
5. EchoFence immediately stops obsolete audio, invalidates the previous request generation, cancels/reconciles stale work, and speaks only the result for the updated request.

## Hard Voice Claim

**When a user interrupts an active voice turn and changes the request, EchoFence prevents obsolete audio and stale tool results from becoming the spoken response for the old request.**

The acceptance test must be defined before the final demo and measured using user-visible behavior.

## Primary Technical Idea

Every conversational turn and every asynchronous operation receives a monotonically increasing **generation ID**.

Only the currently active generation may:

- enqueue speech
- play speech
- commit tool results to conversational state
- produce the final spoken response

When the user interrupts:

1. increment the generation
2. abort/cancel eligible work
3. stop queued/current Rime playback
4. mark the previous generation stale
5. accept the new user utterance
6. run the new request
7. speak only output belonging to the new generation

This is application-level full duplex behavior. Rime is the primary TTS provider; the application owns input, state, cancellation, orchestration, transport, and evaluation.

## Success Criteria

The project is successful when the final demo clearly proves:

- voice is materially necessary
- interruption works during speech and tool work
- obsolete audio stops promptly
- stale tool results are not spoken as current
- the updated request becomes authoritative
- Rime provides the primary spoken output
- the behavior is reproducible from the repository
- measurements are based on actual user-visible behavior
- limitations are disclosed

## Non-Goals

Do not turn this into a general-purpose assistant.

Do not add unrelated product features merely for breadth.

Do not claim unsupported latency or reliability improvements.

Do not use Rime only for greetings, confirmations, or optional playback.

Do not hide fallback providers. If a fallback exists, it must be visible and Rime remains the default judged path.

## Submission Artifacts

The repository must contain:

- working application
- README with setup and exact Rime configuration used in the demo
- `RIME_EVIDENCE.md`
- environment example with placeholders only
- reproducible stress-test procedure
- demo recording of no more than 4–5 minutes
- generated test artifacts where practical

## Important Source Constraint

The challenge requires the current production Rime model/voice/language configuration at submission time. The exact model ID, speaker, language, endpoint, audio format, and transport must be recorded after the live configuration is selected and tested. Do not invent or hard-code a stale speaker list in this planning document.
