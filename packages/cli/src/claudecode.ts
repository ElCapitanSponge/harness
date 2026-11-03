import { spawn } from "node:child_process";
import type { PrintOptions } from "./print.js";

export const isClaudeModel = (model: string) => {
  return model === "claude" || model.startsWith("claude:");
};

export const claudeArgs = (model: string, prompt: string, print?: PrintOptions): string[] => {
  const alias = model.replace(/^claude:?/, "");
  // Claude Code has the same two flags, so print mode is handed over to it as it is.
  const printing = print ? ["-p", ...(print.format === "json" ? ["--output-format", "json"] : [])] : [];
  return [...printing, ...(alias ? ["--model", alias] : []), ...(prompt ? [prompt] : [])];
};

// Claude already has its own file tools, so for Claude models the CLI hands over to the real
// Claude Code on this machine, in this directory, using this machine's own login.
export const runClaudeCode = (model: string, prompt: string, print?: PrintOptions): Promise<void> => {
  const child = spawn(process.env.CLAUDE_BIN ?? "claude", claudeArgs(model, prompt, print), { stdio: "inherit" });
  return new Promise((resolve, reject) => {
    child.on("error", (err) => {
      reject(new Error(`could not start claude: ${err.message}`));
    });
    child.on("close", (code) => {
      if (code) {
        reject(new Error(`claude exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
};
