import os from "node:os";
import path from "node:path";
import { parseRoots } from "./toolserver.js";

const env = process.env;

export const config = {
  nodeId: env.NODE_ID ?? os.hostname().toLowerCase(),
  gatewayUrl: env.GATEWAY_URL ?? "http://localhost:8787",
  apiKey: env.HARNESS_API_KEY || undefined,
  // Address the gateway should use to reach this node's inference server.
  // On a tailnet this becomes the machine's Tailscale address.
  inferenceUrl: env.INFERENCE_URL ?? "http://localhost:1234",
  // Project folders coding sessions may work in, as `name=path` entries separated by the platform path delimiter.
  // Nothing is exposed unless this is set. Read-only tools are enabled by default.
  projectRoots: parseRoots(env.PROJECT_ROOTS),
  // Tools coding sessions may run on this device. Read-only by default; write_file, edit_file and run_command
  // change files or run programs, so add them here only if you want that.
  allowedTools: (env.ALLOWED_TOOLS ?? "read_file,list_dir,grep").split(",").map((s) => s.trim()).filter(Boolean),
  // Every tool call the gateway makes on this device is appended here, one JSON line each.
  auditLog: env.AUDIT_LOG ?? path.join(os.homedir(), ".harness", "audit.log"),
  // Serve Claude requests from this device with its logged-in `claude` CLI. Off unless you turn it on.
  claude: env.CLAUDE_ENABLED === "1",
  claudeBin: env.CLAUDE_BIN ?? "claude",
  // Executables that mean "the user is gaming; stay out of the GPU".
  gameProcesses: (env.GAME_PROCESSES ?? "RocketLeague.exe,Fortnite.exe,eldenring.exe,cs2.exe,Cyberpunk2077.exe")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};
