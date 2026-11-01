import { describe, expect, it, vi } from "vitest";
import { Gateway, sseData } from "./api.js";
import { loadArgs, unloadArgs } from "./lms.js";

const respond = (body: unknown, init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}) =>
  vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    headers: new Headers(init.headers),
  }) as unknown as typeof fetch;

describe("Gateway.chat", () => {
  const msgs = [{ role: "user" as const, content: "hi" }];

  it("returns the text, model and serving node", async () => {
    const f = respond({ model: "qwen", choices: [{ message: { content: "hello" } }] }, { headers: { "x-harness-node": "anakin" } });
    await expect(new Gateway("http://g", f).chat("auto", msgs)).resolves.toEqual({ text: "hello", model: "qwen", node: "anakin" });
  });

  it("surfaces the gateway's error message", async () => {
    const f = respond({ error: { message: "no idle node" } }, { ok: false, status: 503 });
    await expect(new Gateway("http://g", f).chat("auto", msgs)).rejects.toThrow("no idle node");
  });

  it("falls back to the status code when the error body is empty", async () => {
    const f = respond({}, { ok: false, status: 500 });
    await expect(new Gateway("http://g", f).chat("auto", msgs)).rejects.toThrow("500");
  });

  it("throws when a successful response has no completion", async () => {
    await expect(new Gateway("http://g", respond({ choices: [] })).chat("auto", msgs)).rejects.toThrow("no completion");
  });
});

describe("Gateway.complete", () => {
  const msgs = [{ role: "user" as const, content: "hi" }];
  const tool = { type: "function" as const, function: { name: "read_file" } };

  it("sends tools and returns the whole assistant message including tool calls", async () => {
    const toolCalls = [{ id: "1", type: "function", function: { name: "read_file", arguments: "{}" } }];
    const f = respond({ model: "m", choices: [{ message: { role: "assistant", content: null, tool_calls: toolCalls } }] }, { headers: { "x-harness-node": "pc" } });
    const out = await new Gateway("http://g", f).complete("auto", msgs, [tool]);
    expect(out.message.tool_calls).toEqual(toolCalls);
    expect(out.node).toBe("pc");
    expect(JSON.parse((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1].body)).toMatchObject({ tools: [tool] });
  });

  it("leaves tools out of the request when there are none", async () => {
    const f = respond({ choices: [{ message: { role: "assistant", content: "x" } }] });
    await new Gateway("http://g", f).complete("auto", msgs, []);
    expect(JSON.parse((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1].body)).not.toHaveProperty("tools");
  });

  it("throws on a 401 and when no message comes back", async () => {
    await expect(new Gateway("http://g", respond({}, { ok: false, status: 401 })).complete("auto", msgs)).rejects.toThrow("API key");
    await expect(new Gateway("http://g", respond({ choices: [] })).complete("auto", msgs)).rejects.toThrow("no completion");
  });
});

describe("Gateway auth", () => {
  it("sends the bearer key on nodes and chat requests", async () => {
    const f = respond([]);
    const g = new Gateway("http://g", f, "k");
    await g.nodes();
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1].headers).toEqual({ authorization: "Bearer k" });

    const f2 = respond({ choices: [{ message: { content: "x" } }] });
    await new Gateway("http://g", f2, "k").chat("auto", [{ role: "user", content: "hi" }]);
    expect((f2 as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1].headers).toMatchObject({ authorization: "Bearer k" });
  });

  it("explains a 401 from nodes", async () => {
    await expect(new Gateway("http://g", respond({}, { ok: false, status: 401 })).nodes()).rejects.toThrow("API key");
  });
});

describe("Gateway.nodes", () => {
  it("returns the node list", async () => {
    const nodes = [{ nodeId: "pc" }];
    await expect(new Gateway("http://g", respond(nodes)).nodes()).resolves.toEqual(nodes);
  });

  it("throws on a failed response", async () => {
    await expect(new Gateway("http://g", respond([], { ok: false, status: 502 })).nodes()).rejects.toThrow("502");
  });
});

describe("lms arguments", () => {
  it("builds load args with an optional context length", () => {
    expect(loadArgs("m")).toEqual(["load", "m", "-y"]);
    expect(loadArgs("m", 32768)).toEqual(["load", "m", "-y", "-c", "32768"]);
  });

  it("unloads one model or all", () => {
    expect(unloadArgs("m")).toEqual(["unload", "m"]);
    expect(unloadArgs()).toEqual(["unload", "--all"]);
  });
});

describe("sseData", () => {
  const body = (...parts: string[]): ReadableStream<Uint8Array> =>
    new ReadableStream({
      start(c) {
        for (const p of parts) c.enqueue(new TextEncoder().encode(p));
        c.close();
      },
    });
  const collect = async (stream: ReadableStream<Uint8Array>): Promise<string[]> => {
    const out: string[] = [];
    for await (const d of sseData(stream)) out.push(d);
    return out;
  };

  it("yields each data payload, across chunk boundaries, ignoring comments", async () => {
    const lf = String.fromCharCode(10);
    const frame = (text: string) => text + lf + lf;
    const out = await collect(body(frame('data: {"a":1}'), ": keepalive" + lf + lf + 'data: {"b"', ":2}" + lf + lf));
    expect(out).toEqual(['{"a":1}', '{"b":2}']);
  });
});

describe("Gateway sessions", () => {
  const sse = (...events: unknown[]) =>
    new Response(events.map((e) => "data: " + JSON.stringify(e) + String.fromCharCode(10, 10)).join(""), { headers: { "content-type": "text/event-stream" } });

  it("creates a session, sends a message and cancels, with the key as a header", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "s1", model: "qwen", device: "pc", root: "proj", busy: false, events: 0 }), { status: 201 }));
    const g = new Gateway("http://g", f as unknown as typeof fetch, "k");
    expect((await g.createSession({ model: "qwen", device: "pc", root: "proj" })).id).toBe("s1");
    await g.sendMessage("s1", "hi");
    await g.cancelSession("s1");
    const calls = f.mock.calls as unknown as [string, { headers: Record<string, string>; body: string }][];
    expect(calls.map((c) => c[0])).toEqual(["http://g/sessions", "http://g/sessions/s1/messages", "http://g/sessions/s1/cancel"]);
    expect(calls[0]![1].headers.authorization).toBe("Bearer k");
    expect(JSON.parse(calls[1]![1].body)).toEqual({ text: "hi" });
  });

  it("surfaces the gateway's error when a session cannot be created", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'device "x" is not connected' } }), { status: 400 }));
    await expect(new Gateway("http://g", f as unknown as typeof fetch).createSession({ model: "m", device: "x", root: "r" })).rejects.toThrow("not connected");
  });

  it("streams session events from an index", async () => {
    const f = vi.fn(async () => sse({ type: "text", text: "hello" }, { type: "done", stopped: false }));
    const seen: string[] = [];
    for await (const e of new Gateway("http://g", f as unknown as typeof fetch).sessionEvents("s1", 3)) seen.push(e.type);
    expect(seen).toEqual(["text", "done"]);
    expect((f.mock.calls as unknown as [string][])[0]![0]).toBe("http://g/sessions/s1/events?from=3");
  });
});
