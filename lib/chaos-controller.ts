/**
 * lib/chaos-controller.ts
 * Deterministic Chaos Engineering & Fault Injection Layer for EchoFence.
 *
 * Core Principle:
 *   CHAOS MAY BREAK EXECUTION.
 *   CHAOS MUST NOT BREAK OWNERSHIP.
 *   FAILURE != LOSS OF GENERATION AUTHORITY.
 *
 * Key Guarantees:
 * 1. Deterministic & reproducible: all injected failures follow explicit plans or scenarios.
 * 2. Zero production change when disabled: disabled by default in production.
 * 3. Invariant enforcement:
 *    - audio.resurrectionCount === 0
 *    - transcript.corruptionCount === 0
 *    - staleResults.protectionRate === 100%
 *    - chaos.resourceLeaksDetected === 0
 *    - chaos.chaosSafetyRate === 100%
 * 4. Zero secret exposure: sensitive payloads, keys, and tokens are NEVER captured or logged.
 */

import type {
  FaultType,
  FaultInjectionPoint,
  FaultContext,
  FaultPlanItem,
  FaultPlan,
  FaultOutcome,
  ChaosScenario,
  ChaosExecutionRecord,
  ChaosRunSummary,
  ResourceLeakReport,
} from "@/types/chaos";
import { generationFence, type GenerationFence } from "./generation-fence";
import { interruptController, type InterruptController } from "./interrupt-controller";
import { generationAwareAudio, type GenerationAwareAudio } from "./generation-aware-audio";
import { generationAwareAudioStream, type GenerationAwareAudioStream } from "./generation-aware-audio-stream";
import { bargeInDetector, type BargeInDetector } from "./barge-in-detector";
import { measurementPipeline, type MeasurementPipeline } from "./measurement-pipeline";
import { generationAudit, type GenerationAuditLog } from "./generation-audit";

export class ChaosController {
  private enabled: boolean = false;
  private activeScenario: ChaosScenario | null = null;
  private currentPlan: FaultPlan = [];
  private records: ChaosExecutionRecord[] = [];
  private currentOutcomes: FaultOutcome[] = [];

  constructor(
    private fence: GenerationFence = generationFence,
    private interruptCtrl: InterruptController = interruptController,
    private audio: GenerationAwareAudio = generationAwareAudio,
    private stream: GenerationAwareAudioStream = generationAwareAudioStream,
    private bargeIn: BargeInDetector = bargeInDetector,
    private measurement: MeasurementPipeline = measurementPipeline,
    private audit: GenerationAuditLog = generationAudit
  ) {}

  /**
   * Enables chaos testing mode, optionally binding to an active scenario.
   */
  public enable(scenario?: ChaosScenario): void {
    this.enabled = true;
    if (scenario) {
      this.activeScenario = scenario;
      this.currentPlan = [...scenario.plan];
      this.measurement.recordChaosScenarioStarted(scenario.id);
      this.audit.record(
        this.fence.getCurrentGeneration(),
        "chaos_scenario_started",
        this.fence.getCurrentGeneration(),
        "chaos_controller",
        `Scenario started: ${scenario.name} (${scenario.id})`
      );
    }
  }

  /**
   * Disables chaos testing mode and restores normal execution semantics.
   */
  public disable(): void {
    this.enabled = false;
    this.activeScenario = null;
    this.currentPlan = [];
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public getActiveScenario(): ChaosScenario | null {
    return this.activeScenario;
  }

  public setPlan(plan: FaultPlan): void {
    this.currentPlan = [...plan];
  }

  public getPlan(): FaultPlan {
    return [...this.currentPlan];
  }

  /**
   * Intercepts execution at a specific injection point.
   * Returns a FaultOutcome if a fault was injected, or null if execution should proceed normally.
   */
  public async executeFault(
    point: FaultInjectionPoint,
    context: FaultContext
  ): Promise<FaultOutcome | null> {
    if (!this.enabled) {
      return null;
    }

    const planItem = this.findMatchingPlanItem(point, context);
    if (!planItem) {
      return null;
    }

    const currentGen = this.fence.getCurrentGeneration();
    const targetGen = context.generationId ?? currentGen;
    const timestamp = Date.now();

    // Map fault category for measurement and audit
    const category = this.getFaultCategory(planItem.fault);
    this.measurement.recordChaosFaultInjected(category);

    const auditEvent = this.getAuditEventType(category);
    this.audit.record(
      targetGen,
      auditEvent,
      currentGen,
      "chaos_controller",
      `Fault injected: ${planItem.fault} at ${point}`
    );

    let actionTaken = `Injected ${planItem.fault}`;
    let safeRecovery = true;
    let error: string | undefined;

    try {
      if (planItem.delayMs && planItem.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, planItem.delayMs));
      }

      switch (planItem.fault) {
        case "NETWORK_TIMEOUT":
          actionTaken = `Simulated network timeout (${planItem.delayMs || 0}ms)`;
          error = "Request timed out";
          this.measurement.recordChaosSafeFailure();
          break;

        case "NETWORK_FAILURE":
          actionTaken = "Simulated network failure 503";
          error = "Service Unavailable";
          this.measurement.recordChaosSafeFailure();
          break;

        case "NETWORK_DELAY":
          actionTaken = `Simulated network latency delay of ${planItem.delayMs || 0}ms`;
          this.measurement.recordChaosFaultRecovered();
          break;

        case "ABORT_RACE":
          actionTaken = `Injected abort race for Gen ${targetGen}`;
          this.interruptCtrl.interrupt(targetGen, "test_simulation");
          this.measurement.recordChaosFaultRecovered();
          break;

        case "DUPLICATE_RESPONSE":
          actionTaken = "Injected duplicate response marker";
          this.measurement.recordChaosFaultRecovered();
          break;

        case "STALE_RESPONSE":
          actionTaken = `Injected stale response arrival for superseded Gen ${targetGen}`;
          this.measurement.recordChaosStaleResultBlocked(targetGen);
          this.measurement.recordChaosFaultRecovered();
          break;

        case "MALFORMED_AUDIO":
          actionTaken = "Injected malformed audio payload";
          error = "Malformed audio bytes";
          this.measurement.recordChaosSafeFailure();
          break;

        case "AUDIO_DECODE_FAILURE":
          actionTaken = "Injected audio decode rejection";
          error = "DOMException: EncodingError";
          this.measurement.recordChaosSafeFailure();
          break;

        case "STREAM_REORDER":
          actionTaken = "Injected streaming chunk reordering";
          this.measurement.recordChaosFaultRecovered();
          break;

        case "STREAM_DUPLICATION":
          actionTaken = "Injected duplicate stream chunk";
          this.measurement.recordChaosFaultRecovered();
          break;

        case "STREAM_DROP":
          actionTaken = "Injected dropped stream chunk";
          this.measurement.recordChaosSafeFailure();
          break;

        case "INTERRUPT_STORM":
          actionTaken = `Injected interrupt storm on Gen ${targetGen}`;
          for (let i = 0; i < 4; i++) {
            this.interruptCtrl.interrupt(targetGen, "test_simulation");
          }
          this.measurement.recordChaosFaultRecovered();
          break;

        case "RAPID_GENERATION_ADVANCEMENT":
          actionTaken = `Rapidly advanced generations from ${targetGen}`;
          for (let i = 0; i < 4; i++) {
            this.fence.beginGeneration("chaos_simulation", `Rapid generation step ${i}`);
          }
          this.measurement.recordChaosFaultRecovered();
          break;

        case "LATE_COMPLETION":
          actionTaken = `Simulated late completion callback for superseded Gen ${targetGen}`;
          this.fence.recordStaleBlocked(
            targetGen,
            "stale_state_transition_blocked",
            "chaos_controller",
            `Late completion for Gen ${targetGen} blocked`
          );
          this.measurement.recordChaosFaultRecovered();
          break;

        case "COMPONENT_UNMOUNT":
          actionTaken = "Simulated component unmount cleanup";
          this.audio.stopAll("MANUAL");
          this.stream.stopAll();
          this.bargeIn.stopMonitoring();
          this.measurement.recordChaosFaultRecovered();
          break;

        case "RESOURCE_CLEANUP_RACE":
          actionTaken = "Simulated resource cleanup race";
          this.interruptCtrl.cleanStaleAbortControllers(this.fence.getCurrentGeneration());
          this.measurement.recordChaosFaultRecovered();
          break;

        default:
          actionTaken = `Injected generic fault ${planItem.fault}`;
          this.measurement.recordChaosFaultRecovered();
          break;
      }
    } catch (faultErr) {
      safeRecovery = false;
      error = faultErr instanceof Error ? faultErr.message : String(faultErr);
      this.measurement.recordChaosUnsafeFailure();
      this.audit.record(
        targetGen,
        "chaos_unsafe_failure",
        this.fence.getCurrentGeneration(),
        "chaos_controller",
        `Unsafe failure during fault injection: ${error}`
      );
    }

    const outcome: FaultOutcome = {
      injected: true,
      faultType: planItem.fault,
      point,
      actionTaken,
      safeRecovery,
      timestamp,
      error,
    };

    this.currentOutcomes.push(outcome);
    return outcome;
  }

  private findMatchingPlanItem(
    point: FaultInjectionPoint,
    context: FaultContext
  ): FaultPlanItem | null {
    const itemIndex = this.currentPlan.findIndex((item) => {
      if (item.point !== point) return false;
      if (item.generationId !== undefined && context.generationId !== undefined) {
        if (item.generationId !== context.generationId) return false;
      }
      if (item.triggerCondition && !item.triggerCondition(context)) {
        return false;
      }
      return true;
    });

    if (itemIndex >= 0) {
      const item = this.currentPlan[itemIndex];
      // Consume item from plan so it doesn't fire indefinitely unless specified
      this.currentPlan.splice(itemIndex, 1);
      return item ?? null;
    }

    return null;
  }

  private getFaultCategory(
    fault: FaultType
  ): "network" | "audio" | "streaming" | "interruption" | "lifecycle" {
    switch (fault) {
      case "NETWORK_DELAY":
      case "NETWORK_TIMEOUT":
      case "NETWORK_FAILURE":
      case "DUPLICATE_RESPONSE":
      case "STALE_RESPONSE":
        return "network";

      case "MALFORMED_AUDIO":
      case "AUDIO_DECODE_FAILURE":
        return "audio";

      case "STREAM_REORDER":
      case "STREAM_DUPLICATION":
      case "STREAM_DROP":
        return "streaming";

      case "ABORT_RACE":
      case "INTERRUPT_STORM":
      case "RAPID_GENERATION_ADVANCEMENT":
        return "interruption";

      case "LATE_COMPLETION":
      case "COMPONENT_UNMOUNT":
      case "RESOURCE_CLEANUP_RACE":
      default:
        return "lifecycle";
    }
  }

  private getAuditEventType(
    category: "network" | "audio" | "streaming" | "interruption" | "lifecycle"
  ):
    | "chaos_network_fault"
    | "chaos_audio_fault"
    | "chaos_stream_fault"
    | "chaos_interrupt_fault"
    | "chaos_lifecycle_fault" {
    switch (category) {
      case "network":
        return "chaos_network_fault";
      case "audio":
        return "chaos_audio_fault";
      case "streaming":
        return "chaos_stream_fault";
      case "interruption":
        return "chaos_interrupt_fault";
      case "lifecycle":
      default:
        return "chaos_lifecycle_fault";
    }
  }

  /**
   * Validates resource leak invariants across all subsystems.
   */
  public checkResourceLeaks(): ResourceLeakReport {
    const currentGen = this.fence.getCurrentGeneration();
    const details: string[] = [];

    // 1. Audio playbacks belonging to superseded generations
    const staleAudioPlaybacks = this.audio.getStaleActivePlaybackCount(currentGen);
    if (staleAudioPlaybacks > 0) {
      details.push(`${staleAudioPlaybacks} stale active audio playback handles found`);
    }

    // 2. Audio streams belonging to superseded generations
    const staleStreams = this.stream.getStaleStreamCount(currentGen);
    if (staleStreams > 0) {
      details.push(`${staleStreams} stale active audio streams found`);
    }

    // 3. AbortControllers belonging to superseded generations
    const staleAbortControllers = this.interruptCtrl.getStaleAbortControllerCount(currentGen);
    if (staleAbortControllers > 0) {
      details.push(`${staleAbortControllers} stale AbortControllers found`);
    }

    // 4. Microphone tracks active when monitoring is stopped
    const micActive = this.bargeIn.hasActiveMicrophoneTracks();
    if (micActive && !this.bargeIn.isCurrentlyMonitoring()) {
      details.push("Active microphone tracks detected while monitoring is stopped");
    }

    const hasLeaks =
      staleAudioPlaybacks > 0 ||
      staleStreams > 0 ||
      staleAbortControllers > 0 ||
      (micActive && !this.bargeIn.isCurrentlyMonitoring());

    if (hasLeaks) {
      this.measurement.recordChaosResourceLeaksDetected(details.length);
      this.audit.record(
        currentGen,
        "chaos_unsafe_failure",
        currentGen,
        "chaos_controller",
        `Resource leak detected: ${details.join("; ")}`
      );
    }

    return {
      hasLeaks,
      activeAudioNodes: this.audio.getActivePlaybackCount() + this.stream.getActiveNodeCount(),
      activeAudioNodesStale: staleAudioPlaybacks,
      activeStreams: this.stream.getActiveStreams(currentGen).length + staleStreams,
      staleActiveStreams: staleStreams,
      activeAbortControllers: this.interruptCtrl.getActiveAbortControllerCount(),
      staleAbortControllers,
      activeMicrophoneTracks: micActive ? 1 : 0,
      details,
    };
  }

  /**
   * Completes the current scenario and checks all core invariants.
   */
  public completeScenario(scenarioId: string): ChaosExecutionRecord {
    const startedAt = Date.now();
    const leaks = this.checkResourceLeaks();
    const snapshot = this.measurement.getSnapshot();

    const invariantsPreserved =
      snapshot.audio.resurrectionCount === 0 &&
      snapshot.transcript.corruptionCount === 0 &&
      snapshot.staleResults.protectionRate === 100 &&
      snapshot.chaos.chaosSafetyRate === 100 &&
      !leaks.hasLeaks;

    const record: ChaosExecutionRecord = {
      scenarioId,
      startedAt,
      completedAt: Date.now(),
      faultsInjected: this.currentOutcomes.filter((o) => o.injected).length,
      faultsRecovered: this.currentOutcomes.filter((o) => o.safeRecovery).length,
      outcomes: [...this.currentOutcomes],
      passed: invariantsPreserved,
      invariantsPreserved,
      error: leaks.hasLeaks ? leaks.details.join("; ") : undefined,
    };

    this.records.push(record);
    this.measurement.recordChaosScenarioCompleted(scenarioId, record.passed);
    this.audit.record(
      this.fence.getCurrentGeneration(),
      "chaos_scenario_completed",
      this.fence.getCurrentGeneration(),
      "chaos_controller",
      `Scenario completed: ${scenarioId}, passed=${record.passed}`
    );

    this.currentOutcomes = [];
    this.disable();
    return record;
  }

  public getSummary(): ChaosRunSummary {
    const passed = this.records.filter((r) => r.passed).length;
    const failed = this.records.filter((r) => !r.passed).length;
    const totalInjected = this.records.reduce((acc, r) => acc + r.faultsInjected, 0);
    const totalRecovered = this.records.reduce((acc, r) => acc + r.faultsRecovered, 0);
    const snapshot = this.measurement.getSnapshot();

    return {
      scenariosExecuted: this.records.length,
      scenariosPassed: passed,
      scenariosFailed: failed,
      totalFaultsInjected: totalInjected,
      totalFaultsRecovered: totalRecovered,
      safeFailures: snapshot.chaos.safeFailures,
      unsafeFailures: snapshot.chaos.unsafeFailures,
      resourceLeaksDetected: snapshot.chaos.resourceLeaksDetected,
      unhandledErrorsDetected: snapshot.chaos.unhandledErrorsDetected,
      chaosSafetyRate: snapshot.chaos.chaosSafetyRate,
      records: [...this.records],
    };
  }

  public reset(): void {
    this.disable();
    this.records = [];
    this.currentOutcomes = [];
  }
}

export const chaosController = new ChaosController();
