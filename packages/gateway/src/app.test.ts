import type { Heartbeat } from "@harness/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { ModelLoader } from "./loader.js";
import { Registry } from "./registry.js";
import { Sessions } from "./sessions.js";

const beat = (over: Partial<Heartbeat> = {}): Heartbeat => {
  return {
    nodeId: "pc",
    kind: "local",
    busy: false,
    models: [{ id: "qwen", loaded: true }, { id: "idle-model", loaded: false }],
    ...over,
  };
};

const json = (body: unknown, headers: Record<string, string> = {}) => {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
};

const chat = (over: Record<string, unknown> = {}) => {
  return { model: "auto", messages: [{ role: "user", content: "hi" }], ...over };
};

let registry: Registry;
const loaderEnsure = vi.fn<ModelLoader["ensure"]>();
let relay: { request: ReturnType<typeof vi.fn>; callTool: ReturnType<typeof vi.fn>; callClaude: ReturnType<typeof vi.fn>; callModel: ReturnType<typeof vi.fn> };

const build = (apiKey?: string) => {
  return createApp({ registry, apiKey, relay: relay as never, loader: { ensure: loaderEnsure }, sessions: new Sessions({ registry, relay: relay as never, complete: (async () => {
    return { role: "assistant", content: "ok" };
  }) as never }) });
};

beforeEach(() => {
  loaderEnsure.mockReset();
  loaderEnsure.mockResolvedValue(undefined);
  registry = new Registry();
  relay = {
    callModel: vi.fn(async () => {
      return { ok: true, output: "loaded qwen" };
    }),
    callClaude: vi.fn(async () => {
      return { ok: true, output: JSON.stringify({ text: "pong", model: "claude:sonnet" }) };
    }),
    callTool: vi.fn(async () => {
      return { ok: true, output: "file contents" };
    }), request: vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "hello" } }] }), { status: 200 });
    }) };
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

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- compiling the page's script without running it is the whole test
      return new Function(script);
    }).not.toThrow();
  });
});

describe("nodes", () => {
  it("lists the registered nodes", async () => {
    registry.upsert(beat());
    const nodes = (await (await build().request("/nodes")).json()) as { nodeId: string }[];
    expect(nodes.map((n) => {
      return n.nodeId;
    })).toEqual(["pc"]);
  });

  it("no longer accepts heartbeats over HTTP; devices register through the tunnel", async () => {
    expect((await build().request("/nodes/heartbeat", json(beat()))).status).toBe(404);
  });
});

describe("device tools", () => {
  const call = (app: ReturnType<typeof build>, nodeId: string, body: unknown, headers: Record<string, string> = {}) => {
    return app.request(`/devices/${nodeId}/tools`, json(body, headers));
  };

  it("runs a tool on a connected device and returns its result", async () => {
    registry.upsert(beat());
    const res = await call(build(), "pc", { root: "proj", name: "read_file", args: { path: "a.txt" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, output: "file contents" });
    expect(relay.callTool).toHaveBeenCalledWith("pc", "proj", "read_file", { path: "a.txt" });
  });

  it("refuses tools that change things or run commands, and tools that do not exist, without asking the device", async () => {
    registry.upsert(beat());
    for (const name of ["write_file", "edit_file", "run_command", "nope"]) {
      expect((await call(build(), "pc", { root: "proj", name, args: {} })).status).toBe(403);
    }
    expect(relay.callTool).not.toHaveBeenCalled();
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

describe("device model control", () => {
  const post = (app: ReturnType<typeof build>, path: string, body: unknown, headers: Record<string, string> = {}) => {
    return app.request(path, json(body, headers));
  };

  it("loads and unloads a model on a device that allows it", async () => {
    registry.upsert(beat({ modelControl: true }));
    const app = build();
    const loaded = await post(app, "/devices/pc/models/load", { model: "qwen", contextLength: 32768 });
    expect(loaded.status).toBe(200);
    expect(await loaded.json()).toEqual({ ok: true, output: "loaded qwen" });
    expect(relay.callModel).toHaveBeenCalledWith("pc", "load", "qwen", 32768);

    expect((await post(app, "/devices/pc/models/unload", {})).status).toBe(200);
    expect(relay.callModel).toHaveBeenLastCalledWith("pc", "unload", undefined, undefined);
  });

  it("refuses a device that has not switched it on, without contacting it", async () => {
    registry.upsert(beat());
    const res = await post(build(), "/devices/pc/models/load", { model: "qwen" });
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toContain("ALLOW_MODEL_CONTROL=1");
    expect(relay.callModel).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown device, 400 for a bad body, 502 when the device fails", async () => {
    expect((await post(build(), "/devices/ghost/models/load", { model: "qwen" })).status).toBe(404);
    registry.upsert(beat({ modelControl: true }));
    expect((await post(build(), "/devices/pc/models/load", {})).status).toBe(400);
    relay.callModel.mockRejectedValue(new Error("tunnel closed"));
    expect((await post(build(), "/devices/pc/models/load", { model: "qwen" })).status).toBe(502);
  });

  it("requires the key", async () => {
    registry.upsert(beat({ modelControl: true }));
    expect((await post(build("k"), "/devices/pc/models/load", { model: "qwen" })).status).toBe(401);
  });
});

describe("session endpoints", () => {
  const post = (app: ReturnType<typeof build>, path: string, body: unknown) => {
    return app.request(path, json(body));
  };

  it("creates a session, lists it, and rejects bad input, unknown devices and missing sessions", async () => {
    registry.upsert(beat({ roots: ["proj"], allowedTools: ["read_file"] }));
    const app = build();

    const created = await post(app, "/sessions", { model: "qwen", device: "pc", root: "proj" });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(((await (await app.request("/sessions")).json()) as { id: string }[]).map((s) => {
      return s.id;
    })).toEqual([id]);

    // A model alone is a chat. A device without a project root, or a root without a device, is a mistake.
    expect((await post(app, "/sessions", {})).status).toBe(400);
    expect((await post(app, "/sessions", { model: "qwen", device: "pc" })).status).toBe(400);
    expect((await post(app, "/sessions", { model: "qwen", root: "proj" })).status).toBe(400);
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
    const ids = body.data.map((m) => {
      return m.id;
    });
    expect(ids).toContain("qwen");
    expect(ids).not.toContain("idle-model");
    expect(body.data.find((m) => {
      return m.id === "qwen";
    })?.owned_by).toBe("pc");
  });

  it("lists the Claude models only while a device that is logged in to Claude is connected", async () => {
    registry.upsert(beat());
    const without = (await (await build().request("/v1/models")).json()) as { data: { id: string }[] };
    expect(without.data.map((m) => {
      return m.id;
    })).not.toContain("claude");

    registry.upsert(beat({ nodeId: "mac", claude: true }));
    const withDevice = (await (await build().request("/v1/models")).json()) as { data: { id: string; owned_by: string }[] };
    expect(withDevice.data.map((m) => {
      return m.id;
    })).toEqual(expect.arrayContaining(["claude", "claude:sonnet", "claude:opus", "claude:haiku"]));
    expect(withDevice.data.find((m) => {
      return m.id === "claude";
    })?.owned_by).toBe("mac");
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
    expect(relay.callClaude).toHaveBeenCalledWith("mac", expect.stringContaining("\"model\":\"claude:sonnet\""));
    expect(relay.request).not.toHaveBeenCalled();
  });

  it("streams as SSE when asked", async () => {
    const res = await build().request("/v1/chat/completions", json(chat({ model: "claude", stream: true })));
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const text = await res.text();
    expect(text).toContain("\"content\":\"pong\"");
    expect(text).toContain("data: [DONE]");
  });

  it("passes the tools on, and returns the tool calls Claude asks for in the standard form", async () => {
    const tools = [{ type: "function", function: { name: "read_file" } }];
    relay.callClaude.mockResolvedValue({ ok: true, output: JSON.stringify({ text: "", model: "claude", toolCalls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: "{}" } }] }) });
    const res = await build().request("/v1/chat/completions", json(chat({ model: "claude", tools })));
    expect(res.status).toBe(200);
    expect(JSON.parse(relay.callClaude.mock.calls[0]?.[1] as string)).toMatchObject({ tools });
    const body = (await res.json()) as { choices: { finish_reason: string; message: { tool_calls: { id: string }[] } }[] };
    expect(body.choices[0]?.finish_reason).toBe("tool_calls");
    expect(body.choices[0]?.message.tool_calls[0]?.id).toBe("call_1");
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

describe("catalogue and loading on demand", () => {
  const idle = (over: Partial<Heartbeat> = {}): Heartbeat => {
    return beat({ modelControl: true, models: [{ id: "qwen", loaded: true }, { id: "idle-model", loaded: false, contextLength: 8192 }], ...over });
  };

  it("lists every model on every device, with what choosing it does, and whether Claude is available", async () => {
    registry.upsert(idle());
    registry.upsert(beat({ nodeId: "mac", claude: true, models: [] }));
    const res = await build().request("/catalogue");
    const body = (await res.json()) as { models: { id: string; device: string; state: string }[]; claude: { available: boolean; device?: string; models: string[] } };
    expect(body.models.map((m) => {
      return `${m.device}:${m.id}:${m.state}`;
    })).toEqual(["pc:qwen:loaded", "pc:idle-model:loads-on-use"]);
    expect(body.claude).toMatchObject({ available: true, device: "mac" });
    expect(body.claude.models).toContain("claude:sonnet");
  });

  it("says Claude is unavailable when no device serves it", async () => {
    registry.upsert(idle());
    const body = (await (await build().request("/catalogue")).json()) as { claude: { available: boolean; models: string[] } };
    expect(body.claude).toMatchObject({ available: false, models: [] });
  });

  it("requires the key", async () => {
    expect((await build("k").request("/catalogue")).status).toBe(401);
  });

  it("loads a model that is available but not loaded, then answers with it", async () => {
    registry.upsert(idle());
    const res = await build().request("/v1/chat/completions", json(chat({ model: "idle-model" })));
    expect(res.status).toBe(200);
    expect(loaderEnsure).toHaveBeenCalledTimes(1);
    expect(loaderEnsure.mock.calls[0]?.[0]).toMatchObject({ model: "idle-model" });
    const [nodeId, body] = relay.request.mock.calls[0] as unknown as [string, string];
    expect(nodeId).toBe("pc");
    expect(JSON.parse(body)).toMatchObject({ model: "idle-model" });
  });

  it("does not load anything for a model that is already loaded", async () => {
    registry.upsert(idle());
    await build().request("/v1/chat/completions", json(chat({ model: "qwen" })));
    expect(loaderEnsure).not.toHaveBeenCalled();
  });

  it("answers 502 with the reason when the load fails, without sending the request on", async () => {
    registry.upsert(idle());
    loaderEnsure.mockRejectedValue(new Error("pc could not load idle-model: not enough memory"));
    const res = await build().request("/v1/chat/completions", json(chat({ model: "idle-model" })));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).toContain("not enough memory");
    expect(relay.request).not.toHaveBeenCalled();
  });

  it("answers 503 and says how to enable loading when the device does not allow it", async () => {
    registry.upsert(idle({ modelControl: false }));
    const res = await build().request("/v1/chat/completions", json(chat({ model: "idle-model" })));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).toContain("ALLOW_MODEL_CONTROL=1");
    expect(loaderEnsure).not.toHaveBeenCalled();
  });
});

describe("skills", () => {
  it("lists the skills and instruction files each device finds in each folder, without the instruction text", async () => {
    registry.upsert(beat({ roots: ["proj"] }));
    relay.callTool.mockResolvedValue({ ok: true, output: JSON.stringify({ instructions: [{ source: "AGENTS.md", text: "Use pnpm." }], skills: [{ name: "tdd", description: "Test first.", length: 900, modelInvocable: true, source: "user" }], skipped: [{ path: "x/SKILL.md", reason: "no front matter" }] }) });
    const res = await build().request("/skills");
    expect(await res.json()).toEqual([{ device: "pc", root: "proj", skills: [expect.objectContaining({ name: "tdd", length: 900 }) as unknown], skipped: [{ path: "x/SKILL.md", reason: "no front matter" }], instructions: [{ source: "AGENTS.md", length: 9 }] }]);
    expect(relay.callTool).toHaveBeenCalledWith("pc", "proj", "project_context", {}, expect.anything());
  });

  it("narrows to one folder, and lists a device that cannot answer with a note instead of failing", async () => {
    registry.upsert(beat({ roots: ["proj"] }));
    relay.callTool.mockResolvedValue({ ok: false, output: "tool \"project_context\" is not allowed on this device" });
    expect(await (await build().request("/skills?device=pc&root=proj")).json()).toEqual([expect.objectContaining({ device: "pc", root: "proj", skills: [], note: expect.stringContaining("not allowed") as string }) as unknown]);
    expect(await (await build().request("/skills?device=other")).json()).toEqual([]);
  });
});
