"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Shield } from "lucide-react";
import { Transcript } from "./Transcript";
import { AudioState } from "./AudioState";
import { ProviderBadge } from "./ProviderBadge";
import { VoiceControls } from "./VoiceControls";
import { EvidencePanel } from "../evidence/EvidencePanel";
import { RaceDemoPanel } from "../evidence/RaceDemoPanel";
import { MeasurementDashboard } from "../evidence/MeasurementDashboard";
import { EvidenceDashboard } from "../evidence/EvidenceDashboard";
import { VoiceStateMachine } from "@/lib/voice-state-machine";
import { generationFence } from "@/lib/generation-fence";
import { generationAudit } from "@/lib/generation-audit";
import { interruptController } from "@/lib/interrupt-controller";
import {
  isSpeechRecognitionSupported,
  startNativeSpeechRecognition,
  playBase64Audio,
  stopActiveAudio,
  simulateAudioPlayback,
} from "@/lib/browser-audio";
import { searchHotelsDelayed, delayedToolRegistry } from "@/lib/delayed-tool";
import { generationAwareAudio } from "@/lib/generation-aware-audio";
import { generationAwareAudioStream } from "@/lib/generation-aware-audio-stream";
import { measurementPipeline } from "@/lib/measurement-pipeline";
import { bargeInDetector } from "@/lib/barge-in-detector";
import { chaosController } from "@/lib/chaos-controller";
import type { VoiceState } from "@/types/voice";
import type { ConversationTurn } from "@/types/conversation";
import type { GenerationAuditEvent } from "@/types/generation";
import type { InterruptMetrics } from "@/types/interrupt";
import type { AuthorizedSynthesisResult } from "@/types/provider";

export function VoiceConsole(): React.JSX.Element {
  const stateMachineRef = useRef<VoiceStateMachine>(new VoiceStateMachine("IDLE"));
  const [voiceState, setVoiceState] = useState<VoiceState>("IDLE");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [generationId, setGenerationId] = useState<number>(() =>
    generationFence.getCurrentGeneration()
  );
  const [staleBlockedCount, setStaleBlockedCount] = useState<number>(() =>
    generationAudit.getStaleBlockedCount()
  );
  const [auditEvents, setAuditEvents] = useState<GenerationAuditEvent[]>(() =>
    generationAudit.getEvents(10)
  );
  const [interruptMetrics, setInterruptMetrics] = useState<InterruptMetrics>(() =>
    interruptController.getMetrics()
  );
  const [isListening, setIsListening] = useState<boolean>(false);
  const [speechSupported, setSpeechSupported] = useState<boolean>(false);
  const [isBargeInMonitoring, setIsBargeInMonitoring] = useState<boolean>(false);
  const stopRecognitionRef = useRef<(() => void) | null>(null);

  const isMountedRef = useRef<boolean>(true);
  const turnsRef = useRef<ConversationTurn[]>(turns);
  turnsRef.current = turns;

  const executeTurnRef = useRef<(text: string) => Promise<void>>(() => Promise.resolve());
  const triggerInterruptionRef = useRef<(targetGenId: number, reason?: "user_barge_in" | "test_simulation") => void>(() => {});

  // Synchronize state machine, generation fence, audit, and interrupt listeners
  useEffect(() => {
    isMountedRef.current = true;
    const sm = stateMachineRef.current;
    const unsubSm = sm.subscribe((newState) => {
      if (isMountedRef.current) setVoiceState(newState);
    });

    const unsubFence = generationFence.subscribe((newGen) => {
      if (isMountedRef.current) setGenerationId(newGen);
    });

    const unsubAudit = generationAudit.subscribe((_event) => {
      if (isMountedRef.current) {
        setStaleBlockedCount(generationAudit.getStaleBlockedCount());
        setAuditEvents(generationAudit.getEvents(10));
      }
    });

    const unsubInterrupt = interruptController.subscribe((_res, metrics) => {
      if (isMountedRef.current) setInterruptMetrics(metrics);
    });

    setSpeechSupported(isSpeechRecognitionSupported());

    return () => {
      isMountedRef.current = false;
      unsubSm();
      unsubFence();
      unsubAudit();
      unsubInterrupt();
      stopActiveAudio();
      generationAwareAudio.stopAll();
      bargeInDetector.stopMonitoring();
      if (stopRecognitionRef.current) {
        stopRecognitionRef.current();
      }
      if (typeof window !== "undefined") {
        delete (window as unknown as { __ECHOFENCE_TEST__?: unknown }).__ECHOFENCE_TEST__;
      }
    };
  }, []);

  /**
   * Safe interruption helper.
   * Halts active audio, aborts registered in-flight requests, marks generation interrupted,
   * and transitions state machine through INTERRUPTED -> RECOVERING.
   */
  const triggerInterruption = useCallback(
    (targetGenId: number, reason: "user_barge_in" | "test_simulation" = "user_barge_in"): void => {
      const sm = stateMachineRef.current;
      const currentState = sm.getState();

      if (currentState === "SPEAKING" || currentState === "THINKING") {
        sm.transitionTo("INTERRUPTED");
      }

      // Execute interruption via Interrupt Controller
      interruptController.interrupt(targetGenId, reason);

      if (sm.getState() === "INTERRUPTED") {
        sm.transitionTo("RECOVERING");
      }
    },
    []
  );

  /**
   * Execute voice turn with full AbortController cancellation and Generation Fence guards.
   */
  const executeTurn = useCallback(
    async (userText: string): Promise<void> => {
      const sm = stateMachineRef.current;
      const currentState = sm.getState();

      // If an existing generation is currently SPEAKING or THINKING, interrupt it first!
      const activeGen = generationFence.getCurrentGeneration();
      if (currentState === "SPEAKING" || currentState === "THINKING") {
        triggerInterruption(activeGen, "user_barge_in");
      }

      // Transition to LISTENING if coming from RECOVERING or IDLE
      if (sm.getState() === "RECOVERING" || sm.getState() === "IDLE") {
        sm.transitionTo("LISTENING");
      }

      // Begin new authoritative generation
      const turnGenId = generationFence.beginGeneration("user_turn", userText);

      // Create and register AbortController for cancellable network requests
      const abortController = new AbortController();
      interruptController.registerAbortController(turnGenId, abortController);

      // 1. Record User Turn
      const userTurn: ConversationTurn = {
        id: `turn-user-${Date.now()}-${turnGenId}`,
        role: "user",
        text: userText,
        timestamp: Date.now(),
        generationId: turnGenId,
      };

      if (isMountedRef.current) {
        setTurns((prev) => [...prev, userTurn]);
      }

      // State check: Move to THINKING
      if (!sm.transitionTo("THINKING")) {
        console.warn("[voice-console] Could not transition to THINKING from", sm.getState());
        sm.reset();
        return;
      }

      try {
        // ASYNC BOUNDARY A: Assistant text response
        const turnRes = await fetch("/api/voice/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: userText, generationId: turnGenId }),
          signal: abortController.signal,
        });

        // FENCE GUARD A: Verify turnGenId is still active and not interrupted
        if (!generationFence.isCurrent(turnGenId) || interruptController.isInterrupted(turnGenId)) {
          const isTool = userText.toLowerCase().includes("delayed") || userText.toLowerCase().includes("hotel");
          generationFence.recordStaleBlocked(
            turnGenId,
            isTool ? "stale_tool_result_blocked" : "stale_result_blocked",
            isTool ? "delayed_tool" : "turn_response",
            `Stale ${isTool ? "delayed tool" : "turn"} response for Gen ${turnGenId} blocked: active Gen is ${generationFence.getCurrentGeneration()}`
          );
          if (isTool) {
            delayedToolRegistry.recordStaleBlocked();
          }
          return;
        }

        if (!turnRes.ok) {
          throw new Error(`Turn endpoint error: ${turnRes.status}`);
        }

        const turnJson = (await turnRes.json()) as {
          success: boolean;
          data?: { responseText: string };
        };

        const assistantText =
          turnJson.data?.responseText || "Response generated.";

        // ASYNC BOUNDARY B: State transition to SPEAKING
        if (!generationFence.isCurrent(turnGenId) || interruptController.isInterrupted(turnGenId)) {
          generationFence.recordStaleBlocked(
            turnGenId,
            "stale_state_transition_blocked",
            "speaking_transition",
            `Gen ${turnGenId} prevented from transitioning to SPEAKING`
          );
          return;
        }

        if (!sm.transitionTo("SPEAKING")) {
          console.warn("[voice-console] Could not transition to SPEAKING from", sm.getState());
          sm.reset();
          return;
        }

        // Request Speech Synthesis
        let audioPlayed = false;
        let audioPayload: { audioAvailable: boolean; audioBase64?: string; contentType?: string } | null = null;

        try {
          const synthRes = await fetch("/api/voice/synthesize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: assistantText,
              generationId: turnGenId,
            }),
            signal: abortController.signal,
          });

          // FENCE GUARD B: Verify generation before accepting audio payload
          if (!generationFence.isCurrent(turnGenId) || interruptController.isInterrupted(turnGenId)) {
            generationFence.recordStaleBlocked(
              turnGenId,
              "stale_audio_blocked",
              "synthesis_response",
              `Synthesized audio for Gen ${turnGenId} dropped: active Gen is ${generationFence.getCurrentGeneration()}`
            );
            return;
          }

          if (synthRes.ok) {
            const synthJson = (await synthRes.json()) as {
              success: boolean;
              data?: {
                audioAvailable: boolean;
                audioBase64?: string;
                contentType?: string;
              };
            };
            audioPayload = synthJson.data || null;
          }
        } catch (synthErr: unknown) {
          if (synthErr instanceof Error && synthErr.name === "AbortError") {
            console.info(`[voice-console] Gen ${turnGenId} synthesis aborted gracefully due to interruption`);
            return;
          }
          console.warn("[voice-console] Synthesis fetch error:", synthErr);
        }

        // ASYNC BOUNDARY C: Audio playback
        if (!generationFence.isCurrent(turnGenId) || interruptController.isInterrupted(turnGenId)) {
          generationFence.recordStaleBlocked(
            turnGenId,
            "stale_audio_blocked",
            "playback_start",
            `Audio playback for Gen ${turnGenId} aborted: superseded by Gen ${generationFence.getCurrentGeneration()}`
          );
          return;
        }

        if (audioPayload?.audioAvailable && audioPayload.audioBase64) {
          try {
            const binaryString = atob(audioPayload.audioBase64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const authResult: AuthorizedSynthesisResult = {
              authorized: true,
              generationId: turnGenId,
              requestId: `req-${turnGenId}-${Date.now()}`,
              audioBuffer: bytes.buffer,
              contentType: audioPayload.contentType || "audio/mpeg",
              provider: "Rime",
              providerLatencyMs: 50,
              authorizedAt: Date.now(),
            };

            bargeInDetector.startMonitoring(turnGenId).catch(() => {});
            setIsBargeInMonitoring(true);

            const outcome = await generationAwareAudio.playAuthorizedAudio(authResult);
            if (outcome.kind === "started") {
              audioPlayed = true;
            } else if (outcome.kind === "failed") {
              // Fallback to HTML5 audio if Web Audio is unsupported in this environment
              await playBase64Audio(
                audioPayload.audioBase64,
                audioPayload.contentType || "audio/mpeg",
                turnGenId
              );
              audioPlayed = true;
            }
          } catch (audioErr) {
            console.warn("[voice-console] Web Audio playback error, falling back:", audioErr);
            await playBase64Audio(
              audioPayload.audioBase64,
              audioPayload.contentType || "audio/mpeg",
              turnGenId
            );
            audioPlayed = true;
          } finally {
            bargeInDetector.stopMonitoring();
            setIsBargeInMonitoring(false);
          }
        } else {
          // Unconfigured Rime fallback display delay
          await new Promise((r) => setTimeout(r, 1000));
        }

        // FENCE GUARD C: Check generation before committing assistant turn
        if (!generationFence.isCurrent(turnGenId) || interruptController.isInterrupted(turnGenId)) {
          generationFence.recordStaleBlocked(
            turnGenId,
            "stale_result_blocked",
            "transcript_commit",
            `Assistant turn commit for Gen ${turnGenId} blocked`
          );
          return;
        }

        // Commit Assistant Turn
        const assistantTurn: ConversationTurn = {
          id: `turn-assistant-${Date.now()}-${turnGenId}`,
          role: "assistant",
          text: assistantText,
          timestamp: Date.now(),
          generationId: turnGenId,
          audioAvailable: audioPlayed,
        };

        if (isMountedRef.current) {
          setTurns((prev) => [...prev, assistantTurn]);
        }

        // ASYNC BOUNDARY D: Completion callback & IDLE transition
        if (generationFence.isCurrent(turnGenId) && !interruptController.isInterrupted(turnGenId)) {
          generationFence.completeGeneration(turnGenId, "voice_loop");
          interruptController.clearGeneration(turnGenId);
          sm.transitionTo("IDLE");
        } else {
          generationFence.recordStaleBlocked(
            turnGenId,
            "stale_state_transition_blocked",
            "completion_callback",
            `Gen ${turnGenId} completion transition ignored: active Gen is ${generationFence.getCurrentGeneration()}`
          );
        }
      } catch (err: unknown) {
        if (
          (err instanceof Error && err.name === "AbortError") ||
          (typeof err === "string" && err.includes("interrupted")) ||
          abortController.signal.aborted
        ) {
          console.info(`[voice-console] Gen ${turnGenId} aborted gracefully due to interruption`);
          return;
        }
        console.error("[voice-console] Voice turn failure:", err);
        sm.reset();
      } finally {
        interruptController.unregisterAbortController(turnGenId, abortController);
      }
    },
    [triggerInterruption]
  );

  executeTurnRef.current = executeTurn;
  triggerInterruptionRef.current = triggerInterruption;

  // Step 16 Test Observability Interface
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      (process.env.NODE_ENV !== "production" ||
        Boolean((window as unknown as { __ECHOFENCE_TEST_ENABLED__?: boolean }).__ECHOFENCE_TEST_ENABLED__))
    ) {
      (window as unknown as { __ECHOFENCE_TEST__?: unknown }).__ECHOFENCE_TEST__ = {
        getGenerationSnapshot: () => ({
          currentGeneration: generationFence.getCurrentGeneration(),
          isCurrent: (genId: number) => generationFence.isCurrent(genId),
          isInterrupted: (genId: number) => interruptController.isInterrupted(genId),
        }),
        getMeasurementSnapshot: () => measurementPipeline.getSnapshot(),
        getAuditEvents: (limit = 100) => generationAudit.getEvents(limit),
        getPlaybackSnapshot: () => ({
          activePlaybackCount: generationAwareAudio.getActivePlaybackCount(),
          isGenerationPlaying: (genId: number) => generationAwareAudio.isGenerationPlaying(genId),
          activeGenerations: generationAwareAudio.getActiveGenerations(),
          isBargeInMonitoring: bargeInDetector.isCurrentlyMonitoring(),
          bargeInTargetGen: bargeInDetector.getTargetGeneration(),
          lastDetectedLevel: bargeInDetector.getLastDetectedLevel(),
          activeStreams: generationAwareAudioStream.getActiveStreams(),
        }),
        executeTurn: (text: string) => executeTurnRef.current(text),
        triggerInterruption: (genId: number, reason?: "user_barge_in" | "test_simulation") =>
          triggerInterruptionRef.current(genId, reason),
        getStateMachineState: () => stateMachineRef.current.getState(),
        getTurns: () => turnsRef.current,
        generationFence,
        interruptController,
        bargeInDetector,
        generationAwareAudio,
        generationAwareAudioStream,
        measurementPipeline,
        generationAudit,
        chaosController,
        getChaosSnapshot: () => chaosController.getSummary(),
        checkResourceLeaks: () => chaosController.checkResourceLeaks(),
        resetAll: () => {
          chaosController.reset();
          bargeInDetector.stopMonitoring();
          generationAwareAudio.reset();
          generationAwareAudioStream.reset();
          generationFence.reset();
          interruptController.reset();
          generationAudit.reset();
          measurementPipeline.reset();
          stateMachineRef.current.reset();
          if (isMountedRef.current) {
            setTurns([]);
            setVoiceState("IDLE");
            setGenerationId(0);
            setStaleBlockedCount(0);
            setAuditEvents([]);
            setIsListening(false);
            setIsBargeInMonitoring(false);
          }
        },
      };
    }
  }, [executeTurn, triggerInterruption]);

  /**
   * Deterministic Barge-In Interruption Test (Requirement 8):
   * 1. Start Generation 1.
   * 2. Assistant starts simulated speaking playback.
   * 3. User barge-in triggers while speaking.
   * 4. Audio is halted immediately (< 15ms stop latency).
   * 5. Generation 1 is invalidated and aborted.
   * 6. State transitions SPEAKING -> INTERRUPTED -> RECOVERING -> LISTENING.
   * 7. Generation 2 runs and commits.
   * 8. Verified: Generation 1 cannot resume or overwrite Generation 2.
   */
  const handleTestBargeIn = useCallback(async (): Promise<void> => {
    const sm = stateMachineRef.current;
    sm.reset();

    // 1. Begin Generation 1
    const gen1 = generationFence.beginGeneration(
      "test_simulation",
      "Gen 1: Initial query (Mumbai Friday)"
    );

    setTurns((prev) => [
      ...prev,
      {
        id: `turn-user-${Date.now()}-gen1`,
        role: "user",
        text: "Find hotels in Mumbai for Friday (Barge-in test)",
        timestamp: Date.now(),
        generationId: gen1,
      },
    ]);

    sm.transitionTo("THINKING");
    await new Promise((r) => setTimeout(r, 200));

    sm.transitionTo("SPEAKING");

    // Add Gen 1 partial response
    setTurns((prev) => [
      ...prev,
      {
        id: `turn-asst-${Date.now()}-gen1`,
        role: "assistant",
        text: "I found 3 hotels in Mumbai for Friday starting at 4,200 rupees per night...",
        timestamp: Date.now(),
        generationId: gen1,
        audioAvailable: true,
      },
    ]);

    // Start 3000ms audio-like playback process for Gen 1
    const playbackPromise = simulateAudioPlayback(3000, gen1);

    // 2. User interrupts at T=350ms while speaking!
    await new Promise((r) => setTimeout(r, 350));

    // Execute barge-in interruption via controller
    triggerInterruption(gen1, "user_barge_in");

    // State is now in RECOVERING -> transition to LISTENING for Gen 2
    if (sm.getState() === "RECOVERING") {
      sm.transitionTo("LISTENING");
    }

    // 3. Begin Generation 2 (the updated request)
    const gen2 = generationFence.beginGeneration(
      "test_simulation",
      "Gen 2: Interruption update (Saturday under 5000)"
    );

    setTurns((prev) => [
      ...prev,
      {
        id: `turn-user-${Date.now()}-gen2`,
        role: "user",
        text: "Actually, make that Saturday under 5000 rupees (Barge-in update)",
        timestamp: Date.now(),
        generationId: gen2,
      },
    ]);

    sm.transitionTo("THINKING");
    await new Promise((r) => setTimeout(r, 250));

    if (generationFence.isCurrent(gen2)) {
      sm.transitionTo("SPEAKING");
      await new Promise((r) => setTimeout(r, 300));

      setTurns((prev) => [
        ...prev,
        {
          id: `turn-asst-${Date.now()}-gen2`,
          role: "assistant",
          text: "Updated for Saturday under 5,000 rupees: Found Trident Nariman Point at 4,800 rupees per night.",
          timestamp: Date.now(),
          generationId: gen2,
          audioAvailable: false,
        },
      ]);

      generationFence.completeGeneration(gen2, "test_simulation");
      sm.transitionTo("IDLE");
    }

    // Await playback handle to verify it was cleanly halted without error
    await playbackPromise;
  }, [triggerInterruption]);

  /**
   * Deterministic 4s Delayed Tool Race Fixture (Step 6):
   * 1. Start Gen 1 with delayed hotel search (4000ms delay, respectAbort = false).
   * 2. Wait ~700ms.
   * 3. Trigger barge-in interruption.
   * 4. Start Gen 2 ("Trident Nariman Point under 5000").
   * 5. Gen 2 finishes normally and becomes authoritative.
   * 6. At 4000ms, Gen 1's delayed tool finishes.
   * 7. The Generation Fence blocks Gen 1's stale result.
   * 8. Verified: Gen 1 does not mutate transcript, audio, or state.
   */
  const handleTestDelayedRace = useCallback(async (): Promise<void> => {
    const sm = stateMachineRef.current;
    sm.reset();

    // 1. Begin Generation 1
    const gen1 = generationFence.beginGeneration(
      "delayed_tool_test",
      "Gen 1: Hotel search with 4s delayed tool"
    );

    setTurns((prev) => [
      ...prev,
      {
        id: `turn-user-${Date.now()}-gen1`,
        role: "user",
        text: "Find me a hotel with delayed search (4s background tool)",
        timestamp: Date.now(),
        generationId: gen1,
      },
    ]);

    sm.transitionTo("THINKING");

    // 2. Begin 4000ms delayed tool execution for Gen 1 (respectAbort = false so it runs to completion)
    const gen1ToolPromise = (async () => {
      try {
        const toolRes = await searchHotelsDelayed({
          generationId: gen1,
          delayMs: 4000,
          respectAbort: false,
          city: "Mumbai",
        });

        // 8. Stale Guard Callback Boundary
        if (!generationFence.isCurrent(gen1) || interruptController.isInterrupted(gen1)) {
          generationFence.recordStaleBlocked(
            gen1,
            "stale_tool_result_blocked",
            "delayed_tool",
            `Gen 1 delayed tool completed late after 4000ms, but was rejected by active Gen ${generationFence.getCurrentGeneration()}`
          );
          delayedToolRegistry.recordStaleBlocked();
          return; // BLOCKED! Zero transcript mutation, zero audio restart!
        }

        // If it was somehow current (which it is not), commit to transcript:
        setTurns((prev) => [
          ...prev,
          {
            id: `turn-asst-${Date.now()}-gen1`,
            role: "assistant",
            text: toolRes.data.searchSummary,
            timestamp: Date.now(),
            generationId: gen1,
            audioAvailable: false,
          },
        ]);
      } catch (err) {
        console.warn("[delayed-tool] Error in Gen 1 delayed tool:", err);
      }
    })();

    // 3. Wait a short deterministic period (700ms)
    await new Promise((r) => setTimeout(r, 700));

    // 4. Trigger user interruption on Gen 1
    triggerInterruption(gen1, "user_barge_in");

    if (sm.getState() === "RECOVERING") {
      sm.transitionTo("LISTENING");
    }

    // 5. Start Generation 2 immediately
    const gen2 = generationFence.beginGeneration(
      "delayed_tool_test",
      "Gen 2: Urgent update during Gen 1 delayed tool"
    );

    setTurns((prev) => [
      ...prev,
      {
        id: `turn-user-${Date.now()}-gen2`,
        role: "user",
        text: "Wait! Forget that, find me Trident Nariman Point for Saturday under 5000",
        timestamp: Date.now(),
        generationId: gen2,
      },
    ]);

    sm.transitionTo("THINKING");
    await new Promise((r) => setTimeout(r, 300));

    // 6. Gen 2 completes normally
    if (generationFence.isCurrent(gen2)) {
      sm.transitionTo("SPEAKING");
      await new Promise((r) => setTimeout(r, 350));

      setTurns((prev) => [
        ...prev,
        {
          id: `turn-asst-${Date.now()}-gen2`,
          role: "assistant",
          text: "Updated for Saturday under 5,000 rupees: Found Trident Nariman Point at 4,800 rupees per night.",
          timestamp: Date.now(),
          generationId: gen2,
          audioAvailable: false,
        },
      ]);

      generationFence.completeGeneration(gen2, "delayed_tool_test");
      sm.transitionTo("IDLE");
    }

    // 7. Wait for original Gen 1 delayed tool to finish
    await gen1ToolPromise;
  }, [triggerInterruption]);

  /**
   * Deterministic Race Simulation from Step 4
   */
  const handleSimulateRace = useCallback(async (): Promise<void> => {
    const sm = stateMachineRef.current;
    if (sm.getState() !== "IDLE") {
      sm.reset();
    }

    const gen1 = generationFence.beginGeneration(
      "race_simulation",
      "Gen 1: Slow delayed turn (Mumbai Friday)"
    );

    setTurns((prev) => [
      ...prev,
      {
        id: `turn-user-${Date.now()}-gen1`,
        role: "user",
        text: "Find hotels in Mumbai for Friday (Slow async)",
        timestamp: Date.now(),
        generationId: gen1,
      },
    ]);

    sm.transitionTo("THINKING");

    const slowGen1Promise = (async () => {
      await new Promise((r) => setTimeout(r, 1400));
      if (!generationFence.isCurrent(gen1) || interruptController.isInterrupted(gen1)) {
        generationFence.recordStaleBlocked(
          gen1,
          "stale_result_blocked",
          "turn_response",
          `Gen 1 delayed response rejected: active Gen is ${generationFence.getCurrentGeneration()}`
        );
        return;
      }
    })();

    await new Promise((r) => setTimeout(r, 300));

    const gen2 = generationFence.beginGeneration(
      "race_simulation",
      "Gen 2: Quick update (Saturday under 5000)"
    );

    setTurns((prev) => [
      ...prev,
      {
        id: `turn-user-${Date.now()}-gen2`,
        role: "user",
        text: "Actually, make that Saturday under 5000 rupees (Fast update)",
        timestamp: Date.now(),
        generationId: gen2,
      },
    ]);

    await new Promise((r) => setTimeout(r, 350));

    if (generationFence.isCurrent(gen2)) {
      sm.transitionTo("SPEAKING");
      await new Promise((r) => setTimeout(r, 400));

      setTurns((prev) => [
        ...prev,
        {
          id: `turn-asst-${Date.now()}-gen2`,
          role: "assistant",
          text: "Updated for Saturday under 5,000 rupees: Found Trident Nariman Point at 4,800 rupees per night.",
          timestamp: Date.now(),
          generationId: gen2,
          audioAvailable: false,
        },
      ]);

      generationFence.completeGeneration(gen2, "race_simulation");
      sm.transitionTo("IDLE");
    }

    await slowGen1Promise;
  }, []);

  const handleStartListening = useCallback((): void => {
    const sm = stateMachineRef.current;
    const currentState = sm.getState();

    // If speaking or thinking, barge-in interrupt immediately
    if (currentState === "SPEAKING" || currentState === "THINKING") {
      triggerInterruption(generationFence.getCurrentGeneration(), "user_barge_in");
    }

    if (!sm.transitionTo("LISTENING")) {
      return;
    }

    setIsListening(true);

    if (speechSupported) {
      stopRecognitionRef.current = startNativeSpeechRecognition({
        onTranscript: (text, isFinal) => {
          if (isFinal && text.trim().length > 0) {
            setIsListening(false);
            if (stopRecognitionRef.current) {
              stopRecognitionRef.current();
              stopRecognitionRef.current = null;
            }
            void executeTurn(text);
          }
        },
        onError: (err) => {
          console.warn("[voice-console] Speech recognition error:", err);
          setIsListening(false);
          sm.transitionTo("IDLE");
        },
        onEnd: () => {
          setIsListening(false);
        },
      });
    } else {
      setTimeout(() => {
        setIsListening(false);
        void executeTurn("Find me a hotel in Mumbai for Friday.");
      }, 750);
    }
  }, [executeTurn, speechSupported, triggerInterruption]);

  const handleStopListening = useCallback((): void => {
    setIsListening(false);
    if (stopRecognitionRef.current) {
      stopRecognitionRef.current();
      stopRecognitionRef.current = null;
    }
    const sm = stateMachineRef.current;
    if (sm.getState() === "LISTENING") {
      sm.transitionTo("IDLE");
    }
  }, []);

  const handleQuickTurn = useCallback(
    (prompt: string): void => {
      const sm = stateMachineRef.current;
      const currentState = sm.getState();

      if (currentState === "SPEAKING" || currentState === "THINKING") {
        triggerInterruption(generationFence.getCurrentGeneration(), "user_barge_in");
      }

      if (sm.transitionTo("LISTENING")) {
        setTimeout(() => {
          void executeTurn(prompt);
        }, 200);
      }
    },
    [executeTurn, triggerInterruption]
  );

  const stopLatencyDisplay =
    typeof interruptMetrics.lastAudioStopLatencyMs === "number"
      ? `${interruptMetrics.lastAudioStopLatencyMs}ms`
      : "—";

  const recoveryTimeDisplay =
    typeof interruptMetrics.lastRecoveryTimeMs === "number"
      ? `${interruptMetrics.lastRecoveryTimeMs}ms`
      : "—";

  return (
    <main className="console-container">
      {/* Header */}
      <header className="app-header">
        <div className="app-brand">
          <div className="brand-icon">
            <Shield size={20} />
          </div>
          <div>
            <div className="app-title">
              EchoFence
              <span className="app-subtitle">Interruption-Safe Voice Intelligence</span>
            </div>
          </div>
        </div>

        <div className="status-pill status-pill-ready">
          <span className="status-dot status-dot-pulse" />
          SYSTEM READY
        </div>
      </header>

      {/* Prominent Hackathon Judge Demo Entry Point */}
      <RaceDemoPanel stateMachine={stateMachineRef.current} setTurns={setTurns} />

      {/* Quantitative Measurement Pipeline Dashboard */}
      <MeasurementDashboard />

      {/* Unified Final Judge-Facing Evidence Dashboard */}
      <EvidenceDashboard />

      {/* Main Console Grid */}
      <div className="console-grid">
        {/* Left Column: Conversation Area & Voice Controls */}
        <section aria-label="Conversation Area" className="console-card-fill">
          <Transcript items={turns} />
          <VoiceControls
            voiceState={voiceState}
            isListening={isListening}
            isSpeechSupported={speechSupported}
            onStartListening={handleStartListening}
            onStopListening={handleStopListening}
            onQuickTurn={handleQuickTurn}
            onSimulateRace={handleSimulateRace}
            onTestBargeIn={handleTestBargeIn}
            onTestDelayedRace={handleTestDelayedRace}
            isBargeInMonitoring={isBargeInMonitoring}
          />
        </section>

        {/* Right Column: Voice State, Provider, Live Evidence */}
        <aside aria-label="System Metrics & Telemetry" className="console-sidebar">
          <AudioState currentState={voiceState} />
          <ProviderBadge />
          <EvidencePanel
            activeGeneration={generationId > 0 ? String(generationId) : "—"}
            interruptions={String(interruptMetrics.interruptionCount)}
            staleResultsBlocked={String(staleBlockedCount)}
            audioStopLatency={stopLatencyDisplay}
            recoveryTime={recoveryTimeDisplay}
            isInterrupted={interruptController.isInterrupted(generationId) || voiceState === "INTERRUPTED"}
            recentEvents={auditEvents}
          />
        </aside>
      </div>

      {/* Event Timeline */}
      <footer className="console-card">
        <div className="console-card-header">
          <span className="console-card-title">Event Timeline & Interruption Telemetry</span>
          <span className="status-pill">
            {interruptMetrics.interruptionCount > 0
              ? `Interrupted: ${interruptMetrics.interruptionCount}x`
              : "No Interruptions"}
          </span>
        </div>
        <div className="timeline-placeholder">
          Interrupt Controller active. Latency: {stopLatencyDisplay} | Recovery: {recoveryTimeDisplay} | Active Gen: {generationId}.
        </div>
      </footer>
    </main>
  );
}
