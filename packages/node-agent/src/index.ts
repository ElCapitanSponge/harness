import type { Heartbeat } from "@harness/core";
import { detectBusy } from "./busy.js";
import { config } from "./config.js";
import { listModels } from "./lmstudio.js";
import { createAuditLog } from "./audit.js";
import { createChatServer } from "./chat.js";
import { createClaudeServer } from "./claude.js";
import { createModelServer } from "./models.js";
import { createToolServer } from "./toolserver.js";
import { connectTunnel } from "./tunnel.js";

const tools = createToolServer({ roots: config.projectRoots, allowed: config.allowedTools, audit: createAuditLog(config.auditLog) });

const collect = async (): Promise<Heartbeat> => {
  const { busy, reason } = await detectBusy(config.gameProcesses);
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
    claude: config.claude,
    modelControl: config.modelControl,
  };
};

console.log(`[agent] ${config.nodeId} -> ${config.gatewayUrl} (inference ${config.inferenceUrl})`);
connectTunnel({
  gatewayUrl: config.gatewayUrl,
  apiKey: config.apiKey,
  heartbeat: collect,
  tools,
  models: createModelServer({ enabled: config.modelControl, isBusy: async () => {
    return (await detectBusy(config.gameProcesses)).busy;
  } }),
  claude: config.claude ? createClaudeServer({ bin: config.claudeBin }) : undefined,
  chat: createChatServer({ inferenceUrl: config.inferenceUrl }),
});
