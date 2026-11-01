import { textOf, type ChatMessage, type StageName, type Tool, type ToolCall } from "@harness/core";
import { tools as allTools, type ToolContext, type ToolSpec } from "./tools.js";

export type Approver = (tool: string, summary: string) => Promise<boolean>;

// Called as the model writes, for callers that want to show progress before the reply is complete.
export interface StreamHooks {
  thinking?: (piece: string) => void;
  text?: (piece: string) => void;
  // Where the request is before the first word arrives; `detail` names the device or model.
  stage?: (stage: StageName, detail?: string) => void;
  // What a model call cost, once it has finished. Counts are the server's own, or an estimate when it reported none.
  usage?: (usage: CallUsage) => void;
}

export interface CallUsage {
  model: string;
  device: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  // The model's context window in tokens, when known.
  contextLength?: number;
  estimated: boolean;
}

export interface AgentDeps {
  complete(messages: ChatMessage[], tools: Tool[], hooks?: StreamHooks): Promise<ChatMessage>;
  approve: Approver;
  // Where tools run when `run` is not given: the local machine, inside ctx.cwd.
  ctx?: ToolContext;
  // Which tools the model is offered (default: all). A remote device may allow only some.
  tools?: ToolSpec[];
  // Runs a tool somewhere else, such as on a device over the gateway. It should throw on failure.
  run?(name: string, args: Record<string, unknown>): Promise<string>;
  onText: (text: string) => void;
  // The model's reasoning for a step, when it gives any, and the live pieces of it and of the reply as they stream.
  onThinking?: (text: string) => void;
  onThinkingDelta?: (piece: string) => void;
  onTextDelta?: (piece: string) => void;
  onTool: (summary: string) => void;
  maxSteps?: number;
}

export const systemPrompt = (cwd: string, platform: string = process.platform): string => {
  return [
    `You are a coding assistant working in the directory ${cwd} on ${platform}.`,
    "Use the tools to look at and change files in that directory. All paths are relative to it.",
    "Read a file before editing it, make the smallest change that does the job, and run the project's tests or build when you can.",
    "When you have finished, reply briefly with what you did.",
  ].join("\n");
};

const DECLINED = "The user declined this action. Stop and ask what they would like instead.";
const SKIPPED = "Skipped because the user declined an earlier action in this turn.";

const execute = async (call: ToolCall, deps: AgentDeps): Promise<{ result: string; declined?: boolean }> => {
  const tool = (deps.tools ?? allTools).find((t) => {
    return t.def.function.name === call.function.name;
  });
  if (!tool) {
    return { result: `error: unknown tool "${call.function.name}"` };
  }

  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(call.function.arguments || "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    args = parsed as Record<string, unknown>;
  } catch {
    return { result: "error: tool arguments were not a valid JSON object" };
  }

  const summary = tool.describe(args);
  deps.onTool(summary);
  if (tool.needsApproval && !(await deps.approve(call.function.name, summary))) {
    return { result: DECLINED, declined: true };
  }
  try {
    if (deps.run) {
      return { result: await deps.run(call.function.name, args) };
    }
    if (!deps.ctx) {
      throw new Error("no working directory");
    }
    return { result: await tool.run(args, deps.ctx) };
  } catch (err) {
    return { result: `error: ${(err as Error).message}` };
  }
};

// Some models send their reasoning alongside the answer, under one of two names. It is shown but never sent back.
const reasoningOf = (message: ChatMessage): string => {
  const m = message as { reasoning_content?: unknown; reasoning?: unknown };
  const value = typeof m.reasoning_content === "string" ? m.reasoning_content : typeof m.reasoning === "string" ? m.reasoning : "";
  return value.trim();
};

// One user turn: keep calling the model and running its tool calls until it answers without any.
// If the user declines an action the turn ends there, so a model cannot keep retrying it.
export const runTurn = async (history: ChatMessage[], deps: AgentDeps): Promise<{ stopped: boolean; declined?: boolean }> => {
  const defs = (deps.tools ?? allTools).map((t) => {
    return t.def;
  });
  const maxSteps = deps.maxSteps ?? 25;

  for (let step = 0; step < maxSteps; step++) {
    const reply = await deps.complete(history, defs, { thinking: deps.onThinkingDelta, text: deps.onTextDelta });
    const thought = reasoningOf(reply);
    if (thought && deps.onThinking) {
      deps.onThinking(thought);
    }
    const calls = reply.tool_calls ?? [];
    history.push({ role: "assistant", content: reply.content ?? "", ...(calls.length ? { tool_calls: calls } : {}) });

    const text = textOf(reply.content).trim();
    if (text) {
      deps.onText(text);
    }
    if (calls.length === 0) {
      return { stopped: false };
    }

    let declined = false;
    for (const call of calls) {
      if (declined) {
        history.push({ role: "tool", tool_call_id: call.id, content: SKIPPED });
        continue;
      }
      const outcome = await execute(call, deps);
      declined = outcome.declined ?? false;
      history.push({ role: "tool", tool_call_id: call.id, content: outcome.result });
    }
    if (declined) {
      return { stopped: false, declined: true };
    }
  }
  return { stopped: true };
};
