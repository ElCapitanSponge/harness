import { describe, expect, it } from "vitest";
import { applyEvent, emptyConversation, markBusy, type ConversationState, type StreamEvent } from "./conversation.js";

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

  it("folds a run of tool calls into one group that a reply, an approval or the end of the turn closes", () => {
    const mid = run([
      { type: "user", text: "q" },
      { type: "tool", summary: "read a.ts", name: "read_file" },
      { type: "tool-output", name: "read_file", output: "1\tx" },
      { type: "thinking", text: "hm" },
      { type: "tool", summary: "run ls", name: "run_command" },
    ]);
    expect(kinds(mid)).toEqual(["user", "actions", "thinking"]);
    expect(mid.items[1]).toMatchObject({ live: true, entries: [{ summary: "read a.ts", output: "1\tx" }, { summary: "run ls" }] });

    const done = run([{ type: "text", text: "ok" }, { type: "tool", summary: "read b.ts", name: "read_file" }, { type: "approval", id: "a", tool: "write_file", summary: "w" }], mid);
    expect(kinds(done)).toEqual(["user", "actions", "thinking", "assistant", "actions", "approval"]);
    expect(done.items[1]).toMatchObject({ live: false });
    expect(done.items[4]).toMatchObject({ live: false, entries: [{ summary: "read b.ts" }] });
  });

  it("attaches a file change to the write that made it, and keeps output with the right call", () => {
    const state = run([
      { type: "user", text: "q" },
      { type: "tool", summary: "write a.ts", name: "write_file" },
      { type: "change", change: { path: "a.ts", created: true, added: 1, removed: 0, patch: "@@\n+x" } },
      { type: "tool-output", name: "write_file", output: "wrote" },
      { type: "done", stopped: false },
    ]);
    expect(state.items[1]).toMatchObject({ live: false, entries: [{ name: "write_file", output: "wrote", change: { path: "a.ts", patch: "@@\n+x" } }] });
    expect(state.changes).toHaveLength(1);
  });

  it("still groups a conversation stored before tool names were kept", () => {
    const state = run([{ type: "user", text: "q" }, { type: "tool", summary: "read a.ts" }, { type: "tool", summary: "read b.ts" }, { type: "done", stopped: false }]);
    expect(kinds(state)).toEqual(["user", "actions"]);
    expect(state.items[1]).toMatchObject({ live: false, entries: [{ summary: "read a.ts" }, { summary: "read b.ts" }] });
  });

  it("keeps the queue the gateway reports, which is live only and does not move the cursor", () => {
    const waiting = run([{ type: "user", text: "q" }, { type: "queue", messages: [{ id: "a", text: "next", images: 0 }, { id: "b", text: "after", images: 1 }], held: false }]);
    expect(waiting.queue.map((m) => {
      return m.text;
    })).toEqual(["next", "after"]);
    expect(waiting.queueHeld).toBe(false);
    expect(waiting.cursor).toBe(1);
    expect(kinds(waiting)).toEqual(["user"]);

    const held = run([{ type: "queue", messages: [{ id: "a", text: "next", images: 0 }], held: true }], waiting);
    expect(held.queueHeld).toBe(true);
    expect(held.queue).toHaveLength(1);
    expect(run([{ type: "queue", messages: [], held: false }], held).queue).toEqual([]);
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

describe("replies from different models in one conversation", () => {
  it("keeps the model and device each reply came from, including after the live text is replaced by the stored one", () => {
    const state = run([
      { type: "user", text: "one" },
      { type: "text", text: "from qwen", model: "qwen", device: "anakin" },
      { type: "done", stopped: false },
      { type: "user", text: "two" },
      { type: "text-delta", text: "from " },
      { type: "text", text: "from claude", model: "claude", device: "bastila" },
      { type: "done", stopped: false },
    ]);
    const replies = state.items.flatMap((i) => {
      return i.kind === "assistant" ? [`${i.model ?? ""}@${i.device ?? ""}:${i.text}`] : [];
    });
    expect(replies).toEqual(["qwen@anakin:from qwen", "claude@bastila:from claude"]);
  });
});

describe("compaction", () => {
  it("shows a marker in the conversation, counted as a stored event, and does not end the turn", () => {
    const state = run([{ type: "user", text: "q" }, { type: "compacted", messages: 6, tokensBefore: 9000, tokensAfter: 1200, manual: false }]);
    expect(state.items.at(-1)).toMatchObject({ kind: "compaction", messages: 6, tokensBefore: 9000, tokensAfter: 1200, manual: false });
    expect(state.busy).toBe(true);
    expect(state.cursor).toBe(2);
  });
});

describe("a compaction as it happens", () => {
  it("shows a note as soon as it starts, and that same note becomes the divider when it ends", () => {
    const started = run([{ type: "user", text: "q" }, { type: "compacting", manual: false, percent: 82 }]);
    expect(started.items.at(-1)).toMatchObject({ kind: "compaction", status: "running", manual: false, percent: 82 });

    const ended = run([{ type: "compacted", messages: 6, tokensBefore: 9000, tokensAfter: 1200, manual: false }], started);
    expect(kinds(ended)).toEqual(["user", "compaction"]);
    expect(ended.items.at(-1)).toMatchObject({ status: "done", messages: 6, tokensBefore: 9000, tokensAfter: 1200 });
    expect(ended.cursor).toBe(3);
  });

  it("becomes a failure note with the reason, and is one note even if the start was never seen", () => {
    const state = run([{ type: "compacting", manual: true }, { type: "compaction-failed", manual: true, reason: "the model wrote no summary" }]);
    expect(kinds(state)).toEqual(["compaction"]);
    expect(state.items[0]).toMatchObject({ status: "failed", manual: true, reason: "the model wrote no summary" });

    const alone = run([{ type: "compaction-failed", manual: false, reason: "x" }]);
    expect(alone.items).toMatchObject([{ kind: "compaction", status: "failed" }]);
  });

  it("is not left saying it is compacting when the turn ends without an end for it", () => {
    const state = run([{ type: "user", text: "q" }, { type: "compacting", manual: false }, { type: "done", stopped: false }]);
    expect(state.items.at(-1)).toMatchObject({ kind: "compaction", status: "interrupted" });
  });
});

describe("the plan as a document", () => {
  it("keeps every version in order, as stored events, apart from the step list", () => {
    const state = run([
      { type: "plan", steps: [{ text: "a", status: "pending" }] },
      { type: "plan-document", version: 1, markdown: "# Plan", by: "model" },
      { type: "plan-document", version: 2, markdown: "# Plan\n\n- more", by: "person" },
    ]);
    expect(state.planDocs).toEqual([{ version: 1, markdown: "# Plan", by: "model" }, { version: 2, markdown: "# Plan\n\n- more", by: "person" }]);
    expect(state.plan).toEqual([{ text: "a", status: "pending" }]);
    expect(state.items).toEqual([]);
    expect(state.cursor).toBe(3);
  });
});

describe("progress before the first word", () => {
  it("is busy with a timer from the moment of sending, follows the stages, and clears when the turn ends", () => {
    const sent = markBusy(emptyConversation(), 5000);
    expect(sent).toMatchObject({ busy: true, since: 5000 });

    const loading = applyEvent(sent, { type: "stage", stage: "loading", detail: "qwen" }, 6000);
    expect(loading.stage).toEqual({ name: "loading", detail: "qwen" });
    // A stage is live only: it does not move the cursor, so a resume does not skip stored events.
    expect(loading.cursor).toBe(0);

    // The echo of the person's own message keeps the original start time.
    const echoed = applyEvent(loading, { type: "user", text: "hi" }, 7000);
    expect(echoed.since).toBe(5000);

    const done = applyEvent(applyEvent(echoed, { type: "stage", stage: "writing" }, 8000), { type: "done", stopped: false }, 9000);
    expect(done).toMatchObject({ busy: false, since: undefined, stage: undefined });
  });

  it("clears on an error so a retry starts fresh", () => {
    const failed = applyEvent(markBusy(emptyConversation(), 1000), { type: "error", message: "no device" }, 1500);
    expect(failed).toMatchObject({ busy: false, since: undefined });
    expect(failed.items.at(-1)).toMatchObject({ tone: "error", text: "no device" });
  });
});

describe("a skill the person started", () => {
  it("shows as its own item after what the person typed", () => {
    const state = run([{ type: "user", text: "/tdd parser" }, { type: "skill", name: "tdd", arguments: "parser", text: "Write the test." }, { type: "text", text: "ok" }, { type: "done", stopped: false }]);
    expect(kinds(state)).toEqual(["user", "skill", "assistant"]);
    expect(state.items[1]).toMatchObject({ kind: "skill", name: "tdd", arguments: "parser", text: "Write the test." });
  });
});

describe("an imported conversation", () => {
  it("starts with a note saying where it came from", () => {
    const state = run([{ type: "imported", source: "ChatGPT", turns: 2 }, { type: "user", text: "q" }, { type: "text", text: "a" }]);
    expect(kinds(state)).toEqual(["note", "user", "assistant"]);
    expect(state.items[0]).toMatchObject({ kind: "note", tone: "info", text: expect.stringContaining("Imported from ChatGPT: 2 messages") as string });
  });
});

describe("the side panel's data", () => {
  const change = (path: string, added: number, removed: number, created = false): StreamEvent => {
    return { type: "change", change: { path, created, added, removed, patch: `@@ ${path}` } };
  };

  it("collects changed files, newest first, adding up several changes to one file and remembering that it was created", () => {
    const state = run([change("a.ts", 2, 0, true), change("b.ts", 1, 1), change("a.ts", 3, 1)]);
    expect(state.changes.map((f) => {
      return f.path;
    })).toEqual(["a.ts", "b.ts"]);
    expect(state.changes[0]).toMatchObject({ path: "a.ts", created: true, added: 5, removed: 1 });
    expect(state.changes[0]?.diffs).toHaveLength(2);
    // They are data for the panel, not items in the thread.
    expect(state.items).toEqual([]);
    expect(state.cursor).toBe(3);
  });

  it("keeps the latest plan", () => {
    const state = run([{ type: "plan", steps: [{ text: "a", status: "in_progress" }] }, { type: "plan", steps: [{ text: "a", status: "done" }, { text: "b", status: "pending" }] }]);
    expect(state.plan).toEqual([{ text: "a", status: "done" }, { text: "b", status: "pending" }]);
  });
});

describe("images and notices", () => {
  it("keeps the pictures of a message with it, and shows a notice as a note", () => {
    const img = { mediaType: "image/png" as const, data: "AAAA" };
    const state = run([{ type: "user", text: "look", images: [img] }, { type: "notice", text: "qwen cannot read images" }, { type: "text", text: "ok" }]);
    expect(kinds(state)).toEqual(["user", "note", "assistant"]);
    expect(state.items[0]).toMatchObject({ images: [img] });
    expect(state.items[1]).toMatchObject({ tone: "info", text: "qwen cannot read images" });
  });
});

describe("a question for the person", () => {
  it("is pending until answered, then shows the answer, or that nobody answered", () => {
    const asked = run([{ type: "question", id: "q1", question: "Which?", options: ["A", "B"] }]);
    expect(asked.items[0]).toMatchObject({ kind: "question", status: "pending", options: ["A", "B"] });
    const answered = run([{ type: "question-resolved", id: "q1", answer: "A" }], asked);
    expect(answered.items[0]).toMatchObject({ status: "answered", answer: "A" });
    const nobody = run([{ type: "question-resolved", id: "q1" }], asked);
    expect(nobody.items[0]).toMatchObject({ status: "unanswered" });
  });
});

describe("a sub-agent", () => {
  it("shows as one item that is updated when it finishes", () => {
    const base = { childId: "c1", task: "find the config", n: 1, of: 8, depth: 1 };
    const running = run([{ type: "subagent", status: "running", ...base }]);
    expect(running.items).toHaveLength(1);
    expect(running.items[0]).toMatchObject({ kind: "subagent", status: "running" });
    const done = run([{ type: "subagent", status: "done", result: "found it", ...base }], running);
    expect(done.items).toHaveLength(1);
    expect(done.items[0]).toMatchObject({ status: "done", result: "found it", n: 1, of: 8 });
  });
});

describe("a screenshot from the agent browser", () => {
  it("is kept for the side panel, newest first, and is not an item in the thread", () => {
    const state = run([{ type: "screenshot", shot: { mediaType: "image/png", data: "AAAA", url: "https://a.example/" } }, { type: "screenshot", shot: { mediaType: "image/png", data: "BBBB", url: "https://b.example/" } }]);
    expect(state.shots.map((s) => {
      return s.url;
    })).toEqual(["https://b.example/", "https://a.example/"]);
    expect(state.items).toEqual([]);
    expect(state.cursor).toBe(2);
  });
});

describe("modes and approvals", () => {
  it("keeps what an approval will do, and the reason a decline was given", () => {
    const preview = { kind: "command" as const, title: "Runs in anakin:proj", text: "pnpm test" };
    const asked = run([{ type: "approval", id: "a1", tool: "run_command", summary: "run: pnpm test", preview }]);
    expect(asked.items[0]).toMatchObject({ kind: "approval", status: "pending", preview });
    const declined = run([{ type: "approval-resolved", id: "a1", approved: false, reason: "use unit tests" }], asked);
    expect(declined.items[0]).toMatchObject({ status: "declined", reason: "use unit tests" });
  });

  it("notes a change of mode in the thread", () => {
    const state = run([{ type: "mode", mode: "plan" }]);
    expect(state.items[0]).toMatchObject({ kind: "note", tone: "info", text: expect.stringContaining("plan first") as string });
  });
});
