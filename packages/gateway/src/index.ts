import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { nonEmpty } from "@harness/core";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ModelLoader } from "./loader.js";
import { assertSafeBinding } from "./auth.js";
import { resolveHosts } from "./hosts.js";
import { Registry } from "./registry.js";
import { Relay } from "./relay.js";
import { Sessions, createCompleter } from "./sessions.js";
import { importLegacySessions } from "./legacy.js";
import { openDatabase, sqliteStore } from "./sqlite.js";
import { attachTunnel } from "./tunnel.js";

const apiKey = nonEmpty(process.env.HARNESS_API_KEY);

const registry = new Registry();
const relay = new Relay();
// Coding sessions are kept here so they survive a restart. In a container, mount a volume at this path.
const dataDir = process.env.HARNESS_DATA_DIR ?? path.join(os.homedir(), ".harness", "gateway");
// Conversations are kept in one SQLite database on the data volume (docs/adr/0007-sqlite-on-the-data-volume.md). The folder of
// JSON files they used to be in is imported once, then set aside.
const store = sqliteStore(openDatabase(path.join(dataDir, "harness.db")));
const imported = await importLegacySessions(path.join(dataDir, "sessions"), store);
if (imported > 0) {
  console.log(`[gateway] moved ${imported} saved conversation${imported === 1 ? "" : "s"} into the database`);
}
// A model that is available but not loaded is loaded when a request needs it. By default the device's other models are
// unloaded first (two rarely fit in one graphics card); HARNESS_KEEP_LOADED=1 keeps them.
const loader = new ModelLoader({
  registry,
  relay,
  unloadOthers: process.env.HARNESS_KEEP_LOADED !== "1",
  defaultContext: Number(process.env.HARNESS_DEFAULT_CONTEXT ?? 32_768),
});
const sessions = new Sessions({
  registry,
  relay,
  complete: createCompleter({ registry, relay, loader }),
  store,
  stored: store.loadAll(),
});
const app = createApp({
  registry,
  relay,
  sessions,
  loader,
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
