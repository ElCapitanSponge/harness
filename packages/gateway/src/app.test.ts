import type { Heartbeat } from "@harness/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { Registry } from "./registry.js";
import { Sessions } from "./sessions.js";

const beat = (over: Partial<Heartbeat> = {}): Heartbeat => ({
  nodeId: "pc",
  kind: "local",
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
let relay: { request: ReturnType<typeof vi.fn>; callTool: ReturnType<typeof vi.fn>; callClaude: ReturnType<typeof vi.fn> };

const build = (apiKey?: string) => createApp({ registry, apiKey, relay: relay as never, sessions: new Sessions({ registry, relay: relay as never, complete: (async () => ({ role: "assistant", content: "ok" })) as never }) });

beforeEach(() => {
  registry = new Registry();
  relay = {
    callClaude: vi.fn(async () => ({ ok: true, output: JSON.stringify({ text: "pong", model: "claude:sonnet" }) })),
    callTool: vi.fn(async () => ({ ok: true, output: "file contents" })), request: vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "hello" } }] }), { status: 200 })) };
});

describe("auth", () => {
  it("leaves routes open when no key is configured", async () => {
    expect((await build().request("/nodes")).status).toBe(200);
  });

  it("protects every route when a key is configured", async () => {
    const app = build("k");
    for (const [path, init] of [["/nodes", {}], ["/v1/models", {}], ["/v1/chat/completions", json(chat())]] as const) {
      expect((await app.request(path, init)).status).toBe(401);
    }
    expect((await app.request("/nodes", { headers: { authorization: "Bearer k" } })).status).toBe(200);
  });
});

describe("web page", () => {
  it("is served without a key so the key can be typed into it, while the API stays protected", async () => {
    const app = build("k");
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toContain("connect-src 'self'");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("Harness");
    expect(html).not.toContain("Bearer k");
    expect((await app.request("/v1/models")).status).toBe(401);
  });

  it("ships JavaScript that parses, since one typo would blank the whole page", async () => {
    const html = await (await build().request("/")).text();
    const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
    expect(script.length).toBeGreaterThan(1000);
    expect(() => new Function(script)).not.toThrow();
  });
});

describe("nodes", () => {
  it("lists the registered nodes", async () => {
    registry.upsert(beat());
    const nodes = (await (await build().request("/nodes")).json()) as { nodeId: string }[];
    expect(nodes.map((n) => n.nodeId)).toEqual(["pc"]);
  });

  it("no longer accepts heartbeats over HTTP; devices register through the tunnel", async () => {
    expect((await build().request("/nodes/heartbeat", json(beat()))).status).toBe(404);
  });
});

describe("device tools", () => {
  const call = (app: ReturnType<typeof build>, nodeId: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(`/devices/${nodeId}/tools`, json(body, headers));

  it("runs a tool on a connected device and returns its result", async () => {
    registry.upsert(beat());
    const res = await call(build(), "pc", { root: "proj", name: "read_file", args: { path: "a.txt" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, output: "file contents" });
    expect(relay.callTool).toHaveBeenCalledWith("pc", "proj", "read_file", { path: "a.txt" });
  });

  it("defaults args to an empty object", async () => {
    registry.upsert(beat());
    await call(build(), "pc", { root: "proj", name: "list_dir" });
    expect(relay.callTool).toHaveBeenCalledWith("pc", "proj", "list_dir", {});
  });

  it("returns 404 for a device that is not connected and 400 for a malformed body", async () => {
    expect((await call(build(), "ghost", { root: "proj", name: "list_dir" })).status).toBe(404);
    registry.upsert(beat());
    expect((await call(build(), "pc", { name: "list_dir" })).status).toBe(400);
  });

  it("returns 502 when the device fails", async () => {
    registry.upsert(beat());
    relay.callTool.mockRejectedValue(new Error("tunnel closed"));
    const res = await call(build(), "pc", { root: "proj", name: "list_dir" });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).toContain("tunnel closed");
  });

  it("requires the key", async () => {
    registry.upsert(beat());
    expect((await call(build("k"), "pc", { root: "proj", name: "list_dir" })).status).toBe(401);
    expect((await call(build("k"), "pc", { root: "proj", name: "list_dir" }, { authorization: "Bearer k" })).status).toBe(200);
  });
});

describe("session endpoints", () => {
  const post = (app: ReturnType<typeof build>, path: string, body: unknown) => app.request(path, json(body));

  it("creates a session, lists it, and rejects bad input, unknown devices and missing sessions", async () => {
    registry.upsert(beat({ roots: ["proj"], allowedTools: ["read_file"] }));
    const app = build();

    const created = await post(app, "/sessions", { model: "qwen", device: "pc", root: "proj" });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(((await (await app.request("/sessions")).json()) as { id: string }[]).map((s) => s.id)).toEqual([id]);

    expect((await post(app, "/sessions", { model: "qwen" })).status).toBe(400);
    expect((await post(app, "/sessions", { model: "qwen", device: "ghost", root: "proj" })).status).toBe(400);
    expect((await post(app, "/sessions/nope/messages", { text: "hi" })).status).toBe(404);
    expect((await post(app, `/sessions/${id}/messages`, { text: "" })).status).toBe(400);
    expect((await post(app, `/sessions/${id}/approvals/nope`, { approve: true })).status).toBe(404);
    expect((await post(app, `/sessions/${id}/cancel`, {})).status).toBe(200);
  });

  it("deletes a session, and returns 404 for one that does not exist", async () => {
    registry.upsert(beat({ roots: ["proj"], allowedTools: ["read_file"] }));
    const app = build();
    const { id } = (await (await post(app, "/sessions", { model: "qwen", device: "pc", root: "proj" })).json()) as { id: string };
    expect((await app.request(`/sessions/${id}`, { method: "DELETE" })).status).toBe(200);
    expect(((await (await app.request("/sessions")).json()) as unknown[]).length).toBe(0);
    expect((await app.request(`/sessions/${id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("requires the key", async () => {
    expect((await build("k").request("/sessions")).status).toBe(401);
    expect((await post(build("k"), "/sessions/x/cancel", {})).status).toBe(401);
  });
});

describe("/v1/models", () => {
  it("lists loaded local models but not unloaded ones", async () => {
    registry.upsert(beat());
    const body = (await (await build().request("/v1/models")).json()) as { data: { id: string; owned_by: string }[] };
    const ids = body.data.map((m) => m.id);
    expect(ids).toContain("qwen");
    expect(ids).not.toContain("idle-model");
    expect(body.data.find((m) => m.id === "qwen")?.owned_by).toBe("pc");
  });

  it("lists the Claude models only while a device that is logged in to Claude is connected", async () => {
    registry.upsert(beat());
    const without = (await (await build().request("/v1/models")).json()) as { data: { id: string }[] };
    expect(without.data.map((m) => m.id)).not.toContain("claude");

    registry.upsert(beat({ nodeId: "mac", claude: true }));
    const withDevice = (await (await build().request("/v1/models")).json()) as { data: { id: string; owned_by: string }[] };
    expect(withDevice.data.map((m) => m.id)).toEqual(expect.arrayContaining(["claude", "claude:sonnet", "claude:opus", "claude:haiku"]));
    expect(withDevice.data.find((m) => m.id === "claude")?.owned_by).toBe("mac");
  });
});

describe("chat: local routing", () => {
  it("forwards to the node with the resolved model, tools and extra fields intact", async () => {
    registry.upsert(beat());
    const tools = [{ type: "function", function: { name: "read_file" } }];
    const res = await build().request("/v1/chat/completions", json(chat({ tools, top_p: 0.3 })));

    expect(res.status).toBe(200);
    expect(res.headers.get("x-harness-node")).toBe("pc");
    expect(relay.request).toHaveBeenCalledTimes(1);
    const [nodeId, body] = relay.request.mock.calls[0] as unknown as [string, string];
    expect(nodeId).toBe("pc");
    expect(JSON.parse(body)).toMatchObject({ model: "qwen", tools, top_p: 0.3 });
  });

  it("passes through the upstream status, content type and stream", async () => {
    registry.upsert(beat());
    relay.request.mockResolvedValue(new Response("data: x\n\ndata: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }));
    const res = await build().request("/v1/chat/completions", json(chat({ stream: true })));
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toContain("[DONE]");
  });

  it("returns 503 when no idle node has the model, including when the only node is busy", async () => {
    const app = build();
    expect((await app.request("/v1/chat/completions", json(chat()))).status).toBe(503);
    registry.upsert(beat({ busy: true, busyReason: "game running: cs2.exe" }));
    expect((await app.request("/v1/chat/completions", json(chat()))).status).toBe(503);
    expect(relay.request).not.toHaveBeenCalled();
  });

  it("returns 502 with the node name when the node cannot be reached", async () => {
    registry.upsert(beat());
    relay.request.mockRejectedValue(new Error("tunnel closed"));
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
  beforeEach(() => {
    registry.upsert(beat({ nodeId: "mac", claude: true, models: [] }));
  });

  it("answers with an OpenAI-style completion, relayed to the device that is logged in", async () => {
    const res = await build().request("/v1/chat/completions", json(chat({ model: "claude:sonnet" })));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-harness-node")).toBe("mac");
    expect(((await res.json()) as { choices: { message: { content: string } }[] }).choices[0]?.message.content).toBe("pong");
    expect(relay.callClaude).toHaveBeenCalledWith("mac", expect.stringContaining('"model":"claude:sonnet"'));
    expect(relay.request).not.toHaveBeenCalled();
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
    expect(relay.callClaude).not.toHaveBeenCalled();
  });

  it("returns 502 with the reason when Claude fails on the device", async () => {
    relay.callClaude.mockResolvedValue({ ok: false, output: "Not logged in" });
    const res = await build().request("/v1/chat/completions", json(chat({ model: "claude" })));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).toContain("Not logged in");
  });

  it("returns 502 when the device drops mid-request", async () => {
    relay.callClaude.mockRejectedValue(new Error("tunnel closed"));
    expect((await build().request("/v1/chat/completions", json(chat({ model: "claude" })))).status).toBe(502);
  });

  it("returns 503 explaining what to do when no device serves Claude", async () => {
    registry.remove("mac");
    const res = await build().request("/v1/chat/completions", json(chat({ model: "claude" })));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).toContain("CLAUDE_ENABLED=1");
    expect(relay.callClaude).not.toHaveBeenCalled();
  });
});
