# EchoFence

**An interruption-safe, voice-native agent for DataForge 2026 x Rime.**

## The Problem

Voice agents have a dangerous failure mode:

> The user changes their mind, but the system is still working on the old request.

If the old speech or tool result reaches the user afterward, the conversation becomes inconsistent with what the user actually asked.

## The Solution

EchoFence uses application-level generation fencing.

When the user interrupts:

- old generation becomes stale
- obsolete speech is stopped/invalidated
- cancellable work is aborted
- stale results are discarded
- the new request becomes authoritative
- Rime speaks the final response

## Why Voice Is Necessary

This is designed for spoken, hands-busy interaction. The user should be able to interrupt naturally while the agent is speaking or working without reaching for a UI control.

Removing voice would remove the primary failure mode being solved.

## Rime

Rime is the primary TTS provider.

The exact production configuration used for the final demo is documented in `RIME_EVIDENCE.md`.

## Architecture

See:

- `context/project-overview.md`
- `context/architecture.md`

## Setup

1. Install dependencies.
2. Copy `.env.example` to `.env.local`.
3. Add credentials locally.
4. Configure the current Rime model/voice/language.
5. Start the development server.
6. Open the voice console.

## Environment

Never commit `.env.local`.

`.env.example` contains placeholders only.

## Stress Test

The repository includes a deterministic delayed-tool scenario.

The test intentionally creates a race:

```text
Old request
    ↓
slow tool
    ↓
USER INTERRUPTS
    ↓
new generation
    ↓
old tool result arrives
    ↓
generation fence rejects it
```

The exact command is documented in `RIME_EVIDENCE.md`.

## Known Limitations

See `RIME_EVIDENCE.md`.

All performance claims must be supported by shipped measurements.
