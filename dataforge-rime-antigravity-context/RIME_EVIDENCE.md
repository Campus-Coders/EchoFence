# Rime Evidence

## Hard Voice Claim

When a user interrupts an active voice interaction and changes one part of the request, the application stops obsolete Rime speech and prevents stale tool/model results from being spoken as current.

## Acceptance Test

### Preconditions

- Rime is the active speech provider.
- The selected model, speaker, language, endpoint, audio format and transport match the final demo configuration.
- A deterministic tool fixture has a fixed delay.
- Event logging is enabled.
- No provider secret is exposed.

### Procedure

1. Start a normal voice session.
2. Submit a request that triggers the delayed tool.
3. Set the tool delay to a fixed value.
4. Allow the agent to begin speaking or waiting.
5. Interrupt the agent.
6. Change exactly one request constraint.
7. Observe the audio lifecycle.
8. Observe the tool lifecycle.
9. Wait until the obsolete tool result arrives.
10. Verify the stale result is fenced and not spoken.
11. Verify the updated request produces the final spoken response.
12. Save the event timeline and measurements.

## Expected Result

PASS requires all of the following:

- obsolete generation is marked stale
- audio stop is requested
- obsolete queued speech does not continue as the final response
- stale tool result is detected
- stale tool result is not spoken as current
- updated request is processed
- final spoken response belongs to the new generation
- active provider is Rime

## Repeatable Command

Replace this placeholder with the actual repository command after implementation:

```bash
<STRESS_TEST_COMMAND>
```

## Metrics

Record:

| Metric | Result |
|---|---|
| Tool delay | TBD |
| Stop request latency | TBD |
| Observed audio stop latency | TBD |
| Stale results generated | TBD |
| Stale results spoken | TBD |
| Updated generation spoken | TBD |
| Test runs | TBD |
| Passes | TBD |

## Rime Configuration Used in Final Demo

| Field | Value |
|---|---|
| Provider | Rime |
| Model ID | TBD — fill from current live catalog |
| Speaker | TBD — fill from current live catalog |
| Language | TBD |
| Endpoint | TBD |
| Audio format | TBD |
| Transport | TBD |

## Evidence Artifacts

Store reproducible artifacts where practical:

- event logs
- stress-test output
- generated audio clips if permitted
- item-level results
- configuration snapshot without secrets

## Limitations

Document honestly:

- browser/device constraints
- network conditions
- cold/warm behavior
- ASR limitations
- unsupported languages/input
- cancellation behavior that depends on transport
- any fallback path

Do not claim that stopping a local audio element proves the remote TTS generation itself was cancelled.

## Reproducibility Notes

A judge should be able to understand:

- what was tested
- exact configuration
- exact fixture
- exact delay
- exact interruption
- what counts as pass/fail
- what was measured
