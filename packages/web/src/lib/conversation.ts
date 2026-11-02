import type { ApprovalPreview, FileChange, ImageAttachment, PlanStep, ToolImage, SessionEvent, StageName } from "@harness/core";

// What the page shows for a conversation, built up from the gateway's events. Kept free of React so it can be tested.

export type Item
  = | { kind: "user"; id: number; text: string; images?: ImageAttachment[] }
    | { kind: "assistant"; id: number; text: string; streaming: boolean; model?: string; device?: string; reason?: string }
    | { kind: "thinking"; id: number; text: string; live: boolean; startedAt: number; seconds: number }
    // A run of tool activity between two messages, or a message and an approval or question. Open (live) while the turn is still adding to it.
    | { kind: "actions"; id: number; entries: ActionEntry[]; live: boolean }
    | { kind: "skill"; id: number; name: string; arguments: string; text: string }
    | { kind: "compaction"; id: number; messages: number; tokensBefore: number; tokensAfter: number; manual: boolean }
    | { kind: "approval"; id: number; approvalId: string; tool: string; summary: string; status: "pending" | "allowed" | "declined"; preview?: ApprovalPreview; reason?: string }
    | { kind: "subagent"; id: number; childId: string; task: string; status: "running" | "done" | "failed"; result?: string; n: number; of: number; depth: number }
    | { kind: "question"; id: number; questionId: string; question: string; options: string[]; status: "pending" | "answered" | "unanswered"; answer?: string }
    | { kind: "note"; id: number; text: string; tone: "info" | "error" };

// A file the session changed, for the side panel: totals over every write and edit, and each one's diff in order.
export interface ChangedFile {
  path: string;
  // True if the session created it (its first change made the file).
  created: boolean;
  added: number;
  removed: number;
  diffs: { patch?: string; note?: string }[];
}

export interface ConversationState {
  items: Item[];
  // Files the session changed, most recently changed first, and the model's plan as it stands. Both are rebuilt from the stored
  // events when a conversation is reopened.
  changes: ChangedFile[];
  plan: PlanStep[];
  // Screenshots the agent browser took, newest first.
  shots: ToolImage[];
  // A turn is running: from the person's message until it is done, cancelled or has failed.
  busy: boolean;
  // How many stored events have been seen, so a dropped connection resumes where it left off.
  cursor: number;
  next: number;
  // When the running turn began, and where it is before the first word: finding a device, loading a model, waiting.
  since?: number;
  stage?: { name: StageName; detail?: string };
}

import type { ActionEntry } from "./actions";
import { MODE_LABELS } from "./modes";

export const emptyConversation = (): ConversationState => {
  return { items: [], changes: [], plan: [], shots: [], busy: false, cursor: 0, next: 1 };
};

export type StreamEvent = SessionEvent | { type: "thinking-delta"; text: string } | { type: "text-delta"; text: string } | { type: "stage"; stage: StageName; detail?: string };

// The turn is running from the moment Send is pressed, before any event has come back.
export const markBusy = (state: ConversationState, now: number = Date.now()): ConversationState => {
  return { ...state, busy: true, since: state.since ?? now };
};

const isDelta = (event: StreamEvent): boolean => {
  return event.type === "thinking-delta" || event.type === "text-delta" || event.type === "stage";
};

// Finishes any thinking or reply that was still being written, and ends the open group of actions: a message, an approval, a question
// or the end of the turn closes it. Thinking and more tool calls (`keepGroup`) do not, so one group spans a run of steps.
const settle = (items: Item[], now: number, keepGroup = false): Item[] => {
  return items.map((item) => {
    if (item.kind === "actions" && item.live && !keepGroup) {
      return { ...item, live: false };
    }
    if (item.kind === "thinking" && item.live) {
      return { ...item, live: false, seconds: Math.max(0, Math.round((now - item.startedAt) / 1000)) };
    }
    if (item.kind === "assistant" && item.streaming) {
      return { ...item, streaming: false };
    }
    return item;
  });
};

const withNote = (state: ConversationState, cursor: number, text: string, tone: "info" | "error", now: number): ConversationState => {
  return {
    ...state,
    cursor,
    busy: false,
    since: undefined,
    stage: undefined,
    items: [...settle(state.items, now), { kind: "note", id: state.next, text, tone }],
    next: state.next + 1,
  };
};

const lastActions = (items: Item[]): number => {
  return items.findLastIndex((i) => {
    return i.kind === "actions";
  });
};

const withEntries = (items: Item[], index: number, entries: ActionEntry[]): Item[] => {
  return items.map((item, i) => {
    return item.kind === "actions" && i === index ? { ...item, entries } : item;
  });
};

// A file change belongs to the write or edit that made it: the latest entry still waiting for its output (the change arrives before the output,
// and in a conversation stored before tool names were kept, every entry is waiting, so the latest is the one). With none to join, it is a row of its own.
const attachChange = (items: Item[], c: FileChange): Item[] => {
  const index = lastActions(items);
  const group = items[index];
  if (group?.kind !== "actions") {
    return items;
  }
  const change = { path: c.path, patch: c.patch, note: c.note, created: c.created };
  const k = group.entries.findLastIndex((e) => {
    return e.output === undefined && e.change === undefined && (e.name === undefined || e.name === "write_file" || e.name === "edit_file");
  });
  if (k >= 0) {
    return withEntries(items, index, group.entries.map((e, j) => {
      return j === k ? { ...e, change } : e;
    }));
  }
  return group.live ? withEntries(items, index, [...group.entries, { summary: `modified ${c.path}`, change }]) : items;
};

export const applyEvent = (state: ConversationState, event: StreamEvent, now: number = Date.now()): ConversationState => {
  const cursor = isDelta(event) ? state.cursor : state.cursor + 1;
  const push = (items: Item[], make: (id: number) => Item): ConversationState => {
    return { ...state, cursor, items: [...items, make(state.next)], next: state.next + 1 };
  };
  const replaceLast = (item: Item): ConversationState => {
    return { ...state, cursor, items: [...state.items.slice(0, -1), item] };
  };
  const last = state.items.at(-1);

  switch (event.type) {
    case "user":
      return { ...push(state.items, (id) => {
        return { kind: "user", id, text: event.text, ...(event.images ? { images: event.images } : {}) };
      }), busy: true, since: state.since ?? now, stage: undefined };

    case "stage":
      return { ...state, stage: { name: event.stage, detail: event.detail } };

    case "thinking-delta":
      if (last?.kind === "thinking" && last.live) {
        return replaceLast({ ...last, text: last.text + event.text });
      }
      return push(settle(state.items, now, true), (id) => {
        return { kind: "thinking", id, text: event.text, live: true, startedAt: now, seconds: 0 };
      });

    case "text-delta":
      if (last?.kind === "assistant" && last.streaming) {
        return replaceLast({ ...last, text: last.text + event.text });
      }
      return push(settle(state.items, now), (id) => {
        return { kind: "assistant", id, text: event.text, streaming: true };
      });

    case "thinking":
      // The finished reasoning: replace the live block if there is one, otherwise show it already collapsed (a reopened conversation).
      if (last?.kind === "thinking" && last.live) {
        return replaceLast({ ...last, text: event.text, live: false, seconds: Math.max(0, Math.round((now - last.startedAt) / 1000)) });
      }
      return push(state.items, (id) => {
        return { kind: "thinking", id, text: event.text, live: false, startedAt: now, seconds: 0 };
      });

    case "text":
      if (last?.kind === "assistant" && last.streaming) {
        return replaceLast({ ...last, text: event.text, streaming: false, model: event.model, device: event.device, reason: event.reason });
      }
      return push(settle(state.items, now), (id) => {
        return { kind: "assistant", id, text: event.text, streaming: false, model: event.model, device: event.device, reason: event.reason };
      });

    case "compacted":
      return push(state.items, (id) => {
        return { kind: "compaction", id, messages: event.messages, tokensBefore: event.tokensBefore, tokensAfter: event.tokensAfter, manual: event.manual };
      });

    case "change": {
      const c: FileChange = event.change;
      const earlier = state.changes.find((f) => {
        return f.path === c.path;
      });
      const entry: ChangedFile = {
        path: c.path,
        created: earlier?.created ?? c.created,
        added: (earlier?.added ?? 0) + c.added,
        removed: (earlier?.removed ?? 0) + c.removed,
        diffs: [...(earlier?.diffs ?? []), { patch: c.patch, note: c.note }],
      };
      return { ...state, cursor, items: attachChange(state.items, c), changes: [entry, ...state.changes.filter((f) => {
        return f.path !== c.path;
      })] };
    }

    case "mode":
      return push(state.items, (id) => {
        return { kind: "note", id, text: `Changes in this conversation now: ${MODE_LABELS[event.mode]}.`, tone: "info" };
      });

    case "screenshot":
      return { ...state, cursor, shots: [event.shot, ...state.shots] };

    case "plan":
      return { ...state, cursor, plan: event.steps };

    case "imported":
      return push(state.items, (id) => {
        return { kind: "note", id, text: `Imported from ${event.source}: ${String(event.turns)} message${event.turns === 1 ? "" : "s"}. Nothing was sent to a model; carry on with any model.`, tone: "info" };
      });

    case "notice":
      return push(settle(state.items, now), (id) => {
        return { kind: "note", id, text: event.text, tone: "info" };
      });

    case "skill":
      return push(settle(state.items, now), (id) => {
        return { kind: "skill", id, name: event.name, arguments: event.arguments, text: event.text };
      });

    case "tool": {
      const entry: ActionEntry = { summary: event.summary, ...(event.name ? { name: event.name } : {}) };
      const open = state.items.findLastIndex((i) => {
        return i.kind === "actions" && i.live;
      });
      const group = state.items[open];
      if (group?.kind === "actions") {
        return { ...state, cursor, items: withEntries(state.items, open, [...group.entries, entry]) };
      }
      return push(settle(state.items, now, true), (id) => {
        return { kind: "actions", id, entries: [entry], live: true };
      });
    }

    case "tool-output": {
      const index = lastActions(state.items);
      const group = state.items[index];
      const k = group?.kind === "actions"
        ? group.entries.findLastIndex((e) => {
            return e.output === undefined && (e.name === undefined || e.name === event.name);
          })
        : -1;
      if (group?.kind !== "actions" || k < 0) {
        return { ...state, cursor };
      }
      return { ...state, cursor, items: withEntries(state.items, index, group.entries.map((e, j) => {
        return j === k ? { ...e, name: event.name, output: event.output, ...(event.failed ? { failed: true } : {}) } : e;
      })) };
    }

    case "approval":
      return push(settle(state.items, now), (id) => {
        return { kind: "approval", id, approvalId: event.id, tool: event.tool, summary: event.summary, status: "pending", ...(event.preview ? { preview: event.preview } : {}) };
      });

    case "approval-resolved":
      return {
        ...state,
        cursor,
        items: state.items.map((item) => {
          return item.kind === "approval" && item.approvalId === event.id ? { ...item, status: event.approved ? "allowed" : "declined", ...(event.reason ? { reason: event.reason } : {}) } : item;
        }),
      };

    case "subagent": {
      const known = state.items.some((i) => {
        return i.kind === "subagent" && i.childId === event.childId;
      });
      const item = (id: number): Item => {
        return { kind: "subagent", id, childId: event.childId, task: event.task, status: event.status, result: event.result, n: event.n, of: event.of, depth: event.depth };
      };
      return known
        ? { ...state, cursor, items: state.items.map((i) => {
            return i.kind === "subagent" && i.childId === event.childId ? item(i.id) : i;
          }) }
        : push(settle(state.items, now, true), item);
    }

    case "question":
      return push(settle(state.items, now), (id) => {
        return { kind: "question", id, questionId: event.id, question: event.question, options: event.options, status: "pending" };
      });

    case "question-resolved":
      return {
        ...state,
        cursor,
        items: state.items.map((item) => {
          return item.kind === "question" && item.questionId === event.id ? { ...item, status: event.answer === undefined ? "unanswered" : "answered", answer: event.answer } : item;
        }),
      };

    case "done": {
      if (event.declined) {
        return withNote(state, cursor, "Declined. Nothing was changed. Tell me what to do instead.", "info", now);
      }
      if (event.stopped) {
        return withNote(state, cursor, "Stopped at the step limit. Say continue to go on.", "info", now);
      }
      return { ...state, cursor, busy: false, since: undefined, stage: undefined, items: settle(state.items, now) };
    }

    case "cancelled":
      return withNote(state, cursor, "Cancelled.", "info", now);

    case "error":
      return withNote(state, cursor, event.message, "error", now);
  }
};
