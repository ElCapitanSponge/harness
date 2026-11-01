import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { nonEmpty } from "@harness/core";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { assertSafeBinding } from "./auth.js";
import { resolveHosts } from "./hosts.js";
import { Registry } from "./registry.js";
import { Relay } from "./relay.js";
import { Sessions, createCompleter } from "./sessions.js";
import { fileStore, loadStored } from "./store.js";
import { attachTunnel } from "./tunnel.js";

const apiKey = nonEmpty(process.env.HARNESS_API_KEY);

const registry = new Registry();
const relay = new Relay();
// Coding sessions are kept here so they survive a restart. In a container, mount a volume at this path.
const dataDir = process.env.HARNESS_DATA_DIR ?? path.join(os.homedir(), ".harness", "gateway");
const sessionsDir = path.join(dataDir, "sessions");
const sessions = new Sessions({
  registry,
  relay,
  complete: createCompleter({ registry, relay }),
  store: fileStore(sessionsDir),
  stored: await loadStored(sessionsDir),
});
const app = createApp({
  registry,
  relay,
  sessions,
  apiKey,
});

const port = Number(process.env.PORT ?? 8787);
const hosts = await resolveHosts(process.env.HOST ?? "127.0.0.1");
assertSafeBinding(hosts, apiKey, process.env.HARNESS_ALLOW_ANY_INTERFACE === "1");
for (const hostname of hosts) {
  const server = serve({ fetch: app.fetch, port, hostname }) as Server;
  attachTunnel(server, { registry, relay, apiKey });
  console.log(`[gateway] listening on ${hostname}:${port} (${apiKey ? "api key required" : "no auth, loopback only"})`);
}
