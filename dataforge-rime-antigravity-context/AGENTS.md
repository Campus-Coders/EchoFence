# AGENTS.md

## Mission

You are building **EchoFence**, a voice-native product for the DataForge 2026 x Rime Hackathon Challenge.

The goal is not to build a broad assistant.

The goal is to solve and prove one hard voice problem:

> **Interruption and recovery: obsolete Rime speech and stale tool results must not re-enter the conversation after the user changes the request.**

## Mandatory Reading Order

Before implementation:

1. `context/project-overview.md`
2. `context/architecture.md`
3. `context/build-plan.md`
4. `context/code-standards.md`
5. `context/library-docs.md`
6. `context/ui-tokens.md`
7. `context/ui-rules.md`
8. `context/ui-registry.md`
9. `context/progress-tracker.md`

## Hard Constraints

### Rime

- Rime must provide the primary spoken output.
- Rime cannot be incidental.
- Use a current production model/voice/language combination.
- Record exact final configuration.
- Never expose credentials.
- Make the active provider observable.
- Disclose any fallback.

### Voice Problem

The implementation must support interruption during:

- speech
- waiting/tool execution

The application must:

- stop/invalidate obsolete speech
- fence stale asynchronous results
- keep conversational state consistent
- accept the updated request
- speak only the current generation

### Evidence

Do not make unsupported performance claims.

The final repository must include:

- deterministic stress fixture
- repeatable test procedure
- `RIME_EVIDENCE.md`
- measured user-visible behavior
- limitations

### Demo

The recorded demo must be no more than 4–5 minutes and show:

1. target user/problem
2. normal flow
3. hard voice problem
4. deliberate stress/failure case
5. result/measurement
6. active Rime provider

## Implementation Discipline

- one feature at a time
- test immediately
- no unrelated features
- no TODO comments in committed code
- update progress tracker after each feature
- update UI registry after each UI component
- update evidence when measurement behavior changes

## Important

Never solve a timing/cancellation bug by hiding it in the UI.

The application state machine and generation fence are the source of truth.

Never claim a stale result was blocked unless the event log proves it.

Never claim Rime was active unless the actual audio path used Rime.

## Definition of Done

A feature is complete only when:

- implementation exists
- UI reflects real state where applicable
- error path exists
- acceptance test exists
- TypeScript passes
- relevant tests pass
- documentation is updated
- progress tracker is updated
