import type { Heartbeat } from "@harness/core";
import { detectBusy } from "./busy.js";
import { config } from "./config.js";
import { listModels } from "./lmstudio.js";
import { connectTunnel } from "./tunnel.js";

async function collect(): Promise<Heartbeat> {
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
    baseUrl: config.inferenceUrl,
    busy,
    busyReason: reason,
    models,
  };
}

console.log(`[agent] ${config.nodeId} -> ${config.gatewayUrl} (inference ${config.inferenceUrl})`);
connectTunnel({ gatewayUrl: config.gatewayUrl, apiKey: config.apiKey, heartbeat: collect });
