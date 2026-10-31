import { serve } from "@hono/node-server";
import { ChatRequest, Heartbeat } from "@harness/core";
import { Hono } from "hono";
import { assertSafeBinding, bearerAuth } from "./auth.js";
import { runClaude, toOpenAIResponse, toSse } from "./claude.js";
import { resolveHosts } from "./hosts.js";
import { Registry } from "./registry.js";
import { CLAUDE_MODEL_IDS, isClaudeModel, pickRoute } from "./router.js";

const claudeBin = process.env.CLAUDE_BIN ?? "claude";
const apiKey = process.env.HARNESS_API_KEY || undefined;
const registry = new Registry();
const app = new Hono();

if (apiKey) app.use("*", bearerAuth(apiKey));

app.post("/nodes/heartbeat", async (c) => {
  const parsed = Heartbeat.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  registry.upsert(parsed.data);
  return c.json({ ok: true });
});

app.get("/nodes", (c) => c.json(registry.live()));

app.get("/v1/models", (c) => {
  const local = registry
    .live()
    .flatMap((n) => n.models.filter((m) => m.loaded).map((m) => ({ id: m.id, object: "model", owned_by: n.nodeId })));
  const claude = CLAUDE_MODEL_IDS.map((id) => ({ id, object: "model", owned_by: "claude" }));
  return c.json({ object: "list", data: [...local, ...claude] });
});

app.post("/v1/chat/completions", async (c) => {
  const parsed = ChatRequest.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  if (isClaudeModel(parsed.data.model)) {
    if (parsed.data.tools?.length) {
      return c.json(
        { error: { message: "Claude models do not take client-side tools through the gateway; run `harness code -m claude:<alias>` to use Claude Code locally" } },
        400,
      );
    }
    try {
      const result = await runClaude(claudeBin, parsed.data);
      if (parsed.data.stream) {
        return new Response(toSse(result), { headers: { "content-type": "text/event-stream", "x-harness-node": "claude" } });
      }
      return c.json(toOpenAIResponse(result), 200, { "x-harness-node": "claude" });
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
const hosts = await resolveHosts(process.env.HOST ?? "127.0.0.1");
assertSafeBinding(hosts, apiKey, process.env.HARNESS_ALLOW_ANY_INTERFACE === "1");
for (const hostname of hosts) {
  serve({ fetch: app.fetch, port, hostname });
  console.log(`[gateway] listening on ${hostname}:${port} (${apiKey ? "api key required" : "no auth, loopback only"})`);
}
