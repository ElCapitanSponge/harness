import { describe, expect, it } from "vitest";
import { applyEvent, emptyConversation, type ConversationState, type StreamEvent } from "./conversation.js";

const run = (events: StreamEvent[], start: ConversationState = emptyConversation()): ConversationState => {
  let now = 1000;
  return events.reduce((state, event) => {
    now += 1000;
    return applyEvent(state, event, now);
  }, start);
};

const kinds = (state: ConversationState): string[] => {
  return state.items.map((i) => {
    return i.kind;
  });
};

describe("a conversation built from events", () => {
  it("shows a turn as it streams: thinking, then the reply, finished by the stored events", () => {
    const live = run([
      { type: "user", text: "hi" },
      { type: "thinking-delta", text: "Let me " },
      { type: "thinking-delta", text: "think." },
      { type: "text-delta", text: "Hel" },
      { type: "text-delta", text: "lo" },
    ]);
    expect(live.busy).toBe(true);
    expect(kinds(live)).toEqual(["user", "thinking", "assistant"]);
    expect(live.items[1]).toMatchObject({ text: "Let me think.", live: false });
    expect(live.items[2]).toMatchObject({ text: "Hello", streaming: true });

    const done = run([{ type: "thinking", text: "Let me think." }, { type: "text", text: "Hello" }, { type: "done", stopped: false }], live);
    expect(done.busy).toBe(false);
    expect(done.items[2]).toMatchObject({ text: "Hello", streaming: false });
    // Deltas are not counted, so a dropped connection resumes after the stored events only.
    expect(done.cursor).toBe(4);
  });

  it("replays a stored conversation with its thinking already collapsed", () => {
    const state = run([{ type: "user", text: "q" }, { type: "thinking", text: "hm" }, { type: "text", text: "a" }, { type: "done", stopped: false }]);
    expect(kinds(state)).toEqual(["user", "thinking", "assistant"]);
    expect(state.items[1]).toMatchObject({ live: false });
    expect(state.busy).toBe(false);
  });

  it("stays busy when the stored events end mid-turn", () => {
    expect(run([{ type: "user", text: "q" }, { type: "tool", summary: "read a.ts" }]).busy).toBe(true);
  });

  it("tracks an approval from asked to answered", () => {
    const asked = run([{ type: "user", text: "q" }, { type: "approval", id: "a1", tool: "write_file", summary: "write x" }]);
    expect(asked.items[1]).toMatchObject({ kind: "approval", status: "pending" });
    const answered = run([{ type: "approval-resolved", id: "a1", approved: false }], asked);
    expect(answered.items[1]).toMatchObject({ status: "declined" });
  });

  it("adds a note for a decline, a step limit, a cancel and an error, and stops being busy", () => {
    expect(run([{ type: "user", text: "q" }, { type: "done", stopped: false, declined: true }]).items.at(-1)).toMatchObject({ kind: "note", tone: "info" });
    expect(run([{ type: "user", text: "q" }, { type: "done", stopped: true }]).items.at(-1)).toMatchObject({ text: expect.stringContaining("step limit") as string });
    expect(run([{ type: "user", text: "q" }, { type: "cancelled" }]).busy).toBe(false);
    const failed = run([{ type: "user", text: "q" }, { type: "error", message: "boom" }]);
    expect(failed.busy).toBe(false);
    expect(failed.items.at(-1)).toMatchObject({ tone: "error", text: "boom" });
  });
});
