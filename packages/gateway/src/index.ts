import { serve } from "@hono/node-server";
import { ChatRequest, Heartbeat } from "@harness/core";
import { Hono } from "hono";
import { runClaude, toOpenAIResponse } from "./claude.js";
import { Registry } from "./registry.js";
import { isClaudeModel, pickRoute } from "./router.js";

const claudeBin = process.env.CLAUDE_BIN ?? "claude";
const registry = new Registry();
const app = new Hono();

app.post("/nodes/heartbeat", async (c) => {
  const parsed = Heartbeat.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  registry.upsert(parsed.data);
  return c.json({ ok: true });
});

app.get("/nodes", (c) => c.json(registry.live()));

app.get("/v1/models", (c) => {
  const data = registry
    .live()
    .flatMap((n) => n.models.filter((m) => m.loaded).map((m) => ({ id: m.id, object: "model", owned_by: n.nodeId })));
  return c.json({ object: "list", data });
});

app.post("/v1/chat/completions", async (c) => {
  const parsed = ChatRequest.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  if (isClaudeModel(parsed.data.model)) {
    try {
      return c.json(toOpenAIResponse(await runClaude(claudeBin, parsed.data)), 200, { "x-harness-node": "claude" });
    } catch (err) {
      return c.json({ error: { message: (err as Error).message } }, 502);
    }
  }

  const route = pickRoute(registry.live(), parsed.data);
  if (!route) {
    return c.json({ error: { message: `no idle node has model "${parsed.data.model}" loaded` } }, 503);
  }

  const upstream = await fetch(`${route.node.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...parsed.data, model: route.model }),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "x-harness-node": route.node.nodeId,
    },
  });
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "127.0.0.1" });
console.log(`[gateway] listening on ${process.env.HOST ?? "127.0.0.1"}:${port}`);
