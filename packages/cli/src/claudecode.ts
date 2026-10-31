import { spawn } from "node:child_process";

export const isClaudeModel = (model: string) => model === "claude" || model.startsWith("claude:");

export function claudeArgs(model: string, prompt: string): string[] {
  const alias = model.replace(/^claude:?/, "");
  return [...(alias ? ["--model", alias] : []), ...(prompt ? [prompt] : [])];
}

// Claude already has its own file tools, so for Claude models the CLI hands over to the real
// Claude Code on this machine, in this directory, using this machine's own login.
export function runClaudeCode(model: string, prompt: string): Promise<void> {
  const child = spawn(process.env.CLAUDE_BIN ?? "claude", claudeArgs(model, prompt), { stdio: "inherit" });
  return new Promise((resolve, reject) => {
    child.on("error", (err) => reject(new Error(`could not start claude: ${err.message}`)));
    child.on("close", (code) => (code ? reject(new Error(`claude exited with code ${code}`)) : resolve()));
  });
}
