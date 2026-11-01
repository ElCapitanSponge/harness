import { execFile } from "node:child_process";
import { textOf, type ChatRequest, type ClaudeLimits } from "@harness/core";
import { ClaudeLimitError, limitedUntil, readLimits, type RateLimitInfo } from "./limits.js";

export { ClaudeLimitError } from "./limits.js";

export type Exec = (bin: string, args: string[], input: string) => Promise<string>;

// Runs the official `claude` CLI in headless mode so the user's own login and plan are used.
export const defaultExec: Exec = (bin, args, input) => {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { maxBuffer: 32 * 1024 * 1024, timeout: 300_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim() || stdout.trim() || err.message));
      } else {
        resolve(stdout);
      }
    });
    child.stdin?.end(input);
  });
};

export const toPrompt = (req: ChatRequest): { system?: string; prompt: string } => {
  const system = req.messages.filter((m) => {
    return m.role === "system";
  }).map((m) => {
    return textOf(m.content);
  }).join("\n\n");
  const turns = req.messages.filter((m) => {
    return m.role === "user" || m.role === "assistant";
  });
  const prompt
    = turns.length === 1
      ? textOf(turns[0]?.content)
      : turns.map((m) => {
          return `${m.role === "user" ? "User" : "Assistant"}: ${textOf(m.content)}`;
        }).join("\n\n");
  return { system: system || undefined, prompt };
};

export const buildArgs = (req: ChatRequest, system?: string): string[] => {
  const alias = req.model.replace(/^claude:?/, "");
  // stream-json carries the plan's usage windows (rate_limit_event) that plain json leaves out; it needs --verbose.
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--tools", ""];
  if (alias) {
    args.push("--model", alias);
  }
  if (system) {
    args.push("--append-system-prompt", system);
  }
  return args;
};

export interface ClaudeResult {
  text: string;
  model: string;
  // What the program counted for the call. Prompt tokens include its cached input.
  usage?: { inputTokens: number; outputTokens: number };
  limits?: ClaudeLimits;
}

interface ResultEvent {
  result?: string;
  is_error?: boolean;
  model?: string;
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
  return { text: result.result, model: result.model ?? assistantModel ?? fallbackModel, ...(usage ? { usage } : {}), ...(limits ? { limits } : {}) };
};

export const runClaude = async (bin: string, req: ChatRequest, exec: Exec = defaultExec): Promise<ClaudeResult> => {
  const { system, prompt } = toPrompt(req);
  const out = await exec(bin, buildArgs(req, system), prompt);
  return parseClaudeOutput(out, req.model);
};

// Claude answers in one piece, so a streamed reply is a single content chunk, a stop chunk and [DONE].
export const toSse = (r: ClaudeResult): string => {
  const id = `chatcmpl-claude-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta: object, finish: string | null) => {
    return `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: r.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  };
  return chunk({ role: "assistant", content: r.text }, null) + chunk({}, "stop") + "data: [DONE]\n\n";
};

export const toOpenAIResponse = (r: ClaudeResult) => {
  return {
    id: `chatcmpl-claude-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: r.model,
    choices: [{ index: 0, message: { role: "assistant", content: r.text }, finish_reason: "stop" }],
  };
};
