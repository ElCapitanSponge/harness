import { createHash, randomUUID } from "node:crypto";
import type { ChatMessage, ClaudeLimits, ClaudeStatus, Effort, Tool } from "@harness/core";
import type { ClaudeResult } from "@harness/claude";
import type { Registry } from "./registry.js";
import type { Relay } from "./relay.js";

// Thrown when Claude cannot be used right now, with when it can be again.
export class ClaudeUnavailableError extends Error {
  readonly until: number;

  constructor(until: number, now: number = Date.now()) {
    super(`Claude is at its usage limit until ${new Date(until).toLocaleString()} (in ${String(Math.max(1, Math.ceil((until - now) / 60_000)))} minutes). Pick a local model for now; Claude comes back by itself.`);
    this.name = "ClaudeUnavailableError";
    this.until = until;
  }
}

// What the gateway knows of the Claude plan: the windows the program reports with each reply, and when a refused request
// can be tried again. In memory only: after a restart the first Claude reply, or the first refusal, brings it back.
export class ClaudeState {
  private limits?: ClaudeLimits;
  private device?: string;
  private until = 0;
  readonly conversations = new ClaudeConversations();

  observe(device: string, limits: ClaudeLimits | undefined): void {
    if (limits) {
      this.limits = limits;
      this.device = device;
      // A reply that worked ends any earlier refusal.
      this.until = 0;
    }
  }

  markLimited(device: string, limits: ClaudeLimits): void {
    this.limits = limits;
    this.device = device;
    this.until = limits.limitedUntil ?? 0;
  }

  // When Claude can be used again, if it cannot be used now.
  limitedUntil(now: number = Date.now()): number | undefined {
    return this.until > now ? this.until : undefined;
  }

  status(now: number = Date.now()): ClaudeStatus {
    const until = this.limitedUntil(now);
    return {
      readable: this.limits !== undefined,
      available: until === undefined,
      device: this.device,
      limitedUntil: until,
      fiveHour: this.limits?.fiveHour,
      sevenDay: this.limits?.sevenDay,
      usingOverage: this.limits?.usingOverage,
      observedAt: this.limits?.observedAt,
    };
  }
}

interface Kept {
  id: string;
  // Turns the program's conversation holds, counting its own last reply.
  seen: number;
  // Of the turns before that reply, to tell whether the conversation still begins the same way.
  digest: string;
  device: string;
  model: string;
}

const turnsOf = (messages: ChatMessage[]): ChatMessage[] => {
  return messages.filter((m) => {
    return m.role !== "system";
  });
};

const digestOf = (turns: ChatMessage[]): string => {
  return createHash("sha256").update(JSON.stringify(turns)).digest("hex");
};

// The program's own conversation for each of ours, so a step of a coding session sends only what is new. Sending the whole transcript
// as one longer message each step is never found in Claude's prompt cache and is paid for in full, so a long session costs far more
// than the same work in Claude Code. In memory only: after a restart the first step starts a conversation again, as one does when the
// history was changed (compacted, rewound, edited), the model or the device differs, or the program no longer has it.
export class ClaudeConversations {
  private readonly kept = new Map<string, Kept>();

  // What to ask for the next step of `conversation`.
  plan(conversation: string, device: string, model: string, messages: ChatMessage[]): { id: string; seen: number } {
    const turns = turnsOf(messages);
    const kept = this.kept.get(conversation);
    if (kept?.device === device && kept.model === model && kept.seen <= turns.length && turns[kept.seen - 1]?.role === "assistant" && digestOf(turns.slice(0, kept.seen - 1)) === kept.digest) {
      return { id: kept.id, seen: kept.seen };
    }
    return { id: randomUUID(), seen: 0 };
  }

  // Notes where the program's conversation stands after a step (or that it could not be used).
  remember(conversation: string, device: string, model: string, messages: ChatMessage[], after: { id: string; seen: number } | undefined): void {
    if (!after) {
      this.kept.delete(conversation);
      return;
    }
    this.kept.set(conversation, { id: after.id, seen: after.seen, digest: digestOf(turnsOf(messages).slice(0, after.seen - 1)), device, model });
  }

  forget(conversation: string): void {
    this.kept.delete(conversation);
  }
}

interface AskDeps {
  registry: Registry;
  relay: Pick<Relay, "callClaude">;
  state: ClaudeState;
}

// One Claude request, through a device that is logged in to it. Refuses at once while Claude is limited, notes the plan's
// windows from each reply, and turns a refusal for hitting a limit into the time it ends.
// `tools` are the ones Claude may ask for, and `effort` how hard it should think. A caller that already has the whole request as JSON
// (the OpenAI-style route) passes it as `body` instead.
export const askClaude = async (deps: AskDeps, model: string, messages: ChatMessage[], options: { tools?: Tool[]; effort?: Effort; body?: string; conversation?: string } = {}): Promise<{ result: ClaudeResult; device: string }> => {
  const until = deps.state.limitedUntil();
  if (until !== undefined) {
    throw new ClaudeUnavailableError(until);
  }
  const device = deps.registry.live().find((n) => {
    return n.claude;
  });
  if (!device) {
    throw new Error("no connected device is logged in to Claude. Turn Claude on for a device where `claude` is logged in (Devices page, or CLAUDE_ENABLED=1)");
  }
  const tools = options.tools !== undefined && options.tools.length > 0 ? options.tools : undefined;
  const continuation = options.conversation && options.body === undefined ? deps.state.conversations.plan(options.conversation, device.nodeId, model, messages) : undefined;
  const reply = await deps.relay.callClaude(device.nodeId, options.body ?? JSON.stringify({ model, messages, tools, effort: options.effort, continuation }));
  if (!reply.ok) {
    if (options.conversation) {
      deps.state.conversations.forget(options.conversation);
    }
    const refusal = parseRefusal(reply.output);
    if (refusal) {
      deps.state.markLimited(device.nodeId, refusal.limits);
      throw new ClaudeUnavailableError(refusal.limits.limitedUntil ?? Date.now() + 15 * 60_000);
    }
    throw new Error(reply.output);
  }
  const result = JSON.parse(reply.output) as ClaudeResult;
  if (options.conversation && options.body === undefined) {
    deps.state.conversations.remember(options.conversation, device.nodeId, model, messages, result.continuation);
  }
  deps.state.observe(device.nodeId, result.limits);
  return { result, device: device.nodeId };
};

const parseRefusal = (output: string): { limits: ClaudeLimits } | undefined => {
  try {
    const data = JSON.parse(output) as { limited?: boolean; limits?: ClaudeLimits };
    return data.limited === true && data.limits ? { limits: data.limits } : undefined;
  } catch {
    return undefined;
  }
};
