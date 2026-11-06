import { randomUUID } from "node:crypto";
import { effortFor, noImagesReason, type ApprovalPreview, type PermissionMode, sseData, supportsImages, type ImageAttachment, textOf, type ChatMessage, type Effort, type NodeRecord, type PlanStep, type LiveSessionEvent, type QueuedInfo, type SessionEvent, type SessionInfo, type Tool, type ToolCall } from "@harness/core";
import { MAX_SUBAGENTS, MAX_SUBAGENT_DEPTH, agentTool, askTool, contextPrompt, fileChange, planTool, planToolForPlanMode, readQuestion, readPlan, readPlanDocument, readSubagentTask, runTurn, systemPrompt, type ProjectContext, type SkillSummary, tools as allTools, type StreamHooks, type ToolSpec } from "@harness/tools";
import type { Registry } from "./registry.js";
import type { Relay } from "./relay.js";
import type { ModelLoader } from "./loader.js";
import { isClaudeModel } from "./router.js";
import { chooseModel, type AutoChoice, type AutoPrefs } from "./auto.js";
import { ClaudeState, askClaude } from "./claude.js";
import { SUMMARY_PROMPT, compacted, historyTokens, planCompaction, transcriptOf } from "./compaction.js";
import { estimateTokens, type UsageLedger } from "./ledger.js";
import { resolveRoute } from "./routing.js";
import { limitTurns, type Turn } from "./transcripts.js";

export type { SessionEvent, SessionInfo };

// What can be asked of a model call besides the conversation: how hard it should think, for the models that can be told.
export interface CallOptions {
  effort?: Effort;
  // The conversation the call is a step of, so Claude can carry on its own conversation instead of being sent everything again.
  conversation?: string;
}

export type Complete = (model: string, messages: ChatMessage[], tools: Tool[], signal: AbortSignal, hooks?: StreamHooks, options?: CallOptions) => Promise<ChatMessage>;

// What the person adds when they approve a plan: the document as they edited it, and what the conversation becomes (ask before each change, or accept file edits).
export interface PlanAnswer {
  edited?: string | undefined;
  next?: "ask" | "edits" | undefined;
}

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
  // Pinned to the top of the sidebar.
  pinned?: boolean;
  // Put away in the Archive section of the sidebar.
  archived?: boolean;
  // How many of the events the person has read.
  read?: number;
  // How changes are treated: ask (the default), edits, plan or bypass.
  mode?: PermissionMode;
  // The conversation that started this one as a sub-agent, and how deep it is (0 for an ordinary conversation).
  parent?: string;
  depth?: number;
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
      const { result, device } = await askClaude({ registry: deps.registry, relay: deps.relay, state: deps.claude ?? new ClaudeState() }, model, messages, { tools, effort: effortFor(model, options?.effort), conversation: options?.conversation });
      hooks?.stage?.("writing");
      if (result.text) {
        hooks?.text?.(result.text);
      }
      // The program's own count where it gave one (cached input included), otherwise an estimate, against a 200k window.
      hooks?.usage?.({
        // The model the program says answered, so the reply is labelled with it; the requested name when it said nothing.
        model: result.reportedModel ?? model,
        device,
        promptTokens: result.usage?.inputTokens ?? estimateTokens(JSON.stringify(messages)),
        completionTokens: result.usage?.outputTokens ?? estimateTokens(result.text),
        durationMs: Date.now() - claudeStarted,
        contextLength: result.contextWindow ?? CLAUDE_CONTEXT,
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
const QUESTION_TIMEOUT_MS = 10 * 60_000;

// A conversation is named after what it started with, until the person renames it.
const titleFrom = (text: string): string => {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}...` : oneLine;
};
// Reasoning can run to many thousands of characters a step; keep enough to read without bloating saved sessions.
const MAX_STORED_THOUGHT = 6000;
// What a tool returned, as kept in the events for the page to show when a group of actions is opened. The model was given all of it.
const MAX_STORED_OUTPUT = 4000;
// How many messages can wait for a running turn to end.
const MAX_QUEUED = 10;

// A message sent while a turn was running, with everything `send` needs to start it later.
interface QueuedMessage {
  id: string;
  text: string;
  model?: string;
  effort?: Effort | "default";
  skill?: { name: string; arguments?: string };
  images?: ImageAttachment[];
  // When it was queued, in milliseconds since the epoch.
  at: number;
}

interface SessionDeps {
  relay: Pick<Relay, "callTool">;
  // What the device says about the project's instructions and skills; without it the session tells the model nothing of them.
  projectContext?(device: string, root: string, session: string): Promise<ProjectContext | undefined>;
  // The gateway's own skills, available in every conversation, including chats.
  library?: {
    list(): Promise<SkillSummary[]>;
    text(name: string, args: Record<string, unknown>, options?: { byPerson?: boolean }): Promise<string>;
  };
  // Rules remembered for a folder on a device: a tool the person said to always allow there.
  rules?: {
    has(device: string, root: string, tool: string): boolean;
    add(device: string, root: string, tool: string): void;
  };
  // Whether a conversation may be set to run without asking (the owner can turn it off for the gateway).
  allowBypass?: boolean;
  // Starts a child conversation for a sub-agent on the same device and folder.
  spawn?(parent: Session, input: { task: string; model: string; tools: string[] | undefined }): Session;
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
  private approvals = new Map<string, (approved: boolean, always?: boolean | "project", reason?: string, plan?: PlanAnswer) => void>();
  private questions = new Map<string, (answer: string | undefined) => void>();
  // Sub-agents: the conversation that started this one (if any) and how deep it is; the ones this conversation has started; the tools
  // it may use at most (a sub-agent is given a subset of its parent's); and the names it was offered at its last turn.
  readonly parent: string | undefined;
  readonly depth: number;
  private children = new Set<Session>();
  private started = 0;
  private restrict: string[] | undefined;
  private offered: string[] = [];
  // A sub-agent's approvals and questions go to the person through the conversation that started it.
  private delegate: { approve: (tool: string, summary: string, args?: Record<string, unknown>) => Promise<boolean>; ask: (args: Record<string, unknown>) => Promise<string> } | undefined;
  private always = new Set<string>();
  // How changes are treated in this conversation.
  private mode: PermissionMode;
  pinned = false;
  // Put away in the Archive section of the sidebar. Nothing is deleted.
  archived = false;
  // How many of the events the person has read, in any client.
  read = 0;
  // Why the person declined the last action, if they said, so the model is told.
  private declined: string | undefined;
  // What came with the last approval of a plan, read once the plan tool call resumes.
  private planAnswer: PlanAnswer | undefined;
  // When the history was last compacted and how big it was after, so the meter can show that before the next reply.
  compaction: { time: number; tokensAfter: number } | undefined;
  // Which model on which device made the latest call, to label the reply that follows.
  private lastRoute: { model: string; device: string } | undefined;
  // Pictures sent with the message being run.
  private attached: ImageAttachment[] = [];
  // A skill the person started with the message being sent.
  private starting: { name: string; arguments?: string } | undefined;
  // With the model set to "auto": what was chosen for the turn, kept so the next turn can stay on it.
  private chosen: AutoChoice | undefined;
  // The call whose size last made automatic compaction fail, so one failure does not repeat on every message.
  private compactFailedFor = 0;
  // Messages sent while a turn was running, in the order they will be taken up. They are kept here, not on the page, so every client sees the
  // same queue and a reload loses nothing; they are not kept across a restart of the gateway.
  private queue: QueuedMessage[] = [];
  // The queue is held back when the last turn was declined, cancelled or failed: the person is looked to, not the next message sent for them.
  private held = false;
  // Whether the turn that is ending finished (a step-limit stop counts), so the queue may go on.
  private finishedCleanly = false;
  // A queued message the person chose to send now: taken as soon as the running turn has stopped, however it ended.
  private sendFirst: string | undefined;

  constructor(
    init: Pick<StoredSession, "id" | "title" | "model" | "device" | "root" | "created" | "updated"> & { pinned?: boolean; archived?: boolean; read?: number; mode?: PermissionMode; parent?: string; depth?: number; effort?: Effort; history: ChatMessage[]; events?: SessionEvent[] },
    private deps: SessionDeps,
    autoApprove = false,
  ) {
    this.mode = init.mode ?? (autoApprove ? "bypass" : "ask");
    this.pinned = init.pinned === true;
    this.archived = init.archived === true;
    this.read = init.read ?? init.events?.length ?? 0;
    this.id = init.id;
    this.parent = init.parent;
    this.depth = init.depth ?? 0;
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
      mode: this.mode,
      ...(this.parent ? { parent: this.parent } : {}),
      ...(this.pinned ? { pinned: true } : {}),
      ...(this.archived ? { archived: true } : {}),
      ...(this.waiting() ? { waiting: this.waiting() } : {}),
      read: this.read,
      ...(this.queue.length > 0 ? { queued: this.queued(), ...(this.held ? { queueHeld: true } : {}) } : {}),
      chosen: this.current === "auto" && this.chosen ? { model: this.chosen.model, device: this.chosen.device, reason: this.chosen.reason } : undefined,
    };
  }

  toStored(): StoredSession {
    return { id: this.id, title: this.title, model: this.model, device: this.device, root: this.root, created: this.created, updated: this.updated, effort: this.effort, mode: this.mode, ...(this.pinned ? { pinned: true } : {}), ...(this.archived ? { archived: true } : {}), read: this.read, ...(this.parent ? { parent: this.parent } : {}), depth: this.depth, history: [...this.history], events: [...this.events] };
  }

  // Replays what has already happened, then follows live. Returns an unsubscribe function.
  subscribe(listener: (event: SessionEvent | LiveSessionEvent) => void, from = 0): () => void {
    for (const event of this.events.slice(from)) {
      listener(event);
    }
    // A client that joins (or comes back) is told what is waiting; the queue is not among the stored events.
    if (this.queue.length > 0) {
      listener({ type: "queue", messages: this.queued(), held: this.held });
    }
    this.listeners.add(listener);
    return () => {
      return this.listeners.delete(listener);
    };
  }

  // Stores an event and tells whoever is watching. The gateway stamps the time (`at`) so every client, and a reload, shows the same one;
  // an event that already has one (an imported turn) keeps it.
  private emit(event: SessionEvent): void {
    const stamped: SessionEvent = event.at === undefined ? { ...event, at: Date.now() } : event;
    this.events.push(stamped);
    for (const listener of this.listeners) {
      listener(stamped);
    }
  }

  // Whether the conversation is stopped for an answer from the person, and which kind.
  waiting(): "approval" | "question" | undefined {
    if (this.approvals.size > 0) {
      return "approval";
    }
    return this.questions.size > 0 ? "question" : undefined;
  }

  // The person has read this many events, in some client. It only moves forward, and never past what there is.
  markRead(events: number): void {
    const next = Math.min(events, this.events.length);
    if (next > this.read) {
      this.read = next;
      this.deps.persist?.(this);
    }
  }

  setPinned(pinned: boolean): void {
    if (pinned !== this.pinned) {
      this.pinned = pinned;
      this.deps.persist?.(this);
    }
  }

  // Putting a conversation away also unpins it: the two do not go together. Bringing it back leaves it unpinned.
  setArchived(archived: boolean): void {
    if (archived !== this.archived) {
      this.archived = archived;
      if (archived) {
        this.pinned = false;
      }
      this.deps.persist?.(this);
    }
  }

  // Every version of the plan document, oldest first. The latest is the one in force.
  planDocuments(): Extract<SessionEvent, { type: "plan-document" }>[] {
    return this.events.filter((e): e is Extract<SessionEvent, { type: "plan-document" }> => {
      return e.type === "plan-document";
    });
  }

  // A new version is a new stored event (history is never edited); the same text as the latest is not a new version.
  private addPlanDocument(markdown: string, by: "model" | "person"): void {
    const versions = this.planDocuments();
    if (versions.at(-1)?.markdown === markdown) {
      return;
    }
    this.emit({ type: "plan-document", version: versions.length + 1, markdown, by });
  }

  // The plan as the model last sent it, or as the person last cleared it: the latest plan event.
  plan(): PlanStep[] {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i];
      if (event?.type === "plan") {
        return event.steps;
      }
    }
    return [];
  }

  // The person clears the steps that are done. That is a new plan event (history is never edited), and the model is told, because it sends the
  // whole plan each time and would otherwise bring the steps back. Refused while a turn is running, so the note cannot land inside a tool exchange.
  clearDonePlan(): { ok: true; cleared: number } | { ok: false; reason: string } {
    if (this.abort) {
      return { ok: false, reason: "the conversation is busy with a turn" };
    }
    const steps = this.plan();
    const kept = steps.filter((s) => {
      return s.status !== "done";
    });
    const cleared = steps.length - kept.length;
    if (cleared === 0) {
      return { ok: true, cleared };
    }
    this.emit({ type: "plan", steps: kept });
    const listed = kept.map((s, i) => {
      return `${String(i + 1)}. ${s.text} (${s.status})`;
    }).join("\n");
    const left = kept.length === 0
      ? "No steps are left."
      : `The steps left are:\n${listed}`;
    this.history.push({ role: "system", content: `The person cleared the finished steps from the plan. Do not add them back. ${left}` });
    this.deps.persist?.(this);
    return { ok: true, cleared };
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

  // Starts a turn, or, if one is running, queues the message to be taken up when it ends, and says which. Throws if the device is not
  // connected (a session whose device is away can be read, not continued) or the queue is full.
  send(text: string, model?: string, effort?: Effort | "default", skill?: { name: string; arguments?: string }, images?: ImageAttachment[]): "started" | "queued" {
    if (skill && !(this.kind === "code" ? this.deps.startSkill !== undefined || this.deps.library !== undefined : this.deps.library !== undefined)) {
      throw new Error("skills run in a coding session, on a device, or in a chat with the gateway's skill library");
    }
    if (this.abort) {
      if (this.queue.length >= MAX_QUEUED) {
        throw new Error(`${String(MAX_QUEUED)} messages are already waiting`);
      }
      this.queue.push({ id: randomUUID(), text, at: Date.now(), ...(model !== undefined ? { model } : {}), ...(effort !== undefined ? { effort } : {}), ...(skill ? { skill } : {}), ...(images && images.length > 0 ? { images } : {}) });
      this.announceQueue();
      return "queued";
    }
    this.starting = skill;
    this.attached = images ?? [];
    if (model !== undefined && model !== this.current) {
      this.current = model;
      // Picking a model takes Auto off, and picking Auto starts its choice afresh.
      this.chosen = undefined;
    }
    // "default" puts the model back to its own setting.
    if (effort !== undefined) {
      this.effort = effort === "default" ? undefined : effort;
    }
    const allowed = this.kind === "chat" ? [] : this.deps.resolve(this.device, this.root);
    // A sub-agent has the tools it was given and no others.
    const specs = this.restrict
      ? allowed.filter((t) => {
          return this.restrict?.includes(t.def.function.name);
        })
      : allowed;
    if (this.title === "") {
      this.title = titleFrom(text);
    }
    this.abort = new AbortController();
    this.emit({ type: "user", text, ...(images && images.length > 0 ? { images } : {}) });
    this.history.push({ role: "user", content: text });
    void this.run(this.abort, specs);
    return "started";
  }

  private queued(): QueuedInfo[] {
    return this.queue.map((q) => {
      return { id: q.id, text: q.text, images: q.images?.length ?? 0, at: q.at };
    });
  }

  private announceQueue(): void {
    this.emitLive({ type: "queue", messages: this.queued(), held: this.held });
  }

  // Changes the words of a waiting message. False if it is not there (it was taken up, or removed).
  editQueued(id: string, text: string): boolean {
    const item = this.queue.find((q) => {
      return q.id === id;
    });
    if (!item) {
      return false;
    }
    item.text = text;
    this.announceQueue();
    return true;
  }

  removeQueued(id: string): boolean {
    const at = this.queue.findIndex((q) => {
      return q.id === id;
    });
    if (at < 0) {
      return false;
    }
    this.queue.splice(at, 1);
    this.held = this.held && this.queue.length > 0;
    this.announceQueue();
    return true;
  }

  // Sends a waiting message at once. If a turn is running it is cancelled (what it waited to ask counts as declined) and this message goes next,
  // however the turn ends. False if the message is not there. Throws if it cannot start (the device is away), leaving it queued.
  sendQueuedNow(id: string): boolean {
    if (!this.queue.some((q) => {
      return q.id === id;
    })) {
      return false;
    }
    if (this.abort) {
      this.sendFirst = id;
      this.cancel();
      return true;
    }
    this.takeAndSend(id);
    return true;
  }

  // Takes a waiting message out of the queue and starts it; if it cannot start it goes back to where it was.
  private takeAndSend(id: string): void {
    const at = this.queue.findIndex((q) => {
      return q.id === id;
    });
    const item = this.queue[at];
    if (!item) {
      return;
    }
    this.queue.splice(at, 1);
    this.announceQueue();
    try {
      this.send(item.text, item.model, item.effort, item.skill, item.images);
    } catch (err) {
      this.queue.splice(at, 0, item);
      this.announceQueue();
      throw err;
    }
  }

  // Called once a turn has ended and the session is idle. A message the person chose to send now goes first. Otherwise the next waiting
  // message starts, but only if the turn finished: after a decline, a cancel or a failure the queue is held, and goes on after the next turn that
  // finishes (or when the person sends a message from it, or removes it).
  private advance(): void {
    const clean = this.finishedCleanly;
    this.finishedCleanly = false;
    const first = this.sendFirst;
    this.sendFirst = undefined;
    const next = first ?? (clean ? this.queue[0]?.id : undefined);
    if (next === undefined) {
      if (this.queue.length > 0 && !this.held) {
        this.held = true;
        this.announceQueue();
      }
      return;
    }
    this.held = false;
    try {
      this.takeAndSend(next);
    } catch (err) {
      this.emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      this.held = true;
      this.announceQueue();
    }
  }

  cancel(): void {
    this.abort?.abort();
    for (const child of this.children) {
      child.cancel();
    }
    for (const settle of this.approvals.values()) {
      settle(false);
    }
    for (const settle of this.questions.values()) {
      settle(undefined);
    }
  }

  // Answers a pending question. Returns false if there is none by that id (already answered or timed out).
  answerQuestion(id: string, answer: string): boolean {
    const settle = this.questions.get(id);
    if (!settle) {
      return false;
    }
    settle(answer);
    return true;
  }

  // Gives a sub-agent its tools (a subset of this conversation's) and sends its approvals and questions through this one.
  adopt(child: Session, tools: string[] | undefined): void {
    const mine = this.offered.filter((n) => {
      return n !== "agent" || child.depth < MAX_SUBAGENT_DEPTH;
    });
    child.restrict = tools
      ? tools.filter((t) => {
          return mine.includes(t);
        })
      : mine;
    child.delegate = { approve: this.approve, ask: (args) => {
      return this.ask(args);
    } };
    this.children.add(child);
  }

  // Waits for the turn that is running to end and gives its last answer, or why it failed.
  finished(): Promise<{ ok: boolean; text: string }> {
    return new Promise((resolve) => {
      const off = this.subscribe((event) => {
        if (event.type === "done" || event.type === "cancelled" || event.type === "error") {
          off();
          const last = this.events.findLast((e) => {
            return e.type === "text";
          });
          const failure = event.type === "error" ? event.message : event.type === "cancelled" ? "it was cancelled" : undefined;
          resolve(failure === undefined ? { ok: true, text: last?.type === "text" ? last.text : "(it gave no answer)" } : { ok: false, text: failure });
        }
      }, this.events.length);
    });
  }

  // Starts a sub-agent on a task and returns what it answers. It is a conversation of its own, shown under this one.
  private async runSubagent(args: Record<string, unknown>): Promise<string> {
    const task = readSubagentTask(args);
    if (this.depth >= MAX_SUBAGENT_DEPTH) {
      throw new Error(`sub-agents may nest ${String(MAX_SUBAGENT_DEPTH)} deep, and this one is at the limit; do the task yourself`);
    }
    if (this.started >= MAX_SUBAGENTS) {
      throw new Error(`this conversation has already started ${String(MAX_SUBAGENTS)} sub-agents, which is the limit; do the rest yourself`);
    }
    if (!this.deps.spawn) {
      throw new Error("sub-agents are not available here");
    }
    this.started++;
    const child = this.deps.spawn(this, { task: task.task, model: task.model ?? this.active, tools: task.tools });
    const base = { childId: child.id, task: task.task.slice(0, 300), n: this.started, of: MAX_SUBAGENTS, depth: this.depth + 1 };
    this.emit({ type: "subagent", status: "running", ...base });
    const outcome = child.finished();
    child.send(task.task);
    const result = await outcome;
    this.emit({ type: "subagent", status: result.ok ? "done" : "failed", result: result.text.slice(0, 2000), ...base });
    if (!result.ok) {
      throw new Error(`the sub-agent failed: ${result.text}`);
    }
    return result.text.length > 8000 ? `${result.text.slice(0, 8000)}\n[... shortened]` : result.text;
  }

  // Puts a question to the person and waits. Nobody watching, no answer in ten minutes, or a cancel, is "nobody answered".
  private ask(args: Record<string, unknown>): Promise<string> {
    if (this.delegate) {
      return this.delegate.ask(args);
    }
    const { question, options } = readQuestion(args);
    const nobody = "Nobody answered. Do not guess: stop and tell the person what you need to know.";
    if (this.listeners.size === 0) {
      return Promise.resolve(nobody);
    }
    const id = randomUUID();
    return new Promise<string>((resolve) => {
      const settle = (answer: string | undefined): void => {
        clearTimeout(timer);
        this.questions.delete(id);
        this.emit({ type: "question-resolved", id, ...(answer === undefined ? {} : { answer }) });
        resolve(answer === undefined ? nobody : `The person answered: ${answer}`);
      };
      const timer = setTimeout(() => {
        settle(undefined);
      }, QUESTION_TIMEOUT_MS);
      this.questions.set(id, settle);
      this.emit({ type: "question", id, question, options });
    });
  }

  // Answers a pending approval. Returns false if there is no such approval (already answered or timed out).
  answer(approvalId: string, approved: boolean, always: boolean | "project" = false, reason?: string, plan?: PlanAnswer): boolean {
    const settle = this.approvals.get(approvalId);
    if (!settle) {
      return false;
    }
    settle(approved, always, reason, plan);
    return true;
  }

  get permission(): PermissionMode {
    return this.mode;
  }

  // Changes how this conversation treats changes, from the next one on. Running without asking can be switched off for the whole gateway.
  setMode(mode: PermissionMode): void {
    if (mode === "bypass" && this.deps.allowBypass === false) {
      throw new Error("running without asking is turned off on this gateway");
    }
    if (mode !== this.mode) {
      this.mode = mode;
      this.emit({ type: "mode", mode });
      this.updated = Date.now();
      this.deps.persist?.(this);
    }
  }

  // Changes need an answer from whoever is driving the session, unless the mode, a choice made earlier in this conversation or a rule
  // remembered for this folder says yes. No answer in five minutes counts as no. The device's own allow list is checked after this,
  // whatever is said here.
  private approve = (tool: string, summary: string, args?: Record<string, unknown>): Promise<boolean> => {
    if (this.delegate) {
      return this.delegate.approve(tool, summary, args);
    }
    if (this.mode === "bypass" || this.always.has(tool) || (this.mode === "edits" && (tool === "write_file" || tool === "edit_file")) || (this.deps.rules?.has(this.device, this.root, tool) ?? false)) {
      return Promise.resolve(true);
    }
    return this.askToApprove(tool, summary, previewOf(tool, args, this.device, this.root));
  };

  // Puts an approval card to the person and waits for the answer.
  private askToApprove(tool: string, summary: string, preview?: ApprovalPreview, sticky = true): Promise<boolean> {
    const id = randomUUID();
    this.declined = undefined;
    return new Promise<boolean>((resolve) => {
      const settle = (approved: boolean, always: boolean | "project" = false, reason?: string, plan?: PlanAnswer): void => {
        clearTimeout(timer);
        this.approvals.delete(id);
        if (approved && sticky && always === true) {
          this.always.add(tool);
        }
        if (approved && sticky && always === "project") {
          this.deps.rules?.add(this.device, this.root, tool);
        }
        this.declined = approved ? undefined : reason;
        this.planAnswer = approved ? plan : undefined;
        this.emit({ type: "approval-resolved", id, approved, ...(reason ? { reason } : {}) });
        resolve(approved);
      };
      const timer = setTimeout(() => {
        settle(false);
      }, APPROVAL_TIMEOUT_MS);
      this.approvals.set(id, settle);
      this.emit({ type: "approval", id, tool, summary, ...(preview ? { preview } : {}) });
    });
  }

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
      // Messages that were sent while it ran are not left waiting for a turn that is not coming.
      this.finishedCleanly = true;
      this.advance();
    }
  }

  private async compactNow(abort: AbortController, manual: boolean, percent?: number): Promise<CompactResult> {
    const plan = planCompaction(this.history);
    if (!plan) {
      return { ok: false, reason: "there is nothing older to summarise yet" };
    }
    const tokensBefore = historyTokens(this.history);
    const window = this.deps.ledger?.forConversation(this.id).last?.contextLength;
    // Stored, so the thread says so as soon as the summary is asked for, on every page and after a reload.
    this.emit({ type: "compacting", manual, ...(percent === undefined ? {} : { percent }) });
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
      const reason = err instanceof Error ? err.message : String(err);
      this.emit({ type: "compaction-failed", manual, reason });
      return { ok: false, reason };
    }
  }

  // Before a turn: the last call's time and how full the context was, if it left the context full enough that the conversation should compact first.
  private compactionDue(): { time: number; percent: number } | undefined {
    const at = this.deps.compactAt ?? 0;
    const last = this.deps.ledger?.forConversation(this.id).last;
    // The window of the model that is about to answer, which may not be the one that answered last.
    const window = this.deps.contextLength?.(this.active) ?? last?.contextLength;
    if (at <= 0 || !last || !window || last.time <= this.compactFailedFor || (this.compaction && this.compaction.time >= last.time)) {
      return undefined;
    }
    // After a change of model the last call's size says nothing about the new window, so the history is measured instead.
    const used = last.model === this.active ? last.promptTokens + last.completionTokens : historyTokens(this.history);
    return used / window >= at ? { time: last.time, percent: Math.round((used / window) * 100) } : undefined;
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
    let result = chooseModel({
      tokens: historyTokens(this.history),
      needsTools: this.kind === "code",
      needsImages: this.attached.length > 0,
      current: this.chosen?.model ?? this.lastRoute?.model,
      ...pool,
    });
    // With no model that can read the image, Auto still answers; the image is left out and the person is told.
    if ("none" in result && this.attached.length > 0) {
      result = chooseModel({ tokens: historyTokens(this.history), needsTools: this.kind === "code", current: this.chosen?.model ?? this.lastRoute?.model, ...pool });
    }
    if ("none" in result) {
      throw new Error(result.none);
    }
    this.chosen = result.chosen;
    this.emitLive({ type: "stage", stage: "routing", detail: result.chosen.reason });
  }

  // Tells the model what it can draw on: the project's instruction files and skills as the device reports them, and the skills in the
  // gateway's library (a device's skill of the same name wins). They go in the system prompt, replacing what an earlier turn put
  // there. An older device that cannot answer, or any failure, adds nothing. The skill tool is only offered when there is a skill the
  // model may use.
  private async learn(specs: ToolSpec[]): Promise<ToolSpec[]> {
    let context: ProjectContext | undefined;
    if (this.kind === "code" && this.deps.projectContext) {
      try {
        context = await this.deps.projectContext(this.device, this.root, this.id);
      } catch {
        context = undefined;
      }
    }
    const fromDevice = context !== undefined && Array.isArray(context.skills) && Array.isArray(context.instructions) ? context : undefined;
    const library = this.deps.library
      ? await this.deps.library.list().catch((): SkillSummary[] => {
          return [];
        })
      : [];
    const onDevice = new Set((fromDevice?.skills ?? []).map((s) => {
      return s.name;
    }));
    const extra = library.filter((s) => {
      return !onDevice.has(s.name);
    });
    const skills = [...(fromDevice?.skills ?? []), ...extra];
    const first = this.history[0];
    if ((fromDevice || extra.length > 0) && first?.role === "system" && typeof first.content === "string") {
      const base = first.content.split(CONTEXT_MARK)[0] ?? first.content;
      const text = contextPrompt({ instructions: fromDevice?.instructions ?? [], skills, skipped: [] });
      first.content = text === "" ? base : `${base}${CONTEXT_MARK}${text}`;
    }
    const usable = skills.some((s) => {
      return s.modelInvocable;
    });
    const without = specs.filter((s) => {
      return s.def.function.name !== "skill";
    });
    const skillSpec = allTools.find((t) => {
      return t.def.function.name === "skill";
    });
    return usable && skillSpec ? [...without, skillSpec] : without;
  }

  // The skill tool: the device's skill of that name, or else one from the gateway's library. A chat has only the library.
  private async useSkill(args: Record<string, unknown>): Promise<string> {
    const name = typeof args.name === "string" ? args.name : "";
    if (this.kind === "code") {
      const result = await this.deps.relay.callTool(this.device, this.root, "skill", args, { session: this.id });
      if (result.ok) {
        return result.output;
      }
      if (!this.deps.library || !result.output.includes("no skill named")) {
        throw new Error(result.output);
      }
    }
    if (!this.deps.library) {
      throw new Error(`there is no skill named "${name}"`);
    }
    const text = await this.deps.library.text(name, args);
    return this.kind === "chat" && typeof args.file !== "string" ? `${text}\n\n(This conversation has no device, so you cannot read or change files or run commands. Do what can be done in text, and say what needs a device.)` : text;
  }

  // The instructions of a skill the person started: from the device, or else from the gateway's library.
  private async startedSkillText(name: string, args: string): Promise<string> {
    if (this.kind === "code" && this.deps.startSkill) {
      try {
        return await this.deps.startSkill(this.device, this.root, this.id, name, args);
      } catch (err) {
        if (!this.deps.library || !(err instanceof Error && err.message.includes("no skill named"))) {
          throw err;
        }
      }
    }
    if (!this.deps.library) {
      throw new Error(`there is no skill named "${name}"`);
    }
    const text = await this.deps.library.text(name, { arguments: args }, { byPerson: true });
    return this.kind === "chat" ? `${text}\n\n(This conversation has no device, so you cannot read or change files or run commands. Do what can be done in text, and say what needs a device.)` : text;
  }

  // Puts the message's pictures into the request if the model that will answer can read them; otherwise leaves them out and says so.
  private attachImages(): void {
    const images = this.attached;
    this.attached = [];
    const last = this.history.at(-1);
    if (images.length === 0 || last?.role !== "user" || typeof last.content !== "string") {
      return;
    }
    if (!supportsImages(this.active)) {
      this.emit({ type: "notice", text: noImagesReason(this.active) });
      return;
    }
    last.content = [{ type: "text", text: last.content }, ...images.map((i) => {
      return { type: "image_url", image_url: { url: `data:${i.mediaType};base64,${i.data}` } };
    })];
  }

  // If the person started a skill with this message, its instructions go into the conversation in place of the bare command.
  private async runStartedSkill(): Promise<void> {
    const skill = this.starting;
    this.starting = undefined;
    const last = this.history.at(-1);
    if (!skill || last?.role !== "user") {
      return;
    }
    const args = skill.arguments?.trim() ?? "";
    const text = await this.startedSkillText(skill.name, args);
    const typed = typeof last.content === "string" ? last.content : "";
    last.content = `${typed}\n\nThe person started the skill "${skill.name}". Follow its instructions:\n\n${text}`;
    this.emit({ type: "skill", name: skill.name, arguments: args, text });
  }

  private async run(abort: AbortController, offered: ToolSpec[]): Promise<void> {
    let specs = this.kind === "code" ? [...offered, this.mode === "plan" ? planToolForPlanMode() : planTool, askTool, ...(this.depth < MAX_SUBAGENT_DEPTH && (this.restrict?.includes("agent") ?? true) ? [agentTool] : [])] : offered;
    this.offered = specs.map((s) => {
      return s.def.function.name;
    });
    try {
      // A started skill goes in first, so Auto chooses with its instructions counted and does not pick a model too small for them.
      if (this.starting) {
        await this.runStartedSkill();
      }
      this.decide();
      if (this.deps.projectContext ?? this.deps.library) {
        specs = await this.learn(specs);
      }
      this.attachImages();
    } catch (err) {
      this.history.pop();
      this.emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      this.abort = undefined;
      this.updated = Date.now();
      this.deps.persist?.(this);
      this.advance();
      return;
    }
    // A failure to summarise does not stop the turn; it is tried again after the next model call, not on every message.
    const due = this.compactionDue();
    if (due !== undefined) {
      this.emitLive({ type: "stage", stage: "compacting" });
      if (!(await this.compactNow(abort, false, due.percent)).ok) {
        this.compactFailedFor = due.time;
      }
    }
    const mark = this.history.length - 1;
    try {
      this.checkFits();
      // In plan mode only the tools that read are offered, until the person approves the plan; then the whole list.
      const full = specs;
      const inUse = this.mode === "plan" ? full.filter(readsOnly) : [...full];
      const outcome = await runTurn(this.history, {
        tools: inUse,
        declineReason: () => {
          return this.declined;
        },
        complete: async (messages, tools) => {
          // A cancel that arrived while a tool was running must stop the turn before the next model call.
          if (abort.signal.aborted) {
            throw new Error("cancelled");
          }
          return this.deps.complete(this.active, supportsImages(this.active) ? messages : withoutImages(messages), tools, abort.signal, {
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
          }, { effort: this.effort, conversation: this.id });
        },
        run: async (name, args) => {
          if (name === "ask") {
            return this.ask(args);
          }
          if (name === "agent") {
            return this.runSubagent(args);
          }
          if (name === "skill") {
            return this.useSkill(args);
          }
          // The plan is the session's own, kept here and shown in the side panel; it touches no device.
          if (name === "plan") {
            const steps = readPlan(args);
            const markdown = readPlanDocument(args);
            this.emit({ type: "plan", steps });
            if (markdown !== undefined) {
              this.addPlanDocument(markdown, "model");
            }
            if (this.mode === "plan") {
              const approved = await this.askToApprove("plan", "Approve this plan? The model stays read-only until you do.", { kind: "file", title: "The plan", text: markdown ?? steps.map((s, i) => {
                return `${String(i + 1)}. ${s.text}`;
              }).join("\n") }, false);
              if (!approved) {
                return `The person did not approve the plan${this.declined ? `: ${this.declined}` : ""}. Revise it, or ask what they want.`;
              }
              // What the person approved: possibly their own edit of the document, and what the conversation becomes now.
              const answer = this.planAnswer;
              const edited = answer?.edited?.trim() ?? "";
              const changed = edited !== "" && edited !== markdown;
              if (changed) {
                this.addPlanDocument(edited, "person");
              }
              const next = answer?.next ?? "ask";
              this.setMode(next);
              inUse.splice(0, inUse.length, ...full);
              const how = next === "edits" ? "File edits are accepted without asking; other changes still ask the person." : "Each change still asks the person as usual.";
              return changed
                ? `The plan is approved, with the person's changes. This is the plan to follow:\n\n${edited}\n\nYou can now make changes. ${how}`
                : `The plan is approved. You can now make changes; ${how}`;
            }
            return `plan saved: ${String(steps.filter((s) => {
              return s.status === "done";
            }).length)} of ${String(steps.length)} steps done`;
          }
          const result = await this.deps.relay.callTool(this.device, this.root, name, args, { session: this.id });
          if (!result.ok) {
            throw new Error(result.output);
          }
          // What a write or edit changed is for the person's side panel; the model is only told the result.
          if (result.change) {
            this.emit({ type: "change", change: result.change });
          }
          if (result.image) {
            this.emit({ type: "screenshot", shot: result.image });
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
        onTool: (summary, name) => {
          this.emit({ type: "tool", summary, name });
        },
        onToolOutput: (name, output, failed) => {
          this.emit({ type: "tool-output", name, output: output.length > MAX_STORED_OUTPUT ? output.slice(0, MAX_STORED_OUTPUT) + "\n... (shortened)" : output, ...(failed ? { failed: true } : {}) });
        },
      });
      this.emit({ type: "done", ...outcome });
      this.finishedCleanly = outcome.declined !== true;
    } catch (err) {
      // Drop a half-finished turn so the next one does not send tool calls that never got results.
      this.history.length = mark;
      this.emit(abort.signal.aborted ? { type: "cancelled" } : { type: "error", message: (err as Error).message });
    } finally {
      this.abort = undefined;
      this.updated = Date.now();
      this.deps.persist?.(this);
      this.advance();
    }
  }
}

// In plan mode the model is offered what only reads, and the plan and question tools.
const readsOnly = (spec: ToolSpec): boolean => {
  return spec.level === "read" || spec.def.function.name === "plan" || spec.def.function.name === "ask";
};

// What an approval card shows beyond the summary, worked out from the call itself: the diff of an edit, the whole command with where it
// runs, or the start of a file that is about to be written.
const previewOf = (tool: string, args: Record<string, unknown> | undefined, device: string, root: string): ApprovalPreview | undefined => {
  if (!args) {
    return undefined;
  }
  const text = (key: string): string => {
    const v = args[key];
    return typeof v === "string" ? v : "";
  };
  if (tool === "run_command") {
    return { kind: "command", title: `${args.background === true ? "Runs in the background" : "Runs"} in ${device}:${root}`, text: text("command") };
  }
  if (tool === "edit_file") {
    // One edit given as old_string and new_string, or a list of them in edits.
    const edits: unknown = args.edits;
    const listed: unknown[] = Array.isArray(edits) ? Array.from<unknown>(edits) : [args];
    const patches = listed.map((one) => {
      const fields: Record<string, unknown> = typeof one === "object" && one !== null ? Object.fromEntries(Object.entries(one)) : {};
      const field = (key: string): string => {
        const v = fields[key];
        return typeof v === "string" ? v : "";
      };
      return fileChange(text("path"), field("old_string"), field("new_string")).patch ?? "";
    }).filter((patch) => {
      return patch !== "";
    });
    return { kind: "diff", title: text("path"), text: patches.length > 0 ? patches.join("\n") : "(no difference)" };
  }
  if (tool === "write_file") {
    const lines = text("content").split("\n");
    return { kind: "file", title: `${text("path")} (${String(text("content").length)} characters)`, text: lines.slice(0, 40).join("\n") + (lines.length > 40 ? `\n... ${String(lines.length - 40)} more lines` : "") };
  }
  return undefined;
};

// A model that cannot read images is sent the conversation with each picture replaced by a note, so an image sent earlier to a model
// that could see it does not break a later turn on one that cannot.
const withoutImages = (messages: ChatMessage[]): ChatMessage[] => {
  return messages.map((m) => {
    if (!Array.isArray(m.content) || !m.content.some((p) => {
      return p.type === "image_url";
    })) {
      return m;
    }
    return { ...m, content: m.content.map((p) => {
      return p.type === "image_url" ? { type: "text", text: "[an image was attached here]" } : p;
    }) };
  });
};

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
    private opts: { registry: Registry; relay: Pick<Relay, "callTool">; complete: Complete; store?: SessionStore; stored?: StoredSession[]; ledger?: UsageLedger; compactAt?: number; claude?: ClaudeState; autoPrefs?: AutoPrefs; rules?: SessionDeps["rules"]; allowBypass?: boolean; projectContext?: SessionDeps["projectContext"]; startSkill?: SessionDeps["startSkill"]; library?: SessionDeps["library"] },
  ) {
    this.deps = {
      relay: opts.relay,
      projectContext: opts.projectContext,
      spawn: (parent, input) => {
        return this.spawnChild(parent, input);
      },
      startSkill: opts.startSkill,
      library: opts.library,
      rules: opts.rules,
      allowBypass: opts.allowBypass,
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
          return opts.claude?.contextWindow() ?? CLAUDE_CONTEXT;
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

  create(input: { model: string; device?: string; root?: string; autoApprove?: boolean; mode?: PermissionMode }): Session {
    const mode: PermissionMode = input.mode ?? (input.autoApprove === true ? "bypass" : "ask");
    if (mode === "bypass" && this.opts.allowBypass === false) {
      throw new Error("running without asking is turned off on this gateway");
    }
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
      { id: randomUUID(), title: "", model: input.model, device, root, created: now, updated: now, mode, history: [{ role: "system", content: prompt }] },
      this.deps,
      false,
    );
    this.sessions.set(session.id, session);
    this.deps.persist?.(session);
    return session;
  }

  // A sub-agent's conversation: the same device and folder as the one that started it, a model and a set of tools it chose, and a
  // prompt that says what it is for. It is saved and listed like any conversation, under its parent.
  private spawnChild(parent: Session, input: { task: string; model: string; tools: string[] | undefined }): Session {
    const node = this.opts.registry.live().find((n) => {
      return n.nodeId === parent.device;
    });
    const readOnly = node?.readOnlyRoots?.includes(parent.root) ?? false;
    const prompt = `${systemPrompt(parent.root, node?.platform, node?.shell)}${readOnly ? " This folder is read-only: you can look at its files but cannot change, create or delete anything in it." : ""}\nYou are a sub-agent: another agent gave you one task. You cannot see its conversation, so work only from the task. When you finish, reply with the result alone, concisely, since it is handed back to that agent.`;
    const now = Date.now();
    const child = new Session(
      { id: randomUUID(), title: input.task.slice(0, 60), model: input.model, device: parent.device, root: parent.root, created: now, updated: now, parent: parent.id, depth: parent.depth + 1, history: [{ role: "system", content: prompt }] },
      this.deps,
    );
    parent.adopt(child, input.tools);
    this.sessions.set(child.id, child);
    this.deps.persist?.(child);
    return child;
  }

  // A conversation brought in from another tool, as a saved chat that carries on with whichever model is picked. The turns become
  // events and history exactly as they are; nothing is sent to a model.
  import(input: { title?: string; source: string; turns: Turn[]; model?: string; created?: number }): Session {
    const turns = limitTurns(input.turns);
    const now = Date.now();
    const events: SessionEvent[] = [{ type: "imported", source: input.source, turns: turns.length, at: now }, ...turns.map((t): SessionEvent => {
      const at = t.at === undefined ? {} : { at: t.at };
      return t.role === "user" ? { type: "user", text: t.text, ...at } : { type: "text", text: t.text, ...at };
    })];
    const history: ChatMessage[] = [{ role: "system", content: CHAT_PROMPT }, ...turns.map((t): ChatMessage => {
      return { role: t.role, content: t.text };
    })];
    const first = turns.find((t) => {
      return t.role === "user";
    });
    const given = input.title?.trim() ?? "";
    const session = new Session(
      { id: randomUUID(), title: given === "" ? (first ? titleFrom(first.text) : "Imported conversation") : given, model: input.model ?? "auto", device: "", root: "", created: input.created ?? now, updated: now, history, events },
      this.deps,
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
    // Its sub-agents go with it.
    const kids = [...this.sessions.values()].filter((other) => {
      return other.parent === id;
    });
    for (const kid of kids) {
      await this.delete(kid.id);
    }
    session.cancel();
    this.sessions.delete(id);
    await this.opts.store?.remove(id).catch(() => {
      return undefined;
    });
    return true;
  }
}
