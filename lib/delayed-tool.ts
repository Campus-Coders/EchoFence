/**
 * lib/delayed-tool.ts
 * Deterministic Delayed Tool Fixture for EchoFence.
 *
 * Simulates a long-running external tool (e.g. hotel availability search)
 * with a deterministic delay (default 4000ms).
 *
 * Crucially supports:
 * 1. respectAbort: true  -> Cancels when AbortSignal triggers.
 * 2. respectAbort: false -> Continues executing even after the caller/turn was interrupted.
 *    This simulates external asynchronous work that cannot be canceled across network boundaries,
 *    proving that the Generation Fence is required to block obsolete results.
 */

import { generationFence } from "./generation-fence";
import { generationAudit } from "./generation-audit";
import type { DelayedToolMetrics } from "@/types/generation";

export type DelayedToolOptions = {
  generationId: number;
  delayMs?: number;
  signal?: AbortSignal;
  respectAbort?: boolean;
  city?: string;
  maxBudget?: number;
};

export type DelayedToolHotelResult = {
  name: string;
  city: string;
  pricePerNight: number;
  availableRooms: number;
};

export type DelayedToolResult = {
  success: boolean;
  toolName: "searchHotelsDelayed";
  generationId: number;
  delayMs: number;
  startedAt: number;
  completedAt: number;
  completedLate: boolean;
  wasAborted: boolean;
  data: {
    hotels: DelayedToolHotelResult[];
    searchSummary: string;
  };
};

class DelayedToolRegistry {
  private runs = 0;
  private normalCompletions = 0;
  private lateCompletions = 0;
  private staleBlocked = 0;
  private abortCount = 0;

  public recordRun(): void {
    this.runs++;
  }

  public recordNormalCompletion(): void {
    this.normalCompletions++;
  }

  public recordLateCompletion(): void {
    this.lateCompletions++;
  }

  public recordStaleBlocked(): void {
    this.staleBlocked++;
  }

  public recordAbort(): void {
    this.abortCount++;
  }

  public getMetrics(): DelayedToolMetrics {
    return {
      delayedToolRuns: this.runs,
      delayedToolCompletions: this.normalCompletions + this.lateCompletions,
      lateToolCompletions: this.lateCompletions,
      staleToolResultsBlocked: this.staleBlocked,
    };
  }

  public reset(): void {
    this.runs = 0;
    this.normalCompletions = 0;
    this.lateCompletions = 0;
    this.staleBlocked = 0;
    this.abortCount = 0;
  }
}

export const delayedToolRegistry = new DelayedToolRegistry();

/**
 * Deterministic delayed hotel search fixture.
 * Simulates a 4000ms asynchronous search operation.
 */
export async function searchHotelsDelayed(
  options: DelayedToolOptions
): Promise<DelayedToolResult> {
  const {
    generationId,
    delayMs = 4000,
    signal,
    respectAbort = false,
    city = "Mumbai",
    maxBudget = 5000,
  } = options;

  const startedAt = Date.now();
  delayedToolRegistry.recordRun();

  generationAudit.record(
    generationId,
    "tool_started",
    generationFence.getCurrentGeneration(),
    "delayed_tool",
    `Started ${delayMs}ms delayed hotel search for Gen ${generationId} in ${city} (respectAbort=${respectAbort})`
  );

  return new Promise<DelayedToolResult>((resolve, reject) => {
    let timerId: NodeJS.Timeout | null = null;

    const onAbort = () => {
      if (respectAbort) {
        if (timerId) {
          clearTimeout(timerId);
          timerId = null;
        }
        delayedToolRegistry.recordAbort();
        reject(
          new DOMException(
            `Delayed tool aborted for Gen ${generationId}`,
            "AbortError"
          )
        );
      }
    };

    if (signal) {
      if (signal.aborted && respectAbort) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    timerId = setTimeout(() => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }

      const completedAt = Date.now();
      const isCurrent = generationFence.isCurrent(generationId);
      const isLate = !isCurrent;

      if (isLate) {
        delayedToolRegistry.recordLateCompletion();
        generationAudit.record(
          generationId,
          "tool_completed_late",
          generationFence.getCurrentGeneration(),
          "delayed_tool",
          `Gen ${generationId} delayed tool finished after ${completedAt - startedAt}ms (active Gen is ${generationFence.getCurrentGeneration()})`
        );
      } else {
        delayedToolRegistry.recordNormalCompletion();
        generationAudit.record(
          generationId,
          "tool_completed",
          generationFence.getCurrentGeneration(),
          "delayed_tool",
          `Gen ${generationId} delayed tool completed normally in ${completedAt - startedAt}ms`
        );
      }

      const result: DelayedToolResult = {
        success: true,
        toolName: "searchHotelsDelayed",
        generationId,
        delayMs,
        startedAt,
        completedAt,
        completedLate: isLate,
        wasAborted: Boolean(signal?.aborted),
        data: {
          hotels: [
            {
              name: "The Taj Mahal Tower",
              city,
              pricePerNight: 4200,
              availableRooms: 3,
            },
            {
              name: "Trident Nariman Point",
              city,
              pricePerNight: 4800,
              availableRooms: 5,
            },
          ],
          searchSummary: `Found 2 hotels in ${city} under ₹${maxBudget}/night: The Taj Mahal Tower (₹4,200) and Trident Nariman Point (₹4,800).`,
        },
      };

      resolve(result);
    }, delayMs);
  });
}
