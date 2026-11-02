import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { nonEmpty } from "@harness/core";
import type { ProjectContext } from "@harness/tools";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ModelLoader } from "./loader.js";
import { assertSafeBinding } from "./auth.js";
import { resolveHosts } from "./hosts.js";
import { Registry } from "./registry.js";
import { Relay } from "./relay.js";
import { parseList } from "./auto.js";
import { ClaudeState } from "./claude.js";
import { Sessions, createCompleter } from "./sessions.js";
import { importLegacySessions } from "./legacy.js";
import { createLibrary } from "./library.js";
import { sqliteLedger } from "./ledger.js";
import { openDatabase, sqliteRules, sqliteStore } from "./sqlite.js";
import { attachTunnel } from "./tunnel.js";
import { findWebDist, loadWebApp } from "./webapp.js";

const apiKey = nonEmpty(process.env.HARNESS_API_KEY);

const registry = new Registry();
const relay = new Relay();
// Coding sessions are kept here so they survive a restart. In a container, mount a volume at this path.
const dataDir = process.env.HARNESS_DATA_DIR ?? path.join(os.homedir(), ".harness", "gateway");
// Conversations are kept in one SQLite database on the data volume (docs/adr/0007-sqlite-on-the-data-volume.md). The folder of
// JSON files they used to be in is imported once, then set aside.
const db = openDatabase(path.join(dataDir, "harness.db"));
const store = sqliteStore(db);
const ledger = sqliteLedger(db);
const rules = sqliteRules(db);
const claude = new ClaudeState();
// The gateway's own skills, kept beside the database so they are available in every conversation, including chats.
const library = createLibrary(path.join(dataDir, "skills"));
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
// Compact a conversation when its context is this percent full before a message (0 turns it off).
const compactPercent = Number(process.env.HARNESS_COMPACT_AT ?? "80");
const sessions = new Sessions({
  ledger,
  compactAt: Number.isFinite(compactPercent) && compactPercent > 0 && compactPercent < 100 ? compactPercent / 100 : 0,
  registry,
  relay,
  claude,
  library,
  rules,
  // Running without asking can be turned off for the whole gateway (HARNESS_ALLOW_BYPASS=0).
  allowBypass: process.env.HARNESS_ALLOW_BYPASS !== "0",
  // The project's instruction files and skills, as the device finds them at the start of each turn; an older device just says no.
  projectContext: async (device, root, session) => {
    const result = await relay.callTool(device, root, "project_context", {}, { session });
    return result.ok ? JSON.parse(result.output) as ProjectContext : undefined;
  },
  startSkill: async (device, root, session, name, args) => {
    const result = await relay.callTool(device, root, "start_skill", { name, arguments: args }, { session });
    if (!result.ok) {
      throw new Error(result.output);
    }
    return result.output;
  },
  // Auto mode: models to prefer or avoid (names, best first), and devices it must never choose.
  autoPrefs: {
    prefer: parseList(process.env.HARNESS_AUTO_PREFER),
    avoid: parseList(process.env.HARNESS_AUTO_AVOID),
    keepFree: parseList(process.env.HARNESS_AUTO_KEEP_FREE),
  },
  complete: createCompleter({ registry, relay, loader, claude }),
  store,
  stored: store.loadAll(),
});
// The built web app (pnpm build:web), if there is one; otherwise the single-file page in web.ts.
const webDist = await findWebDist(process.env.WEB_DIST ?? path.resolve(import.meta.dirname, "../../web/dist"));
const app = createApp({
  registry,
  relay,
  sessions,
  library,
  rules,
  trustProxy: process.env.HARNESS_TRUST_PROXY === "1",
  ledger,
  claude,
  loader,
  apiKey,
  mountWeb: webDist ? await loadWebApp(webDist) : undefined,
});
console.log(`[gateway] web app: ${webDist ?? "built-in page (run pnpm build:web for the new one)"}`);

const port = Number(process.env.PORT ?? 8787);
const hosts = await resolveHosts(process.env.HOST ?? "127.0.0.1");
assertSafeBinding(hosts, apiKey, process.env.HARNESS_ALLOW_ANY_INTERFACE === "1");
for (const hostname of hosts) {
  const server = serve({ fetch: app.fetch, port, hostname }) as Server;
  attachTunnel(server, { registry, relay, apiKey });
  console.log(`[gateway] listening on ${hostname}:${port} (${apiKey ? "api key required" : "no auth, loopback only"})`);
}
