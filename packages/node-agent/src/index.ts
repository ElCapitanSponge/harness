import type { Heartbeat } from "@harness/core";
import { detectBusy } from "./busy.js";
import { config } from "./config.js";
import { listModels } from "./lmstudio.js";
import { createAuditLog } from "./audit.js";
import { createChatServer } from "./chat.js";
import { createClaudeServer } from "./claude.js";
import { createModelServer } from "./models.js";
import { createSettings } from "./settings.js";
import { createSettingsServer } from "./settingsserver.js";
import { createToolServer } from "./toolserver.js";
import { connectTunnel } from "./tunnel.js";

const audit = createAuditLog(config.auditLog);
// Changes from the gateway reach the tool server through this, so they apply without a restart.
const settings = await createSettings({
  file: config.settingsFile,
  remoteConfig: config.remoteConfig,
  audit,
  onChange: (next) => {
    tools.configure({ roots: next.projectRoots, allowed: next.allowedTools });
  },
});
const now = settings.current();

const tools = createToolServer({ roots: now.projectRoots, allowed: now.allowedTools, audit });

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
    platform: process.platform,
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
  }),
  claude: createClaudeServer({
    bin: config.claudeBin,
    enabled: () => {
      return settings.current().claude;
    },
  }),
  chat: createChatServer({ inferenceUrl: config.inferenceUrl }),
});
