import { ChatRequest, Heartbeat } from "@harness/core";
import { Hono } from "hono";
import { bearerAuth } from "./auth.js";
import type { ClaudeResult } from "./claude.js";
import { toOpenAIResponse, toSse } from "./claude.js";
import type { Registry } from "./registry.js";
import { CLAUDE_MODEL_IDS, isClaudeModel, pickRoute } from "./router.js";
import { WEB_PAGE } from "./web.js";

export interface AppDeps {
  registry: Registry;
  apiKey?: string;
  claude: (req: ChatRequest) => Promise<ClaudeResult>;
  fetchImpl?: typeof fetch;
}

export function createApp({ registry, apiKey, claude, fetchImpl = fetch }: AppDeps): Hono {
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

  app.post("/nodes/heartbeat", async (c) => {
    const parsed = Heartbeat.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    registry.upsert(parsed.data);
    return c.json({ ok: true });
  });

  app.get("/nodes", (c) => c.json(registry.live()));

  app.get("/v1/models", (c) => {
    const local = registry
      .live()
      .flatMap((n) => n.models.filter((m) => m.loaded).map((m) => ({ id: m.id, object: "model", owned_by: n.nodeId })));
    const claudeModels = CLAUDE_MODEL_IDS.map((id) => ({ id, object: "model", owned_by: "claude" }));
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
      try {
        const result = await claude(req);
        if (req.stream) {
          return new Response(toSse(result), { headers: { "content-type": "text/event-stream", "x-harness-node": "claude" } });
        }
        return c.json(toOpenAIResponse(result), 200, { "x-harness-node": "claude" });
      } catch (err) {
        return c.json({ error: { message: (err as Error).message } }, 502);
      }
    }

    const route = pickRoute(registry.live(), req);
    if (!route) return c.json({ error: { message: `no idle node has model "${req.model}" loaded` } }, 503);

    let upstream: Response;
    try {
      upstream = await fetchImpl(`${route.node.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...req, model: route.model }),
      });
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
