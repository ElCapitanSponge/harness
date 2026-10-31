import { execFile } from "node:child_process";
import type { ChatRequest } from "@harness/core";

export type Exec = (bin: string, args: string[], input: string) => Promise<string>;

// Runs the official `claude` CLI in headless mode so the user's own login and plan are used.
export const defaultExec: Exec = (bin, args, input) =>
  new Promise((resolve, reject) => {
    const child = execFile(bin, args, { maxBuffer: 32 * 1024 * 1024, timeout: 300_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || stdout.trim() || err.message));
      else resolve(stdout);
    });
    child.stdin?.end(input);
  });

export function toPrompt(req: ChatRequest): { system?: string; prompt: string } {
  const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const turns = req.messages.filter((m) => m.role !== "system");
  const prompt =
    turns.length === 1 ? turns[0]!.content : turns.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
  return { system: system || undefined, prompt };
}

export function buildArgs(req: ChatRequest, system?: string): string[] {
  const alias = req.model.replace(/^claude:?/, "");
  const args = ["-p", "--output-format", "json", "--no-session-persistence", "--tools", ""];
  if (alias) args.push("--model", alias);
  if (system) args.push("--append-system-prompt", system);
  return args;
}

export interface ClaudeResult {
  text: string;
  model: string;
}

export async function runClaude(bin: string, req: ChatRequest, exec: Exec = defaultExec): Promise<ClaudeResult> {
  const { system, prompt } = toPrompt(req);
  const out = await exec(bin, buildArgs(req, system), prompt);
  const parsed = JSON.parse(out) as { result?: string; is_error?: boolean; model?: string };
  if (parsed.is_error || typeof parsed.result !== "string") {
    throw new Error(parsed.result ?? "claude returned no result");
  }
  return { text: parsed.result, model: parsed.model ?? req.model };
}

export function toOpenAIResponse(r: ClaudeResult) {
  return {
    id: `chatcmpl-claude-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: r.model,
    choices: [{ index: 0, message: { role: "assistant", content: r.text }, finish_reason: "stop" }],
  };
}
