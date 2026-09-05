# Architecture

## Product

**EchoFence — An Interruption-Safe Voice Agent**

## Stack

| Layer | Tool | Purpose |
|---|---|---|
| Framework | Next.js 16 App Router | Full-stack application |
| UI | React 19 + Tailwind CSS + shadcn/ui | Voice console and evidence dashboard |
| Realtime transport | LiveKit Agents | Recommended realtime transport, turn handling and orchestration |
| Speech recognition | Pluggable ASR | Converts user speech to text |
| AI model | Configurable LLM, project default documented in env | Reasoning and tool orchestration |
| TTS | Rime | **Primary spoken output and required sponsor integration** |
| Tool simulation | Local deterministic delayed tools | Reproducible stress cases |
| Evaluation | Local event log + browser metrics | User-visible evidence |
| Validation | Zod | Runtime validation |
| Language | TypeScript strict | Entire codebase |

## Critical Architecture Rule

Rime is the primary TTS provider.

The application, not Rime, owns:

- user input
- speech recognition
- turn handling
- interruption detection
- cancellation
- generation/state fencing
- tool orchestration
- safety
- evaluation
- UI

## Folder Structure

```text
/
├── AGENTS.md
├── README.md
├── .env.example
├── RIME_EVIDENCE.md
├── context/
│   ├── project-overview.md
│   ├── architecture.md
│   ├── ui-tokens.md
│   ├── ui-rules.md
│   ├── ui-registry.md
│   ├── code-standards.md
│   ├── library-docs.md
│   ├── build-plan.md
│   └── progress-tracker.md
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── console/
│   │   └── page.tsx
│   └── api/
│       ├── voice/
│       │   ├── turn/route.ts
│       │   ├── interrupt/route.ts
│       │   └── speak/route.ts
│       └── evaluation/
│           ├── run/route.ts
│           └── results/route.ts
├── agent/
│   ├── orchestrator.ts
│   ├── generation-fence.ts
│   ├── interruption.ts
│   ├── tools.ts
│   ├── rime.ts
│   ├── evaluator.ts
│   └── types.ts
├── components/
│   ├── ui/
│   ├── voice/
│   │   ├── VoiceConsole.tsx
│   │   ├── Transcript.tsx
│   │   ├── AudioState.tsx
│   │   ├── InterruptControl.tsx
│   │   └── ProviderBadge.tsx
│   └── evidence/
│       ├── EvidencePanel.tsx
│       ├── EventTimeline.tsx
│       ├── MetricsCards.tsx
│       └── StressTestRunner.tsx
├── lib/
│   ├── rime-client.ts
│   ├── livekit.ts
│   ├── metrics.ts
│   ├── logger.ts
│   └── utils.ts
├── types/
│   └── index.ts
└── tests/
    ├── interruption/
    ├── stale-results/
    └── fixtures/
```

## System Boundaries

| Folder | Owns |
|---|---|
| `app/` | Pages and route handlers only |
| `agent/` | Voice orchestration, cancellation, generation fencing, tool logic and evaluation |
| `components/` | UI only |
| `lib/` | Third-party client initialization and shared utilities |
| `types/` | Shared types |
| `tests/` | Deterministic acceptance tests |

## Generation/Fencing Model

Every user turn gets a `generationId`.

```text
generation 1
  ├── user request
  ├── tool call A
  └── Rime audio A

USER INTERRUPTS

generation 2
  ├── new user request
  ├── tool call B
  └── Rime audio B
```

Generation 1 becomes stale immediately after interruption.

Any asynchronous result must pass the fence before it can affect user-visible state:

```text
result.generationId === activeGenerationId
        ↓ yes
commit / speak
        ↓ no
discard / reconcile / log
```

## State Machine

```text
IDLE
  ↓ user starts turn
LISTENING
  ↓ ASR final
THINKING
  ↓ tool call
TOOL_RUNNING
  ↓ result
SPEAKING
  ↓ user interruption
INTERRUPTING
  ↓ fence + stop audio + abort work
LISTENING
```

An interruption from `SPEAKING` or `TOOL_RUNNING` must converge on the same cancellation/fencing path.

## Required Event Model

Each important event should contain:

```ts
type VoiceEvent = {
  id: string;
  sessionId: string;
  generationId: number;
  type:
    | "user_turn_started"
    | "user_turn_final"
    | "assistant_started"
    | "tool_started"
    | "tool_completed"
    | "interrupt_started"
    | "audio_stop_requested"
    | "audio_stopped"
    | "stale_result_discarded"
    | "assistant_spoken";
  timestamp: number;
  metadata?: Record<string, string | number | boolean>;
};
```

## User-Visible Measurements

At minimum measure:

- interruption timestamp
- audio stop request timestamp
- audio stop observed timestamp
- stop latency
- time from updated user turn to final response
- stale results attempted
- stale results spoken
- final generation spoken
- provider used

Do not label a metric as proven until it is measured from the shipped path.

## Rime Configuration Record

The final implementation must expose an observable configuration object containing:

- provider: `rime`
- exact model ID
- exact speaker
- language
- endpoint
- audio format
- transport

The values must come from environment/configuration used by the final demo, not from this planning file.

## Failure Behavior

If Rime fails:

- surface a clear provider failure state
- log the failure
- do not silently claim that Rime spoke the response
- if a fallback is implemented, visibly mark it as fallback
- keep the fallback out of the primary judged path

If ASR fails:

- show an actionable input error
- preserve the session state
- do not advance the conversation generation incorrectly

If a tool fails:

- return a recoverable result
- do not crash the voice session
- do not speak a stale failure from an obsolete generation

## Security

- secrets only server-side
- no API key in client bundles
- no secrets in screenshots, logs, README, demo recording, or committed fixtures
- `.env.example` contains placeholders only
