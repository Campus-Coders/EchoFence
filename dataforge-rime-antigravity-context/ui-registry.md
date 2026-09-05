# UI Registry

Living document. Update after every component is built.

## Components

### Planned

| Component | Path | Purpose |
|---|---|---|
| VoiceConsole | `components/voice/VoiceConsole.tsx` | Main voice interaction surface |
| Transcript | `components/voice/Transcript.tsx` | User/assistant turn history |
| AudioState | `components/voice/AudioState.tsx` | Listening/thinking/speaking/interrupted state |
| InterruptControl | `components/voice/InterruptControl.tsx` | Visible interruption control for demo |
| ProviderBadge | `components/voice/ProviderBadge.tsx` | Shows Rime as active provider |
| EvidencePanel | `components/evidence/EvidencePanel.tsx` | Acceptance-test evidence |
| EventTimeline | `components/evidence/EventTimeline.tsx` | Generation/tool/audio timeline |
| MetricsCards | `components/evidence/MetricsCards.tsx` | User-visible measurements |
| StressTestRunner | `components/evidence/StressTestRunner.tsx` | Runs deterministic failure case |

## Rule

Before creating a new component, check this registry.

After creating one, record:

- exact path
- purpose
- important classes/patterns
- reusable behavior
