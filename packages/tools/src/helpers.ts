import fs from "node:fs/promises";
import path from "node:path";
import type { Tool } from "@harness/core";

// What every tool shares: its shape, argument reading, output limits, and keeping paths inside the project folder.

export interface ToolContext {
  cwd: string;
}

export interface ToolSpec {
  def: Tool;
  needsApproval: boolean;
  // A program on the device the tool needs, such as gh. A tool whose program is missing is not offered to the model.
  requires?: string;
  describe(args: Args): string;
  run(args: Args, ctx: ToolContext): Promise<string>;
}

export type Args = Record<string, unknown>;

// Prints a tool argument the model supplied, which may be anything, as text for the person.
export const show = (value: unknown, fallback = ""): string => {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
};

export const MAX_OUTPUT = 20_000;

export const str = (args: Args, key: string): string => {
  const v = args[key];
  if (typeof v !== "string") {
    throw new Error(`"${key}" must be a string`);
  }
  return v;
};

export const num = (args: Args, key: string): number | undefined => {
  const v = args[key];
  if (v === undefined || v === null) {
    return undefined;
  }
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`"${key}" must be a number`);
  }
  return v;
};

export const truncate = (text: string, max = MAX_OUTPUT): string => {
  return text.length <= max ? text : `${text.slice(0, max)}\n[... truncated ${text.length - max} characters]`;
};

export const isInside = (root: string, target: string): boolean => {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

// Resolve a path the model gave us and refuse anything outside the working directory,
// including via symlinks (the nearest existing ancestor is resolved before checking).
export const resolveInside = async (cwd: string, requested: string): Promise<string> => {
  const root = await fs.realpath(cwd);
  const abs = path.resolve(root, requested);
  let probe = abs;
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      const full = path.join(real, path.relative(probe, abs));
      if (!isInside(root, full)) {
        throw new Error(`path "${requested}" is outside the working directory`);
      }
      return full;
    } catch (err) {
      if ((err as Error).message.includes("outside the working directory")) {
        throw err;
      }
      const parent = path.dirname(probe);
      if (parent === probe) {
        throw new Error(`cannot resolve path "${requested}"`, { cause: err });
      }
      probe = parent;
    }
  }
};
