import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { ModelInfo } from "@harness/core";
import { getRequestListener } from "@hono/node-server";
import { afterEach, describe, expect, it } from "vitest";
import { createChatServer } from "../../node-agent/src/chat.js";
import { createClaudeServer, type ClaudeServer } from "../../node-agent/src/claude.js";
import { createModelServer, type ModelServer } from "../../node-agent/src/models.js";
import { createToolServer, type ToolServer } from "../../node-agent/src/toolserver.js";
import { connectTunnel } from "../../node-agent/src/tunnel.js";
import { createApp } from "./app.js";
import { ModelLoader } from "./loader.js";
import { Registry } from "./registry.js";
import { Relay } from "./relay.js";
import { Sessions, createCompleter } from "./sessions.js";
import { attachTunnel } from "./tunnel.js";

// A real gateway, a real node agent and a fake LM Studio, all on loopback: the device exposes nothing inbound.
let gateway: Server | undefined;
let lmstudio: Server | undefined;
let tunnelHandle: { close(): void } | undefined;
let attached: { close(): void } | undefined;

const listen = (server: Server): Promise<number> => {
  return new Promise((resolve) => {
    return server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
};

afterEach(async () => {
  tunnelHandle?.close();
  attached?.close();
  lmstudio?.closeAllConnections();
  gateway?.closeAllConnections();
  await Promise.all([new Promise((r) => {
    return lmstudio?.close(r);
  }), new Promise((r) => {
    return gateway?.close(r);
  })]);
});

const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !check(); i++) {
    await new Promise((r) => {
      return setTimeout(r, 10);
    });
  }
  expect(check()).toBe(true);
};

const setup = async (opts: {
  apiKey?: string;
  handler: Parameters<typeof createServer>[1];
  tools?: ToolServer;
  claude?: ClaudeServer;
  // The device's model server and what it currently reports, for scenarios where the gateway has to load a model.
  models?: ModelServer;
  modelList?: () => ModelInfo[];
}) => {
  lmstudio = createServer(opts.handler);
  const lmPort = await listen(lmstudio);

  const registry = new Registry();
  const relay = new Relay();
  const loader = new ModelLoader({ registry, relay });
  const app = createApp({ registry, relay, loader, sessions: new Sessions({ registry, relay, complete: createCompleter({ registry, relay, loader }) }), apiKey: opts.apiKey });
  // The same adapter the real gateway uses, so streamed responses behave as they do in production.
  const listener = getRequestListener(app.fetch);
  gateway = createServer((req, res) => {
    void listener(req, res);
  });
  attached = attachTunnel(gateway, { registry, relay, apiKey: opts.apiKey });
  const gwPort = await listen(gateway);

  tunnelHandle = connectTunnel({
    gatewayUrl: `http://127.0.0.1:${gwPort}`,
    apiKey: opts.apiKey,
    intervalMs: 50,
    heartbeat: async () => {
      return { nodeId: "pc", kind: "local", busy: false, models: opts.modelList?.() ?? [{ id: "qwen", loaded: true }], modelControl: opts.models ? true : undefined, roots: opts.tools?.rootNames(), allowedTools: opts.tools?.allowedNames(), claude: opts.claude ? true : undefined };
    },
    tools: opts.tools,
    claude: opts.claude,
    models: opts.models,
    chat: createChatServer({ inferenceUrl: `http://127.0.0.1:${lmPort}` }),
  });
  await until(() => {
    return registry.live().length === 1;
  });
  return { gwPort };
};

describe("tools run on the device through the tunnel", () => {
  it("reads a file in the device's project root over the gateway, and refuses what it did not expose", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-e2e-"));
    await fs.writeFile(path.join(root, "hello.txt"), "hi from the device\n");
    try {
      const { gwPort } = await setup({
        handler: () => {
          return undefined;
        },
        tools: createToolServer({ roots: { proj: root }, allowed: ["read_file", "list_dir"] }),
      });
      const call = async (body: unknown) => {
        const res = await fetch(`http://127.0.0.1:${gwPort}/devices/pc/tools`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        return { status: res.status, body: (await res.json()) as { ok: boolean; output: string } };
      };

      expect(await call({ root: "proj", name: "read_file", args: { path: "hello.txt" } })).toEqual({
        status: 200,
        body: { ok: true, output: "1\thi from the device\n2\t" },
      });
      // Changes are refused at the gateway too: this endpoint is for looking, sessions are for changing.
      expect((await call({ root: "proj", name: "write_file", args: { path: "x", content: "y" } })).status).toBe(403);
      expect((await call({ root: "proj", name: "read_file", args: { path: "../../etc/passwd" } })).body.ok).toBe(false);
      expect((await call({ root: "nope", name: "list_dir" })).body.ok).toBe(false);
      await expect(fs.access(path.join(root, "x"))).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("a coding session over the tunnel", () => {
  it("drives a model on one device to read a file on the device that owns it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-session-"));
    await fs.writeFile(path.join(root, "hello.txt"), "hi from the device");
    const requests: { messages: { role: string; content?: string }[]; tools?: unknown[] }[] = [];
    try {
      const { gwPort } = await setup({
        tools: createToolServer({ roots: { proj: root }, allowed: ["read_file", "list_dir"] }),
        handler: (req, res) => {
          let body = "";
          req.on("data", (c: Buffer) => {
            body += c.toString();
          });
          req.on("end", () => {
            requests.push(JSON.parse(body) as (typeof requests)[number]);
            const message
              = requests.length === 1
                ? { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "hello.txt" }) } }] }
                : { role: "assistant", content: "The file greets you." };
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ choices: [{ message }] }));
          });
        },
      });
      const api = (p: string, init?: RequestInit) => {
        return fetch(`http://127.0.0.1:${gwPort}${p}`, init);
      };
      const post = (p: string, body: unknown) => {
        return api(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      };

      const created = await post("/sessions", { model: "qwen", device: "pc", root: "proj" });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      expect((await post(`/sessions/${id}/messages`, { text: "what does hello.txt say?" })).status).toBe(202);

      const events = await api(`/sessions/${id}/events`);
      const reader = events.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (!text.includes("\"type\":\"done\"")) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        text += decoder.decode(chunk.value);
      }
      await reader.cancel();

      // Stages are live progress, not part of the conversation.
      const types = [...text.matchAll(/"type":"(\w+)"/g)].map((m) => {
        return m[1];
      }).filter((t) => {
        return t !== "stage";
      });
      expect(types).toEqual(["user", "tool", "text", "done"]);
      expect(text).toContain("The file greets you.");
      // The second model call saw the file contents that were read on the device.
      expect(JSON.stringify(requests[1]?.messages)).toContain("hi from the device");
      // The model was only offered the read-only tools this device allows.
      expect(((requests[0]?.tools ?? []) as { function: { name: string } }[]).map((t) => {
        return t.function.name;
      }).sort()).toEqual(["ask", "list_dir", "plan", "read_file"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("approvals over the tunnel", () => {
  // A model that always asks to write notes.txt, then says it is finished once it has seen a tool result.
  const writerModel: Parameters<typeof createServer>[1] = (req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c.toString();
    });
    req.on("end", () => {
      const sawResult = (JSON.parse(body) as { messages: { role: string }[] }).messages.some((m) => {
        return m.role === "tool";
      });
      const message = sawResult
        ? { role: "assistant", content: "All done." }
        : {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "w1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "notes.txt", content: "written on the device" }) } }],
          };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message }] }));
    });
  };

  const run = async (decide: boolean): Promise<{ root: string; types: string[] }> => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-approval-"));
    const { gwPort } = await setup({
      tools: createToolServer({ roots: { proj: root }, allowed: ["read_file", "write_file"] }),
      handler: writerModel,
    });
    const api = (p: string, init?: RequestInit) => {
      return fetch(`http://127.0.0.1:${gwPort}${p}`, init);
    };
    const post = (p: string, body: unknown) => {
      return api(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    };

    const { id } = (await (await post("/sessions", { model: "qwen", device: "pc", root: "proj" })).json()) as { id: string };
    await post(`/sessions/${id}/messages`, { text: "write the notes" });

    const reader = (await api(`/sessions/${id}/events`)).body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let answered = false;
    while (!text.includes("\"type\":\"done\"")) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      text += decoder.decode(chunk.value);
      const ask = /"type":"approval","id":"([^"]+)"/.exec(text);
      if (ask && !answered) {
        answered = true;
        // The file must not exist while the approval is still pending.
        await expect(fs.access(path.join(root, "notes.txt"))).rejects.toThrow();
        await post(`/sessions/${id}/approvals/${ask[1]}`, { approve: decide });
      }
    }
    await reader.cancel();
    return { root, types: [...text.matchAll(/"type":"([a-z-]+)"/g)].map((m) => {
      return m[1]!;
    }).filter((t) => {
      return t !== "stage";
    }) };
  };

  it("writes the file on the device only after it is approved", async () => {
    const { root, types } = await run(true);
    try {
      expect(types).toEqual(["user", "tool", "approval", "approval-resolved", "change", "text", "done"]);
      expect(await fs.readFile(path.join(root, "notes.txt"), "utf8")).toBe("written on the device");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("leaves the device untouched and ends the turn when it is declined", async () => {
    const { root, types } = await run(false);
    try {
      expect(types).toEqual(["user", "tool", "approval", "approval-resolved", "done"]);
      await expect(fs.access(path.join(root, "notes.txt"))).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("Claude served by a device over the tunnel", () => {
  it("answers a Claude chat through the gateway by running the CLI on the device, with no CLI on the gateway", async () => {
    const asked: string[] = [];
    const { gwPort } = await setup({
      handler: () => {
        return undefined;
      },
      claude: createClaudeServer({
        bin: "claude",
        run: async (_bin, req) => {
          asked.push(req.model);
          return { text: "pong from the device", model: "claude-sonnet" };
        },
      }),
    });

    const models = (await (await fetch(`http://127.0.0.1:${gwPort}/v1/models`)).json()) as { data: { id: string; owned_by: string }[] };
    expect(models.data.find((m) => {
      return m.id === "claude:sonnet";
    })?.owned_by).toBe("pc");

    const res = await fetch(`http://127.0.0.1:${gwPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "claude:sonnet", messages: [{ role: "user", content: "ping" }] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-harness-node")).toBe("pc");
    expect(JSON.stringify(await res.json())).toContain("pong from the device");
    expect(asked).toEqual(["claude:sonnet"]);
  });

  it("offers no Claude models and returns 503 when no device serves it", async () => {
    const { gwPort } = await setup({ handler: () => {
      return undefined;
    } });
    const models = (await (await fetch(`http://127.0.0.1:${gwPort}/v1/models`)).json()) as { data: { id: string }[] };
    expect(models.data.map((m) => {
      return m.id;
    })).not.toContain("claude");
    const res = await fetch(`http://127.0.0.1:${gwPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "claude", messages: [{ role: "user", content: "ping" }] }),
    });
    expect(res.status).toBe(503);
  });
});

describe("a model that is not loaded", () => {
  it("is loaded on the device when a chat asks for it, making room first, and then answers", async () => {
    const state: ModelInfo[] = [
      { id: "small", loaded: true },
      { id: "big", loaded: false, contextLength: 262_144 },
    ];
    const calls: string[] = [];
    const flip = (id: string, loaded: boolean): void => {
      for (const m of state) {
        if (m.id === id) {
          m.loaded = loaded;
        }
      }
    };
    const served: string[] = [];
    const { gwPort } = await setup({
      modelList: () => {
        return state.map((m) => {
          return { ...m };
        });
      },
      models: createModelServer({
        enabled: true,
        isBusy: () => {
          return Promise.resolve(false);
        },
        lms: {
          serverStart: () => {
            return Promise.resolve("started");
          },
          load: (model, ctx) => {
            calls.push(`load ${model}@${ctx}`);
            flip(model, true);
            return Promise.resolve(`loaded ${model}`);
          },
          unload: (model) => {
            calls.push(`unload ${model}`);
            flip(model ?? "", false);
            return Promise.resolve("unloaded");
          },
        },
      }),
      handler: (req, res) => {
        let body = "";
        req.on("data", (c: Buffer) => {
          body += c.toString();
        });
        req.on("end", () => {
          served.push((JSON.parse(body) as { model: string }).model);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "hello from big" } }] }));
        });
      },
    });

    const catalogue = (await (await fetch(`http://127.0.0.1:${gwPort}/catalogue`)).json()) as { models: { id: string; state: string }[] };
    expect(catalogue.models.map((m) => {
      return `${m.id}:${m.state}`;
    })).toEqual(["small:loaded", "big:loads-on-use"]);

    const res = await fetch(`http://127.0.0.1:${gwPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "big", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain("hello from big");
    // It made room, loaded with a sensible context length rather than the model's enormous maximum, then served the request.
    expect(calls).toEqual(["unload small", "load big@32768"]);
    expect(served).toEqual(["big"]);
  });

  it("explains how to enable loading when the device does not allow it", async () => {
    const state: ModelInfo[] = [{ id: "big", loaded: false }];
    const { gwPort } = await setup({
      handler: () => {
        // Nothing should reach the model server.
      },
      modelList: () => {
        return state;
      },
    });
    const res = await fetch(`http://127.0.0.1:${gwPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "big", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).toContain("ALLOW_MODEL_CONTROL=1");
  });
});

describe("chat relayed through the tunnel", () => {
  it("answers a chat through the gateway with no inbound connection to the device", async () => {
    const seen: string[] = [];
    const { gwPort } = await setup({
      apiKey: "k",
      handler: (req, res) => {
        let body = "";
        req.on("data", (c: Buffer) => {
          body += c.toString();
        });
        req.on("end", () => {
          seen.push(`${req.method} ${req.url} ${body}`);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "hello from the device" } }] }));
        });
      },
    });

    const res = await fetch(`http://127.0.0.1:${gwPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer k" },
      body: JSON.stringify({ model: "auto", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-harness-node")).toBe("pc");
    expect(JSON.stringify(await res.json())).toContain("hello from the device");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("POST /v1/chat/completions");
    expect(seen[0]).toContain("\"model\":\"qwen\"");
  });

  it("streams server-sent events through to the caller", async () => {
    const { gwPort } = await setup({
      handler: (_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: {\"choices\":[{\"delta\":{\"content\":\"one \"}}]}\n\n");
        setTimeout(() => {
          res.write("data: {\"choices\":[{\"delta\":{\"content\":\"two\"}}]}\n\n");
          res.end("data: [DONE]\n\n");
        }, 30);
      },
    });

    const res = await fetch(`http://127.0.0.1:${gwPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "qwen", stream: true, messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const text = await res.text();
    expect(text).toContain("\"content\":\"one \"");
    expect(text).toContain("\"content\":\"two\"");
    expect(text).toContain("[DONE]");
  });

  it("passes the model server's error status through", async () => {
    const { gwPort } = await setup({
      handler: (_req, res) => {
        res.writeHead(400, { "content-type": "application/json" });
        res.end("{\"error\":{\"message\":\"context too long\"}}");
      },
    });
    const res = await fetch(`http://127.0.0.1:${gwPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "qwen", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("context too long");
  });

  it("returns a 502 naming the node when its model server is down", async () => {
    const { gwPort } = await setup({ handler: () => {
      return undefined;
    } });
    await new Promise((r) => {
      return lmstudio?.close(r);
    });
    lmstudio?.closeAllConnections();
    const res = await fetch(`http://127.0.0.1:${gwPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "qwen", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("node pc is unreachable");
  });
});
