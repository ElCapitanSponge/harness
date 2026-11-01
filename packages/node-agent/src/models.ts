import type { RelayRequest, TunnelMessage } from "@harness/core";
import { lms as realLms, validateContext, validateModel } from "@harness/lmstudio";

type ModelMessage = Extract<RelayRequest, { type: "model" }>;

interface Lms {
  serverStart(): Promise<string>;
  load(model: string, contextLength?: number): Promise<string>;
  unload(model?: string): Promise<string>;
}

// Loads and unloads models in this device's LM Studio when the gateway asks, if the owner has allowed it.
// A device that is busy (for example a game is running) refuses, so a remote load cannot take its GPU.
export function createModelServer(opts: { enabled: boolean; isBusy: () => Promise<boolean>; lms?: Lms }) {
  const lms = opts.lms ?? (realLms as Lms);
  return {
    enabled: opts.enabled,
    async handle(msg: ModelMessage, send: (m: TunnelMessage) => void): Promise<void> {
      const reply = (ok: boolean, output: string): void => send({ type: "tool-result", id: msg.id, ok, output });
      if (!opts.enabled) return reply(false, "remote model control is not enabled on this device (set ALLOW_MODEL_CONTROL=1)");
      try {
        if (await opts.isBusy()) return reply(false, "this device is busy right now");
        if (msg.op === "load") {
          const model = validateModel(msg.model);
          const contextLength = validateContext(msg.contextLength);
          await lms.serverStart().catch(() => undefined);
          return reply(true, (await lms.load(model, contextLength)) || `loaded ${model}`);
        }
        const model = msg.model === undefined ? undefined : validateModel(msg.model);
        return reply(true, (await lms.unload(model)) || (model ? `unloaded ${model}` : "unloaded all models"));
      } catch (err) {
        return reply(false, (err as Error).message);
      }
    },
  };
}

export type ModelServer = ReturnType<typeof createModelServer>;
