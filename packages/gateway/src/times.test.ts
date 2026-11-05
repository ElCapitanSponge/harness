import type { Heartbeat } from "@harness/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Registry } from "./registry.js";
import type { Relay } from "./relay.js";
import { Sessions, type Complete, type Session } from "./sessions.js";
import { parseImportFile } from "./transcripts.js";

// When things happened: the gateway stamps each stored event and queued message, and an import keeps the source's times.

const beat: Heartbeat = { nodeId: "pc", kind: "local", busy: false, models: [{ id: "qwen", loaded: true }], roots: ["proj"], allowedTools: ["read_file"], platform: "win32" };

let registry: Registry;
let complete: ReturnType<typeof vi.fn<Complete>>;
let sessions: Sessions;

const relay = {
  callTool: vi.fn<Relay["callTool"]>(async () => {
    return { ok: true, output: "" };
  }),
};

const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !check(); i++) {
    await new Promise((r) => {
      return setTimeout(r, 5);
    });
  }
  expect(check()).toBe(true);
};

const create = (): Session => {
  return sessions.create({ model: "qwen", device: "pc", root: "proj" });
};

beforeEach(() => {
  // Only the clock is faked, so the polling above still runs.
  vi.useFakeTimers({ toFake: ["Date"] });
  registry = new Registry();
  registry.upsert(beat);
  complete = vi.fn<Complete>();
  sessions = new Sessions({ registry, relay, complete });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the gateway sets the time", () => {
  it("stamps every stored event with the time it recorded it, in UTC milliseconds", async () => {
    const start = Date.parse("2026-11-05T07:00:00Z");
    vi.setSystemTime(start);
    complete.mockResolvedValue({ role: "assistant", content: "hi" });
    const s = create();
    s.send("hello");
    await until(() => {
      return s.events.some((e) => {
        return e.type === "done";
      });
    });
    expect(s.events.length).toBeGreaterThan(1);
    for (const e of s.events) {
      expect(e.at).toBe(start);
    }
  });

  it("gives each event the time of its own moment, not the first one's", async () => {
    vi.setSystemTime(Date.parse("2026-11-05T07:00:00Z"));
    complete.mockImplementation(async () => {
      vi.setSystemTime(Date.parse("2026-11-05T07:00:30Z"));
      return { role: "assistant", content: "hi" };
    });
    const s = create();
    s.send("hello");
    await until(() => {
      return s.events.some((e) => {
        return e.type === "done";
      });
    });
    expect(s.events.find((e) => {
      return e.type === "user";
    })?.at).toBe(Date.parse("2026-11-05T07:00:00Z"));
    expect(s.events.find((e) => {
      return e.type === "text";
    })?.at).toBe(Date.parse("2026-11-05T07:00:30Z"));
  });

  it("says when a queued message was queued", () => {
    vi.setSystemTime(Date.parse("2026-11-05T07:00:00Z"));
    // A turn that never ends, so the next message has to wait.
    complete.mockImplementation(() => {
      return new Promise(() => {
        return undefined;
      });
    });
    const s = create();
    s.send("first");
    vi.setSystemTime(Date.parse("2026-11-05T07:05:00Z"));
    expect(s.send("second")).toBe("queued");
    expect(s.info().queued?.[0]?.at).toBe(Date.parse("2026-11-05T07:05:00Z"));
  });
});

describe("conversations with no times", () => {
  it("keeps events stored before times were recorded as they were, with no time", () => {
    const old = new Sessions({
      registry,
      relay,
      complete,
      stored: [{ id: "old", title: "", model: "qwen", device: "pc", root: "proj", created: 1, updated: 1, history: [], events: [{ type: "user", text: "hi" }, { type: "done", stopped: false }] }],
    });
    const events = old.get("old")?.events;
    expect(events).toEqual([{ type: "user", text: "hi" }, { type: "done", stopped: false }]);
    expect(events?.some((e) => {
      return "at" in e;
    })).toBe(false);
  });
});

describe("imported conversations", () => {
  it("keeps the time the source gave for a turn, and none for a turn it gave none for", () => {
    vi.setSystemTime(Date.parse("2026-11-05T07:00:00Z"));
    const given = Date.parse("2026-01-02T03:04:05Z");
    const s = sessions.import({ source: "Claude Code", turns: [{ role: "user", text: "fix it", at: given }, { role: "assistant", text: "done" }] });
    expect(s.events[0]?.at).toBe(Date.parse("2026-11-05T07:00:00Z"));
    expect(s.events[1]).toEqual({ type: "user", text: "fix it", at: given });
    expect(s.events[2]).toEqual({ type: "text", text: "done" });
  });

  it("reads each turn's time from a Claude Code transcript, taking the end of a reply that came in parts", () => {
    const lines = [
      { type: "user", timestamp: "2026-01-02T03:04:05Z", message: { role: "user", content: "fix the bug" } },
      { type: "assistant", timestamp: "2026-01-02T03:04:09Z", message: { role: "assistant", content: [{ type: "text", text: "Looking." }] } },
      { type: "assistant", timestamp: "2026-01-02T03:04:20Z", message: { role: "assistant", content: [{ type: "text", text: "Fixed." }] } },
    ].map((l) => {
      return JSON.stringify(l);
    }).join("\n");
    const turns = parseImportFile("session.jsonl", lines).conversations[0]?.turns;
    expect(turns?.map((t) => {
      return t.at;
    })).toEqual([Date.parse("2026-01-02T03:04:05Z"), Date.parse("2026-01-02T03:04:20Z")]);
  });

  it("reads message times from a ChatGPT export, where they are in seconds", () => {
    const node = (id: string, parent: string | null, role: string, text: string, seconds: number | null) => {
      return [id, { id, parent, message: { author: { role }, content: { content_type: "text", parts: [text] }, create_time: seconds, metadata: {} } }] as const;
    };
    const mapping = Object.fromEntries([
      node("a", null, "user", "hi", 1_767_323_045),
      node("b", "a", "assistant", "hello", null),
    ]);
    const data = [{ title: "Greeting", current_node: "b", mapping }];
    const turns = parseImportFile("conversations.json", JSON.stringify(data)).conversations[0]?.turns;
    expect(turns?.[0]?.at).toBe(1_767_323_045_000);
    expect(turns?.[1] && "at" in turns[1]).toBe(false);
  });

  it("reads message times from a Claude.ai export, and leaves a message without one alone", () => {
    const data = [{ name: "Haiku", chat_messages: [{ sender: "human", text: "Write a haiku", created_at: "2026-02-03T00:00:01Z" }, { sender: "assistant", text: "Old pond" }] }];
    const turns = parseImportFile("claude.json", JSON.stringify(data)).conversations[0]?.turns;
    expect(turns?.[0]?.at).toBe(Date.parse("2026-02-03T00:00:01Z"));
    expect(turns?.[1] && "at" in turns[1]).toBe(false);
  });
});
