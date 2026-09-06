# Library Docs

## Rule

Before using a third-party library, check the project's `AGENTS.md` for current skills/MCP documentation and then verify the library's current official documentation.

Do not blindly copy stale examples.

## Rime

Rime provides the **primary spoken output**.

Implementation requirements:

- keep credentials server-side
- use a current production model/voice/language combination
- record the exact configuration used in the final demo
- verify the exact endpoint, region, framework, model, audio format and transport
- make the active provider observable
- stream audio when supported by the selected integration
- support cancellation/invalidation at the application layer

Do not hard-code a model ID or speaker in this context file. The challenge requires a current live catalog configuration at submission time.

Recommended configuration record:

```ts
type RimeConfigRecord = {
  provider: "rime";
  modelId: string;
  speaker: string;
  language: string;
  endpoint: string;
  audioFormat: string;
  transport: string;
};
```

## LiveKit Agents

The challenge recommends LiveKit Agents for realtime transport, turn handling and orchestration across browser, mobile and telephony.

Use it where it simplifies:

- realtime audio transport
- turn handling
- interruption detection
- orchestration

The application still owns the generation fence and stale-result policy.

## Zod

Use Zod for:

- API input validation
- environment validation where appropriate
- structured tool outputs
- evidence result validation

Never trust JSON from an external model/provider without validation.

## OpenAI / LLM

The LLM is responsible for reasoning and response generation.

Keep the model layer replaceable enough that the hard voice behavior remains an application property.

Structured outputs should be validated.

Never let an LLM decide whether a generation is current. Generation validity is deterministic application state.

## Browser APIs

Browser APIs may be used for:

- microphone permissions
- audio playback
- interruption detection
- timing metrics

Keep browser-specific code in Client Components or dedicated browser utilities.

## Evaluation

Prefer deterministic local fixtures over live external services for the stress test.

A judge should be able to reproduce the race without depending on a random network response.

## Timing

Use a monotonic timing source for duration measurements where available.

Never infer "audio stopped" merely because a stop request was issued.

Measure both:

- stop requested
- stop observed
