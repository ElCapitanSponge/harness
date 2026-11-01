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
export const createModelServer = (opts: { enabled: boolean | (() => boolean); isBusy: () => Promise<boolean>; lms?: Lms }) => {
  const lms = opts.lms ?? (realLms);
  const enabled = (): boolean => {
    return typeof opts.enabled === "function" ? opts.enabled() : opts.enabled;
  };
  return {
    get enabled(): boolean {
      return enabled();
    },
    async handle(msg: ModelMessage, send: (m: TunnelMessage) => void): Promise<void> {
      const reply = (ok: boolean, output: string): void => {
        send({ type: "tool-result", id: msg.id, ok, output });
      };
      if (!enabled()) {
        reply(false, "remote model control is not enabled on this device (set ALLOW_MODEL_CONTROL=1)");
        return;
      }
      try {
        if (await opts.isBusy()) {
          reply(false, "this device is busy right now");
          return;
        }
        if (msg.op === "load") {
          const model = validateModel(msg.model);
          const contextLength = validateContext(msg.contextLength);
          await lms.serverStart().catch(() => {
            return undefined;
          });
          reply(true, (await lms.load(model, contextLength)) || `loaded ${model}`);
          return;
        }
        const model = msg.model === undefined ? undefined : validateModel(msg.model);
        reply(true, (await lms.unload(model)) || (model ? `unloaded ${model}` : "unloaded all models"));
        return;
      } catch (err) {
        reply(false, (err as Error).message);
        return;
      }
    },
  };
};

export type ModelServer = ReturnType<typeof createModelServer>;
