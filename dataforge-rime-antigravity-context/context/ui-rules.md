# UI Rules

## Product Feel

The UI is an evidence-first voice console.

It should immediately communicate:

1. who the user is
2. what the agent is doing
3. whether the agent is listening/speaking/working
4. which generation is active
5. that Rime is the active speech provider
6. what happened during the interruption

## Main Console Layout

```text
┌─────────────────────────────────────────────────────────────┐
│ EchoFence                         Rime ACTIVE ●              │
├──────────────────────────────┬──────────────────────────────┤
│                              │ Voice State                  │
│ Conversation                 │ SPEAKING / LISTENING         │
│                              │ Generation 4                 │
│ User                         │                              │
│ ...                          │ Provider: Rime               │
│                              │ Model: ...                   │
│ Assistant                    │ Voice: ...                   │
│ ...                          │                              │
│                              │                              │
│ [Hold / Interrupt]           │ Evidence                     │
│                              │ Stop latency: ...             │
│                              │ Stale blocked: ...            │
├──────────────────────────────┴──────────────────────────────┤
│ Event Timeline                                               │
└─────────────────────────────────────────────────────────────┘
```

## Stress Test UI

The stress test must be easy to trigger and explain.

Show:

- delayed tool: e.g. 4000ms
- initial request
- interrupt instruction
- updated request
- event timeline
- pass/fail result

Do not allow the stress case to be mistaken for a scripted animation.

## Accessibility

- keyboard-accessible controls
- visible focus states
- transcript readable without audio
- important evidence not encoded by color alone
- buttons have explicit labels

## Demo Clarity

The judge should understand the core claim within 20 seconds.

Preferred wording:

> "When the user changes their mind while the agent is working, stale work must never become the next thing they hear."

Then show it.

## No Fake State

UI state must come from the actual application event/state model.

Do not manually change the UI to make the demo look successful.
