import { toOpenAIResponse, toSse, type ClaudeResult } from "@harness/claude";
import { ChatRequest, DeviceToolRequest, SessionApproval, SessionCreate, SessionMessage } from "@harness/core";
import { Hono } from "hono";
import { bearerAuth } from "./auth.js";
import type { Registry } from "./registry.js";
import type { Relay } from "./relay.js";
import { CLAUDE_MODEL_IDS, isClaudeModel, pickRoute } from "./router.js";
import type { Sessions } from "./sessions.js";
import { WEB_PAGE } from "./web.js";

export interface AppDeps {
  registry: Registry;
  apiKey?: string;
  relay: Pick<Relay, "request" | "callTool" | "callClaude">;
  sessions: Sessions;
}

export function createApp({ registry, apiKey, relay, sessions }: AppDeps): Hono {
  const app = new Hono();

  // The page holds no secrets and must load before a key can be typed, so it is registered ahead of the auth middleware.
  app.get("/", (c) =>
    c.html(WEB_PAGE, 200, {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    }),
  );

  if (apiKey) app.use("*", bearerAuth(apiKey));

  app.get("/nodes", (c) => c.json(registry.live()));

  // Runs one tool on a connected device. The device decides which roots and tools it allows.
  app.post("/devices/:nodeId/tools", async (c) => {
    const parsed = DeviceToolRequest.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const nodeId = c.req.param("nodeId");
    if (!registry.live().some((n) => n.nodeId === nodeId)) return c.json({ error: { message: `device "${nodeId}" is not connected` } }, 404);
    try {
      return c.json(await relay.callTool(nodeId, parsed.data.root, parsed.data.name, parsed.data.args));
    } catch (err) {
      return c.json({ error: { message: `device ${nodeId} failed: ${(err as Error).message}` } }, 502);
    }
  });

  // Coding sessions: the model loop runs here, tool calls run on the chosen device.
  app.get("/sessions", (c) => c.json(sessions.list()));

  app.post("/sessions", async (c) => {
    const parsed = SessionCreate.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    try {
      return c.json(sessions.create(parsed.data).info(), 201);
    } catch (err) {
      return c.json({ error: { message: (err as Error).message } }, 400);
    }
  });

  app.post("/sessions/:id/messages", async (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) return c.json({ error: { message: "no such session" } }, 404);
    const parsed = SessionMessage.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    try {
      session.send(parsed.data.text);
    } catch (err) {
      return c.json({ error: { message: (err as Error).message } }, 409);
    }
    return c.json(session.info(), 202);
  });

  app.post("/sessions/:id/approvals/:approvalId", async (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) return c.json({ error: { message: "no such session" } }, 404);
    const parsed = SessionApproval.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    if (!session.answer(c.req.param("approvalId"), parsed.data.approve, parsed.data.always)) {
      return c.json({ error: { message: "no such pending approval" } }, 404);
    }
    return c.json({ ok: true });
  });

  app.delete("/sessions/:id", async (c) => {
    if (!(await sessions.delete(c.req.param("id")))) return c.json({ error: { message: "no such session" } }, 404);
    return c.json({ ok: true });
  });

  app.post("/sessions/:id/cancel", (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) return c.json({ error: { message: "no such session" } }, 404);
    session.cancel();
    return c.json({ ok: true });
  });

  // Server-sent events: everything so far from `from`, then live. fetch-based, so the key can go in a header.
  app.get("/sessions/:id/events", (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) return c.json({ error: { message: "no such session" } }, 404);
    const from = Math.max(0, Number(c.req.query("from")) || 0);
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | undefined;
    let keepalive: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const frame = (text: string): Uint8Array => encoder.encode(text + String.fromCharCode(10, 10));
        unsubscribe = session.subscribe((event) => controller.enqueue(frame(`data: ${JSON.stringify(event)}`)), from);
        keepalive = setInterval(() => controller.enqueue(frame(": keepalive")), 15_000);
      },
      cancel() {
        unsubscribe?.();
        clearInterval(keepalive);
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  });

  app.get("/v1/models", (c) => {
    const local = registry
      .live()
      .flatMap((n) => n.models.filter((m) => m.loaded).map((m) => ({ id: m.id, object: "model", owned_by: n.nodeId })));
    // Claude is offered only while a device that is logged in to it is connected.
    const claudeDevice = registry.live().find((n) => n.claude);
    const claudeModels = claudeDevice ? CLAUDE_MODEL_IDS.map((id) => ({ id, object: "model", owned_by: claudeDevice.nodeId })) : [];
    return c.json({ object: "list", data: [...local, ...claudeModels] });
  });

  app.post("/v1/chat/completions", async (c) => {
    const parsed = ChatRequest.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const req = parsed.data;

    if (isClaudeModel(req.model)) {
      if (req.tools?.length) {
        return c.json(
          { error: { message: "Claude models do not take client-side tools through the gateway; run `harness code -m claude:<alias>` to use Claude Code locally" } },
          400,
        );
      }
      const device = registry.live().find((n) => n.claude);
      if (!device) {
        return c.json({ error: { message: "no connected device is logged in to Claude. Start a node agent with CLAUDE_ENABLED=1 on a device where `claude` is logged in" } }, 503);
      }
      try {
        const reply = await relay.callClaude(device.nodeId, JSON.stringify(req));
        if (!reply.ok) throw new Error(reply.output);
        const result = JSON.parse(reply.output) as ClaudeResult;
        if (req.stream) {
          return new Response(toSse(result), { headers: { "content-type": "text/event-stream", "x-harness-node": device.nodeId } });
        }
        return c.json(toOpenAIResponse(result), 200, { "x-harness-node": device.nodeId });
      } catch (err) {
        return c.json({ error: { message: (err as Error).message } }, 502);
      }
    }

    const route = pickRoute(registry.live(), req);
    if (!route) return c.json({ error: { message: `no idle node has model "${req.model}" loaded` } }, 503);

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
}
