import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

export type Run = (bin: string, args: string[]) => Promise<string>;

// `lms` draws a spinner and progress percentage while loading. That arrives as terminal escape codes and a long run
// of repeated "Loading <model> NN% <spinner>" frames. Keep only what a person would want to read.
export function cleanOutput(text: string): string {
  return text
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/Loading \S+ \d+% [⠀-⣿]\s*/g, "")
    .replace(/\r/g, "")
    .trim();
}

const defaultRun: Run = (bin, args) =>
  new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 300_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(cleanOutput(stderr) || cleanOutput(stdout) || err.message));
      else resolve(cleanOutput(stdout));
    });
  });

export const lmsBin = process.env.LMS_BIN ?? path.join(os.homedir(), ".lmstudio", "bin", process.platform === "win32" ? "lms.exe" : "lms");

// Controls the LM Studio on this machine, from the CLI directly or on behalf of the gateway through the node agent.

// Model ids reach the `lms` program as arguments, so one that starts with a dash could be read as an option.
export function validateModel(model: unknown): string {
  if (typeof model !== "string" || !/^[A-Za-z0-9][\w.:@/+() -]{0,199}$/.test(model)) throw new Error("invalid model id");
  return model;
}

export function validateContext(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 256 || value > 4_000_000) throw new Error("invalid context length");
  return value;
}

export function loadArgs(model: string, contextLength?: number): string[] {
  const args = ["load", model, "-y"];
  if (contextLength) args.push("-c", String(contextLength));
  return args;
}

export function unloadArgs(model?: string): string[] {
  return model ? ["unload", model] : ["unload", "--all"];
}

export const lms = {
  async serverStart(run: Run = defaultRun) {
    return run(lmsBin, ["server", "start"]);
  },
  async load(model: string, contextLength?: number, run: Run = defaultRun) {
    return run(lmsBin, loadArgs(model, contextLength));
  },
  async unload(model?: string, run: Run = defaultRun) {
    return run(lmsBin, unloadArgs(model));
  },
};
