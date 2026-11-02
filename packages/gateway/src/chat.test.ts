import type { ChatMessage, Heartbeat } from "@harness/core";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { Registry } from "./registry.js";
import { Sessions, createCompleter, type Complete, type Session } from "./sessions.js";
import { openDatabase, sqliteStore } from "./sqlite.js";

const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 400 && !check(); i++) {
    await new Promise((r) => {
      return setTimeout(r, 5);
    });
  }
  expect(check()).toBe(true);
};

const types = (s: Session): string[] => {
  return s.events.map((e) => {
    return e.type;
  });
};

const setup = () => {
  const registry = new Registry();
  const seen: { messages: ChatMessage[]; tools: number }[] = [];
  const complete = vi.fn<Complete>((_model, messages, tools, _signal, hooks) => {
    seen.push({ messages: [...messages], tools: tools.length });
    hooks?.text?.("hi there");
    return Promise.resolve({ role: "assistant", content: "hi there" });
  });
  const sessions = new Sessions({ registry, relay: { callTool: vi.fn() }, complete });
  return { registry, sessions, seen, complete };
};

describe("a chat", () => {
  it("needs no device and no tools, and answers", async () => {
    const { sessions, seen } = setup();
    const chat = sessions.create({ model: "qwen" });
    expect(chat.kind).toBe("chat");
    expect(chat.info()).toMatchObject({ kind: "chat", device: "", root: "", deviceConnected: true });

    chat.send("Hello");
    await until(() => {
      return types(chat).includes("done");
    });
    expect(types(chat)).toEqual(["user", "text", "done"]);
    expect(seen[0]?.tools).toBe(0);
    expect(seen[0]?.messages[0]?.content).toContain("helpful assistant");
  });

  it("is named after what it started with, until it is renamed", async () => {
    const { sessions } = setup();
    const chat = sessions.create({ model: "qwen" });
    expect(chat.title).toBe("");
    chat.send("  Why does   the   build\nfail on Windows?  ");
    await until(() => {
      return !chat.busy;
    });
    expect(chat.title).toBe("Why does the build fail on Windows?");

    chat.rename("Windows build");
    expect(chat.title).toBe("Windows build");
    chat.send("another question");
    await until(() => {
      return !chat.busy;
    });
    expect(chat.title).toBe("Windows build");
  });

  it("shortens a long first message in its title", async () => {
    const { sessions } = setup();
    const chat = sessions.create({ model: "qwen" });
    chat.send("x".repeat(200));
    await until(() => {
      return !chat.busy;
    });
    expect(chat.title).toHaveLength(60);
    expect(chat.title.endsWith("...")).toBe(true);
  });

  it("can be created and continued with no device connected at all", async () => {
    const { sessions, registry } = setup();
    expect(registry.live()).toEqual([]);
    const chat = sessions.create({ model: "qwen" });
    chat.send("still works");
    await until(() => {
      return types(chat).includes("done");
    });
    expect(chat.info().deviceConnected).toBe(true);
  });

  it("may use a Claude model, in a chat or a coding session", () => {
    const { sessions, registry } = setup();
    expect(() => {
      return sessions.create({ model: "claude:sonnet" });
    }).not.toThrow();
    registry.upsert({ nodeId: "pc", kind: "local", busy: false, models: [], roots: ["proj"], allowedTools: ["read_file"] } satisfies Heartbeat);
    expect(() => {
      return sessions.create({ model: "claude:sonnet", device: "pc", root: "proj" });
    }).not.toThrow();
  });

  it("refuses a device without a root and a root without a device", () => {
    const { sessions } = setup();
    expect(() => {
      return sessions.create({ model: "qwen", device: "pc" });
    }).toThrow("needs both a device and a project root");
    expect(() => {
      return sessions.create({ model: "qwen", root: "proj" });
    }).toThrow("needs both a device and a project root");
  });

  it("is listed with coding sessions, most recently active first", async () => {
    const { sessions } = setup();
    const older = sessions.create({ model: "qwen" });
    older.send("first");
    await until(() => {
      return !older.busy;
    });
    await new Promise((r) => {
      return setTimeout(r, 5);
    });
    const newer = sessions.create({ model: "qwen" });
    newer.send("second");
    await until(() => {
      return !newer.busy;
    });
    expect(sessions.list().map((s) => {
      return s.id;
    })).toEqual([newer.id, older.id]);

    older.send("back to the first");
    await until(() => {
      return !older.busy;
    });
    expect(sessions.list()[0]?.id).toBe(older.id);
  });
});

describe("conversations that survive a restart", () => {
  it("come back from the database with their title, history and events, and carry on", async () => {
    const db = openDatabase(":memory:");
    const store = sqliteStore(db);
    const registry = new Registry();
    const first = new Sessions({ registry, relay: { callTool: vi.fn() }, complete: setup().complete, store });
    const chat = first.create({ model: "qwen" });
    chat.send("remember me");
    await until(() => {
      return !chat.busy;
    });
    await until(() => {
      return store.loadAll()[0]?.events.length === 3;
    });

    // A restart: a new Sessions reading what the database holds.
    const { complete, seen } = setup();
    const second = new Sessions({ registry, relay: { callTool: vi.fn() }, complete, store, stored: store.loadAll() });
    const back = second.get(chat.id);
    if (!back) {
      throw new Error("the conversation did not come back");
    }
    expect(back.title).toBe("remember me");
    expect(back.kind).toBe("chat");
    expect(back.events.map((e) => {
      return e.type;
    })).toEqual(["user", "text", "done"]);

    back.send("and again");
    await until(() => {
      return !back.busy && back.events.length === 6;
    });
    expect(seen[0]?.messages.map((m) => {
      return m.role;
    })).toEqual(["system", "user", "assistant", "user"]);
  });
});

describe("createCompleter for Claude and for plain chats", () => {
  const registry = new Registry();
  registry.upsert({ nodeId: "pc", kind: "local", busy: false, models: [{ id: "qwen", loaded: true }] } satisfies Heartbeat);
  const signal = new AbortController().signal;
  const messages: ChatMessage[] = [{ role: "user", content: "hi" }];

  it("sends no tools array at all when there are no tools", async () => {
    const request = vi.fn(() => {
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] })));
    });
    await createCompleter({ registry, relay: { request, callClaude: vi.fn() }, loader: { ensure: vi.fn() } })("qwen", messages, [], signal);
    const sent = JSON.parse((request.mock.calls[0] as unknown as [string, string])[1]) as Record<string, unknown>;
    expect(sent).not.toHaveProperty("tools");
  });

  it("answers Claude through a device that is logged in to it", async () => {
    const claudeRegistry = new Registry();
    claudeRegistry.upsert({ nodeId: "mac", kind: "local", busy: false, models: [], claude: true } satisfies Heartbeat);
    const callClaude = vi.fn(() => {
      return Promise.resolve({ ok: true, output: JSON.stringify({ text: "from Claude", model: "claude" }) });
    });
    const pieces: string[] = [];
    const reply = await createCompleter({ registry: claudeRegistry, relay: { request: vi.fn(), callClaude }, loader: { ensure: vi.fn() } })(
      "claude:sonnet",
      messages,
      [],
      signal,
      {
        text: (p) => {
          pieces.push(p);
        },
      },
    );
    expect(reply.content).toBe("from Claude");
    expect(pieces).toEqual(["from Claude"]);
    expect(callClaude).toHaveBeenCalledWith("mac", expect.stringContaining("\"model\":\"claude:sonnet\""));
  });

  it("says so when no device is logged in to Claude, and passes on a failure", async () => {
    const none = createCompleter({ registry, relay: { request: vi.fn(), callClaude: vi.fn() }, loader: { ensure: vi.fn() } });
    await expect(none("claude", messages, [], signal)).rejects.toThrow("no connected device is logged in to Claude");

    const claudeRegistry = new Registry();
    claudeRegistry.upsert({ nodeId: "mac", kind: "local", busy: false, models: [], claude: true } satisfies Heartbeat);
    const failing = createCompleter({
      registry: claudeRegistry,
      relay: {
        request: vi.fn(),
        callClaude: vi.fn(() => {
          return Promise.resolve({ ok: false, output: "Not logged in" });
        }),
      },
      loader: { ensure: vi.fn() },
    });
    await expect(failing("claude", messages, [], signal)).rejects.toThrow("Not logged in");
  });
});

describe("conversation routes", () => {
  const build = () => {
    const registry = new Registry();
    const sessions = new Sessions({ registry, relay: { callTool: vi.fn() }, complete: setup().complete });
    const app = createApp({
      registry,
      relay: { request: vi.fn(), callTool: vi.fn(), callClaude: vi.fn(), callModel: vi.fn(), callSettings: vi.fn() },
      loader: { ensure: vi.fn() },
      sessions,
    });
    return { app, sessions };
  };
  const send = (method: string, body?: unknown): RequestInit => {
    return { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) };
  };

  it("creates a chat from just a model, lists it, renames it and deletes it", async () => {
    const { app } = build();
    const created = await app.request("/sessions", send("POST", { model: "qwen" }));
    expect(created.status).toBe(201);
    const info = (await created.json()) as { id: string; kind: string; title: string };
    expect(info).toMatchObject({ kind: "chat", title: "" });

    const renamed = await app.request(`/sessions/${info.id}`, send("PATCH", { title: "  My chat  " }));
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { title: string }).title).toBe("My chat");

    const list = (await (await app.request("/sessions")).json()) as { id: string; title: string }[];
    expect(list).toMatchObject([{ id: info.id, title: "My chat" }]);

    expect((await app.request(`/sessions/${info.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await (await app.request("/sessions")).json()).toEqual([]);
  });

  it("pins a conversation and unpins it, without changing its title or when it was last active", async () => {
    const { app, sessions } = build();
    const chat = sessions.create({ model: "qwen" });
    const before = chat.info();
    const pinned = (await (await app.request(`/sessions/${chat.id}`, send("PATCH", { pinned: true }))).json()) as { pinned?: boolean; title: string; updated: number };
    expect(pinned).toMatchObject({ pinned: true, title: before.title, updated: before.updated });
    expect(((await (await app.request("/sessions")).json()) as { pinned?: boolean }[])[0]?.pinned).toBe(true);
    const unpinned = (await (await app.request(`/sessions/${chat.id}`, send("PATCH", { pinned: false }))).json()) as { pinned?: boolean };
    expect(unpinned.pinned).toBeUndefined();
  });

  it("refuses a rename with no title or a title that is too long, and for a conversation that does not exist", async () => {
    const { app, sessions } = build();
    const chat = sessions.create({ model: "qwen" });
    expect((await app.request(`/sessions/${chat.id}`, send("PATCH", { title: "   " }))).status).toBe(400);
    expect((await app.request(`/sessions/${chat.id}`, send("PATCH", { title: "x".repeat(121) }))).status).toBe(400);
    expect((await app.request(`/sessions/${chat.id}`, send("PATCH", {}))).status).toBe(400);
    expect((await app.request("/sessions/nope", send("PATCH", { title: "x" }))).status).toBe(404);
  });
});
