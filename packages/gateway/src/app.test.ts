import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import type { Heartbeat } from "@harness/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { ModelLoader } from "./loader.js";
import { createLibrary } from "./library.js";
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

  it("queues a message sent while a turn is running, and lets it be reworded, taken back or sent now", async () => {
    registry.upsert(beat({ roots: ["proj"], allowedTools: ["read_file"] }));
    // A model that never answers, until the turn is cancelled.
    const waiting = (_model: string, _messages: unknown, _tools: unknown, signal: AbortSignal) => {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(new Error("cancelled"));
        });
      });
    };
    const app = createApp({ registry, relay: relay as never, loader: { ensure: loaderEnsure }, sessions: new Sessions({ registry, relay: relay as never, complete: waiting as never }) });
    const { id } = (await (await post(app, "/sessions", { model: "qwen", device: "pc", root: "proj" })).json()) as { id: string };
    const patch = (path: string, body: unknown) => {
      return app.request(path, { ...json(body), method: "PATCH" });
    };

    expect((await post(app, `/sessions/${id}/messages`, { text: "first" })).status).toBe(202);
    const queued = await post(app, `/sessions/${id}/messages`, { text: "second" });
    expect(queued.status).toBe(202);
    const info = (await queued.json()) as { busy: boolean; queued: { id: string; text: string }[] };
    expect(info.busy).toBe(true);
    expect(info.queued.map((q) => {
      return q.text;
    })).toEqual(["second"]);
    const second = info.queued[0]!.id;

    const reworded = await patch(`/sessions/${id}/queue/${second}`, { text: "second, reworded" });
    expect(reworded.status).toBe(200);
    expect(((await reworded.json()) as { queued: { text: string }[] }).queued[0]?.text).toBe("second, reworded");
    expect((await patch(`/sessions/${id}/queue/${second}`, { text: "" })).status).toBe(400);
    expect((await patch(`/sessions/${id}/queue/nope`, { text: "x" })).status).toBe(404);

    const removed = await app.request(`/sessions/${id}/queue/${second}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { queued?: unknown }).queued).toBeUndefined();
    expect((await app.request(`/sessions/${id}/queue/${second}`, { method: "DELETE" })).status).toBe(404);

    const third = ((await (await post(app, `/sessions/${id}/messages`, { text: "third" })).json()) as { queued: { id: string }[] }).queued[0]!.id;
    expect((await post(app, `/sessions/${id}/queue/${third}/send`, {})).status).toBe(202);
    expect((await post(app, "/sessions/nope/queue/x/send", {})).status).toBe(404);
    await post(app, `/sessions/${id}/cancel`, {});
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

describe("importing and exporting conversations", () => {
  const post = (app: ReturnType<typeof build>, url: string, body: unknown) => {
    return app.request(url, json(body));
  };

  it("splits a pasted transcript for checking, saving nothing, and says plainly when a file is not understood", async () => {
    const app = build();
    const res = await post(app, "/import/parse", { name: "chat.md", content: "## User\n\nhi\n\n## Assistant\n\nhello" });
    expect(await res.json()).toMatchObject({ format: "headings", split: true, conversations: [{ turns: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }] }] });
    expect((await app.request("/sessions")).status).toBe(200);
    expect(await (await app.request("/sessions")).json()).toEqual([]);

    const bad = await post(app, "/import/parse", { name: "x.json", content: "{\"a\":1}" });
    expect(bad.status).toBe(422);
    expect((await post(app, "/import/parse", { content: "" })).status).toBe(400);
  });

  it("saves the turns as a conversation marked as imported, sends nothing to a model, and exports it again", async () => {
    const app = build();
    const res = await post(app, "/sessions/import", { title: "Sorting", source: "ChatGPT", turns: [{ role: "user", text: "How do I sort?" }, { role: "assistant", text: "Use sorted()." }] });
    expect(res.status).toBe(201);
    const info = await res.json() as { id: string; title: string; kind: string; model: string };
    expect(info).toMatchObject({ title: "Sorting", kind: "chat", model: "auto" });

    // The import marker and the two turns are stored as events; nothing was asked of a model.
    expect((await (await app.request("/sessions")).json() as { events: number }[])[0]?.events).toBe(3);

    const exported = await app.request(`/sessions/${info.id}/export`);
    expect(exported.headers.get("content-type")).toContain("text/markdown");
    expect(exported.headers.get("content-disposition")).toContain("Sorting.md");
    expect(await exported.text()).toBe("# Sorting\n\n## You\n\nHow do I sort?\n\n## Assistant\n\nUse sorted().\n");
    expect((await app.request("/sessions/nope/export")).status).toBe(404);
  });

  it("refuses an import with no turns", async () => {
    expect((await post(build(), "/sessions/import", { turns: [] })).status).toBe(400);
  });
});

describe("a project's instruction files, from a session", () => {
  const start = async () => {
    registry.upsert(beat({ roots: ["proj"], allowedTools: ["read_file"] }));
    const app = build();
    const code = await (await app.request("/sessions", json({ model: "qwen", device: "pc", root: "proj" }))).json() as { id: string };
    const chat = await (await app.request("/sessions", json({ model: "qwen" }))).json() as { id: string };
    relay.callTool.mockClear();
    const put = (id: string, name: string, body: unknown) => {
      return app.request(`/sessions/${id}/instructions/${name}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    };
    return { app, code: code.id, chat: chat.id, put };
  };

  it("lists the two files with whether each exists and how long it is, and says why one cannot be opened", async () => {
    const { app, code, chat } = await start();
    // The route asks for AGENTS.md first, then CLAUDE.md.
    relay.callTool.mockResolvedValueOnce({ ok: true, output: JSON.stringify({ name: "AGENTS.md", exists: true, text: "Use pnpm.", version: "1-9" }) });
    relay.callTool.mockResolvedValueOnce({ ok: false, output: "CLAUDE.md is too long to edit here (30000 characters); edit it on the device" });
    expect(await (await app.request(`/sessions/${code}/instructions`)).json()).toEqual([
      { name: "AGENTS.md", exists: true, length: 9 },
      { name: "CLAUDE.md", note: "CLAUDE.md is too long to edit here (30000 characters); edit it on the device" },
    ]);
    expect(relay.callTool).toHaveBeenCalledWith("pc", "proj", "read_instruction", { name: "AGENTS.md" }, expect.objectContaining({ session: code }));
    expect(await (await app.request(`/sessions/${chat}/instructions`)).json()).toEqual([]);
    expect((await app.request("/sessions/nope/instructions")).status).toBe(404);
  });

  it("gives one file's text and version", async () => {
    const { app, code } = await start();
    const file = { name: "AGENTS.md", exists: true, text: "Use pnpm.\n", version: "1-10" };
    relay.callTool.mockResolvedValue({ ok: true, output: JSON.stringify(file) });
    const res = await app.request(`/sessions/${code}/instructions/AGENTS.md`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(file);
    expect(relay.callTool).toHaveBeenCalledWith("pc", "proj", "read_instruction", { name: "AGENTS.md" }, expect.objectContaining({ session: code }));
  });

  it("never asks the device for any other name or path", async () => {
    const { app, code, put } = await start();
    for (const name of ["package.json", "agents.md", "..%2FAGENTS.md", "docs%2FAGENTS.md", "AGENTS.md%2F"]) {
      expect((await app.request(`/sessions/${code}/instructions/${name}`)).status, name).toBe(404);
      expect((await put(code, name, { text: "x", version: "absent" })).status, name).toBe(404);
    }
    expect(relay.callTool).not.toHaveBeenCalled();
  });

  it("has nothing to read or save in a conversation with no project folder", async () => {
    const { app, chat, put } = await start();
    expect((await app.request(`/sessions/${chat}/instructions/AGENTS.md`)).status).toBe(409);
    expect((await put(chat, "AGENTS.md", { text: "x", version: "absent" })).status).toBe(409);
    expect(relay.callTool).not.toHaveBeenCalled();
  });

  it("saves through the device, with the version it was opened at", async () => {
    const { code, put } = await start();
    relay.callTool.mockResolvedValue({ ok: true, output: JSON.stringify({ saved: true, version: "2-12", length: 12 }) });
    const res = await put(code, "AGENTS.md", { text: "Use pnpm.\nGo.", version: "1-10" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: true, version: "2-12", length: 12 });
    expect(relay.callTool).toHaveBeenCalledWith("pc", "proj", "write_instruction", { name: "AGENTS.md", text: "Use pnpm.\nGo.", version: "1-10" }, expect.objectContaining({ session: code }));
  });

  it("refuses a save over a file that changed, with 409 and the file's current version", async () => {
    const { code, put } = await start();
    relay.callTool.mockResolvedValue({ ok: true, output: JSON.stringify({ saved: false, conflict: true, message: "AGENTS.md changed on disk after you opened it; reload it to see what changed", version: "3-20" }) });
    const res = await put(code, "AGENTS.md", { text: "mine", version: "1-10" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { message: "AGENTS.md changed on disk after you opened it; reload it to see what changed" }, conflict: true, version: "3-20" });
  });

  it("refuses a save with no version or with text that is not text, without asking the device", async () => {
    const { code, put } = await start();
    expect((await put(code, "AGENTS.md", { text: "x" })).status).toBe(400);
    expect((await put(code, "AGENTS.md", { text: 5, version: "1-1" })).status).toBe(400);
    expect((await put(code, "AGENTS.md", { text: "x".repeat(20_001), version: "1-1" })).status).toBe(400);
    expect(relay.callTool).not.toHaveBeenCalled();
  });

  it("passes on text right up to the limit, which the device checks again for what escaping adds", async () => {
    const { code, put } = await start();
    relay.callTool.mockResolvedValue({ ok: true, output: JSON.stringify({ saved: true, version: "2-1", length: 20_000 }) });
    expect((await put(code, "AGENTS.md", { text: "x".repeat(20_000), version: "1-1" })).status).toBe(200);
  });

  it("says why the device refused: a read-only folder, a device that does not change files, an older agent, or nothing to reach", async () => {
    const { app, code, put } = await start();
    const read = () => {
      return app.request(`/sessions/${code}/instructions/AGENTS.md`);
    };
    const save = () => {
      return put(code, "AGENTS.md", { text: "x", version: "absent" });
    };

    relay.callTool.mockResolvedValue({ ok: false, output: "project root \"proj\" is read-only on this device, so write_instruction is not allowed there" });
    const locked = await save();
    expect(locked.status).toBe(403);
    expect(await locked.json()).toEqual({ error: { message: "project root \"proj\" is read-only on this device, so write_instruction is not allowed there" } });

    relay.callTool.mockResolvedValue({ ok: false, output: "tool \"write_instruction\" is not allowed on this device" });
    const refused = await save();
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { message: expect.stringContaining("does not let the agent change files") as string } });

    relay.callTool.mockResolvedValue({ ok: false, output: "error: unknown tool \"read_instruction\"" });
    const old = await read();
    expect(old.status).toBe(501);
    expect(await old.json()).toMatchObject({ error: { message: expect.stringContaining("older agent") as string } });

    relay.callTool.mockResolvedValue({ ok: false, output: "AGENTS.md is not a text file" });
    const odd = await read();
    expect(odd.status).toBe(502);
    expect(await odd.json()).toEqual({ error: { message: "AGENTS.md is not a text file" } });

    relay.callTool.mockRejectedValue(new Error("not connected"));
    const offline = await save();
    expect(offline.status).toBe(503);
    expect(await offline.json()).toEqual({ error: { message: "Could not reach the device, so nothing was saved: not connected" } });
    expect((await read()).status).toBe(503);
  });
});

describe("background tasks of a session", () => {
  it("lists what the device says the session has running, nothing for a chat, and stops them when the session is deleted", async () => {
    registry.upsert(beat({ roots: ["proj"], allowedTools: ["read_file"] }));
    const app = build();
    const code = await (await app.request("/sessions", json({ model: "qwen", device: "pc", root: "proj" }))).json() as { id: string };
    relay.callTool.mockResolvedValue({ ok: true, output: JSON.stringify([{ id: "t1", command: "pnpm dev", status: "running", startedAt: 1 }]) });
    expect(await (await app.request(`/sessions/${code.id}/tasks`)).json()).toEqual([{ id: "t1", command: "pnpm dev", status: "running", startedAt: 1 }]);
    expect(relay.callTool).toHaveBeenCalledWith("pc", "proj", "tasks_list", {}, expect.objectContaining({ session: code.id }));

    const chat = await (await app.request("/sessions", json({ model: "qwen" }))).json() as { id: string };
    expect(await (await app.request(`/sessions/${chat.id}/tasks`)).json()).toEqual([]);
    expect((await app.request("/sessions/nope/tasks")).status).toBe(404);

    relay.callTool.mockClear();
    expect((await app.request(`/sessions/${code.id}`, { method: "DELETE" })).status).toBe(200);
    expect(relay.callTool).toHaveBeenCalledWith("pc", "proj", "tasks_stop_all", {}, expect.objectContaining({ session: code.id }));
  });

  it("answers with no tasks when the device cannot be reached", async () => {
    registry.upsert(beat({ roots: ["proj"], allowedTools: ["read_file"] }));
    const app = build();
    const code = await (await app.request("/sessions", json({ model: "qwen", device: "pc", root: "proj" }))).json() as { id: string };
    relay.callTool.mockRejectedValue(new Error("not connected"));
    expect(await (await app.request(`/sessions/${code.id}/tasks`)).json()).toEqual([]);
  });
  it("clears the finished tasks through the device, and says so when the device's agent is too old", async () => {
    registry.upsert(beat({ roots: ["proj"], allowedTools: ["read_file"] }));
    const app = build();
    const code = await (await app.request("/sessions", json({ model: "qwen", device: "pc", root: "proj" }))).json() as { id: string };
    const clear = (id: string) => {
      return app.request(`/sessions/${id}/tasks/finished`, { method: "DELETE" });
    };
    relay.callTool.mockResolvedValue({ ok: true, output: "cleared 2 tasks" });
    const done = await clear(code.id);
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ cleared: 2 });
    expect(relay.callTool).toHaveBeenCalledWith("pc", "proj", "tasks_clear_finished", {}, expect.objectContaining({ session: code.id }));

    expect((await clear("nope")).status).toBe(404);
    const chat = await (await app.request("/sessions", json({ model: "qwen" }))).json() as { id: string };
    expect(await (await clear(chat.id)).json()).toEqual({ cleared: 0 });

    relay.callTool.mockResolvedValue({ ok: false, output: "error: unknown tool \"tasks_clear_finished\"" });
    const old = await clear(code.id);
    expect(old.status).toBe(501);
    expect(await old.json()).toMatchObject({ error: { message: expect.stringContaining("older agent") as string } });

    relay.callTool.mockRejectedValue(new Error("not connected"));
    expect(await (await clear(code.id)).json()).toEqual({ cleared: 0 });
  });

  it("clears the done steps of the plan, with nothing to clear for a session that has none", async () => {
    const app = build();
    const chat = await (await app.request("/sessions", json({ model: "qwen" }))).json() as { id: string };
    const res = await app.request(`/sessions/${chat.id}/plan/done`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cleared: 0 });
    expect((await app.request("/sessions/nope/plan/done", { method: "DELETE" })).status).toBe(404);
  });
});

describe("answering a question", () => {
  it("refuses an answer for a session or question that is not there, and an empty answer", async () => {
    registry.upsert(beat({ roots: ["proj"], allowedTools: ["read_file"] }));
    const app = build();
    expect((await app.request("/sessions/nope/questions/q", json({ answer: "yes" }))).status).toBe(404);
    const code = await (await app.request("/sessions", json({ model: "qwen", device: "pc", root: "proj" }))).json() as { id: string };
    expect((await app.request(`/sessions/${code.id}/questions/q`, json({ answer: "yes" }))).status).toBe(404);
    expect((await app.request(`/sessions/${code.id}/questions/q`, json({ answer: "  " }))).status).toBe(400);
  });
});

describe("the skill library routes", () => {
  const withLibrary = async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lib-routes-"));
    const app = createApp({ registry, relay: relay as never, loader: { ensure: loaderEnsure }, sessions: new Sessions({ registry, relay: relay as never, complete: (async () => {
      return { role: "assistant", content: "ok" };
    }) as never }), library: createLibrary(dir) });
    return { app, dir };
  };
  const skill = strToU8("---\nname: tdd\ndescription: Test first.\n---\n\nWrite the test.\n");
  const b64 = (bytes: Uint8Array): string => {
    return Buffer.from(bytes).toString("base64");
  };

  it("adds a skill from a zip or from files, lists it, exports it as a zip, and removes it", async () => {
    const { app, dir } = await withLibrary();
    try {
      const added = await app.request("/library/skills", json({ zip: b64(zipSync({ "SKILL.md": skill })) }));
      expect(added.status).toBe(201);
      expect(await added.json()).toMatchObject({ name: "tdd", files: 1 });
      expect(await (await app.request("/library/skills")).json()).toEqual([expect.objectContaining({ name: "tdd", description: "Test first." }) as unknown]);

      const exported = await app.request("/library/skills/tdd/export");
      expect(exported.headers.get("content-type")).toBe("application/zip");
      expect(exported.headers.get("content-disposition")).toContain("tdd.zip");
      expect(Object.keys(unzipSync(new Uint8Array(await exported.arrayBuffer())))).toEqual(["tdd/SKILL.md"]);

      expect((await app.request("/library/skills/tdd", { method: "DELETE" })).status).toBe(200);
      expect((await app.request("/library/skills/tdd", { method: "DELETE" })).status).toBe(404);
      expect((await app.request("/library/skills/tdd/export")).status).toBe(404);

      const files = await app.request("/library/skills", json({ files: [{ path: "folder/SKILL.md", data: b64(skill) }] }));
      expect(files.status).toBe(201);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("says why a skill was refused: a clash, a bad zip, an unsafe path, or a body that is neither zip nor files", async () => {
    const { app, dir } = await withLibrary();
    try {
      const zip = b64(zipSync({ "SKILL.md": skill }));
      expect((await app.request("/library/skills", json({ zip }))).status).toBe(201);
      const again = await app.request("/library/skills", json({ zip }));
      expect(again.status).toBe(409);
      expect(((await again.json()) as { error: { message: string } }).error.message).toContain("already has a skill");
      expect((await app.request("/library/skills", json({ zip, overwrite: true }))).status).toBe(201);

      const bad = await app.request("/library/skills", json({ zip: b64(strToU8("not a zip")) }));
      expect(bad.status).toBe(422);
      const unsafe = await app.request("/library/skills", json({ files: [{ path: "SKILL.md", data: b64(skill) }, { path: "../x", data: b64(skill) }] }));
      expect(unsafe.status).toBe(422);
      expect((await app.request("/library/skills", json({}))).status).toBe(400);
      expect((await app.request("/library/skills", json({ zip, files: [] }))).status).toBe(400);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("answers an empty list, and refuses additions, on a gateway with no library", async () => {
    expect(await (await build().request("/library/skills")).json()).toEqual([]);
    expect((await build().request("/library/skills", json({ zip: "AAAA" }))).status).toBe(404);
  });
});

describe("which device the browser is on", () => {
  const withProxy = (trustProxy: boolean) => {
    return createApp({ registry, relay: relay as never, loader: { ensure: loaderEnsure }, sessions: new Sessions({ registry, relay: relay as never, complete: (async () => {
      return { role: "assistant", content: "ok" };
    }) as never }), trustProxy });
  };

  it("lists the connected agents that connect from the caller address, and none when nothing matches", async () => {
    registry.upsert(beat({ nodeId: "anakin" }), "100.64.0.7");
    registry.upsert(beat({ nodeId: "bastila" }), "100.64.0.8");
    registry.upsert(beat({ nodeId: "nas", kind: "claude" }), "100.64.0.9");
    const app = withProxy(true);
    const at = async (forwarded: string) => {
      return await (await app.request("/whoami", { headers: { "x-forwarded-for": forwarded } })).json() as unknown;
    };
    expect(await at("100.64.0.7")).toMatchObject({ address: "100.64.0.7", devices: ["anakin"], likelyBehindPortPublishing: false });
    expect(await at("100.64.0.99")).toMatchObject({ devices: [] });
    // A container network address that matches nothing is probably port publishing hiding the real one.
    expect(await at("172.17.0.1")).toMatchObject({ devices: [], likelyBehindPortPublishing: true });
  });

  it("does not believe X-Forwarded-For unless told to", async () => {
    registry.upsert(beat({ nodeId: "anakin" }), "100.64.0.7");
    const res = await withProxy(false).request("/whoami", { headers: { "x-forwarded-for": "100.64.0.7" } });
    expect(await res.json()).toMatchObject({ devices: [] });
  });
});

describe("permission modes and remembered rules over HTTP", () => {
  const withRules = (allowBypass = true) => {
    const store = [{ id: 1, device: "pc", root: "proj", tool: "run_command", created: 1 }];
    const app = createApp({ registry, relay: relay as never, loader: { ensure: loaderEnsure }, sessions: new Sessions({ registry, relay: relay as never, allowBypass, complete: (async () => {
      return { role: "assistant", content: "ok" };
    }) as never }), rules: { list: () => {
      return store;
    }, remove: (id: number) => {
      const i = store.findIndex((r) => {
        return r.id === id;
      });
      if (i < 0) {
        return false;
      }
      store.splice(i, 1);
      return true;
    } } });
    return app;
  };
  const start = async (app: ReturnType<typeof withRules>, body: Record<string, unknown> = {}) => {
    registry.upsert(beat({ roots: ["proj"], allowedTools: ["read_file", "write_file"] }));
    return await (await app.request("/sessions", json({ model: "qwen", device: "pc", root: "proj", ...body }))).json() as { id: string; mode: string };
  };

  it("starts a conversation in ask mode, or the mode asked for, and changes it", async () => {
    const app = withRules();
    const first = await start(app);
    expect(first.mode).toBe("ask");
    const res = await app.request(`/sessions/${first.id}/mode`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "plan" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: "plan" });
    expect((await start(app, { mode: "edits" })).mode).toBe("edits");
    expect((await app.request(`/sessions/${first.id}/mode`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "nope" }) })).status).toBe(400);
    expect((await app.request("/sessions/missing/mode", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "ask" }) })).status).toBe(404);
  });

  it("refuses running without asking when the gateway has it turned off", async () => {
    const app = withRules(false);
    const s = await start(app);
    const res = await app.request(`/sessions/${s.id}/mode`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "bypass" }) });
    expect(res.status).toBe(403);
    registry.upsert(beat({ roots: ["proj"], allowedTools: ["read_file"] }));
    expect((await app.request("/sessions", json({ model: "qwen", device: "pc", root: "proj", mode: "bypass" }))).status).toBe(400);
  });

  it("lists the remembered rules and removes one", async () => {
    const app = withRules();
    expect(await (await app.request("/rules")).json()).toEqual([{ id: 1, device: "pc", root: "proj", tool: "run_command", created: 1 }]);
    expect((await app.request("/rules/1", { method: "DELETE" })).status).toBe(200);
    expect(await (await app.request("/rules")).json()).toEqual([]);
    expect((await app.request("/rules/1", { method: "DELETE" })).status).toBe(404);
  });

  it("answers an empty list on a gateway with no rule store", async () => {
    expect(await (await build().request("/rules")).json()).toEqual([]);
    expect((await build().request("/rules/1", { method: "DELETE" })).status).toBe(404);
  });
});

describe("collapsed sidebar groups over HTTP", () => {
  const put = (body: unknown) => {
    return { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  };

  it("lists, collapses and expands a project group", async () => {
    const store: { device: string; root: string }[] = [];
    const app = createApp({ registry, relay: relay as never, loader: { ensure: loaderEnsure }, sessions: new Sessions({ registry, relay: relay as never, complete: (async () => {
      return { role: "assistant", content: "ok" };
    }) as never }), groups: { list: () => {
      return store;
    }, set: (device, root, collapsed) => {
      const i = store.findIndex((g) => {
        return g.device === device && g.root === root;
      });
      if (collapsed && i < 0) {
        store.push({ device, root });
      } else if (!collapsed && i >= 0) {
        store.splice(i, 1);
      }
    } } });
    expect(await (await app.request("/sidebar/collapsed")).json()).toEqual([]);
    expect((await app.request("/sidebar/collapsed", put({ device: "pc", root: "proj", collapsed: true }))).status).toBe(200);
    expect(await (await app.request("/sidebar/collapsed")).json()).toEqual([{ device: "pc", root: "proj" }]);
    await app.request("/sidebar/collapsed", put({ device: "pc", root: "proj", collapsed: false }));
    expect(await (await app.request("/sidebar/collapsed")).json()).toEqual([]);
  });

  it("refuses a request that does not say which group", async () => {
    expect((await build().request("/sidebar/collapsed", put({ device: "pc" }))).status).toBe(400);
  });

  it("answers an empty list on a gateway with no group store", async () => {
    expect(await (await build().request("/sidebar/collapsed")).json()).toEqual([]);
  });
});

describe("which device the browser is on, behind a container network", () => {
  it("does not match when the caller and every device show as the container network's gateway", async () => {
    registry.upsert(beat({ nodeId: "anakin" }), "172.0.13.1");
    const app = createApp({ registry, relay: relay as never, loader: { ensure: loaderEnsure }, sessions: new Sessions({ registry, relay: relay as never, complete: (async () => {
      return { role: "assistant", content: "ok" };
    }) as never }), trustProxy: true, interfaces: () => {
      return [{ address: "172.0.13.5", netmask: "255.255.255.0", family: "IPv4", internal: false }];
    } });
    const res = await app.request("/whoami", { headers: { "x-forwarded-for": "172.0.13.1" } });
    expect(await res.json()).toEqual({ address: "172.0.13.1", devices: [], likelyBehindPortPublishing: true });
  });
});
