import { randomUUID } from "node:crypto";
import { sseData, type ChatMessage, type LiveSessionEvent, type SessionEvent, type SessionInfo, type Tool, type ToolCall } from "@harness/core";
import { runTurn, systemPrompt, tools as allTools, type StreamHooks, type ToolSpec } from "@harness/tools";
import type { Registry } from "./registry.js";
import type { Relay } from "./relay.js";
import type { ModelLoader } from "./loader.js";
import { isClaudeModel } from "./router.js";
import { ClaudeState, askClaude } from "./claude.js";
import { estimateTokens, type UsageLedger } from "./ledger.js";
import { resolveRoute } from "./routing.js";

export type { SessionEvent, SessionInfo };

export type Complete = (model: string, messages: ChatMessage[], tools: Tool[], signal: AbortSignal, hooks?: StreamHooks) => Promise<ChatMessage>;

// Everything needed to bring a session back after a restart. Always taken at a turn boundary, never mid-turn.
export interface StoredSession {
  id: string;
  title: string;
  model: string;
  device: string;
  root: string;
  created: number;
  updated: number;
  history: ChatMessage[];
  events: SessionEvent[];
}

export interface SessionStore {
  save(session: StoredSession): Promise<void>;
  remove(id: string): Promise<void>;
}

// Answers one model call for a coding session by routing it through the pool, like any other chat request. It asks for a
// stream so the caller can show the model's thinking and answer as they arrive, and returns the finished message.
// The window assumed for Claude models, which the Claude program does not report.
const CLAUDE_CONTEXT = 200_000;

export const createCompleter = (deps: { registry: Registry; relay: Pick<Relay, "request" | "callClaude">; loader: Pick<ModelLoader, "ensure">; claude?: ClaudeState }): Complete => {
  return async (model, messages, tools, signal, hooks) => {
    // Claude answers through a device that is logged in to it, in one piece.
    if (isClaudeModel(model)) {
      hooks?.stage?.("waiting", "Claude");
      const claudeStarted = Date.now();
      const { result, device } = await askClaude({ registry: deps.registry, relay: deps.relay, state: deps.claude ?? new ClaudeState() }, model, messages);
      hooks?.stage?.("writing");
      hooks?.text?.(result.text);
      // The program's own count where it gave one (cached input included), otherwise an estimate, against a 200k window.
      hooks?.usage?.({
        model,
        device,
        promptTokens: result.usage?.inputTokens ?? estimateTokens(JSON.stringify(messages)),
        completionTokens: result.usage?.outputTokens ?? estimateTokens(result.text),
        durationMs: Date.now() - claudeStarted,
        contextLength: CLAUDE_CONTEXT,
        estimated: result.usage === undefined,
      });
      return { role: "assistant", content: result.text };
    }
    hooks?.stage?.("routing", model);
    const route = await resolveRoute({ registry: deps.registry, loader: deps.loader }, { model, messages, tools }, (step) => {
      hooks?.stage?.(step.type, step.model);
    });
    hooks?.stage?.("waiting", `${route.model} on ${route.node.nodeId}`);
    const started = Date.now();
    const res = await deps.relay.request(route.node.nodeId, JSON.stringify({ model: route.model, messages, tools: tools.length > 0 ? tools : undefined, stream: true, stream_options: { include_usage: true } }), signal);
    const contextLength = route.node.models.find((m) => {
      return m.id === route.model;
    })?.contextLength;
    const report = (message: ChatMessage, reported?: { prompt_tokens?: number; completion_tokens?: number }): void => {
      const estimated = reported?.prompt_tokens === undefined || reported.completion_tokens === undefined;
      hooks?.usage?.({
        model: route.model,
        device: route.node.nodeId,
        promptTokens: reported?.prompt_tokens ?? estimateTokens(JSON.stringify(messages)),
        completionTokens: reported?.completion_tokens ?? estimateTokens(JSON.stringify(message)),
        durationMs: Date.now() - started,
        contextLength,
        estimated,
      });
    };

    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
      // An error, or a server that answered in one piece anyway.
      const body = (await res.json().catch(() => {
        return undefined;
      })) as { error?: { message?: string }; choices?: { message?: ChatMessage }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } } | undefined;
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `node ${route.node.nodeId} returned ${res.status}`);
      }
      const message = body?.choices?.[0]?.message;
      if (!message) {
        throw new Error("the model returned no message");
      }
      report(message, body.usage);
      return message;
    }
    let reported: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    const message = await assembleStream(res, hooks, (usage) => {
      reported = usage;
    });
    report(message, reported);
    return message;
  };
};

interface StreamDelta {
  content?: string | null;
  reasoning_content?: string | null;
  reasoning?: string | null;
  tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
}

// Reads a chat completion stream, reporting text and reasoning as they arrive, and builds the finished message.
export const assembleStream = async (res: Response, hooks?: StreamHooks, onUsage?: (usage: { prompt_tokens?: number; completion_tokens?: number }) => void): Promise<ChatMessage> => {
  let content = "";
  let reasoning = "";
  const calls: { id: string; name: string; args: string }[] = [];

  for await (const data of sseData(res.body as ReadableStream<Uint8Array>)) {
    if (data === "[DONE]") {
      break;
    }
    let chunk: { error?: { message?: string }; choices?: { delta?: StreamDelta }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } | null };
    try {
      chunk = JSON.parse(data) as typeof chunk;
    } catch {
      continue;
    }
    if (chunk.error) {
      throw new Error(chunk.error.message ?? "the model stream failed");
    }
    // The server's own count arrives in the last chunk when asked for.
    if (chunk.usage) {
      onUsage?.(chunk.usage);
    }
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) {
      continue;
    }

    const thought = delta.reasoning_content ?? delta.reasoning;
    if (thought) {
      if (reasoning === "" && content === "") {
        hooks?.stage?.("thinking");
      }
      reasoning += thought;
      hooks?.thinking?.(thought);
    }
    if (delta.content) {
      if (content === "") {
        hooks?.stage?.("writing");
      }
      content += delta.content;
      hooks?.text?.(delta.content);
    }
    // A tool call arrives in pieces keyed by index: the id and name once, the arguments spread over many chunks.
    for (const piece of delta.tool_calls ?? []) {
      const at = piece.index ?? calls.length;
      const call = (calls[at] ??= { id: "", name: "", args: "" });
      if (piece.id) {
        call.id = piece.id;
      }
      if (piece.function?.name) {
        call.name += piece.function.name;
      }
      if (piece.function?.arguments) {
        call.args += piece.function.arguments;
      }
    }
  }

  const toolCalls: ToolCall[] = calls
    .filter((c) => {
      return c.name !== "";
    })
    .map((c, i) => {
      return { id: c.id || `call_${i}`, type: "function" as const, function: { name: c.name, arguments: c.args } };
    });
  if (!content && toolCalls.length === 0) {
    throw new Error("the model returned no message");
  }
  return { role: "assistant", content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}), ...(reasoning ? { reasoning_content: reasoning } : {}) };
};

const APPROVAL_TIMEOUT_MS = 5 * 60_000;

// A conversation is named after what it started with, until the person renames it.
const titleFrom = (text: string): string => {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}...` : oneLine;
};
// Reasoning can run to many thousands of characters a step; keep enough to read without bloating saved sessions.
const MAX_STORED_THOUGHT = 6000;

interface SessionDeps {
  relay: Pick<Relay, "callTool">;
  complete: Complete;
  // Looks up what the device allows right now. Throws if it is not connected or no longer exposes the root.
  resolve(device: string, root: string): ToolSpec[];
  connected(device: string): boolean;
  // Called when a turn ends, with the session in a consistent state.
  persist?(session: Session): void;
  // Every model call is recorded here, for the usage page and the context meter.
  ledger?: UsageLedger;
}

export class Session {
  readonly id: string;
  title: string;
  updated: number;
  readonly model: string;
  readonly device: string;
  readonly root: string;
  readonly created: number;
  readonly events: SessionEvent[];
  private listeners = new Set<(event: SessionEvent | LiveSessionEvent) => void>();
  private history: ChatMessage[];
  private abort: AbortController | undefined;
  private approvals = new Map<string, (approved: boolean, always?: boolean) => void>();
  private always = new Set<string>();

  constructor(
    init: Pick<StoredSession, "id" | "title" | "model" | "device" | "root" | "created" | "updated"> & { history: ChatMessage[]; events?: SessionEvent[] },
    private deps: SessionDeps,
    private autoApprove = false,
  ) {
    this.id = init.id;
    this.title = init.title;
    this.updated = init.updated;
    this.model = init.model;
    this.device = init.device;
    this.root = init.root;
    this.created = init.created;
    this.history = init.history;
    this.events = init.events ?? [];
  }

  // A chat has no device and no tools; a code conversation has both.
  get kind(): "chat" | "code" {
    return this.device === "" ? "chat" : "code";
  }

  get busy(): boolean {
    return this.abort !== undefined;
  }

  info(): SessionInfo {
    return {
      id: this.id,
      model: this.model,
      device: this.device,
      root: this.root,
      busy: this.busy,
      events: this.events.length,
      created: this.created,
      updated: this.updated,
      kind: this.kind,
      title: this.title,
      deviceConnected: this.kind === "chat" || this.deps.connected(this.device),
    };
  }

  toStored(): StoredSession {
    return { id: this.id, title: this.title, model: this.model, device: this.device, root: this.root, created: this.created, updated: this.updated, history: [...this.history], events: [...this.events] };
  }

  // Replays what has already happened, then follows live. Returns an unsubscribe function.
  subscribe(listener: (event: SessionEvent | LiveSessionEvent) => void, from = 0): () => void {
    for (const event of this.events.slice(from)) {
      listener(event);
    }
    this.listeners.add(listener);
    return () => {
      return this.listeners.delete(listener);
    };
  }

  private emit(event: SessionEvent): void {
    this.events.push(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  rename(title: string): void {
    this.title = title;
    this.updated = Date.now();
    this.deps.persist?.(this);
  }

  // Live pieces go to whoever is watching right now and are not kept: the finished event holds the same words.
  private emitLive(event: LiveSessionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  // Throws if a turn is running or the device is not connected: a session whose device is away can be read, not continued.
  send(text: string): void {
    if (this.abort) {
      throw new Error("the session is busy with a turn");
    }
    const specs = this.kind === "chat" ? [] : this.deps.resolve(this.device, this.root);
    if (this.title === "") {
      this.title = titleFrom(text);
    }
    this.abort = new AbortController();
    this.emit({ type: "user", text });
    this.history.push({ role: "user", content: text });
    void this.run(this.abort, specs);
  }

  cancel(): void {
    this.abort?.abort();
    for (const settle of this.approvals.values()) {
      settle(false);
    }
  }

  // Answers a pending approval. Returns false if there is no such approval (already answered or timed out).
  answer(approvalId: string, approved: boolean, always = false): boolean {
    const settle = this.approvals.get(approvalId);
    if (!settle) {
      return false;
    }
    settle(approved, always);
    return true;
  }

  // Changes need an answer from whoever is driving the session. No answer in five minutes counts as no.
  private approve = (tool: string, summary: string): Promise<boolean> => {
    if (this.autoApprove || this.always.has(tool)) {
      return Promise.resolve(true);
    }
    const id = randomUUID();
    return new Promise<boolean>((resolve) => {
      const settle = (approved: boolean, always = false): void => {
        clearTimeout(timer);
        this.approvals.delete(id);
        if (approved && always) {
          this.always.add(tool);
        }
        this.emit({ type: "approval-resolved", id, approved });
        resolve(approved);
      };
      const timer = setTimeout(() => {
        settle(false);
      }, APPROVAL_TIMEOUT_MS);
      this.approvals.set(id, settle);
      this.emit({ type: "approval", id, tool, summary });
    });
  };

  private async run(abort: AbortController, specs: ToolSpec[]): Promise<void> {
    const mark = this.history.length - 1;
    try {
      const outcome = await runTurn(this.history, {
        tools: specs,
        complete: async (messages, tools) => {
          // A cancel that arrived while a tool was running must stop the turn before the next model call.
          if (abort.signal.aborted) {
            throw new Error("cancelled");
          }
          return this.deps.complete(this.model, messages, tools, abort.signal, {
            thinking: (piece) => {
              this.emitLive({ type: "thinking-delta", text: piece });
            },
            text: (piece) => {
              this.emitLive({ type: "text-delta", text: piece });
            },
            stage: (stage, detail) => {
              this.emitLive({ type: "stage", stage, detail });
            },
            usage: (usage) => {
              this.deps.ledger?.record({ time: Date.now(), conversationId: this.id, ...usage });
            },
          });
        },
        run: async (name, args) => {
          const result = await this.deps.relay.callTool(this.device, this.root, name, args, { session: this.id });
          if (!result.ok) {
            throw new Error(result.output);
          }
          return result.output;
        },
        approve: this.approve,
        onThinking: (text) => {
          this.emit({ type: "thinking", text: text.length > MAX_STORED_THOUGHT ? text.slice(0, MAX_STORED_THOUGHT) + "... (shortened)" : text });
        },
        onText: (text) => {
          this.emit({ type: "text", text });
        },
        onTool: (summary) => {
          this.emit({ type: "tool", summary });
        },
      });
      this.emit({ type: "done", ...outcome });
    } catch (err) {
      // Drop a half-finished turn so the next one does not send tool calls that never got results.
      this.history.length = mark;
      this.emit(abort.signal.aborted ? { type: "cancelled" } : { type: "error", message: (err as Error).message });
    } finally {
      this.abort = undefined;
      this.updated = Date.now();
      this.deps.persist?.(this);
    }
  }
}

const CHAT_PROMPT = "You are a helpful assistant. Answer clearly and say so when you are not sure.";

export class Sessions {
  private sessions = new Map<string, Session>();
  private deps: SessionDeps;

  constructor(
    private opts: { registry: Registry; relay: Pick<Relay, "callTool">; complete: Complete; store?: SessionStore; stored?: StoredSession[]; ledger?: UsageLedger },
  ) {
    this.deps = {
      relay: opts.relay,
      complete: opts.complete,
      ledger: opts.ledger,
      resolve: (device, root) => {
        return this.resolve(device, root);
      },
      connected: (device) => {
        return opts.registry.live().some((n) => {
          return n.nodeId === device;
        });
      },
      // A session that was deleted while its last turn was still ending must not be written back.
      persist: (session) => {
        return this.sessions.has(session.id) && void opts.store?.save(session.toStored()).catch((err: unknown) => {
          console.warn(`[gateway] could not save session ${session.id}: ${err instanceof Error ? err.message : String(err)}`);
        });
      },
    };
    // Sessions from before a restart come back as they were at the end of their last turn.
    for (const stored of opts.stored ?? []) {
      this.sessions.set(stored.id, new Session(stored, this.deps));
    }
  }

  private resolve(device: string, root: string): ToolSpec[] {
    const node = this.opts.registry.live().find((n) => {
      return n.nodeId === device;
    });
    if (!node) {
      throw new Error(`device "${device}" is not connected`);
    }
    if (!node.roots?.includes(root)) {
      throw new Error(`device "${device}" does not expose a project root named "${root}"`);
    }
    const specs = allTools.filter((t) => {
      return node.allowedTools?.includes(t.def.function.name);
    });
    if (specs.length === 0) {
      throw new Error(`device "${device}" does not allow any tools`);
    }
    return specs;
  }

  create(input: { model: string; device?: string; root?: string; autoApprove?: boolean }): Session {
    if ((input.device === undefined) !== (input.root === undefined)) {
      throw new Error("a coding session needs both a device and a project root; a chat needs neither");
    }
    const device = input.device ?? "";
    const root = input.root ?? "";
    let prompt = CHAT_PROMPT;
    if (device !== "") {
      if (isClaudeModel(input.model)) {
        throw new Error("Claude models cannot drive a coding session through the gateway yet; pick a local model");
      }
      this.resolve(device, root);
      const platform = this.opts.registry.live().find((n) => {
        return n.nodeId === device;
      })?.platform;
      prompt = systemPrompt(root, platform);
    }
    const now = Date.now();
    const session = new Session(
      { id: randomUUID(), title: "", model: input.model, device, root, created: now, updated: now, history: [{ role: "system", content: prompt }] },
      this.deps,
      input.autoApprove ?? false,
    );
    this.sessions.set(session.id, session);
    this.deps.persist?.(session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => {
      return s.info();
    }).sort((a, b) => {
      return b.updated - a.updated;
    });
  }

  // Stops a session and forgets it, including from disk.
  async delete(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) {
      return false;
    }
    session.cancel();
    this.sessions.delete(id);
    await this.opts.store?.remove(id).catch(() => {
      return undefined;
    });
    return true;
  }
}
