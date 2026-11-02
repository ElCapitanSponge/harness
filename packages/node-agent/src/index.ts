import type { Heartbeat } from "@harness/core";
import { detectBusy, detectLoad } from "./busy.js";
import { config } from "./config.js";
import { lms } from "@harness/lmstudio";
import { listModels } from "./lmstudio.js";
import { createAuditLog } from "./audit.js";
import { createChatServer } from "./chat.js";
import { createClaudeServer } from "./claude.js";
import { createIdleUnloader } from "./idle.js";
import { createModelServer } from "./models.js";
import { detectPrograms } from "./programs.js";
import { createSettings } from "./settings.js";
import { shellName, tools as toolSpecs } from "@harness/tools";
import { createSettingsServer } from "./settingsserver.js";
import { createBrowser } from "./browser.js";
import { findBrowser } from "./browser.js";
import { createToolServer } from "./toolserver.js";
import { connectTunnel } from "./tunnel.js";

const audit = createAuditLog(config.auditLog);
// Which programs the tools need (gh, git, jq, fzf) are here. Checked once at start.
const programs = await detectPrograms(toolSpecs.flatMap((t) => {
  return t.requires ? [t.requires] : [];
}));
const installed = (program: string): boolean => {
  return programs.has(program);
};
// Changes from the gateway reach the tool server through this, so they apply without a restart.
const settings = await createSettings({
  file: config.settingsFile,
  remoteConfig: config.remoteConfig,
  audit,
  installed,
  onChange: (next) => {
    tools.configure({ roots: next.projectRoots, allowed: settings.tools(), readOnly: next.readOnlyRoots });
  },
});
const now = settings.current();

// The throwaway browser coding sessions may drive when the owner turns it on (docs/adr/0011-...). Nothing starts until a page is opened.
const agentBrowser = createBrowser({
  launch: async () => {
    const executable = findBrowser(process.platform);
    if (!executable) {
      throw new Error("no Chrome, Edge or Chromium was found on this device; install one, or set BROWSER_PATH to it");
    }
    return (await import("./browser-playwright.js")).launchPlaywright(executable);
  },
  allowLocal: () => {
    return process.env.WEB_FETCH_ALLOW_LOCAL === "1";
  },
  allowedHosts: () => {
    return settings.current().browserHosts;
  },
  audit: (summary) => {
    audit({ time: new Date().toISOString(), root: "", tool: "browser", summary, outcome: "refused", ms: 0 });
  },
});
setInterval(() => {
  void agentBrowser.sweep();
}, 60_000).unref();

const tools = createToolServer({ roots: now.projectRoots, allowed: settings.tools(), readOnly: now.readOnlyRoots, audit, installed, browser: () => {
  return settings.current().browser ? agentBrowser : undefined;
}, skillFolders: () => {
  return settings.current().skillFolders;
} });

// Models nobody has used for a while are unloaded, so the graphics card is free for whatever else this machine is doing.
const idle = createIdleUnloader({
  minutes: () => {
    return settings.current().idleUnloadMinutes;
  },
  enabled: () => {
    return settings.current().modelControl;
  },
  unload: (model) => {
    return lms.unload(model);
  },
  audit,
});
setInterval(() => {
  void idle.check();
}, 60_000).unref();

// How big each downloaded model is, from LM Studio's own list, refreshed now and then. A model whose size is not known is simply not
// limited (there is nothing to compare).
const sizes = new Map<string, number>();
let sizesAt = 0;
const refreshSizes = async (): Promise<void> => {
  if (Date.now() - sizesAt < 5 * 60_000) {
    return;
  }
  sizesAt = Date.now();
  try {
    for (const m of await lms.list()) {
      sizes.set(m.key, m.sizeBytes);
    }
  } catch {
    // No lms, or it failed: sizes stay as they were.
  }
};

const collect = async (): Promise<Heartbeat> => {
  const current = settings.current();
  const { busy, reason, limit } = await detectLoad(current.gameProcesses, current.limitedProcesses, current.limitedMaxGb);
  await refreshSizes();
  let models: Heartbeat["models"] = [];
  try {
    models = await listModels(config.inferenceUrl, sizes);
  } catch (err) {
    console.warn(`[agent] inference server unreachable: ${(err as Error).message}`);
  }
  // While limited, a model Torii loaded that is too big for the limit is unloaded (never one with a reply in progress, and never one the
  // owner loaded for their own use), so the call has the graphics card to itself.
  if (limit && current.modelControl) {
    for (const m of models) {
      if (m.loaded && m.sizeBytes !== undefined && m.sizeBytes > limit.maxBytes && idle.tracked().some((t) => {
        return t.model === m.id && t.inflight === 0;
      })) {
        const started = Date.now();
        void lms.unload(m.id).then(() => {
          idle.forget(m.id);
          console.log(`[agent] unloaded ${m.id}: too big while ${limit.reason}`);
          audit({ time: new Date(started).toISOString(), root: "", tool: "limit-unload", summary: `unloaded ${m.id}: too big while ${limit.reason}`, outcome: "ok", ms: Date.now() - started });
        }).catch(() => {
          return undefined;
        });
      }
    }
  }
  return {
    nodeId: config.nodeId,
    kind: "local",
    busy,
    busyReason: reason,
    ...(limit ? { limit } : {}),
    models,
    roots: tools.rootNames(),
    allowedTools: tools.allowedNames(),
    readOnlyRoots: tools.readOnlyNames(),
    platform: process.platform,
    shell: shellName(),
    claude: current.claude,
    modelControl: current.modelControl,
    remoteConfig: config.remoteConfig,
  };
};

console.log(`[agent] ${config.nodeId} -> ${config.gatewayUrl} (inference ${config.inferenceUrl})${config.remoteConfig ? " [remote settings allowed]" : ""}`);
connectTunnel({
  gatewayUrl: config.gatewayUrl,
  apiKey: config.apiKey,
  heartbeat: collect,
  tools,
  settings: createSettingsServer(settings),
  models: createModelServer({
    enabled: () => {
      return settings.current().modelControl;
    },
    isBusy: async () => {
      return (await detectBusy(settings.current().gameProcesses)).busy;
    },
    onLoaded: (model) => {
      idle.touch(model);
    },
    onUnloaded: (model) => {
      if (model) {
        idle.forget(model);
      }
    },
  }),
  claude: createClaudeServer({
    bin: config.claudeBin,
    enabled: () => {
      return settings.current().claude;
    },
  }),
  chat: createChatServer({ inferenceUrl: config.inferenceUrl, activity: idle }),
});
