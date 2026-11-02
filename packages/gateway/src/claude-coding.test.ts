import type { Heartbeat } from "@harness/core";
import { describe, expect, it, vi } from "vitest";
import { Registry } from "./registry.js";
import type { Relay } from "./relay.js";
import { Sessions, createCompleter, type Session } from "./sessions.js";
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

const pool = (): Registry => {
  const registry = new Registry();
  registry.upsert({ nodeId: "pc", kind: "local", busy: false, roots: ["proj"], allowedTools: ["read_file"], claude: true, models: [{ id: "gpt-oss-20b", loaded: true }, { id: "qwen", loaded: true }] } satisfies Heartbeat);
  return registry;
};

const reply = (value: object) => {
  return Promise.resolve({ ok: true, output: JSON.stringify(value) });
};

describe("Claude driving a coding session", () => {
  it("asks for a tool, gets the result from the device, and answers from it", async () => {
    const registry = pool();
    const sent: { tools?: { function: { name: string } }[]; messages: { role: string }[] }[] = [];
    const callClaude = vi.fn((_node: string, body: string) => {
      const request = JSON.parse(body) as (typeof sent)[number];
      sent.push(request);
      // First it asks to read a file; once it has the result, it answers.
      if (request.messages.some((m) => {
        return m.role === "tool";
      })) {
        return reply({ text: "The package is called harness.", model: "claude" });
      }
      return reply({ text: "Looking.", model: "claude", toolCalls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"package.json\"}" } }] });
    });
    const callTool = vi.fn(() => {
      return Promise.resolve({ ok: true, output: "{\"name\":\"harness\"}" });
    });
    const complete = createCompleter({ registry, relay: { request: vi.fn(), callClaude }, loader: { ensure: vi.fn() } });
    const sessions = new Sessions({ registry, relay: { callTool }, complete });

    const code = sessions.create({ model: "claude", device: "pc", root: "proj" });
    code.send("what is the package called?");
    await until(() => {
      return types(code).includes("done");
    });

    expect(types(code)).toEqual(["user", "text", "tool", "text", "done"]);
    expect(callTool).toHaveBeenCalledWith("pc", "proj", "read_file", { path: "package.json" }, expect.anything());
    // Claude was offered the tools, and saw the result of the call it asked for.
    expect(sent[0]?.tools?.map((t) => {
      return t.function.name;
    })).toEqual(["read_file", "plan", "ask"]);
    expect(sent[1]?.messages.map((m) => {
      return m.role;
    })).toEqual(["system", "user", "assistant", "tool"]);
    expect(code.events.at(-2)).toMatchObject({ type: "text", text: "The package is called harness.", model: "claude" });
  });
});

describe("the effort a model is asked to use", () => {
  it("goes to Claude as an option, to a model that can be told as reasoning effort, and to no other", async () => {
    const registry = pool();
    const callClaude = vi.fn<Relay["callClaude"]>(() => {
      return reply({ text: "ok", model: "claude" });
    });
    const request = vi.fn<Relay["request"]>(() => {
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }), { headers: { "content-type": "application/json" } }));
    });
    const sessions = new Sessions({ registry, relay: { callTool: vi.fn() }, complete: createCompleter({ registry, relay: { request, callClaude }, loader: { ensure: vi.fn() } }) });
    const chat = sessions.create({ model: "claude" });
    const say = async (text: string, model?: string, effort?: "default" | "low" | "high" | "max"): Promise<void> => {
      const before = chat.events.length;
      chat.send(text, model, effort);
      await until(() => {
        return !chat.busy && chat.events.length > before;
      });
    };

    await say("a", undefined, "max");
    expect(JSON.parse(callClaude.mock.calls[0]?.[1] ?? "{}")).toMatchObject({ effort: "max" });

    // gpt-oss stops at high, so max becomes high; the setting stays "max" for the conversation.
    await say("b", "gpt-oss-20b");
    expect(JSON.parse(request.mock.calls[0]?.[1] ?? "{}")).toMatchObject({ reasoning_effort: "high" });
    expect(chat.info().effort).toBe("max");

    // A model that cannot be told is not sent one.
    await say("c", "qwen");
    expect(JSON.parse(request.mock.calls[1]?.[1] ?? "{}")).not.toHaveProperty("reasoning_effort");

    // "default" puts it back.
    await say("d", "claude", "default");
    expect(JSON.parse(callClaude.mock.calls[1]?.[1] ?? "{}") as { effort?: string }).not.toHaveProperty("effort");
    expect(chat.info().effort).toBeUndefined();
  });

  it("is remembered with the conversation across a restart", async () => {
    const registry = pool();
    const store = sqliteStore(openDatabase(":memory:"));
    const complete = vi.fn(() => {
      return Promise.resolve({ role: "assistant" as const, content: "ok" });
    });
    const first = new Sessions({ registry, relay: { callTool: vi.fn() }, complete, store });
    const chat = first.create({ model: "qwen" });
    chat.send("hello", undefined, "high");
    await until(() => {
      return !chat.busy && store.loadAll()[0]?.effort === "high";
    });
    const back = new Sessions({ registry, relay: { callTool: vi.fn() }, complete, store, stored: store.loadAll() }).get(chat.id);
    expect(back?.effort).toBe("high");
    expect(back?.info().effort).toBe("high");
  });
});
