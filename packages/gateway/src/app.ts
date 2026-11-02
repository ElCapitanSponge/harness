import { toOpenAIResponse, toSse } from "@harness/claude";
import { ChatRequest, DeviceToolRequest, ModelLoad, ModelUnload, ImportParse, SessionApproval, SessionCreate, SessionImport, SessionMessage, SessionRename, flattenError } from "@harness/core";
import { findTool, type ProjectContext } from "@harness/tools";
import { Hono, type Context } from "hono";
import { bearerAuth } from "./auth.js";
import type { Registry } from "./registry.js";
import type { Relay } from "./relay.js";
import type { ModelLoader } from "./loader.js";
import { CLAUDE_MODEL_IDS, catalogue, isClaudeModel } from "./router.js";
import { RouteError, resolveRoute } from "./routing.js";
import type { UsageLedger } from "./ledger.js";
import { ClaudeState, ClaudeUnavailableError, askClaude } from "./claude.js";
import type { Sessions } from "./sessions.js";
import { parseImportFile, toMarkdown } from "./transcripts.js";
import { WEB_PAGE } from "./web.js";

export interface AppDeps {
  registry: Registry;
  apiKey?: string;
  relay: Pick<Relay, "request" | "callTool" | "callClaude" | "callModel" | "callSettings">;
  sessions: Sessions;
  // Every model call, for the usage routes. Without it the routes report nothing.
  ledger?: UsageLedger;
  // What is known of the Claude plan: its windows, and whether Claude is limited right now.
  claude?: ClaudeState;
  loader: Pick<ModelLoader, "ensure">;
  // Mounts the built web app. Without it the page is the single-file one in web.ts.
  mountWeb?: (app: Hono) => void;
}

export const createApp = ({ registry, apiKey, relay, sessions, ledger, claude = new ClaudeState(), loader, mountWeb }: AppDeps): Hono => {
  const app = new Hono();

  // The page holds no secrets and must load before a key can be typed, so it is registered ahead of the auth middleware.
  if (mountWeb) {
    mountWeb(app);
  } else {
    app.get("/", (c) => {
      return c.html(WEB_PAGE, 200, {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      });
    });
  }

  if (apiKey) {
    app.use("*", bearerAuth(apiKey));
  }

  app.get("/nodes", (c) => {
    return c.json(registry.live());
  });

  // Runs one read-only tool on a connected device. The device also decides which roots and tools it allows.
  app.post("/devices/:nodeId/tools", async (c) => {
    const parsed = DeviceToolRequest.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    // Changes go through a coding session, where they wait for an approval. This endpoint is for looking around.
    const spec = findTool(parsed.data.name);
    if (!spec || spec.needsApproval) {
      return c.json({ error: { message: `"${parsed.data.name}" is not a read-only tool; start a coding session to make changes` } }, 403);
    }
    const nodeId = c.req.param("nodeId");
    if (!registry.live().some((n) => {
      return n.nodeId === nodeId;
    })) {
      return c.json({ error: { message: `device "${nodeId}" is not connected` } }, 404);
    }
    try {
      return c.json(await relay.callTool(nodeId, parsed.data.root, parsed.data.name, parsed.data.args));
    } catch (err) {
      return c.json({ error: { message: `device ${nodeId} failed: ${(err as Error).message}` } }, 502);
    }
  });

  // Loads or unloads a model in a device's LM Studio. The device must have switched this on.
  const modelControl = (op: "load" | "unload") => {
    return async (c: Context) => {
      const parsed = (op === "load" ? ModelLoad : ModelUnload).safeParse(await c.req.json().catch(() => {
        return undefined;
      }));
      if (!parsed.success) {
        return c.json({ error: flattenError(parsed.error) }, 400);
      }
      const nodeId = c.req.param("nodeId") ?? "";
      const node = registry.live().find((n) => {
        return n.nodeId === nodeId;
      });
      if (!node) {
        return c.json({ error: { message: `device "${nodeId}" is not connected` } }, 404);
      }
      if (!node.modelControl) {
        return c.json({ error: { message: `device "${nodeId}" does not allow remote model control (start its agent with ALLOW_MODEL_CONTROL=1)` } }, 403);
      }
      const input = parsed.data as { model?: string; contextLength?: number };
      try {
        return c.json(await relay.callModel(nodeId, op, input.model, input.contextLength));
      } catch (err) {
        return c.json({ error: { message: `device ${nodeId} failed: ${(err as Error).message}` } }, 502);
      }
    };
  };
  app.post("/devices/:nodeId/models/load", modelControl("load"));
  app.post("/devices/:nodeId/models/unload", modelControl("unload"));

  // A device's effective settings, and changes to them. The device checks it was started to accept changes.
  const deviceSettings = (op: "get" | "set") => {
    return async (c: Context) => {
      const nodeId = c.req.param("nodeId") ?? "";
      if (!registry.live().some((n) => {
        return n.nodeId === nodeId;
      })) {
        return c.json({ error: { message: `device "${nodeId}" is not connected` } }, 404);
      }
      let patch: Record<string, unknown> | undefined;
      if (op === "set") {
        const body: unknown = await c.req.json().catch(() => {
          return undefined;
        });
        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          return c.json({ error: { message: "send an object of settings to change" } }, 400);
        }
        patch = body as Record<string, unknown>;
      }
      try {
        const result = await relay.callSettings(nodeId, op, patch);
        if (!result.ok) {
          return c.json({ error: { message: result.output } }, 422);
        }
        return c.json(JSON.parse(result.output));
      } catch (err) {
        return c.json({ error: { message: `device ${nodeId} failed: ${(err as Error).message}` } }, 502);
      }
    };
  };
  app.get("/devices/:nodeId/settings", deviceSettings("get"));
  app.put("/devices/:nodeId/settings", deviceSettings("set"));

  // What the models have used. `days` counts local days ending today; `offset` is the caller's minutes ahead of UTC, so days
  // start at the caller's midnight.
  app.get("/usage", (c) => {
    const days = Math.min(Math.max(Math.trunc(Number(c.req.query("days") ?? "7")) || 7, 1), 366);
    const offset = Math.trunc(Number(c.req.query("offset") ?? "0")) || 0;
    return c.json(ledger?.summary(days, Date.now(), offset) ?? { days, since: 0, calls: 0, promptTokens: 0, completionTokens: 0, byModel: [], byDevice: [], byDay: [] });
  });

  app.get("/sessions/:id/usage", (c) => {
    const id = c.req.param("id");
    const session = sessions.get(id);
    if (!session) {
      return c.json({ error: { message: "no such conversation" } }, 404);
    }
    const usage = { ...(ledger?.forConversation(id) ?? { byModel: [] }), compactAt: sessions.compactAt };
    // After a compaction the history is smaller than the last call saw, so show that until the next reply says exactly.
    if (usage.last && session.compaction && session.compaction.time >= usage.last.time) {
      return c.json({ ...usage, last: { ...usage.last, promptTokens: session.compaction.tokensAfter, completionTokens: 0, estimated: true } });
    }
    return c.json(usage);
  });

  // Summarises the older turns now, to free context. The conversation shown stays whole; only what the model is sent shrinks.
  app.post("/sessions/:id/compact", async (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such conversation" } }, 404);
    }
    const outcome = await session.compact();
    if (!outcome.ok) {
      return c.json({ error: { message: outcome.reason } }, outcome.reason.includes("busy") ? 409 : 422);
    }
    return c.json(outcome);
  });

  // Coding sessions: the model loop runs here, tool calls run on the chosen device.
  // Splits pasted text or a dropped file into the turns it finds, for the person to check. Nothing is saved.
  app.post("/import/parse", async (c) => {
    const parsed = ImportParse.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    try {
      return c.json(parseImportFile(parsed.data.name ?? "pasted.txt", parsed.data.content));
    } catch (err) {
      return c.json({ error: { message: (err as Error).message } }, 422);
    }
  });

  app.post("/sessions/import", async (c) => {
    const parsed = SessionImport.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    try {
      return c.json(sessions.import(parsed.data).info(), 201);
    } catch (err) {
      return c.json({ error: { message: (err as Error).message } }, 422);
    }
  });

  app.get("/sessions/:id/export", (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    const name = session.title.replace(/[^\w -]+/g, "").trim().slice(0, 60) || "conversation";
    return c.body(toMarkdown(session.title, session.events), 200, { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${name}.md"` });
  });

  app.get("/sessions", (c) => {
    return c.json(sessions.list());
  });

  app.post("/sessions", async (c) => {
    const parsed = SessionCreate.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    try {
      return c.json(sessions.create(parsed.data).info(), 201);
    } catch (err) {
      return c.json({ error: { message: (err as Error).message } }, 400);
    }
  });

  app.post("/sessions/:id/messages", async (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    const parsed = SessionMessage.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    try {
      session.send(parsed.data.text, parsed.data.model, parsed.data.effort, parsed.data.skill);
    } catch (err) {
      return c.json({ error: { message: (err as Error).message } }, 409);
    }
    return c.json(session.info(), 202);
  });

  app.post("/sessions/:id/approvals/:approvalId", async (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    const parsed = SessionApproval.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    if (!session.answer(c.req.param("approvalId"), parsed.data.approve, parsed.data.always)) {
      return c.json({ error: { message: "no such pending approval" } }, 404);
    }
    return c.json({ ok: true });
  });

  app.patch("/sessions/:id", async (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such conversation" } }, 404);
    }
    const parsed = SessionRename.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    session.rename(parsed.data.title);
    return c.json(session.info());
  });

  // The commands a coding session has running in the background, as its device reports them. A chat, or a device that is offline or
  // too old to answer, has none.
  app.get("/sessions/:id/tasks", async (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    if (session.device === "") {
      return c.json([]);
    }
    try {
      const result = await relay.callTool(session.device, session.root, "tasks_list", {}, { session: session.id, timeoutMs: 10_000 });
      return c.json(result.ok ? JSON.parse(result.output) as unknown : []);
    } catch {
      return c.json([]);
    }
  });

  app.delete("/sessions/:id", async (c) => {
    // Whatever the session left running on its device stops with it, as far as the device can be reached.
    const doomed = sessions.get(c.req.param("id"));
    if (doomed && doomed.device !== "") {
      await relay.callTool(doomed.device, doomed.root, "tasks_stop_all", {}, { session: doomed.id, timeoutMs: 10_000 }).catch(() => {
        return undefined;
      });
    }
    if (!(await sessions.delete(c.req.param("id")))) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    return c.json({ ok: true });
  });

  app.post("/sessions/:id/cancel", (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    session.cancel();
    return c.json({ ok: true });
  });

  // Server-sent events: everything so far from `from`, then live. fetch-based, so the key can go in a header.
  app.get("/sessions/:id/events", (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: { message: "no such session" } }, 404);
    }
    const from = Math.max(0, Number(c.req.query("from")) || 0);
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | undefined;
    let keepalive: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const frame = (text: string): Uint8Array => {
          return encoder.encode(text + String.fromCharCode(10, 10));
        };
        unsubscribe = session.subscribe((event) => {
          controller.enqueue(frame(`data: ${JSON.stringify(event)}`));
        }, from);
        keepalive = setInterval(() => {
          controller.enqueue(frame(": keepalive"));
        }, 15_000);
      },
      cancel() {
        unsubscribe?.();
        clearInterval(keepalive);
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  });

  // The skills and instruction files each device finds in each project folder it exposes, for the composer's slash menu and the skills
  // page. `device` and `root` narrow it to one folder. A device that cannot answer (an older one) is listed with no skills.
  app.get("/skills", async (c) => {
    const only = { device: c.req.query("device"), root: c.req.query("root") };
    const folders = registry.live().filter((n) => {
      return n.kind === "local" && (only.device === undefined || n.nodeId === only.device);
    }).flatMap((n) => {
      return (n.roots ?? []).filter((r) => {
        return only.root === undefined || r === only.root;
      }).map((root) => {
        return { device: n.nodeId, root };
      });
    });
    return c.json(await Promise.all(folders.map(async ({ device, root }) => {
      try {
        const result = await relay.callTool(device, root, "project_context", {}, { timeoutMs: 15_000 });
        const context = result.ok ? JSON.parse(result.output) as ProjectContext : undefined;
        if (context) {
          return { device, root, skills: context.skills, skipped: context.skipped, instructions: context.instructions.map((i) => {
            return { source: i.source, length: i.text.length };
          }) };
        }
        return { device, root, skills: [], skipped: [], instructions: [], note: result.output };
      } catch (err) {
        return { device, root, skills: [], skipped: [], instructions: [], note: err instanceof Error ? err.message : String(err) };
      }
    })));
  });

  // Everything that can be chosen, for the interface: each model on each device with what choosing it would do, and Claude.
  app.get("/catalogue", (c) => {
    const nodes = registry.live();
    const claudeDevice = nodes.find((n) => {
      return n.claude;
    });
    // While Claude is at its limit its models are listed with when they come back, so the page can show why they are greyed out.
    const limitedUntil = claudeDevice ? claude.limitedUntil() : undefined;
    return c.json({
      models: catalogue(nodes),
      claude: { available: claudeDevice !== undefined && limitedUntil === undefined, device: claudeDevice?.nodeId, models: claudeDevice ? CLAUDE_MODEL_IDS : [], limitedUntil },
    });
  });

  // How much of the Claude plan is left, as the claude program last reported it.
  app.get("/claude/usage", (c) => {
    return c.json(claude.status());
  });

  app.get("/v1/models", (c) => {
    const local = registry
      .live()
      .flatMap((n) => {
        return n.models.filter((m) => {
          return m.loaded;
        }).map((m) => {
          return { id: m.id, object: "model", owned_by: n.nodeId };
        });
      });
    // Claude is offered only while a device that is logged in to it is connected.
    const claudeDevice = registry.live().find((n) => {
      return n.claude;
    });
    const claudeModels = claudeDevice && claude.limitedUntil() === undefined
      ? CLAUDE_MODEL_IDS.map((id) => {
          return { id, object: "model", owned_by: claudeDevice.nodeId };
        })
      : [];
    return c.json({ object: "list", data: [...local, ...claudeModels] });
  });

  app.post("/v1/chat/completions", async (c) => {
    const parsed = ChatRequest.safeParse(await c.req.json().catch(() => {
      return undefined;
    }));
    if (!parsed.success) {
      return c.json({ error: flattenError(parsed.error) }, 400);
    }
    const req = parsed.data;

    if (isClaudeModel(req.model)) {
      if (!registry.live().some((n) => {
        return n.claude;
      })) {
        return c.json({ error: { message: "no connected device is logged in to Claude. Turn Claude on for a device where `claude` is logged in (Devices page, or CLAUDE_ENABLED=1)" } }, 503);
      }
      try {
        const { result, device } = await askClaude({ registry, relay, state: claude }, req.model, req.messages, { body: JSON.stringify(req) });
        if (req.stream) {
          return new Response(toSse(result), { headers: { "content-type": "text/event-stream", "x-harness-node": device } });
        }
        return c.json(toOpenAIResponse(result), 200, { "x-harness-node": device });
      } catch (err) {
        // A limit is not a fault of the gateway: say when it ends, and let clients back off until then.
        if (err instanceof ClaudeUnavailableError) {
          return c.json({ error: { message: err.message } }, 429, { "retry-after": String(Math.max(1, Math.ceil((err.until - Date.now()) / 1000))) });
        }
        return c.json({ error: { message: (err as Error).message } }, 502);
      }
    }

    let route;
    try {
      route = await resolveRoute({ registry, loader }, req);
    } catch (err) {
      if (err instanceof RouteError) {
        return c.json({ error: { message: err.message } }, err.status);
      }
      throw err;
    }

    let upstream: Response;
    try {
      upstream = await relay.request(route.node.nodeId, JSON.stringify({ ...req, model: route.model }));
    } catch (err) {
      return c.json({ error: { message: `node ${route.node.nodeId} is unreachable: ${(err as Error).message}` } }, 502);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "x-harness-node": route.node.nodeId,
      },
    });
  });

  return app;
};
