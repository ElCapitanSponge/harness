import type { ClaudeLimits, ClaudeWindow } from "@harness/core";

// When a limit message gives no time, try again after this long.
const LIMIT_RETRY_MS = 15 * 60_000;

// Thrown when Claude refuses a request because a usage limit was reached, so callers can stop sending it more.
export class ClaudeLimitError extends Error {
  readonly limits: ClaudeLimits;

  constructor(message: string, limits: ClaudeLimits) {
    super(message);
    this.name = "ClaudeLimitError";
    this.limits = limits;
  }
}

interface RateLimitInfo {
  status?: string;
  resetsAt?: number;
  rateLimitType?: string;
  utilization?: number;
  isUsingOverage?: boolean;
  unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number } | undefined>;
}

const toWindow = (w: { utilization?: number; resetsAt?: number } | undefined): ClaudeWindow | undefined => {
  return w && typeof w.utilization === "number" && typeof w.resetsAt === "number" ? { utilization: w.utilization, resetsAt: w.resetsAt } : undefined;
};

// Reads the program's rate_limit_event. Its "rejected" status does not mean a request failed (a plan with extra usage keeps
// working past 100 percent), so this records what it says and leaves `limitedUntil` to the caller, who knows if a request failed.
export const readLimits = (info: RateLimitInfo, now: number): ClaudeLimits => {
  return {
    status: info.status ?? "unknown",
    fiveHour: toWindow(info.unifiedWindows?.five_hour) ?? (info.rateLimitType === "five_hour" ? toWindow(info) : undefined),
    sevenDay: toWindow(info.unifiedWindows?.seven_day) ?? (info.rateLimitType === "seven_day" ? toWindow(info) : undefined),
    usingOverage: info.isUsingOverage === true,
    observedAt: now,
  };
};

// When a refused request will work again: the soonest reset of a window that is used up, or a short wait if none is known.
export const limitedUntil = (limits: ClaudeLimits, info: RateLimitInfo | undefined, now: number): number => {
  const full = [limits.fiveHour, limits.sevenDay].filter((w): w is ClaudeWindow => {
    return w !== undefined && w.utilization >= 1;
  }).map((w) => {
    return w.resetsAt * 1000;
  });
  if (full.length > 0) {
    return Math.min(...full);
  }
  return typeof info?.resetsAt === "number" ? info.resetsAt * 1000 : now + LIMIT_RETRY_MS;
};

export type { RateLimitInfo };
