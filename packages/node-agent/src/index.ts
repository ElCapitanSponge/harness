import type { Heartbeat } from "@harness/core";
import { detectBusy } from "./busy.js";
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

const tools = createToolServer({ roots: now.projectRoots, allowed: settings.tools(), readOnly: now.readOnlyRoots, audit, installed, skillFolders: () => {
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

const collect = async (): Promise<Heartbeat> => {
  const current = settings.current();
  const { busy, reason } = await detectBusy(current.gameProcesses);
  let models: Heartbeat["models"] = [];
  try {
    models = await listModels(config.inferenceUrl);
  } catch (err) {
    console.warn(`[agent] inference server unreachable: ${(err as Error).message}`);
  }
  return {
    nodeId: config.nodeId,
    kind: "local",
    busy,
    busyReason: reason,
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
