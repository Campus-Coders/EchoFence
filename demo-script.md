# Demo Script

## Target Length

**4–5 minutes maximum.**

## 0:00–0:30 — Problem

Say:

> "Voice agents have a race condition. If I change my mind while the agent is speaking or waiting on a slow tool, the old result can still become the next thing I hear. EchoFence makes that impossible by fencing every turn."

Show the Rime-active indicator.

## 0:30–1:20 — Normal Flow

User:

> "Find me a hotel in Mumbai for Friday."

Agent performs a normal tool-backed interaction and responds through Rime.

Point out:

- realtime voice
- Rime primary output
- active generation

## 1:20–2:45 — Stress Case

Enable deterministic tool delay.

Say:

> "Now I'm going to make the tool deliberately slow."

Start:

> "Find me a hotel in Mumbai for Friday."

While the system is speaking/waiting, interrupt:

> "Actually, make that Saturday and keep it under 5000 rupees."

Show:

- old generation invalidated
- audio stop
- new generation
- stale tool result arriving
- stale result discarded
- final current-generation response

## 2:45–3:45 — Evidence

Show the evidence panel.

Highlight:

- stop requested
- stop observed
- stale results blocked
- stale results spoken = 0
- final generation spoken

Do not show unsupported numbers.

## 3:45–4:30 — Architecture

Show:

```text
User voice
  ↓
ASR
  ↓
Generation fence
  ↓
LLM + delayed tool
  ↓
Rime TTS
  ↓
Audio

Interrupt
  ↓
invalidate generation
  ↓
stop audio + abort work
  ↓
reject stale results
```

Finish:

> "Rime provides the primary spoken output. EchoFence owns the application-level interruption, cancellation, state consistency and evidence."
