import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { assertSafeBinding } from "./auth.js";
import { runClaude } from "./claude.js";
import { resolveHosts } from "./hosts.js";
import { Registry } from "./registry.js";

const claudeBin = process.env.CLAUDE_BIN ?? "claude";
const apiKey = process.env.HARNESS_API_KEY || undefined;

const app = createApp({
  registry: new Registry(),
  apiKey,
  claude: (req) => runClaude(claudeBin, req),
});

const port = Number(process.env.PORT ?? 8787);
const hosts = await resolveHosts(process.env.HOST ?? "127.0.0.1");
assertSafeBinding(hosts, apiKey, process.env.HARNESS_ALLOW_ANY_INTERFACE === "1");
for (const hostname of hosts) {
  serve({ fetch: app.fetch, port, hostname });
  console.log(`[gateway] listening on ${hostname}:${port} (${apiKey ? "api key required" : "no auth, loopback only"})`);
}
