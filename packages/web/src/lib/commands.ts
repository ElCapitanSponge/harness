import { PERMISSION_MODES, type PermissionMode } from "@harness/core";
import type { SkillInfo } from "./types";

// The commands the message box knows without a skill, as Claude Code has them. They are listed with the skills when / is typed, are
// chosen the same way, and are run by the page: a message that starts with one is a command, not something to send.

export interface BuiltinCommand {
  name: string;
  description: string;
  hint?: string;
}

export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  { name: "compact", description: "Summarise the older turns of this conversation now" },
  { name: "clear", description: "Start a fresh conversation in the same project" },
  { name: "model", description: "Choose the model for the next message", hint: "[model]" },
  { name: "permissions", description: "Set how changes are treated in this conversation", hint: "[ask|edits|plan|bypass]" },
  { name: "init", description: "Have the model write an AGENTS.md describing this project" },
];

// A command in the shape the slash menu lists skills in. `source` marks it as a command.
export const asSkillInfo = (command: BuiltinCommand): SkillInfo => {
  return { name: command.name, description: command.description, ...(command.hint ? { hint: command.hint } : {}), length: 0, modelInvocable: false, source: "command" };
};

export const isCommand = (skill: SkillInfo): boolean => {
  return skill.source === "command";
};

// A message that is a command and its arguments: /model qwen, /compact.
export const parseCommand = (text: string): { name: string; args: string } | undefined => {
  const match = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  const name = match?.[1];
  if (!name || !BUILTIN_COMMANDS.some((c) => {
    return c.name === name;
  })) {
    return undefined;
  }
  return { name, args: (match[2] ?? "").trim() };
};

export interface Where {
  // Whether there is a conversation yet (the start screen has none).
  conversation: boolean;
  // Whether it works in a project folder.
  code: boolean;
}

// Why a command cannot be run here, or undefined when it can.
export const unavailable = (name: string, where: Where): string | undefined => {
  switch (name) {
    case "compact":
    case "clear":
      return where.conversation ? undefined : `/${name} works on a conversation that has started.`;
    case "permissions":
      return where.conversation && where.code ? undefined : "/permissions applies to coding sessions: a chat cannot change files.";
    case "init":
      return where.conversation && where.code ? undefined : "/init needs a coding session: a chat has no project folder to describe.";
    default:
      return undefined;
  }
};

// The mode named in /permissions, if it is one.
export const permissionArg = (args: string): PermissionMode | undefined => {
  const wanted = args.trim().toLowerCase();
  return PERMISSION_MODES.find((m) => {
    return m === wanted;
  });
};

// The model named in /model out of those that can be chosen: the exact name, or the only one that contains it. Said in words when it is
// none or several.
export const resolveModel = (args: string, ids: string[]): { id: string } | { error: string } => {
  const wanted = args.trim().toLowerCase();
  const exact = ids.find((id) => {
    return id.toLowerCase() === wanted;
  });
  if (exact) {
    return { id: exact };
  }
  const near = ids.filter((id) => {
    return id.toLowerCase().includes(wanted);
  });
  if (near.length === 1 && near[0]) {
    return { id: near[0] };
  }
  return { error: near.length === 0 ? `No model matches "${args.trim()}".` : `"${args.trim()}" fits ${String(near.length)} models: ${near.slice(0, 4).join(", ")}${near.length > 4 ? ", ..." : ""}. Be more specific.` };
};

export const INIT_PROMPT = [
  "Look through this project and write an AGENTS.md at its root for coding agents (and people) working in it.",
  "Cover what the project is, how to build, test and lint it, how the code is laid out, and the conventions and gotchas that are not obvious from the code.",
  "Read what you need first (README, manifests, config, a sample of the source). If an AGENTS.md or CLAUDE.md already exists, improve it instead of replacing it.",
  "Show me the draft and ask me before you write the file.",
].join(" ");
