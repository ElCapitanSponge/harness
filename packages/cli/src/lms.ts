import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

export type Run = (bin: string, args: string[]) => Promise<string>;

const defaultRun: Run = (bin, args) =>
  new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 300_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || stdout.trim() || err.message));
      else resolve(stdout.trim());
    });
  });

export const lmsBin = process.env.LMS_BIN ?? path.join(os.homedir(), ".lmstudio", "bin", process.platform === "win32" ? "lms.exe" : "lms");

// Controls the LM Studio on this machine. Remote nodes will get this via their node-agent.
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
