import { textOf, type ChatMessage } from "@harness/core";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { compacted, planCompaction, transcriptOf } from "./compaction.js";
import { sqliteLedger } from "./ledger.js";
import { Registry } from "./registry.js";
import { Sessions, type Complete, type Session } from "./sessions.js";
import { openDatabase } from "./sqlite.js";

const sys = (content: string): ChatMessage => {
  return { role: "system", content };
};
const user = (content: string): ChatMessage => {
  return { role: "user", content };
};
const bot = (content: string): ChatMessage => {
  return { role: "assistant", content };
};

describe("planning a compaction", () => {
  it("keeps the system prompt and the two latest turns, and summarises what is older", () => {
    const history = [sys("S"), user("q1"), bot("a1"), user("q2"), bot("a2"), user("q3"), bot("a3"), user("q4")];
    const plan = planCompaction(history);
    expect(plan?.head).toEqual([sys("S")]);
    expect(plan?.older).toEqual([user("q1"), bot("a1"), user("q2"), bot("a2")]);
    expect(plan?.keep).toEqual([user("q3"), bot("a3"), user("q4")]);
  });

  it("has nothing to summarise until there are more turns than it keeps", () => {
    expect(planCompaction([sys("S"), user("q1"), bot("a1"), user("q2")])).toBeUndefined();
    expect(planCompaction([sys("S")])).toBeUndefined();
    expect(planCompaction([])).toBeUndefined();
  });

  it("keeps a tool call together with its result, because a turn runs to the next user message", () => {
    const call: ChatMessage = { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "read_file", arguments: "{}" } }] };
    const result: ChatMessage = { role: "tool", tool_call_id: "t1", name: "read_file", content: "file text" };
    const plan = planCompaction([sys("S"), user("q1"), call, result, bot("a1"), user("q2"), bot("a2"), user("q3")]);
    expect(plan?.older).toEqual([user("q1"), call, result, bot("a1")]);
    expect(plan?.keep[0]).toEqual(user("q2"));
  });

  it("puts the summary after the system prompt and before the recent turns", () => {
    const plan = planCompaction([sys("S"), user("q1"), bot("a1"), user("q2"), user("q3")]);
    if (!plan) {
      throw new Error("expected a plan");
    }
    const next = compacted(plan, "  They asked q1.  ");
    expect(next.map((m) => {
      return m.role;
    })).toEqual(["system", "system", "user", "user"]);
    expect(next[1]?.content).toContain("They asked q1.");
    expect(next[0]).toEqual(sys("S"));
  });
});

describe("the transcript the model summarises", () => {
  it("labels turns, shows tool calls and results, and shortens long tool output", () => {
    const call: ChatMessage = { role: "assistant", content: "Let me look.", tool_calls: [{ id: "t1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"a.ts\"}" } }] };
    const text = transcriptOf([user("fix it"), call, { role: "tool", tool_call_id: "t1", name: "read_file", content: "x".repeat(5000) }], 100_000);
    expect(text).toContain("User: fix it");
    expect(text).toContain("[called read_file({\"path\":\"a.ts\"})]");
    expect(text).toContain("Tool result (read_file):");
    expect(text).toContain("(shortened)");
    expect(text.length).toBeLessThan(2000);
  });

  it("leaves out the middle of a transcript that is still too long, keeping the start and the end", () => {
    const older = Array.from({ length: 40 }, (_v, i) => {
      return user(`message number ${String(i)} ${"y".repeat(200)}`);
    });
    const text = transcriptOf(older, 2000);
    expect(text).toContain("message number 0");
    expect(text).toContain("message number 39");
    expect(text).toContain("the middle of the earlier conversation was left out");
    expect(text.length).toBeLessThan(2200);
  });
});

const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 400 && !check(); i++) {
    await new Promise((r) => {
      return setTimeout(r, 5);
    });
  }
  expect(check()).toBe(true);
};

const kinds = (s: Session): string[] => {
  return s.events.map((e) => {
    return e.type;
  });
};

// A model that answers questions with "answer N" and summaries with a fixed text, and reports a context size we choose.
const setup = (promptTokens: (call: number) => number, compactAt = 0.8) => {
  const registry = new Registry();
  const ledger = sqliteLedger(openDatabase(":memory:"));
  const sent: ChatMessage[][] = [];
  let calls = 0;
  const complete = vi.fn<Complete>((_model, messages, _tools, _signal, hooks) => {
    sent.push([...messages]);
    calls++;
    const summarising = messages[0]?.role === "system" && textOf(messages[0].content).startsWith("You are condensing");
    hooks?.usage?.({ model: "qwen", device: "pc", promptTokens: promptTokens(calls), completionTokens: 10, durationMs: 1, contextLength: 1000, estimated: false });
    return Promise.resolve({ role: "assistant", content: summarising ? "SUMMARY OF OLD TURNS" : `answer ${String(calls)}` });
  });
  const sessions = new Sessions({ registry, relay: { callTool: vi.fn() }, complete, ledger, compactAt });
  return { sessions, ledger, sent, complete, registry };
};

const say = async (s: Session, text: string): Promise<void> => {
  const before = s.events.filter((e) => {
    return e.type === "done";
  }).length;
  s.send(text);
  await until(() => {
    return s.events.filter((e) => {
      return e.type === "done";
    }).length > before;
  });
};

describe("a conversation that compacts itself", () => {
  it("summarises the older turns once the context is past the threshold, before the next message, and says so", async () => {
    // Calls 1 to 3 are small turns; the third reports 900 of 1000 tokens, so the fourth message triggers a compaction.
    const { sessions, sent } = setup((call) => {
      return call >= 3 ? 900 : 100;
    });
    const chat = sessions.create({ model: "qwen" });
    await say(chat, "one");
    await say(chat, "two");
    await say(chat, "three");
    expect(kinds(chat)).not.toContain("compacted");

    await say(chat, "four");
    const note = chat.events.find((e) => {
      return e.type === "compacted";
    });
    expect(note).toMatchObject({ type: "compacted", manual: false, messages: 4 });
    expect(note?.type === "compacted" && note.tokensAfter < note.tokensBefore).toBe(true);

    // The model that answered "four" saw the system prompt, the summary and the latest turns, and not the oldest ones.
    const lastCall = sent.at(-1) ?? [];
    const text = JSON.stringify(lastCall);
    expect(lastCall[0]?.role).toBe("system");
    expect(text).toContain("SUMMARY OF OLD TURNS");
    expect(text).toContain("three");
    expect(text).toContain("four");
    expect(text).not.toContain("\"one\"");
  });

  it("does nothing while the context has room, or when it is turned off", async () => {
    const small = setup(() => {
      return 100;
    });
    const a = small.sessions.create({ model: "qwen" });
    for (const t of ["1", "2", "3", "4"]) {
      await say(a, t);
    }
    expect(kinds(a)).not.toContain("compacted");

    const off = setup(() => {
      return 990;
    }, 0);
    const b = off.sessions.create({ model: "qwen" });
    for (const t of ["1", "2", "3", "4"]) {
      await say(b, t);
    }
    expect(kinds(b)).not.toContain("compacted");
  });

  it("goes ahead with the message when summarising fails, and does not try again until another call has been made", async () => {
    const { sessions, complete } = setup(() => {
      return 950;
    });
    const real = complete.getMockImplementation();
    // The model answers questions but cannot write a summary.
    complete.mockImplementation((model, messages, tools, signal, hooks) => {
      if (textOf(messages[0]?.content).startsWith("You are condensing")) {
        return Promise.reject(new Error("model unavailable"));
      }
      return real?.(model, messages, tools, signal, hooks) ?? Promise.reject(new Error("no model"));
    });
    const chat = sessions.create({ model: "qwen" });
    for (const t of ["one", "two", "three", "four"]) {
      await say(chat, t);
    }
    expect(kinds(chat)).not.toContain("compacted");
    expect(kinds(chat)).not.toContain("error");
    expect(kinds(chat).filter((k) => {
      return k === "done";
    })).toHaveLength(4);
    // One failed attempt, not one for every message after it.
    const attempts = complete.mock.calls.filter(([, messages]) => {
      return textOf(messages[0]?.content).startsWith("You are condensing");
    });
    expect(attempts.length).toBeLessThan(4);
  });

  it("compacts on request, reports how much it freed, and refuses when there is nothing older or a turn is running", async () => {
    const { sessions } = setup(() => {
      return 100;
    });
    const chat = sessions.create({ model: "qwen" });
    await say(chat, "one");
    expect(await chat.compact()).toMatchObject({ ok: false, reason: expect.stringContaining("nothing older") as string });

    await say(chat, "two");
    await say(chat, "three");
    const done = await chat.compact();
    expect(done).toMatchObject({ ok: true, messages: 2 });
    expect(chat.events.at(-1)).toMatchObject({ type: "compacted", manual: true });

    chat.send("four");
    expect(await chat.compact()).toMatchObject({ ok: false, reason: expect.stringContaining("busy") as string });
  });
});

describe("the compact route", () => {
  const build = () => {
    const { sessions, ledger, registry } = setup(() => {
      return 100;
    });
    const app = createApp({
      registry,
      relay: { request: vi.fn(), callTool: vi.fn(), callClaude: vi.fn(), callModel: vi.fn(), callSettings: vi.fn() },
      loader: { ensure: vi.fn() },
      sessions,
      ledger,
    });
    return { app, sessions };
  };

  it("compacts a conversation and shows the smaller context before the next reply", async () => {
    const { app, sessions } = build();
    const chat = sessions.create({ model: "qwen" });
    await say(chat, "one");
    await say(chat, "two");
    await say(chat, "three");

    const res = await app.request(`/sessions/${chat.id}/compact`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    const usage = (await (await app.request(`/sessions/${chat.id}/usage`)).json()) as { last: { promptTokens: number; estimated: boolean } };
    expect(usage.last.estimated).toBe(true);
    expect(usage.last.promptTokens).toBeLessThan(100);
  });

  it("says why when there is nothing to compact, and 404s an unknown conversation", async () => {
    const { app, sessions } = build();
    const chat = sessions.create({ model: "qwen" });
    const res = await app.request(`/sessions/${chat.id}/compact`, { method: "POST" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain("nothing older");
    expect((await app.request("/sessions/nope/compact", { method: "POST" })).status).toBe(404);
  });
});
