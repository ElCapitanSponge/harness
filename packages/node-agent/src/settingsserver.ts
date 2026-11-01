import type { RelayRequest, TunnelMessage } from "@harness/core";
import type { Settings } from "./settings.js";

type SettingsMessage = Extract<RelayRequest, { type: "settings" }>;

// Answers the gateway's requests to read or change this device's settings. The settings object decides whether a
// change is allowed; this only carries the request and the answer.
export const createSettingsServer = (settings: Settings) => {
  return {
    async handle(msg: SettingsMessage, send: (m: TunnelMessage) => void): Promise<void> {
      if (msg.op === "get") {
        send({ type: "tool-result", id: msg.id, ok: true, output: JSON.stringify(settings.report()) });
        return;
      }
      const result = await settings.apply(msg.settings);
      send({ type: "tool-result", id: msg.id, ok: result.ok, output: result.ok ? JSON.stringify(result.report) : result.error });
    },
  };
};

export type SettingsServer = ReturnType<typeof createSettingsServer>;
