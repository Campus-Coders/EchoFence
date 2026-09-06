/**
 * lib/performance-clock.ts
 * High-resolution timing abstraction for EchoFence measurements.
 *
 * Provides accurate timestamps and elapsed duration calculations
 * using performance.now() where available, with safe fallback to Date.now().
 */

export class PerformanceClock {
  /**
   * Returns current high-resolution monotonic time in milliseconds.
   */
  public now(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }

  /**
   * Returns standard unix timestamp in milliseconds.
   */
  public timestamp(): number {
    return Date.now();
  }

  /**
   * Calculates elapsed milliseconds since a starting timestamp.
   * Ensures non-negative result.
   */
  public elapsed(startMs: number): number {
    const current = this.now();
    return Math.max(0, Math.round(current - startMs));
  }

  /**
   * Computes difference between two performance.now() timestamps.
   */
  public diff(endMs: number, startMs: number): number {
    return Math.max(0, Math.round(endMs - startMs));
  }
}

export const performanceClock = new PerformanceClock();
