import type { SessionEvent, StageName } from "@harness/core";

// What the page shows for a conversation, built up from the gateway's events. Kept free of React so it can be tested.

export type Item
  = | { kind: "user"; id: number; text: string }
    | { kind: "assistant"; id: number; text: string; streaming: boolean }
    | { kind: "thinking"; id: number; text: string; live: boolean; startedAt: number; seconds: number }
    | { kind: "tool"; id: number; summary: string }
    | { kind: "compaction"; id: number; messages: number; tokensBefore: number; tokensAfter: number; manual: boolean }
    | { kind: "approval"; id: number; approvalId: string; tool: string; summary: string; status: "pending" | "allowed" | "declined" }
    | { kind: "note"; id: number; text: string; tone: "info" | "error" };

export interface ConversationState {
  items: Item[];
  // A turn is running: from the person's message until it is done, cancelled or has failed.
  busy: boolean;
  // How many stored events have been seen, so a dropped connection resumes where it left off.
  cursor: number;
  next: number;
  // When the running turn began, and where it is before the first word: finding a device, loading a model, waiting.
  since?: number;
  stage?: { name: StageName; detail?: string };
}

export const emptyConversation = (): ConversationState => {
  return { items: [], busy: false, cursor: 0, next: 1 };
};

export type StreamEvent = SessionEvent | { type: "thinking-delta"; text: string } | { type: "text-delta"; text: string } | { type: "stage"; stage: StageName; detail?: string };

// The turn is running from the moment Send is pressed, before any event has come back.
export const markBusy = (state: ConversationState, now: number = Date.now()): ConversationState => {
  return { ...state, busy: true, since: state.since ?? now };
};

const isDelta = (event: StreamEvent): boolean => {
  return event.type === "thinking-delta" || event.type === "text-delta" || event.type === "stage";
};

// Finishes any thinking or reply that was still being written.
const settle = (items: Item[], now: number): Item[] => {
  return items.map((item) => {
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
        return { kind: "user", id, text: event.text };
      }), busy: true, since: state.since ?? now, stage: undefined };

    case "stage":
      return { ...state, stage: { name: event.stage, detail: event.detail } };

    case "thinking-delta":
      if (last?.kind === "thinking" && last.live) {
        return replaceLast({ ...last, text: last.text + event.text });
      }
      return push(settle(state.items, now), (id) => {
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
        return replaceLast({ ...last, text: event.text, streaming: false });
      }
      return push(settle(state.items, now), (id) => {
        return { kind: "assistant", id, text: event.text, streaming: false };
      });

    case "compacted":
      return push(state.items, (id) => {
        return { kind: "compaction", id, messages: event.messages, tokensBefore: event.tokensBefore, tokensAfter: event.tokensAfter, manual: event.manual };
      });

    case "tool":
      return push(settle(state.items, now), (id) => {
        return { kind: "tool", id, summary: event.summary };
      });

    case "approval":
      return push(settle(state.items, now), (id) => {
        return { kind: "approval", id, approvalId: event.id, tool: event.tool, summary: event.summary, status: "pending" };
      });

    case "approval-resolved":
      return {
        ...state,
        cursor,
        items: state.items.map((item) => {
          return item.kind === "approval" && item.approvalId === event.id ? { ...item, status: event.approved ? "allowed" : "declined" } : item;
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
