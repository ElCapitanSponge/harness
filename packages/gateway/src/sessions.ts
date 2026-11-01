import { randomUUID } from "node:crypto";
import { effortFor, sseData, textOf, type ChatMessage, type Effort, type NodeRecord, type LiveSessionEvent, type SessionEvent, type SessionInfo, type Tool, type ToolCall } from "@harness/core";
import { contextPrompt, runTurn, systemPrompt, type ProjectContext, tools as allTools, type StreamHooks, type ToolSpec } from "@harness/tools";
import type { Registry } from "./registry.js";
import type { Relay } from "./relay.js";
import type { ModelLoader } from "./loader.js";
import { isClaudeModel } from "./router.js";
import { chooseModel, type AutoChoice, type AutoPrefs } from "./auto.js";
import { ClaudeState, askClaude } from "./claude.js";
import { SUMMARY_PROMPT, compacted, historyTokens, planCompaction, transcriptOf } from "./compaction.js";
import { estimateTokens, type UsageLedger } from "./ledger.js";
import { resolveRoute } from "./routing.js";

export type { SessionEvent, SessionInfo };

// What can be asked of a model call besides the conversation: how hard it should think, for the models that can be told.
export interface CallOptions {
  effort?: Effort;
}

export type Complete = (model: string, messages: ChatMessage[], tools: Tool[], signal: AbortSignal, hooks?: StreamHooks, options?: CallOptions) => Promise<ChatMessage>;

// Everything needed to bring a session back after a restart. Always taken at a turn boundary, never mid-turn.
export interface StoredSession {
  id: string;
  title: string;
  model: string;
  device: string;
  root: string;
  created: number;
  updated: number;
  effort?: Effort;
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
  return async (model, messages, tools, signal, hooks, options) => {
    // Claude answers through a device that is logged in to it, in one piece.
    if (isClaudeModel(model)) {
      hooks?.stage?.("waiting", "Claude");
      const claudeStarted = Date.now();
      const { result, device } = await askClaude({ registry: deps.registry, relay: deps.relay, state: deps.claude ?? new ClaudeState() }, model, messages, { tools, effort: effortFor(model, options?.effort) });
      hooks?.stage?.("writing");
      if (result.text) {
        hooks?.text?.(result.text);
      }
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
      // With tools offered, Claude may answer with requests for them, which the coding loop runs.
      return { role: "assistant", content: result.text, ...(result.toolCalls && result.toolCalls.length > 0 ? { tool_calls: result.toolCalls } : {}) };
    }
    hooks?.stage?.("routing", model);
    const route = await resolveRoute({ registry: deps.registry, loader: deps.loader }, { model, messages, tools }, (step) => {
      hooks?.stage?.(step.type, step.model);
    });
    hooks?.stage?.("waiting", `${route.model} on ${route.node.nodeId}`);
    const started = Date.now();
    const res = await deps.relay.request(route.node.nodeId, JSON.stringify({ model: route.model, messages, tools: tools.length > 0 ? tools : undefined, stream: true, stream_options: { include_usage: true }, reasoning_effort: effortFor(route.model, options?.effort) }), signal);
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
  // What the device says about the project's instructions and skills; without it the session tells the model nothing of them.
  projectContext?(device: string, root: string, session: string): Promise<ProjectContext | undefined>;
  // The text of a skill the person started, with its arguments filled in. Throws if the device cannot load it.
  startSkill?(device: string, root: string, session: string, name: string, args: string): Promise<string>;
  complete: Complete;
  // Looks up what the device allows right now. Throws if it is not connected or no longer exposes the root.
  resolve(device: string, root: string): ToolSpec[];
  connected(device: string): boolean;
  // Called when a turn ends, with the session in a consistent state.
  persist?(session: Session): void;
  // The context window of a model, in tokens, when it is known: a model that is loaded, or Claude.
  contextLength?(model: string): number | undefined;
  // Every model call is recorded here, for the usage page and the context meter.
  ledger?: UsageLedger;
  // What Auto mode needs to choose: the devices, Claude's state, and the owner's preferences.
  pool?(): { nodes: NodeRecord[]; claude: { available: boolean; device?: string; limitedUntil?: number }; prefs: AutoPrefs };
  // Compact when the context is this fraction full (0.8 is 80 percent). Zero or absent turns automatic compaction off.
  compactAt?: number;
}

export type CompactResult = { ok: true; messages: number; tokensBefore: number; tokensAfter: number } | { ok: false; reason: string };

export class Session {
  readonly id: string;
  title: string;
  updated: number;
  // The model that answers the next message. It can change from one message to the next.
  private current: string;
  // How hard the model is asked to think, when one has been chosen. Sent only to a model that can be told.
  effort: Effort | undefined;
  readonly device: string;
  readonly root: string;
  readonly created: number;
  readonly events: SessionEvent[];
  private listeners = new Set<(event: SessionEvent | LiveSessionEvent) => void>();
  private history: ChatMessage[];
  private abort: AbortController | undefined;
  private approvals = new Map<string, (approved: boolean, always?: boolean) => void>();
  private always = new Set<string>();
  // When the history was last compacted and how big it was after, so the meter can show that before the next reply.
  compaction: { time: number; tokensAfter: number } | undefined;
  // Which model on which device made the latest call, to label the reply that follows.
  private lastRoute: { model: string; device: string } | undefined;
  // A skill the person started with the message being sent.
  private starting: { name: string; arguments?: string } | undefined;
  // With the model set to "auto": what was chosen for the turn, kept so the next turn can stay on it.
  private chosen: AutoChoice | undefined;
  // The call whose size last made automatic compaction fail, so one failure does not repeat on every message.
  private compactFailedFor = 0;

  constructor(
    init: Pick<StoredSession, "id" | "title" | "model" | "device" | "root" | "created" | "updated"> & { effort?: Effort; history: ChatMessage[]; events?: SessionEvent[] },
    private deps: SessionDeps,
    private autoApprove = false,
  ) {
    this.id = init.id;
    this.title = init.title;
    this.updated = init.updated;
    this.current = init.model;
    this.effort = init.effort;
    this.device = init.device;
    this.root = init.root;
    this.created = init.created;
    this.history = init.history;
    this.events = init.events ?? [];
  }

  // What was picked: a model, or "auto".
  get model(): string {
    return this.current;
  }

  // The model that actually answers: the one picked, or with Auto the one chosen for this turn.
  private get active(): string {
    return this.current === "auto" ? (this.chosen?.model ?? this.current) : this.current;
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
      effort: this.effort,
      chosen: this.current === "auto" && this.chosen ? { model: this.chosen.model, device: this.chosen.device, reason: this.chosen.reason } : undefined,
    };
  }

  toStored(): StoredSession {
    return { id: this.id, title: this.title, model: this.model, device: this.device, root: this.root, created: this.created, updated: this.updated, effort: this.effort, history: [...this.history], events: [...this.events] };
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
  send(text: string, model?: string, effort?: Effort | "default", skill?: { name: string; arguments?: string }): void {
    if (this.abort) {
      throw new Error("the session is busy with a turn");
    }
    if (skill && (this.kind === "chat" || !this.deps.startSkill)) {
      throw new Error("skills run in a coding session, on a device");
    }
    this.starting = skill;
    if (model !== undefined && model !== this.current) {
      this.current = model;
      // Picking a model takes Auto off, and picking Auto starts its choice afresh.
      this.chosen = undefined;
    }
    // "default" puts the model back to its own setting.
    if (effort !== undefined) {
      this.effort = effort === "default" ? undefined : effort;
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

  // Replaces the older turns with a summary the model writes, so the conversation can go on. The system prompt and the most
  // recent turns stay as they were. Refused while a turn is running.
  async compact(): Promise<CompactResult> {
    if (this.abort) {
      return { ok: false, reason: "the conversation is busy with a turn" };
    }
    const abort = new AbortController();
    this.abort = abort;
    try {
      return await this.compactNow(abort, true);
    } finally {
      this.abort = undefined;
      this.deps.persist?.(this);
    }
  }

  private async compactNow(abort: AbortController, manual: boolean): Promise<CompactResult> {
    const plan = planCompaction(this.history);
    if (!plan) {
      return { ok: false, reason: "there is nothing older to summarise yet" };
    }
    const tokensBefore = historyTokens(this.history);
    const window = this.deps.ledger?.forConversation(this.id).last?.contextLength;
    try {
      const reply = await this.deps.complete(
        this.active,
        [{ role: "system", content: SUMMARY_PROMPT }, { role: "user", content: transcriptOf(plan.older, window ? window * 2 : 48_000) }],
        [],
        abort.signal,
        {
          stage: (stage, detail) => {
            this.emitLive({ type: "stage", stage, detail });
          },
          usage: (usage) => {
            this.deps.ledger?.record({ time: Date.now(), conversationId: this.id, ...usage });
          },
        },
      );
      const summary = textOf(reply.content).trim();
      if (!summary) {
        throw new Error("the model wrote no summary");
      }
      const next = compacted(plan, summary);
      this.history.splice(0, this.history.length, ...next);
      const tokensAfter = historyTokens(next);
      this.compaction = { time: Date.now(), tokensAfter };
      this.emit({ type: "compacted", messages: plan.older.length, tokensBefore, tokensAfter, manual });
      return { ok: true, messages: plan.older.length, tokensBefore, tokensAfter };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  // Before a turn: the last call's time, if it left the context full enough that the conversation should compact first.
  private compactionDue(): number | undefined {
    const at = this.deps.compactAt ?? 0;
    const last = this.deps.ledger?.forConversation(this.id).last;
    // The window of the model that is about to answer, which may not be the one that answered last.
    const window = this.deps.contextLength?.(this.active) ?? last?.contextLength;
    if (at <= 0 || !last || !window || last.time <= this.compactFailedFor || (this.compaction && this.compaction.time >= last.time)) {
      return undefined;
    }
    // After a change of model the last call's size says nothing about the new window, so the history is measured instead.
    const used = last.model === this.active ? last.promptTokens + last.completionTokens : historyTokens(this.history);
    return used / window >= at ? last.time : undefined;
  }

  // Says so before the call, in words, when the conversation cannot fit the model that is about to answer.
  private checkFits(): void {
    const window = this.deps.contextLength?.(this.active);
    const used = historyTokens(this.history);
    if (window !== undefined && used > window * 0.95) {
      throw new Error(`This conversation is about ${String(used)} tokens, more than ${this.active} can hold (${String(window)}). Compact it, or pick a model with a larger window.`);
    }
  }

  // With the model set to "auto", chooses the model for this turn from the conversation and the pool. If none can be used the turn
  // ends at once with the reasons, and the message is not kept in the history.
  private decide(): void {
    if (this.current !== "auto") {
      return;
    }
    const pool = this.deps.pool?.();
    if (!pool) {
      throw new Error("Auto mode is not set up on this gateway; pick a model");
    }
    const result = chooseModel({
      tokens: historyTokens(this.history),
      needsTools: this.kind === "code",
      current: this.chosen?.model ?? this.lastRoute?.model,
      ...pool,
    });
    if ("none" in result) {
      throw new Error(result.none);
    }
    this.chosen = result.chosen;
    this.emitLive({ type: "stage", stage: "routing", detail: result.chosen.reason });
  }

  // Asks the device for the project's instruction files and skills, and puts them in the system prompt (replacing what an earlier
  // turn put there). An older device that cannot answer, or any failure, leaves the session as it was. The skill tool is only
  // offered when there is a skill the model may use.
  private async learnProject(specs: ToolSpec[]): Promise<ToolSpec[]> {
    if (!this.deps.projectContext) {
      return specs;
    }
    let context: ProjectContext | undefined;
    try {
      context = await this.deps.projectContext(this.device, this.root, this.id);
    } catch {
      context = undefined;
    }
    if (!context || !Array.isArray(context.skills) || !Array.isArray(context.instructions)) {
      return specs.filter((s) => {
        return s.def.function.name !== "skill";
      });
    }
    const first = this.history[0];
    if (first?.role === "system" && typeof first.content === "string") {
      const base = first.content.split(CONTEXT_MARK)[0] ?? first.content;
      const extra = contextPrompt(context);
      first.content = extra === "" ? base : `${base}${CONTEXT_MARK}${extra}`;
    }
    const usable = context.skills.some((s) => {
      return s.modelInvocable;
    });
    return usable
      ? specs
      : specs.filter((s) => {
          return s.def.function.name !== "skill";
        });
  }

  // If the person started a skill with this message, its instructions go into the conversation in place of the bare command.
  private async runStartedSkill(): Promise<void> {
    const skill = this.starting;
    this.starting = undefined;
    const last = this.history.at(-1);
    if (!skill || !this.deps.startSkill || last?.role !== "user") {
      return;
    }
    const args = skill.arguments?.trim() ?? "";
    const text = await this.deps.startSkill(this.device, this.root, this.id, skill.name, args);
    const typed = typeof last.content === "string" ? last.content : "";
    last.content = `${typed}\n\nThe person started the skill "${skill.name}". Follow its instructions:\n\n${text}`;
    this.emit({ type: "skill", name: skill.name, arguments: args, text });
  }

  private async run(abort: AbortController, offered: ToolSpec[]): Promise<void> {
    let specs = offered;
    try {
      this.decide();
      if (this.kind === "code" && this.deps.projectContext) {
        specs = await this.learnProject(offered);
      }
      if (this.starting) {
        await this.runStartedSkill();
      }
    } catch (err) {
      this.history.pop();
      this.emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      this.abort = undefined;
      this.updated = Date.now();
      this.deps.persist?.(this);
      return;
    }
    // A failure to summarise does not stop the turn; it is tried again after the next model call, not on every message.
    const due = this.compactionDue();
    if (due !== undefined) {
      this.emitLive({ type: "stage", stage: "compacting" });
      if (!(await this.compactNow(abort, false)).ok) {
        this.compactFailedFor = due;
      }
    }
    const mark = this.history.length - 1;
    try {
      this.checkFits();
      const outcome = await runTurn(this.history, {
        tools: specs,
        complete: async (messages, tools) => {
          // A cancel that arrived while a tool was running must stop the turn before the next model call.
          if (abort.signal.aborted) {
            throw new Error("cancelled");
          }
          return this.deps.complete(this.active, messages, tools, abort.signal, {
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
              this.lastRoute = { model: usage.model, device: usage.device };
              this.deps.ledger?.record({ time: Date.now(), conversationId: this.id, ...usage });
            },
          }, { effort: this.effort });
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
          this.emit({ type: "text", text, model: this.lastRoute?.model ?? this.active, device: this.lastRoute?.device, ...(this.current === "auto" && this.chosen ? { reason: this.chosen.reason } : {}) });
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

// Where the project's instructions and skills begin in a coding session's system prompt.
const CONTEXT_MARK = "\n\n--- This project and its owner ---\n";

const CHAT_PROMPT = "You are a helpful assistant. Answer clearly and say so when you are not sure.";

export class Sessions {
  // The context fill at which conversations compact themselves, as a fraction; zero is off.
  get compactAt(): number {
    return this.opts.compactAt ?? 0;
  }

  private sessions = new Map<string, Session>();
  private deps: SessionDeps;

  constructor(
    private opts: { registry: Registry; relay: Pick<Relay, "callTool">; complete: Complete; store?: SessionStore; stored?: StoredSession[]; ledger?: UsageLedger; compactAt?: number; claude?: ClaudeState; autoPrefs?: AutoPrefs; projectContext?: SessionDeps["projectContext"]; startSkill?: SessionDeps["startSkill"] },
  ) {
    this.deps = {
      relay: opts.relay,
      projectContext: opts.projectContext,
      startSkill: opts.startSkill,
      complete: opts.complete,
      ledger: opts.ledger,
      compactAt: opts.compactAt,
      pool: () => {
        const nodes = opts.registry.live();
        const device = nodes.find((n) => {
          return n.claude;
        });
        const limitedUntil = device ? opts.claude?.limitedUntil() : undefined;
        return {
          nodes,
          claude: { available: device !== undefined && limitedUntil === undefined, device: device?.nodeId, limitedUntil },
          prefs: opts.autoPrefs ?? { prefer: [], avoid: [], keepFree: [] },
        };
      },
      resolve: (device, root) => {
        return this.resolve(device, root);
      },
      connected: (device) => {
        return opts.registry.live().some((n) => {
          return n.nodeId === device;
        });
      },
      // A session that was deleted while its last turn was still ending must not be written back.
      contextLength: (model) => {
        if (isClaudeModel(model)) {
          return CLAUDE_CONTEXT;
        }
        return opts.registry.live().flatMap((n) => {
          return n.models;
        }).find((m) => {
          return m.id === model && m.loaded && m.contextLength !== undefined;
        })?.contextLength;
      },
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
    // In a folder that can only be read, tools that could change it are not offered at all, so the model plans around that.
    const readOnly = node.readOnlyRoots?.includes(root) ?? false;
    const specs = allTools.filter((t) => {
      return node.allowedTools?.includes(t.def.function.name) && !(readOnly && t.group === "device" && t.level === "change");
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
      this.resolve(device, root);
      const node = this.opts.registry.live().find((n) => {
        return n.nodeId === device;
      });
      const platform = node?.platform;
      const shell = node?.shell;
      prompt = systemPrompt(root, platform, shell);
      if (this.opts.registry.live().find((n) => {
        return n.nodeId === device;
      })?.readOnlyRoots?.includes(root)) {
        prompt += " This folder is read-only: you can look at its files but cannot change, create or delete anything in it.";
      }
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
