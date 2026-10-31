import os from "node:os";

const env = process.env;

export const config = {
  nodeId: env.NODE_ID ?? os.hostname().toLowerCase(),
  gatewayUrl: env.GATEWAY_URL ?? "http://localhost:8787",
  apiKey: env.HARNESS_API_KEY || undefined,
  // Address the gateway should use to reach this node's inference server.
  // On a tailnet this becomes the machine's Tailscale address.
  inferenceUrl: env.INFERENCE_URL ?? "http://localhost:1234",
  // Executables that mean "the user is gaming; stay out of the GPU".
  gameProcesses: (env.GAME_PROCESSES ?? "RocketLeague.exe,Fortnite.exe,eldenring.exe,cs2.exe,Cyberpunk2077.exe")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};
