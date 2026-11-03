import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { textOf, type ChatRequest, type ClaudeLimits, type ToolCall } from "@harness/core";
import { ClaudeLimitError, limitedUntil, readLimits, type RateLimitInfo } from "./limits.js";
import { parseToolCalls, renderToolCall, renderToolResult, toolInstructions } from "./tools.js";

export { ClaudeLimitError } from "./limits.js";

export type Exec = (bin: string, args: string[], input: string) => Promise<string>;

// An empty folder to run the program in, so it finds no project instructions or memory files of its own: what it knows is what
// the gateway sent. Its login and plan are still the user's.
export const isolatedDir = (): string => {
  const dir = path.join(os.tmpdir(), "torii-claude");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

// Where the program keeps the conversations it was run for in the folder above: one file each, in a folder named after it.
export const conversationsDir = (cwd: string = isolatedDir(), home: string = os.homedir()): string => {
  return path.join(home, ".claude", "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
};

// Removes conversations the harness left there that have not been used for a while. Only that folder is touched, never the person's own.
export const pruneConversations = (maxAgeMs: number = 3 * 24 * 3_600_000, dir: string = conversationsDir(), now: number = Date.now()): number => {
  let removed = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (name.endsWith(".jsonl") && now - fs.statSync(file).mtimeMs > maxAgeMs) {
        fs.rmSync(file, { force: true });
        removed++;
      }
    }
  } catch {
    // Nothing kept yet, or not readable: nothing to remove.
  }
  return removed;
};

// Runs the official `claude` CLI in headless mode so the user's own login and plan are used.
export const defaultExec: Exec = (bin, args, input) => {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { maxBuffer: 32 * 1024 * 1024, timeout: 300_000, cwd: isolatedDir() }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim() || stdout.trim() || err.message));
      } else {
        resolve(stdout);
      }
    });
    child.stdin?.end(input);
  });
};

// The turns of a request: everything but the system messages.
export const turnsOf = (req: ChatRequest): ChatRequest["messages"] => {
  return req.messages.filter((m) => {
    return m.role === "user" || m.role === "assistant" || m.role === "tool";
  });
};

export const toPrompt = (req: ChatRequest): { system?: string; prompt: string } => {
  const tools = req.tools ?? [];
  const system = [
    ...req.messages.filter((m) => {
      return m.role === "system";
    }).map((m) => {
      return textOf(m.content);
    }),
    ...(tools.length > 0 ? [toolInstructions(tools)] : []),
  ].join("\n\n");
  // A tool result names its tool only by the id of the call it answers, so the names are remembered as the calls go by.
  const names = new Map<string, string>();
  const turns = turnsOf(req);
  // With a conversation of the program's own to carry on, only what it has not seen is sent.
  const skip = Math.min(req.continuation?.seen ?? 0, turns.length - 1);
  const lines = turns.map((m) => {
    if (m.role === "tool") {
      return renderToolResult(names.get(m.tool_call_id ?? "") ?? m.name ?? "tool", textOf(m.content));
    }
    const calls = m.tool_calls ?? [];
    for (const call of calls) {
      names.set(call.id, call.function.name);
    }
    const said = textOf(m.content);
    const label = m.role === "user" ? "User" : "Assistant";
    return [`${label}: ${said}`.trimEnd(), ...calls.map(renderToolCall)].join("\n");
  });
  const prompt = turns.length === 1 && turns[0]?.role === "user" ? textOf(turns[0].content) : lines.slice(skip).join("\n\n");
  return { system: system || undefined, prompt };
};

// Used when the conversation has no system message of its own.
const DEFAULT_SYSTEM = "You are a helpful assistant. Answer clearly and say so when you are not sure.";

// A system prompt longer than this goes to the program in a file, not on its command line. The tool instructions grow with the tools offered,
// and a command line over the operating system's limit (about 8,000 characters through a .cmd shim on Windows) fails with spawn ENAMETOOLONG.
export const MAX_INLINE_SYSTEM = 6000;

export const buildArgs = (req: ChatRequest, system?: string, systemFile?: string): string[] => {
  const alias = req.model.replace(/^claude:?/, "");
  // stream-json carries the plan's usage windows (rate_limit_event) that plain json leaves out; it needs --verbose.
  // Torii supplies the whole context itself: its own system prompt replaces the program's (which describes tools it is not given here), and
  // extra tool servers and skills from the user's own setup are left out, so a chat is not coloured by them and costs less.
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--tools", "", "--strict-mcp-config", "--disable-slash-commands"];
  // Without a conversation to carry on, nothing is kept. With one, the program keeps it so the next step sends only what is new: sending
  // the whole transcript again as one longer message is never found in its prompt cache, and is paid for in full every step.
  if (req.continuation) {
    args.push(req.continuation.seen > 0 ? "--resume" : "--session-id", req.continuation.id);
  } else {
    args.push("--no-session-persistence");
  }
  if (alias) {
    args.push("--model", alias);
  }
  // How hard Claude thinks, where the program allows it: low, medium, high, xhigh or max.
  if (req.effort) {
    args.push("--effort", req.effort);
  }
  args.push(...(systemFile ? ["--system-prompt-file", systemFile] : ["--system-prompt", system ?? DEFAULT_SYSTEM]));
  return args;
};

export interface ClaudeResult {
  text: string;
  model: string;
  // The model the program says it used, read from its own output. Absent when it said nothing, so the caller can say so instead of guessing.
  reportedModel?: string;
  // That model's context window in tokens, when the program reported it.
  contextWindow?: number;
  // The tools Claude asked to use, when tools were offered. The coding loop runs them and sends the results back.
  toolCalls?: ToolCall[];
  // What the program counted for the call. Prompt tokens include its cached input.
  usage?: { inputTokens: number; outputTokens: number };
  limits?: ClaudeLimits;
  // Where the program's conversation stands after this call, for the next one: it holds every turn of the request and its own reply.
  continuation?: { id: string; seen: number };
}

interface ResultEvent {
  result?: string;
  is_error?: boolean;
  model?: string;
  // Per model, what the call used, including the window: the program's own account of which model answered.
  modelUsage?: Record<string, { contextWindow?: number } | undefined>;
  usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number };
}

const LIMIT_WORDS = /limit|quota|usage cap|too many requests/i;

// Reads what the claude program printed: a stream of JSON lines, or (older versions, tests) one JSON object.
export const parseClaudeOutput = (out: string, fallbackModel: string, now = Date.now()): ClaudeResult => {
  const events: Record<string, unknown>[] = [];
  const text = out.trim();
  if (text.startsWith("{") && !text.includes("\n{")) {
    events.push(JSON.parse(text) as Record<string, unknown>);
  } else {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      try {
        events.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // Not JSON: ignore, the result event is what matters.
      }
    }
  }

  const result = events.findLast((e) => {
    return e.type === "result" || typeof e.result === "string" || e.is_error === true;
  }) as ResultEvent | undefined;
  const assistantModel = (events.find((e) => {
    return e.type === "assistant";
  }) as { message?: { model?: string } } | undefined)?.message?.model;
  const initModel = (events.find((e) => {
    return e.type === "system" && typeof e.model === "string";
  }) as { model?: string } | undefined)?.model;
  const info = (events.findLast((e) => {
    return e.type === "rate_limit_event";
  }) as { rate_limit_info?: RateLimitInfo } | undefined)?.rate_limit_info;
  const limits = info ? readLimits(info, now) : undefined;

  if (!result) {
    throw new Error("claude returned no result");
  }
  if (result.is_error || typeof result.result !== "string") {
    const message = result.result ?? "claude returned no result";
    // A refusal for hitting a limit is told apart from other failures by the wording, and by the program saying it rejected the call.
    if (result.is_error && (LIMIT_WORDS.test(message) || (limits !== undefined && /reject/i.test(limits.status)))) {
      const known = limits ?? { status: "limited", observedAt: now };
      throw new ClaudeLimitError(message, { ...known, limitedUntil: limitedUntil(known, info, now) });
    }
    throw new Error(message);
  }

  const u = result.usage;
  const usage = u ? { inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), outputTokens: u.output_tokens ?? 0 } : undefined;
  // Where the program names the model: its init message, a reply, the result, or the one model its usage was counted against.
  const reportedModel = [result.model, initModel, assistantModel, Object.keys(result.modelUsage ?? {})[0]].find((m) => {
    return typeof m === "string" && m !== "";
  });
  const contextWindow = reportedModel === undefined ? undefined : result.modelUsage?.[reportedModel]?.contextWindow;
  return {
    text: result.result,
    model: reportedModel ?? fallbackModel,
    ...(reportedModel === undefined ? {} : { reportedModel }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(usage ? { usage } : {}),
    ...(limits ? { limits } : {}),
  };
};

const ask = async (bin: string, req: ChatRequest, exec: Exec): Promise<ClaudeResult> => {
  const { system, prompt } = toPrompt(req);
  const systemFile = system !== undefined && system.length > MAX_INLINE_SYSTEM ? path.join(isolatedDir(), `system-${randomUUID()}.txt`) : undefined;
  let out: string;
  try {
    if (systemFile) {
      fs.writeFileSync(systemFile, system ?? "");
    }
    out = await exec(bin, buildArgs(req, system, systemFile), prompt);
  } finally {
    if (systemFile) {
      fs.rmSync(systemFile, { force: true });
    }
  }
  const result = parseClaudeOutput(out, req.model);
  return req.continuation ? { ...result, continuation: { id: req.continuation.id, seen: turnsOf(req).length + 1 } } : result;
};

export const runClaude = async (bin: string, req: ChatRequest, exec: Exec = defaultExec): Promise<ClaudeResult> => {
  let result: ClaudeResult;
  try {
    result = await ask(bin, req, exec);
  } catch (err) {
    // A conversation the program no longer has (pruned, or on another install) is started again from the whole transcript.
    if (!req.continuation || req.continuation.seen === 0 || err instanceof ClaudeLimitError) {
      throw err;
    }
    result = await ask(bin, { ...req, continuation: { id: randomUUID(), seen: 0 } }, exec);
  }
  const tools = req.tools ?? [];
  if (tools.length === 0) {
    return result;
  }
  // With tools offered, the reply is read for requests to use them, which become ordinary tool calls.
  const parsed = parseToolCalls(result.text, tools);
  const note = parsed.unknown.length > 0 ? `\n\n(Claude asked for a tool that is not available: ${parsed.unknown.join(", ")}.)` : "";
  return { ...result, text: `${parsed.text}${note}`.trim(), ...(parsed.calls.length > 0 ? { toolCalls: parsed.calls } : {}) };
};

// Claude answers in one piece, so a streamed reply is a single content chunk (with any tool calls whole), a stop chunk and [DONE].
export const toSse = (r: ClaudeResult): string => {
  const id = `chatcmpl-claude-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta: object, finish: string | null) => {
    return `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: r.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  };
  const calls = (r.toolCalls ?? []).map((c, index) => {
    return { index, ...c };
  });
  const first = { role: "assistant", content: r.text, ...(calls.length > 0 ? { tool_calls: calls } : {}) };
  return chunk(first, null) + chunk({}, calls.length > 0 ? "tool_calls" : "stop") + "data: [DONE]\n\n";
};

export const toOpenAIResponse = (r: ClaudeResult) => {
  const calls = r.toolCalls ?? [];
  return {
    id: `chatcmpl-claude-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: r.model,
    choices: [{ index: 0, message: { role: "assistant", content: r.text, ...(calls.length > 0 ? { tool_calls: calls } : {}) }, finish_reason: calls.length > 0 ? "tool_calls" : "stop" }],
  };
};
