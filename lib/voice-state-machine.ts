import {
  type VoiceState,
  VALID_VOICE_TRANSITIONS,
} from "@/types/voice";

export type StateTransitionListener = (
  nextState: VoiceState,
  prevState: VoiceState
) => void;

/**
 * Deterministic Voice State Machine.
 * Enforces valid transition rules and rejects arbitrary state mutations.
 */
export class VoiceStateMachine {
  private currentState: VoiceState;
  private listeners: Set<StateTransitionListener> = new Set();
  private transitionHistory: Array<{
    from: VoiceState;
    to: VoiceState;
    timestamp: number;
  }> = [];

  constructor(initialState: VoiceState = "IDLE") {
    this.currentState = initialState;
  }

  public getState(): VoiceState {
    return this.currentState;
  }

  /**
   * Checks if a transition from current state to nextState is permitted.
   */
  public canTransitionTo(nextState: VoiceState): boolean {
    if (nextState === this.currentState) {
      return false;
    }
    const allowed = VALID_VOICE_TRANSITIONS[this.currentState];
    return allowed.includes(nextState);
  }

  /**
   * Attempts to execute a transition. Returns true if successful, false otherwise.
   */
  public transitionTo(nextState: VoiceState): boolean {
    if (!this.canTransitionTo(nextState)) {
      console.warn(
        `[state-machine] Invalid transition rejected: ${this.currentState} -> ${nextState}`
      );
      return false;
    }

    const prevState = this.currentState;
    this.currentState = nextState;
    this.transitionHistory.push({
      from: prevState,
      to: nextState,
      timestamp: Date.now(),
    });

    for (const listener of this.listeners) {
      try {
        listener(nextState, prevState);
      } catch (err) {
        console.error("[state-machine] Listener error:", err);
      }
    }

    return true;
  }

  /**
   * Force resets state machine to IDLE (e.g. on session teardown or critical error).
   */
  public reset(): void {
    const prevState = this.currentState;
    this.currentState = "IDLE";
    if (prevState !== "IDLE") {
      this.transitionHistory.push({
        from: prevState,
        to: "IDLE",
        timestamp: Date.now(),
      });
      for (const listener of this.listeners) {
        listener("IDLE", prevState);
      }
    }
  }

  public subscribe(listener: StateTransitionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getHistory(): ReadonlyArray<{
    from: VoiceState;
    to: VoiceState;
    timestamp: number;
  }> {
    return [...this.transitionHistory];
  }
}
