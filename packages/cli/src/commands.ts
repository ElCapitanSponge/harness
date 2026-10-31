import { parseArgs } from "node:util";

export type Command =
  | { name: "nodes" }
  | { name: "models" }
  | { name: "chat"; model: string; prompt: string }
  | { name: "load"; model: string; contextLength?: number }
  | { name: "unload"; model?: string }
  | { name: "help" };

export const USAGE = `harness - talk to local models and Claude through the gateway

Usage:
  harness nodes                         list nodes reporting to the gateway
  harness models                        list models across nodes
  harness chat [-m model] [prompt...]   one-shot chat, or interactive with no prompt
  harness load <model> [-c tokens]      load a model in local LM Studio
  harness unload [model]                unload one model, or all if omitted

Models: a loaded model id, "auto", "claude", or "claude:<alias>" (e.g. claude:sonnet).
Env: GATEWAY_URL (default http://127.0.0.1:8787)`;

export function parseCommand(argv: string[]): Command {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      model: { type: "string", short: "m" },
      context: { type: "string", short: "c" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [name, ...rest] = positionals;
  if (values.help || !name || name === "help") return { name: "help" };

  switch (name) {
    case "nodes":
    case "models":
      return { name };
    case "chat":
      return { name: "chat", model: values.model ?? "auto", prompt: rest.join(" ").trim() };
    case "load": {
      const model = rest[0];
      if (!model) throw new Error("load needs a model id");
      const contextLength = values.context ? Number(values.context) : undefined;
      if (contextLength !== undefined && (!Number.isInteger(contextLength) || contextLength <= 0)) {
        throw new Error(`invalid context length: ${values.context}`);
      }
      return { name: "load", model, contextLength };
    }
    case "unload":
      return { name: "unload", model: rest[0] };
    default:
      throw new Error(`unknown command: ${name}`);
  }
}
