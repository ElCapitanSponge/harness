import { HEARTBEAT_INTERVAL_MS, type Heartbeat } from "@harness/core";
import { detectBusy } from "./busy.js";
import { config } from "./config.js";
import { listModels } from "./lmstudio.js";

async function beat(): Promise<void> {
  const { busy, reason } = await detectBusy(config.gameProcesses);
  let models: Heartbeat["models"] = [];
  try {
    models = await listModels(config.inferenceUrl);
  } catch (err) {
    console.warn(`[agent] inference server unreachable: ${(err as Error).message}`);
  }

  const heartbeat: Heartbeat = {
    nodeId: config.nodeId,
    kind: "local",
    baseUrl: config.inferenceUrl,
    busy,
    busyReason: reason,
    models,
  };

  try {
    const res = await fetch(`${config.gatewayUrl}/nodes/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(heartbeat),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.warn(`[agent] gateway rejected heartbeat: ${res.status}`);
  } catch (err) {
    console.warn(`[agent] gateway unreachable: ${(err as Error).message}`);
  }
}

console.log(`[agent] ${config.nodeId} -> ${config.gatewayUrl} (inference ${config.inferenceUrl})`);
await beat();
setInterval(beat, HEARTBEAT_INTERVAL_MS);
