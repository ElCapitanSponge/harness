import { describe, expect, it, vi } from "vitest";
import { createReplyHold, endOf, endOutcome, exitCodeFor, renderResult } from "./print.js";

describe("endOutcome", () => {
  it("tells a declined turn and one stopped at the step limit from one that finished", () => {
    expect(endOutcome({})).toBe("done");
    expect(endOutcome({ stopped: false, declined: false })).toBe("done");
    expect(endOutcome({ stopped: true })).toBe("stopped");
    expect(endOutcome({ declined: true })).toBe("declined");
    // Declined wins: the model was stopped because a change was refused.
    expect(endOutcome({ stopped: true, declined: true })).toBe("declined");
  });
});

describe("endOf", () => {
  it("reads how the turn ended from the event that ends it, and nothing from the others", () => {
    expect(endOf({ type: "done", stopped: false })).toEqual({ outcome: "done" });
    expect(endOf({ type: "done", stopped: true })).toEqual({ outcome: "stopped" });
    expect(endOf({ type: "done", stopped: false, declined: true })).toEqual({ outcome: "declined" });
    expect(endOf({ type: "error", message: "model down" })).toEqual({ outcome: "error", message: "model down" });
    expect(endOf({ type: "cancelled" })).toEqual({ outcome: "error", message: "the turn was cancelled" });
    expect(endOf({ type: "user", text: "hi" })).toBeUndefined();
    expect(endOf({ type: "text", text: "hi" })).toBeUndefined();
  });
});

describe("createReplyHold", () => {
  it("gives the last reply as the answer and sends the earlier ones to progress", () => {
    const progress = vi.fn();
    const hold = createReplyHold(progress);
    hold.add("Let me look.");
    hold.add("Found it.");
    hold.add("All fixed.");
    expect(progress.mock.calls).toEqual([["Let me look."], ["Found it."]]);
    expect(hold.take()).toBe("All fixed.");
    // Taken once; a second take, or a turn that said nothing, is empty.
    expect(hold.take()).toBe("");
  });
});

describe("exitCodeFor", () => {
  it("is zero only when the turn ended with a reply", () => {
    expect(exitCodeFor("done")).toBe(0);
    expect(exitCodeFor("declined")).toBe(1);
    expect(exitCodeFor("stopped")).toBe(1);
    expect(exitCodeFor("error")).toBe(1);
  });
});

describe("renderResult", () => {
  it("prints just the final reply as text, and nothing when there is none", () => {
    expect(renderResult({ outcome: "done", text: "All fixed.", model: "qwen" }, "text")).toBe("All fixed.");
    expect(renderResult({ outcome: "error", text: "", model: "qwen", message: "model down" }, "text")).toBe("");
  });

  it("prints one JSON object with the text, the model and how the turn ended", () => {
    expect(JSON.parse(renderResult({ outcome: "done", text: "All fixed.", model: "qwen" }, "json"))).toEqual({ outcome: "done", text: "All fixed.", model: "qwen" });
    expect(JSON.parse(renderResult({ outcome: "error", text: "", model: "qwen", message: "model down" }, "json"))).toEqual({ outcome: "error", text: "", model: "qwen", error: "model down" });
    // One line, so a script can read it a line at a time.
    expect(renderResult({ outcome: "done", text: "a\nb", model: "m" }, "json")).not.toContain("\n");
  });
});
