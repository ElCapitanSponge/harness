import type { SessionEvent } from "@harness/core";

// How a turn ended, in the four ways a script needs to tell apart. A turn that was cancelled counts as an error, since no reply came.
export type Outcome = "done" | "declined" | "stopped" | "error";

export type OutputFormat = "text" | "json";

// Print mode (-p): one turn that never waits on a person, for a script to call.
export interface PrintOptions {
  format: OutputFormat;
}

export interface TurnEnd {
  outcome: Outcome;
  message?: string | undefined;
}

export type PrintResult = TurnEnd & { text: string; model: string };

export const endOutcome = (flags: { declined?: boolean | undefined; stopped?: boolean | undefined }): Outcome => {
  if (flags.declined) {
    return "declined";
  }
  return flags.stopped ? "stopped" : "done";
};

// What a stored event says about how the turn ended; undefined for every event that does not end it.
export const endOf = (event: SessionEvent): TurnEnd | undefined => {
  switch (event.type) {
    case "done":
      return { outcome: endOutcome(event) };
    case "cancelled":
      return { outcome: "error", message: "the turn was cancelled" };
    case "error":
      return { outcome: "error", message: event.message };
    default:
      return undefined;
  }
};

// Only the last reply of a turn is the answer. One written before a tool call is progress and goes to standard error, so each reply is
// held until the next arrives or the turn ends, which is when the last can be told from the rest.
export const createReplyHold = (progress: (text: string) => void) => {
  let held = "";
  return {
    add: (text: string): void => {
      if (held) {
        progress(held);
      }
      held = text;
    },
    take: (): string => {
      const text = held;
      held = "";
      return text;
    },
  };
};

// 0 only when the turn ended with a reply.
export const exitCodeFor = (outcome: Outcome): number => {
  return outcome === "done" ? 0 : 1;
};

// What goes to standard output: the final reply as it is, or one JSON object a script can read. Empty when there is nothing to say.
export const renderResult = (result: PrintResult, format: OutputFormat): string => {
  if (format === "json") {
    return JSON.stringify({ outcome: result.outcome, text: result.text, model: result.model, ...(result.message ? { error: result.message } : {}) });
  }
  return result.text;
};
