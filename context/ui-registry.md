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

## Implemented Components

| Component | Path | Purpose | Key Patterns / Tokens |
|---|---|---|---|
| VoiceConsole | `components/voice/VoiceConsole.tsx` | Voice console coordinator with cohesive single-column vertical storytelling layout | Client component, `VoiceStateMachine` integration, auto generation tracking, unified 11-section layout |
| Transcript | `components/voice/Transcript.tsx` | Expanded conversation turn history with live Rime badge and auto-scroll | `.transcript-card` (min 420px, max 55vh), `.transcript-list`, auto-scroll, empty ready state |
| AudioState | `components/voice/AudioState.tsx` | Dynamic voice state machine visualizer | Token-mapped chips (`.state-chip-active-listening`, etc.), active indicator |
| VoiceControls | `components/voice/VoiceControls.tsx` | Centered Click-to-Talk, quick prompts, integrated demo controls deck, and race fixtures | `.btn-talk`, `.btn-quick-prompt`, `.demo-controls-bar`, unified deck, VAD status |
| ProviderBadge | `components/voice/ProviderBadge.tsx` | Active speech provider status & model display (dynamic `/api/voice/status` telemetry) | `.provider-box`, `.provider-row`, safe observable config, client polling |
| EvidencePanel | `components/evidence/EvidencePanel.tsx` | Real-time generation fence & interruption telemetry, late tool execution tracking, and audit feed | `.console-card`, `.status-pill-error`, `.evidence-feed-section`, `.evidence-feed-item-blocked`, monospace timestamps, tool event badges |
| MetricsCards | `components/evidence/MetricsCards.tsx` | Monotonic generation ID, interruptions counter, audio stop latency, recovery time, and stale-blocked counters | `.metrics-grid`, `.metric-card`, monospace numbers, live telemetry binding |
| RaceDemoPanel | `components/evidence/RaceDemoPanel.tsx` | Judge-proof demo entry point with one-click full race scenario orchestration | `.race-demo-panel`, `.race-demo-hero`, `.btn-race-demo-run`, status pills |
| RaceTimeline | `components/evidence/RaceTimeline.tsx` | Visual concurrent lifecycle timeline comparing Generation 1 vs Generation 2 | `.race-timeline-container`, `.race-timeline-column`, event badges (`SUCCESS`, `INTERRUPTED`, `BLOCKED`) |
| InvariantPanel | `components/evidence/InvariantPanel.tsx` | Live evaluation of 5 core system invariants verifying non-corruption | `.invariants-grid`, `.invariant-card`, pass/fail indicators, live status tags |
| DemoResultCard | `components/evidence/DemoResultCard.tsx` | Conclusive race result card with prominent visual PASS badge and zero-corruption metrics | `.demo-result-card`, `.demo-result-badge-pass`, lifecycle summary paths |
| MeasurementDashboard | `components/evidence/MeasurementDashboard.tsx` | Quantitative measurement dashboard displaying real latencies, correctness rates, and integrity invariants | `.measurement-dashboard`, `.measurement-grid`, `.measurement-category-card`, live `/api/evidence/metrics` binding |
| EvidenceDashboard | `components/evidence/EvidenceDashboard.tsx` | Primary Step 9 unified evidence surface aggregating verdict, metrics, scoreboard, and history | `.evidence-dashboard-container`, `.btn-dashboard-refresh`, polling + subscription |
| EvidenceVerdict | `components/evidence/EvidenceVerdict.tsx` | Real-time system verdict component evaluating PASS / FAIL / NOT_RUN / RUNNING invariants | `.evidence-verdict-card`, `.verdict-badge`, `.verdict-summary-pills` |
| EvidenceMetricGrid | `components/evidence/EvidenceMetricGrid.tsx` | Grouped 4-column critical metric display covering interruption, recovery, generation, and protection | `.evidence-metrics-four-column`, `.metric-group-card`, monospace numbers |
| IntegrityScoreboard | `components/evidence/IntegrityScoreboard.tsx` | Core correctness scoreboard validating ownership, transcript, audio, and fence invariants | `.integrity-scoreboard-card`, `.scoreboard-table`, status pills |
| RunHistory | `components/evidence/RunHistory.tsx` | Tabular display of the last 10 completed stress runs with latest run visual badge | `.run-history-card`, `.run-history-table`, `.run-history-row-latest` |
| EvidenceEventLog | `components/evidence/EvidenceEventLog.tsx` | Chronological audit event trace table distinguishing blocked, interrupted, and normal events | `.event-log-card`, `.event-log-table`, semantic badges |
| SystemStatusPanel | `components/evidence/SystemStatusPanel.tsx` | Live 13-metric telemetry grid showing generation, state, latencies, leak counts, streaming chunks, and active provider | `.system-status-panel`, `.system-status-grid`, `.system-status-card`, monospace counters, live polling |
| CoreInvariantPanel | `components/evidence/CoreInvariantPanel.tsx` | Core invariant motto banner and machine-derived invariant checks with [PASS/FAIL] verdicts | `.core-invariant-panel`, `.core-invariant-motto`, `.core-invariant-checks`, status pills |
| GenerationTimeline | `components/evidence/GenerationTimeline.tsx` | Chronological visual flowchart of generation lifecycle events from GenerationAudit | `.generation-timeline-panel`, `.generation-timeline-list`, `.generation-timeline-node`, color badges |
| ChaosScenarioReplay | `components/evidence/ChaosScenarioReplay.tsx` | Interactive selector and live runner for 7 representative deterministic chaos scenarios | `.chaos-scenario-replay`, `.chaos-replay-tabs`, `.btn-run-scenario`, execution logs |




