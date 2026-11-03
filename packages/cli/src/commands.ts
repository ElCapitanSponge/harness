import { parseArgs } from "node:util";
import type { PrintOptions } from "./print.js";

export type Command
  = | { name: "nodes" }
    | { name: "models" }
    | { name: "sessions"; all?: boolean }
    | { name: "export"; id: string }
    | { name: "import"; file: string; all: boolean; pick?: number; model?: string }
    | { name: "settings"; device: string; key?: string; value?: unknown }
    | { name: "chat"; model: string; prompt: string }
    | { name: "code"; model: string; prompt: string; yes: boolean; device?: string; root?: string; resume?: string; continue: boolean; print?: PrintOptions | undefined }
    | { name: "tool"; device: string; root: string; tool: string; args: Record<string, unknown> }
    | { name: "load"; model: string; contextLength?: number; device?: string }
    | { name: "unload"; model?: string; device?: string }
    | { name: "help" };

export const USAGE = `harness - talk to local models and Claude through the gateway

Usage:
  harness nodes                         list nodes reporting to the gateway
  harness models                        list models across nodes
  harness sessions [--all]              list saved conversations (chats and coding sessions); --all adds the archived ones
  harness export <id>                   print a saved conversation as markdown (redirect it to a file)
  harness import <file> [-n number | --all] [-m model]
                                        bring in a Claude Code .jsonl, a ChatGPT or Claude.ai export, or a
                                        markdown/text transcript; with several conversations in the file,
                                        pick one by number (shown when you omit it) or take them all
  harness settings <device> [key json] show a device's settings, or change one (the device must run
                                        with REMOTE_CONFIG=1), e.g. settings anakin claude true
  harness chat [-m model] [prompt...]   one-shot chat, or interactive with no prompt
  harness code [-m model] [-y] [-d device [-r root]] [--continue | --resume id] [-p [--output-format json]] [prompt...]
                                        work on the files in the current directory (read, edit, run
                                        commands). Runs on this machine; claude models launch Claude Code.
                                        --continue / --resume go back to a saved coding session
                                        -p is for scripts: it never asks, prints only the final reply
                                        (or one JSON object), and exits 0 only if the turn got a reply
  harness tool <device> <root> <tool> [json-args]
                                        run one tool on a connected device (debugging the remote tools)
  harness load <model> [-c tokens] [-d device]
                                        load a model in LM Studio, here or on a connected device
                                        (the device must run its agent with ALLOW_MODEL_CONTROL=1)
  harness unload [model] [-d device]    unload one model, or all if omitted

Models: a loaded model id, "auto", "claude", or "claude:<alias>" (e.g. claude:sonnet).
Env: GATEWAY_URL (default http://127.0.0.1:8787)`;

// Apart from the rest because a name with a hyphen has to be quoted, and then the style wants every name in the same object quoted.
const LONG_OPTIONS = { "output-format": { type: "string" } } as const;

// Print mode is on with -p; --output-format only makes sense there.
const printOptions = (print: boolean | undefined, format: string | undefined): PrintOptions | undefined => {
  if (format !== undefined && format !== "text" && format !== "json") {
    throw new Error(`--output-format must be text or json, not "${format}"`);
  }
  if (!print) {
    if (format !== undefined) {
      throw new Error("--output-format only works with --print (-p)");
    }
    return undefined;
  }
  return { format: format === "json" ? "json" : "text" };
};

export const parseCommand = (argv: string[]): Command => {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      model: { type: "string", short: "m" },
      context: { type: "string", short: "c" },
      help: { type: "boolean", short: "h" },
      yes: { type: "boolean", short: "y" },
      device: { type: "string", short: "d" },
      root: { type: "string", short: "r" },
      resume: { type: "string" },
      continue: { type: "boolean" },
      print: { type: "boolean", short: "p" },
      ...LONG_OPTIONS,
      all: { type: "boolean" },
      number: { type: "string", short: "n" },
    },
  });
  const [name, ...rest] = positionals;
  if (values.help || !name || name === "help") {
    return { name: "help" };
  }

  switch (name) {
    case "nodes":
    case "models":
      return { name };
    case "sessions":
      return values.all ? { name, all: true } : { name };
    case "export": {
      if (!rest[0]) {
        throw new Error("export needs a conversation id (see: harness sessions)");
      }
      return { name: "export", id: rest[0] };
    }
    case "import": {
      if (!rest[0]) {
        throw new Error("import needs a file");
      }
      const pick = values.number ? Number(values.number) : undefined;
      if (pick !== undefined && (!Number.isInteger(pick) || pick < 1)) {
        throw new Error(`invalid number: ${values.number ?? ""}`);
      }
      return { name: "import", file: rest[0], all: values.all ?? false, pick, model: values.model };
    }
    case "settings": {
      const [device, key, json] = rest;
      if (!device) {
        throw new Error("settings needs a <device>");
      }
      if (key === undefined) {
        return { name: "settings", device };
      }
      if (json === undefined) {
        throw new Error("settings <device> <key> needs a JSON value");
      }
      try {
        return { name: "settings", device, key, value: JSON.parse(json) as unknown };
      } catch {
        throw new Error("the value must be valid JSON, e.g. true or [\"read_file\"]");
      }
    }
    case "chat":
      return { name: "chat", model: values.model ?? "auto", prompt: rest.join(" ").trim() };
    case "code":
      return { name: "code", model: values.model ?? "auto", prompt: rest.join(" ").trim(), yes: values.yes ?? false, device: values.device, root: values.root, resume: values.resume, continue: values.continue ?? false, print: printOptions(values.print, values["output-format"]) };
    case "tool": {
      const [device, root, tool, json] = rest;
      if (!device || !root || !tool) {
        throw new Error("tool needs <device> <root> <tool> [json-args]");
      }
      let args: unknown = {};
      if (json) {
        try {
          args = JSON.parse(json);
        } catch {
          throw new Error("json-args must be valid JSON");
        }
      }
      if (typeof args !== "object" || args === null || Array.isArray(args)) {
        throw new Error("json-args must be a JSON object");
      }
      return { name: "tool", device, root, tool, args: args as Record<string, unknown> };
    }
    case "load": {
      const model = rest[0];
      if (!model) {
        throw new Error("load needs a model id");
      }
      const contextLength = values.context ? Number(values.context) : undefined;
      if (contextLength !== undefined && (!Number.isInteger(contextLength) || contextLength <= 0)) {
        throw new Error(`invalid context length: ${values.context}`);
      }
      return { name: "load", model, contextLength, device: values.device };
    }
    case "unload":
      return { name: "unload", model: rest[0], device: values.device };
    default:
      throw new Error(`unknown command: ${name}`);
  }
};
