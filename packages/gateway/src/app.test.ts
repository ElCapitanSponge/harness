import type { Heartbeat } from "@harness/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { Registry } from "./registry.js";

const beat = (over: Partial<Heartbeat> = {}): Heartbeat => ({
  nodeId: "pc",
  kind: "local",
  baseUrl: "http://pc:1234",
  busy: false,
  models: [{ id: "qwen", loaded: true }, { id: "idle-model", loaded: false }],
  ...over,
});

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

const chat = (over: Record<string, unknown> = {}) => ({ model: "auto", messages: [{ role: "user", content: "hi" }], ...over });

let registry: Registry;
let claude: ReturnType<typeof vi.fn>;
let upstream: ReturnType<typeof vi.fn>;

const build = (apiKey?: string) => createApp({ registry, apiKey, claude: claude as never, fetchImpl: upstream as unknown as typeof fetch });

beforeEach(() => {
  registry = new Registry();
  claude = vi.fn().mockResolvedValue({ text: "pong", model: "claude:sonnet" });
  upstream = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "hello" } }] }), { status: 200 }));
});

describe("auth", () => {
  it("leaves routes open when no key is configured", async () => {
    expect((await build().request("/nodes")).status).toBe(200);
  });

  it("protects every route when a key is configured", async () => {
    const app = build("k");
    for (const [path, init] of [["/nodes", {}], ["/v1/models", {}], ["/nodes/heartbeat", json(beat())], ["/v1/chat/completions", json(chat())]] as const) {
      expect((await app.request(path, init)).status).toBe(401);
    }
    expect((await app.request("/nodes", { headers: { authorization: "Bearer k" } })).status).toBe(200);
  });
});

describe("heartbeat and nodes", () => {
  it("registers a node that then shows up in /nodes", async () => {
    const app = build();
    expect((await app.request("/nodes/heartbeat", json(beat()))).status).toBe(200);
    const nodes = (await (await app.request("/nodes")).json()) as { nodeId: string }[];
    expect(nodes.map((n) => n.nodeId)).toEqual(["pc"]);
  });

  it("rejects malformed heartbeats and non-JSON bodies with 400", async () => {
    const app = build();
    expect((await app.request("/nodes/heartbeat", json({ nodeId: "x" }))).status).toBe(400);
    expect((await app.request("/nodes/heartbeat", { method: "POST", body: "not json" })).status).toBe(400);
  });
});

describe("/v1/models", () => {
  it("lists loaded local models and the Claude models, but not unloaded ones", async () => {
    registry.upsert(beat());
    const body = (await (await build().request("/v1/models")).json()) as { data: { id: string; owned_by: string }[] };
    const ids = body.data.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["qwen", "claude", "claude:sonnet"]));
    expect(ids).not.toContain("idle-model");
    expect(body.data.find((m) => m.id === "qwen")?.owned_by).toBe("pc");
  });
});

describe("chat: local routing", () => {
  it("forwards to the node with the resolved model, tools and extra fields intact", async () => {
    registry.upsert(beat());
    const tools = [{ type: "function", function: { name: "read_file" } }];
    const res = await build().request("/v1/chat/completions", json(chat({ tools, top_p: 0.3 })));

    expect(res.status).toBe(200);
    expect(res.headers.get("x-harness-node")).toBe("pc");
    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, init] = upstream.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("http://pc:1234/v1/chat/completions");
    expect(JSON.parse(init.body)).toMatchObject({ model: "qwen", tools, top_p: 0.3 });
  });

  it("passes through the upstream status, content type and stream", async () => {
    registry.upsert(beat());
    upstream.mockResolvedValue(new Response("data: x\n\ndata: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }));
    const res = await build().request("/v1/chat/completions", json(chat({ stream: true })));
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toContain("[DONE]");
  });

  it("returns 503 when no idle node has the model, including when the only node is busy", async () => {
    const app = build();
    expect((await app.request("/v1/chat/completions", json(chat()))).status).toBe(503);
    registry.upsert(beat({ busy: true, busyReason: "game running: cs2.exe" }));
    expect((await app.request("/v1/chat/completions", json(chat()))).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("returns 502 with the node name when the node cannot be reached", async () => {
    registry.upsert(beat());
    upstream.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const res = await build().request("/v1/chat/completions", json(chat()));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).toContain("node pc is unreachable");
  });

  it("returns 400 for invalid chat bodies", async () => {
    const app = build();
    expect((await app.request("/v1/chat/completions", json({ model: "auto", messages: [] }))).status).toBe(400);
    expect((await app.request("/v1/chat/completions", { method: "POST", body: "nope" })).status).toBe(400);
  });
});

describe("chat: Claude routing", () => {
  it("answers with an OpenAI-style completion", async () => {
    const res = await build().request("/v1/chat/completions", json(chat({ model: "claude:sonnet" })));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-harness-node")).toBe("claude");
    expect(((await res.json()) as { choices: { message: { content: string } }[] }).choices[0]?.message.content).toBe("pong");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("streams as SSE when asked", async () => {
    const res = await build().request("/v1/chat/completions", json(chat({ model: "claude", stream: true })));
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const text = await res.text();
    expect(text).toContain('"content":"pong"');
    expect(text).toContain("data: [DONE]");
  });

  it("refuses client-side tools with a pointer to harness code", async () => {
    const tools = [{ type: "function", function: { name: "t" } }];
    const res = await build().request("/v1/chat/completions", json(chat({ model: "claude", tools })));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("harness code");
    expect(claude).not.toHaveBeenCalled();
  });

  it("returns 502 with the reason when Claude fails", async () => {
    claude.mockRejectedValue(new Error("Not logged in"));
    const res = await build().request("/v1/chat/completions", json(chat({ model: "claude" })));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).toContain("Not logged in");
  });
});
