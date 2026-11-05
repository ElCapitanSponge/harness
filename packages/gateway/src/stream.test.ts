import type { ChatMessage, Heartbeat, SessionEvent } from "@harness/core";
import { isLiveEvent } from "@harness/core";
import { describe, expect, it, vi } from "vitest";
import { Registry } from "./registry.js";
import { Sessions, assembleStream, createCompleter, type Complete } from "./sessions.js";
import "./event-matchers.js";

const LF = String.fromCharCode(10);
const sse = (...chunks: unknown[]): Response => {
  return new Response(chunks.map((c) => {
    return `data: ${typeof c === "string" ? c : JSON.stringify(c)}${LF}${LF}`;
  }).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
};
const delta = (d: object) => {
  return { choices: [{ index: 0, delta: d }] };
};

describe("assembleStream", () => {
  it("joins the answer and reports each piece as it arrives", async () => {
    const texts: string[] = [];
    const message = await assembleStream(sse(delta({ content: "Hel" }), delta({ content: "lo" }), "[DONE]"), { text: (p) => {
      return texts.push(p);
    } });
    expect(message).toEqual({ role: "assistant", content: "Hello" });
    expect(texts).toEqual(["Hel", "lo"]);
  });

  it("keeps the reasoning separate from the answer, under either field name", async () => {
    const thoughts: string[] = [];
    const message = await assembleStream(
      sse(delta({ reasoning_content: "think " }), delta({ reasoning: "more" }), delta({ content: "done" })),
      { thinking: (p) => {
        return thoughts.push(p);
      } },
    );
    expect(message).toMatchObject({ content: "done", reasoning_content: "think more" });
    expect(thoughts).toEqual(["think ", "more"]);
  });

  it("assembles a tool call whose arguments arrive in pieces", async () => {
    const message = await assembleStream(
      sse(
        delta({ tool_calls: [{ index: 0, id: "call_1", function: { name: "read_file", arguments: "" } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: "{\"path\":" } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: "\"a.txt\"}" } }] }),
      ),
    );
    expect(message.tool_calls).toEqual([{ id: "call_1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"a.txt\"}" } }]);
    expect(message.content).toBe("");
  });

  it("assembles several tool calls by index, and a call that arrives whole in one chunk", async () => {
    const message = await assembleStream(
      sse(
        delta({
          tool_calls: [
            { index: 0, id: "a", function: { name: "list_dir", arguments: "{}" } },
            { index: 1, id: "b", function: { name: "read_file", arguments: "{\"path\":\"x\"}" } },
          ],
        }),
      ),
    );
    expect(message.tool_calls?.map((c) => {
      return [c.id, c.function.name, c.function.arguments];
    })).toEqual([
      ["a", "list_dir", "{}"],
      ["b", "read_file", "{\"path\":\"x\"}"],
    ]);
  });

  it("gives a tool call an id when the model sends none", async () => {
    const message = await assembleStream(sse(delta({ tool_calls: [{ index: 0, function: { name: "list_dir", arguments: "{}" } }] })));
    expect(message.tool_calls?.[0]?.id).toBeTruthy();
  });

  it("ignores malformed chunks, stops at an error chunk, and refuses an empty reply", async () => {
    expect((await assembleStream(sse("not json", delta({ content: "ok" })))).content).toBe("ok");
    await expect(assembleStream(sse(delta({ content: "partial" }), { error: { message: "model crashed" } }))).rejects.toThrow("model crashed");
    await expect(assembleStream(sse(delta({})))).rejects.toThrow("no message");
  });
});

describe("createCompleter", () => {
  const registry = new Registry();
  registry.upsert({ nodeId: "pc", kind: "local", busy: false, models: [{ id: "qwen", loaded: true }] } satisfies Heartbeat);
  const complete = (relay: { request: ReturnType<typeof vi.fn> }) => {
    return createCompleter({ registry, relay: relay as never, loader: { ensure: vi.fn() } });
  };
  const signal = new AbortController().signal;

  it("asks the device for a stream and returns the finished message", async () => {
    const relay = { request: vi.fn(async () => {
      return sse(delta({ content: "hi" }));
    }) };
    const message = await complete(relay)("qwen", [{ role: "user", content: "x" }], [], signal);
    expect(message.content).toBe("hi");
    expect(JSON.parse((relay.request.mock.calls[0] as unknown as [string, string])[1])).toMatchObject({ model: "qwen", stream: true });
  });

  it("still works with a server that answers in one piece, and reports its errors", async () => {
    const json = { request: vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "whole" } }] }));
    }) };
    expect((await complete(json)("qwen", [{ role: "user", content: "x" }], [], signal)).content).toBe("whole");

    const bad = { request: vi.fn(async () => {
      return new Response(JSON.stringify({ error: { message: "context too long" } }), { status: 400 });
    }) };
    await expect(complete(bad)("qwen", [{ role: "user", content: "x" }], [], signal)).rejects.toThrow("context too long");
  });
});

describe("live events in a session", () => {
  const beat: Heartbeat = { nodeId: "pc", kind: "local", busy: false, models: [{ id: "qwen", loaded: true }], roots: ["proj"], allowedTools: ["read_file"] };
  const until = async (check: () => boolean): Promise<void> => {
    for (let i = 0; i < 200 && !check(); i++) {
      await new Promise((r) => {
        return setTimeout(r, 5);
      });
    }
    expect(check()).toBe(true);
  };

  const setup = () => {
    const registry = new Registry();
    registry.upsert(beat);
    const relay = { callTool: vi.fn(async () => {
      return { ok: true, output: "x" };
    }) };
    const complete = vi.fn<Complete>(async (_m, _msgs, _t, _s, hooks) => {
      hooks?.thinking?.("let me ");
      hooks?.thinking?.("think");
      hooks?.text?.("The ");
      hooks?.text?.("answer");
      return { role: "assistant", content: "The answer", reasoning_content: "let me think" };
    });
    const sessions = new Sessions({ registry, relay: relay, complete: complete });
    return sessions.create({ model: "qwen", device: "pc", root: "proj" });
  };

  it("delivers thinking and text pieces to a watcher while the model writes, but does not store them", async () => {
    const s = setup();
    const seen: string[] = [];
    s.subscribe((e) => {
      return seen.push(e.type);
    });
    s.send("hi");
    await until(() => {
      return seen.includes("done");
    });

    expect(seen).toEqual(["user", "thinking-delta", "thinking-delta", "text-delta", "text-delta", "thinking", "text", "done"]);
    // What is stored, and replayed to anyone who joins later, has only the finished events.
    expect(s.events.map((e) => {
      return e.type;
    })).toEqual(["user", "thinking", "text", "done"]);
    expect(s.events.some(isLiveEvent)).toBe(false);
    expect(s.events[1]).toEqualEvents({ type: "thinking", text: "let me think" });
  });

  it("replays only stored events to a late watcher", async () => {
    const s = setup();
    s.send("hi");
    await until(() => {
      return !s.busy;
    });
    const late: SessionEvent[] = [];
    s.subscribe((e) => {
      return late.push(e as SessionEvent);
    });
    expect(late.map((e) => {
      return e.type;
    })).toEqual(["user", "thinking", "text", "done"]);
  });

  it("does not send the model's reasoning back to it on the next call", async () => {
    const registry = new Registry();
    registry.upsert(beat);
    const seen: ChatMessage[][] = [];
    const complete = vi.fn<Complete>(async (_m, msgs) => {
      seen.push([...msgs]);
      return { role: "assistant", content: "ok", reasoning_content: "secret thoughts" };
    });
    const sessions = new Sessions({ registry, relay: { callTool: vi.fn() }, complete: complete });
    const s = sessions.create({ model: "qwen", device: "pc", root: "proj" });
    s.send("one");
    await until(() => {
      return !s.busy;
    });
    s.send("two");
    await until(() => {
      return !s.busy;
    });
    expect(JSON.stringify(seen[1])).not.toContain("secret thoughts");
  });

  it("shortens very long reasoning in what is stored", async () => {
    const registry = new Registry();
    registry.upsert(beat);
    const complete = vi.fn<Complete>(async () => {
      return { role: "assistant", content: "ok", reasoning_content: "x".repeat(20_000) };
    });
    const s = new Sessions({ registry, relay: { callTool: vi.fn() }, complete: complete }).create({ model: "qwen", device: "pc", root: "proj" });
    s.send("go");
    await until(() => {
      return !s.busy;
    });
    const stored = s.events.find((e) => {
      return e.type === "thinking";
    })!;
    expect(stored.text.length).toBeLessThan(6100);
    expect(stored.text).toContain("shortened");
  });
});
