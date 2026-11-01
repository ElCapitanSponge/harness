import os from "node:os";
import path from "node:path";
import { nonEmpty } from "@harness/core";

const env = process.env;

export const config = {
  nodeId: env.NODE_ID ?? os.hostname().toLowerCase(),
  gatewayUrl: env.GATEWAY_URL ?? "http://localhost:8787",
  apiKey: nonEmpty(env.HARNESS_API_KEY),
  // Address the gateway should use to reach this node's inference server.
  // On a tailnet this becomes the machine's Tailscale address.
  inferenceUrl: env.INFERENCE_URL ?? "http://localhost:1234",
  // Every tool call the gateway makes on this device is appended here, one JSON line each.
  auditLog: env.AUDIT_LOG ?? path.join(os.homedir(), ".harness", "audit.log"),
  claudeBin: env.CLAUDE_BIN ?? "claude",
  // Where applied settings are saved, and whether the gateway may change them. See docs/adr/0008.
  settingsFile: env.SETTINGS_FILE ?? path.join(os.homedir(), ".harness", "agent-settings.json"),
  remoteConfig: env.REMOTE_CONFIG === "1",
};
