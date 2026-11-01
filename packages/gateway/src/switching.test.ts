import { textOf, type ChatMessage, type Heartbeat } from "@harness/core";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { sqliteLedger } from "./ledger.js";
import { Registry } from "./registry.js";
import { Sessions, type Complete, type Session } from "./sessions.js";
import { openDatabase, sqliteStore } from "./sqlite.js";

const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 400 && !check(); i++) {
    await new Promise((r) => {
      return setTimeout(r, 5);
    });
  }
  expect(check()).toBe(true);
};

const say = async (s: Session, text: string, model?: string): Promise<void> => {
  const before = s.events.filter((e) => {
    return e.type === "done" || e.type === "error";
  }).length;
  s.send(text, model);
  await until(() => {
    return s.events.filter((e) => {
      return e.type === "done" || e.type === "error";
    }).length > before;
  });
};

const pool = (): Registry => {
  const registry = new Registry();
  registry.upsert({ nodeId: "anakin", kind: "local", busy: false, models: [{ id: "qwen", loaded: true, contextLength: 32_768 }, { id: "tiny", loaded: true, contextLength: 400 }], roots: ["proj"], allowedTools: ["read_file"] } satisfies Heartbeat);
  registry.upsert({ nodeId: "bastila", kind: "local", busy: false, models: [{ id: "gemma", loaded: true, contextLength: 8192 }], claude: true } satisfies Heartbeat);
  return registry;
};

// Answers as whichever model it is asked for, says which device ran it, and reports a call of the size we choose.
const modelFake = (sizeOf: (model: string) => number = () => {
  return 100;
}) => {
  const device: Record<string, string> = { qwen: "anakin", tiny: "anakin", gemma: "bastila", claude: "bastila" };
  const seen: { model: string; messages: ChatMessage[] }[] = [];
  const complete = vi.fn<Complete>((model, messages, _tools, _signal, hooks) => {
    seen.push({ model, messages: [...messages] });
    const summarising = messages[0]?.role === "system" && textOf(messages[0].content).startsWith("You are condensing");
    hooks?.usage?.({ model, device: device[model] ?? "x", promptTokens: sizeOf(model), completionTokens: 10, durationMs: 1, contextLength: model === "gemma" ? 8192 : 32_768, estimated: false });
    return Promise.resolve({ role: "assistant", content: summarising ? "SUMMARY" : `${model} says hi` });
  });
  return { complete, seen };
};

describe("changing the model inside one conversation", () => {
  it("moves between models on different devices and Claude, each seeing the whole history, each reply labelled", async () => {
    const { complete, seen } = modelFake();
    const sessions = new Sessions({ registry: pool(), relay: { callTool: vi.fn() }, complete });
    const chat = sessions.create({ model: "qwen" });

    await say(chat, "first");
    await say(chat, "second", "gemma");
    await say(chat, "third", "claude");
    await say(chat, "fourth");

    expect(seen.map((s) => {
      return s.model;
    })).toEqual(["qwen", "gemma", "claude", "claude"]);
    // The last model saw everything said before, including what the others answered.
    const lastText = JSON.stringify(seen[3]?.messages);
    for (const word of ["first", "qwen says hi", "second", "gemma says hi", "third", "claude says hi"]) {
      expect(lastText).toContain(word);
    }

    const replies = chat.events.flatMap((e) => {
      return e.type === "text" ? [`${e.model ?? ""}@${e.device ?? ""}`] : [];
    });
    expect(replies).toEqual(["qwen@anakin", "gemma@bastila", "claude@bastila", "claude@bastila"]);
    expect(chat.model).toBe("claude");
    expect(chat.info().model).toBe("claude");
  });

  it("stays on the chosen model for the messages after it, until another is chosen", async () => {
    const { seen, complete } = modelFake();
    const chat = new Sessions({ registry: pool(), relay: { callTool: vi.fn() }, complete }).create({ model: "qwen" });
    await say(chat, "a", "gemma");
    await say(chat, "b");
    await say(chat, "c", "qwen");
    expect(seen.map((s) => {
      return s.model;
    })).toEqual(["gemma", "gemma", "qwen"]);
  });

  it("lets a coding session change between local models, but not to Claude, and keeps the old model on a refusal", async () => {
    const { seen, complete } = modelFake();
    const sessions = new Sessions({ registry: pool(), relay: { callTool: vi.fn() }, complete });
    const code = sessions.create({ model: "qwen", device: "anakin", root: "proj" });
    await say(code, "look", "tiny");
    expect(code.model).toBe("tiny");
    expect(() => {
      code.send("now with Claude", "claude");
    }).toThrow("Claude models cannot drive a coding session");
    expect(code.model).toBe("tiny");
    expect(code.busy).toBe(false);
    await say(code, "go on");
    expect(seen.at(-1)?.model).toBe("tiny");
  });

  it("says in words, before calling the model, when the conversation cannot fit the one chosen", async () => {
    const { seen, complete } = modelFake();
    const chat = new Sessions({ registry: pool(), relay: { callTool: vi.fn() }, complete }).create({ model: "qwen" });
    await say(chat, "x".repeat(2000));
    const callsBefore = seen.length;

    // "tiny" holds 400 tokens; the conversation is about 500.
    await say(chat, "and now?", "tiny");
    const error = chat.events.at(-1);
    expect(error).toMatchObject({ type: "error", message: expect.stringContaining("more than tiny can hold (400)") as string });
    expect(seen.length).toBe(callsBefore);

    // The conversation carries on with a model that has room.
    await say(chat, "try again", "qwen");
    expect(chat.events.at(-1)?.type).toBe("done");
  });

  it("compacts first when a smaller window would be nearly full, using the new model's window", async () => {
    // qwen reports small calls, so its own window is far from full; gemma's window (8192 tokens) is what matters after the switch.
    const ledger = sqliteLedger(openDatabase(":memory:"));
    const { seen, complete } = modelFake();
    const chat = new Sessions({ registry: pool(), relay: { callTool: vi.fn() }, complete, ledger, compactAt: 0.8 }).create({ model: "qwen" });
    await say(chat, "a ".repeat(6000));
    await say(chat, "b ".repeat(6000));
    await say(chat, "c ".repeat(1500));

    await say(chat, "d", "gemma");
    expect(chat.events.some((e) => {
      return e.type === "compacted";
    })).toBe(true);
    const gemma = seen.filter((s) => {
      return s.model === "gemma";
    });
    // The summary was written by gemma, the model that now has to fit it, and gemma then answered.
    expect(gemma.length).toBe(2);
    expect(JSON.stringify(gemma[1]?.messages)).toContain("SUMMARY");
  });

  it("is remembered with the conversation, so a restart goes on with the latest model", async () => {
    const store = sqliteStore(openDatabase(":memory:"));
    const { complete } = modelFake();
    const first = new Sessions({ registry: pool(), relay: { callTool: vi.fn() }, complete, store });
    const chat = first.create({ model: "qwen" });
    await say(chat, "hello", "gemma");
    await until(() => {
      return store.loadAll()[0]?.model === "gemma";
    });
    const back = new Sessions({ registry: pool(), relay: { callTool: vi.fn() }, complete, store, stored: store.loadAll() }).get(chat.id);
    expect(back?.model).toBe("gemma");
  });
});

describe("the message route with a model", () => {
  it("changes the conversation's model and tells the caller", async () => {
    const registry = pool();
    const { complete } = modelFake();
    const sessions = new Sessions({ registry, relay: { callTool: vi.fn() }, complete });
    const app = createApp({
      registry,
      relay: { request: vi.fn(), callTool: vi.fn(), callClaude: vi.fn(), callModel: vi.fn(), callSettings: vi.fn() },
      loader: { ensure: vi.fn() },
      sessions,
    });
    const chat = sessions.create({ model: "qwen" });
    const post = (body: unknown) => {
      return app.request(`/sessions/${chat.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    };
    const res = await post({ text: "hi", model: "gemma" });
    expect(res.status).toBe(202);
    expect(((await res.json()) as { model: string }).model).toBe("gemma");
    await until(() => {
      return !chat.busy;
    });

    const code = sessions.create({ model: "qwen", device: "anakin", root: "proj" });
    const refused = await app.request(`/sessions/${code.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hi", model: "claude" }) });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain("cannot drive a coding session");
  });
});
