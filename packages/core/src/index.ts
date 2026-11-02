import { z } from "zod";
import { EFFORTS, type Effort } from "./effort.js";

export { EFFORTS, effortFor, effortLevels, type Effort } from "./effort.js";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES, type ImageAttachment } from "./image.js";
export { IMAGE_TOKENS, IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES, noImagesReason, supportsImages, type ImageAttachment, type ImageType } from "./image.js";

// Validation errors in the shape the API returns: { formErrors, fieldErrors }. Re-exported so other packages need no direct zod dependency.
export const flattenError = z.flattenError;

// OpenAI-style message content: a string, null (assistant turns that only call tools), or text parts.
export const ContentPart = z.looseObject({ type: z.string(), text: z.string().optional() });
export const MessageContent = z.union([z.string(), z.array(ContentPart), z.null()]);

export const ToolCall = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({ name: z.string(), arguments: z.string() }),
});
export type ToolCall = z.infer<typeof ToolCall>;

export const ChatMessage = z.looseObject({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: MessageContent.optional(),
  tool_calls: z.array(ToolCall).optional(),
  tool_call_id: z.string().optional(),
  name: z.string().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const Tool = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type Tool = z.infer<typeof Tool>;

// Unknown fields pass through to the model server untouched.
export const ChatRequest = z.looseObject({
  model: z.string(),
  messages: z.array(ChatMessage).min(1),
  temperature: z.number().optional(),
  max_tokens: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
  tools: z.array(Tool).optional(),
  tool_choice: z.unknown().optional(),
  // How hard the model should think, where it can be told: low, medium, high, xhigh or max. Models that cannot be told ignore it.
  effort: z.enum(EFFORTS).optional(),
  // For Claude: the program's own conversation that earlier turns of this one were already sent into. `seen` is how many of the
  // conversation's turns (not counting system messages) it holds, 0 for a new one. Only the turns after that are sent, so Claude's
  // prompt cache covers everything before them.
  continuation: z.object({ id: z.string(), seen: z.number().int().min(0) }).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

export const textOf = (content: ChatMessage["content"]): string => {
  if (typeof content === "string") {
    return content;
  }
  if (!content) {
    return "";
  }
  return content.map((part) => {
    return part.text ?? "";
  }).join("");
};

export const ModelInfo = z.object({
  id: z.string(),
  loaded: z.boolean(),
  contextLength: z.number().int().optional(),
  tokensPerSecond: z.number().optional(),
  // The model's size on disk, in bytes, when the device can tell (from `lms ls`). Used to keep big models off a device that is limited.
  sizeBytes: z.number().optional(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

export const NodeKind = z.enum(["local", "claude"]);
export type NodeKind = z.infer<typeof NodeKind>;

// What a node reports to the gateway. Same shape for every device and for Claude.
export const Heartbeat = z.object({
  nodeId: z.string(),
  kind: NodeKind,
  busy: z.boolean(),
  busyReason: z.string().optional(),
  // While a program on the device's limited list is running (a call, say) the device still works, but only with models up to this size.
  limit: z.object({ reason: z.string(), maxBytes: z.number() }).optional(),
  models: z.array(ModelInfo),
  // Names of the project folders this device lets coding sessions work in. Absent or empty: no tools.
  roots: z.array(z.string()).optional(),
  // Tools this device will run inside those roots, and its operating system, for the coding session's prompt.
  allowedTools: z.array(z.string()).optional(),
  // True if the owner is logged in to the `claude` CLI on this device and has let it answer Claude requests.
  claude: z.boolean().optional(),
  // True if this device lets the gateway load and unload models in its LM Studio.
  modelControl: z.boolean().optional(),
  // True if this device accepts settings changes from the gateway (started with REMOTE_CONFIG=1).
  remoteConfig: z.boolean().optional(),
  // Names of the roots above that can only be read, so a coding session is not offered tools that change them.
  readOnlyRoots: z.array(z.string()).optional(),
  platform: z.string().optional(),
  // The shell the device runs commands in (PowerShell, cmd, bash, zsh or sh), so a model is told which syntax to write.
  shell: z.string().optional(),
});
export type Heartbeat = z.infer<typeof Heartbeat>;

export interface NodeRecord extends Heartbeat {
  lastSeen: number;
  // Models the device has but that are too big while it is limited, so they are left out of `models`. Worked out by the gateway.
  limitedOut?: { id: string; sizeBytes: number }[];
  // The address the device's tunnel connected from, as the gateway sees it (loopback addresses all read as "loopback").
  address?: string;
}

// What a write or edit did to one file, for the side panel. The device works it out when the tool runs and sends it beside the
// result; the model never sees it. `patch` is unified-diff hunks; `note` says why there is none (a binary or very large file).
export const FileChange = z.object({
  path: z.string(),
  created: z.boolean(),
  added: z.number().int(),
  removed: z.number().int(),
  patch: z.string().optional(),
  note: z.string().optional(),
});
export type FileChange = z.infer<typeof FileChange>;

// The model's plan for a session: short steps, each pending, in progress or done.
export const PlanStep = z.object({ text: z.string().min(1).max(300), status: z.enum(["pending", "in_progress", "done"]) });
export type PlanStep = z.infer<typeof PlanStep>;

// A picture a tool produced for the person (a screenshot): shown in the side panel, never given to the model.
export const ToolImage = z.object({ mediaType: z.enum(["image/png", "image/jpeg"]), data: z.string(), url: z.string() });
export type ToolImage = z.infer<typeof ToolImage>;

// What an approval card shows beyond the summary: the diff of an edit, the whole command and where it runs, or the start of a new file.
export interface ApprovalPreview {
  kind: "diff" | "command" | "file";
  title: string;
  text: string;
}

// Messages a device sends over its outbound tunnel to the gateway: its state, and replies to relayed requests.
export const TunnelMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heartbeat"), heartbeat: Heartbeat }),
  z.object({ type: z.literal("head"), id: z.string(), status: z.number().int(), contentType: z.string().optional() }),
  z.object({ type: z.literal("chunk"), id: z.string(), data: z.string() }),
  z.object({ type: z.literal("end"), id: z.string() }),
  z.object({ type: z.literal("fail"), id: z.string(), message: z.string() }),
  // The single reply to a tool call or a Claude request.
  z.object({ type: z.literal("tool-result"), id: z.string(), ok: z.boolean(), output: z.string(), change: FileChange.optional(), image: ToolImage.optional() }),
]);
export type TunnelMessage = z.infer<typeof TunnelMessage>;

// Messages the gateway sends down a device's tunnel. `body` is the raw JSON of a chat completions request.
export const RelayRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("request"), id: z.string(), body: z.string() }),
  z.object({ type: z.literal("cancel"), id: z.string() }),
  // A chat request to answer with the local `claude` CLI. `body` is the raw JSON of the chat request.
  z.object({ type: z.literal("claude"), id: z.string(), body: z.string() }),
  // Load or unload a model in this device's LM Studio.
  z.object({
    type: z.literal("model"),
    id: z.string(),
    op: z.enum(["load", "unload"]),
    model: z.string().optional(),
    contextLength: z.number().optional(),
  }),
  // Read or change this device's settings. `settings` is a partial DeviceSettings for `set`.
  z.object({ type: z.literal("settings"), id: z.string(), op: z.enum(["get", "set"]), settings: z.record(z.string(), z.unknown()).optional() }),
  z.object({
    type: z.literal("tool"),
    id: z.string(),
    root: z.string(),
    name: z.string(),
    args: z.record(z.string(), z.unknown()),
    session: z.string().optional(),
  }),
]);
export type RelayRequest = z.infer<typeof RelayRequest>;

// What a device lets the gateway change. Each can also be fixed by an environment variable on the device.
export const ToolAccess = z.enum(["off", "read", "change"]);
export type ToolAccess = z.infer<typeof ToolAccess>;

export const DeviceSettings = z.object({
  projectRoots: z.record(z.string().min(1), z.string().min(1)),
  // Names of project roots that can only be read: nothing in them can be written, changed or deleted by a session.
  readOnlyRoots: z.array(z.string().min(1)),
  // What coding sessions may use. "On this device" tools work on its files and programs (reading files, git, jq), "reaching out"
  // tools go beyond it (the web, GitHub). Each is off, read-only, or able to change things.
  onDeviceTools: ToolAccess,
  remoteTools: ToolAccess,
  modelControl: z.boolean(),
  claude: z.boolean(),
  gameProcesses: z.array(z.string().min(1)),
  // Unload a model nobody has used for this many minutes, to free the graphics card. Zero never unloads.
  idleUnloadMinutes: z.number().int().min(0).max(1440),
  // Programs (a call, a meeting) that keep the device working but only with small models, and how large "small" is, in gigabytes.
  limitedProcesses: z.array(z.string().min(1)),
  limitedMaxGb: z.number().min(1).max(512),
  // Lets coding sessions use a throwaway headless browser on this device (see docs/adr/0011-...), and optionally the only hosts it may visit.
  browser: z.boolean(),
  browserHosts: z.array(z.string().min(1)),
  // Folders of skills to look in as well as the usual ones (~/.claude/skills, ~/.agents/skills, and the project's own).
  skillFolders: z.array(z.string().min(1)),
});
export type DeviceSettings = z.infer<typeof DeviceSettings>;
export const SETTING_KEYS = ["projectRoots", "readOnlyRoots", "onDeviceTools", "remoteTools", "modelControl", "claude", "gameProcesses", "idleUnloadMinutes", "limitedProcesses", "limitedMaxGb", "browser", "browserHosts", "skillFolders"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

// A device's answer about its settings: what is in effect, where each value came from, which are fixed by an
// environment variable, and whether it accepts changes at all.
export interface SettingsReport {
  settings: DeviceSettings;
  sources: Record<SettingKey, "default" | "file" | "env">;
  locked: SettingKey[];
  remoteConfig: boolean;
  // Every tool this device knows: whether the program it needs is installed, and whether it asks before it runs. Absent from an older agent.
  tools?: { name: string; group: "device" | "remote"; level: "read" | "change"; installed: boolean; asksFirst: boolean }[];
}

// Body of a request to run one tool on a device, and the device's answer.
export const DeviceToolRequest = z.object({ root: z.string(), name: z.string(), args: z.record(z.string(), z.unknown()).default({}) });
export const DeviceToolResult = z.object({ ok: z.boolean(), output: z.string() });
export type DeviceToolResult = z.infer<typeof DeviceToolResult>;

// Starting a coding session, and sending it a message.
// With no device and root it is a chat; with both it is a coding session on that device's project root.
// How a conversation treats changes: ask before every change, accept file edits (commands still ask), plan first (read-only until the
// person approves the plan), or run without asking.
export const PERMISSION_MODES = ["ask", "edits", "plan", "bypass"] as const;
export const PermissionMode = z.enum(PERMISSION_MODES);
export type PermissionMode = z.infer<typeof PermissionMode>;
export const SessionCreate = z.object({
  model: z.string().min(1),
  device: z.string().min(1).optional(),
  root: z.string().min(1).optional(),
  // Skip approval prompts for this session. An explicit opt-in by whoever starts it.
  autoApprove: z.boolean().optional(),
  mode: PermissionMode.optional(),
});
export const SessionMode = z.object({ mode: PermissionMode });
// `always` is true to allow that tool for the rest of the conversation, or "project" to remember it for that folder on that device.
export const SessionApproval = z.object({ approve: z.boolean(), always: z.union([z.boolean(), z.literal("project")]).optional(), reason: z.string().trim().max(500).optional() });
// `model` picks the model for this message and those after it, so one conversation can move between models, devices and Claude.
// `skill` is a skill the person started with / in the page; `text` is what they typed (the skill's name and its arguments).
// Pictures sent with a message: base64, within the limits in image.ts.
export const ImageAttachmentSchema = z.object({
  mediaType: z.enum(IMAGE_TYPES),
  data: z.string().min(1).max(Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8).regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export const SessionMessage = z.object({ images: z.array(ImageAttachmentSchema).max(MAX_IMAGES).optional(), text: z.string().min(1), model: z.string().min(1).optional(), effort: z.enum(["default", ...EFFORTS]).optional(), skill: z.object({ name: z.string().min(1), arguments: z.string().optional() }).optional() });
// A conversation to bring in: the turns, where they came from, and optionally the model to continue with.
export const SessionImport = z.object({
  title: z.string().trim().max(120).optional(),
  source: z.string().trim().min(1).max(60).default("pasted transcript"),
  model: z.string().min(1).optional(),
  turns: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1) })).min(1),
});
// Text or a file's content to be split into turns, for the person to check before importing.
export const ImportParse = z.object({ name: z.string().optional(), content: z.string().min(1) });
export const SessionAnswer = z.object({ answer: z.string().trim().min(1).max(4000) });
// A skill to add to the gateway's library: a zip, or the files of a folder, both base64.
export const LibraryImport = z.object({
  zip: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).optional(),
  files: z.array(z.object({ path: z.string().min(1).max(300), data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/) })).max(300).optional(),
  overwrite: z.boolean().optional(),
}).refine((v) => {
  return (v.zip !== undefined) !== (v.files !== undefined);
}, { message: "send either a zip or files" });
// Changes to a conversation: a new title, and/or pinning it to the top of the sidebar.
// How far the person has read a conversation, as a count of its events.
export const SessionRead = z.object({ events: z.number().int().min(0) });
export const SessionRename = z.object({ title: z.string().trim().min(1).max(120).optional(), pinned: z.boolean().optional() }).refine((v) => {
  return v.title !== undefined || v.pinned !== undefined;
}, { message: "send a title or pinned" });

// What happens in a coding session, in order. Sent to clients as server-sent events.
export type SessionEvent
  = | { type: "user"; text: string; images?: ImageAttachment[] }
    // Something the person should know that is not a failure, such as an image that was not sent to a model that cannot read it.
    | { type: "notice"; text: string }
    | { type: "text"; text: string; model?: string; device?: string; reason?: string }
    | { type: "thinking"; text: string }
    // A file a write or edit changed, with its diff. Shown in the side panel, never sent to the model.
    | { type: "change"; change: FileChange }
    // A screenshot the agent browser took. Shown in the side panel, never sent to the model.
    | { type: "screenshot"; shot: ToolImage }
    // The model's plan as it stands.
    | { type: "plan"; steps: PlanStep[] }
    // The start of a conversation brought in from another tool. Nothing was sent to a model.
    | { type: "imported"; source: string; turns: number }
    // A skill the person started: its name, what they gave it, and the instructions it put in the conversation.
    | { type: "skill"; name: string; arguments: string; text: string }
    // A tool the model started, by its name (absent in conversations stored before it was recorded), and then what it returned. The output
    // belongs to the latest tool that has none yet, since tools run one at a time. It is shortened, and `failed` is set when the tool reported an error.
    | { type: "tool"; summary: string; name?: string }
    | { type: "tool-output"; name: string; output: string; failed?: boolean }
    | { type: "approval"; id: string; tool: string; summary: string; preview?: ApprovalPreview }
    // The conversation's permission mode changed (or was set when it began).
    | { type: "mode"; mode: PermissionMode }
    | { type: "approval-resolved"; id: string; approved: boolean; reason?: string }
    // A question the model put to the person, and what they answered (absent if nobody did).
    // A sub-agent the model started: its conversation, its progress, and its final answer. `n` of `of` counts the ones this conversation has started.
    | { type: "subagent"; childId: string; task: string; status: "running" | "done" | "failed"; result?: string; n: number; of: number; depth: number }
    | { type: "question"; id: string; question: string; options: string[] }
    | { type: "question-resolved"; id: string; answer?: string }
    | { type: "compacted"; messages: number; tokensBefore: number; tokensAfter: number; manual: boolean }
    | { type: "done"; stopped: boolean; declined?: boolean }
    | { type: "cancelled" }
    | { type: "error"; message: string };

// Sent live while the model is still writing, and never stored or replayed: they only make a running turn feel
// responsive. The stored "thinking" and "text" events carry the same words once the model has finished.
// Where a request is, from being sent to the first word: finding a device, freeing memory and loading a model on it,
// waiting for it to answer, then its thinking and writing. Live only, like the deltas.
export type StageName = "routing" | "freeing" | "loading" | "waiting" | "thinking" | "writing" | "compacting";

export type LiveSessionEvent
  = | { type: "thinking-delta"; text: string }
    | { type: "text-delta"; text: string }
    | { type: "stage"; stage: StageName; detail?: string };

export const isLiveEvent = (event: { type: string }): event is LiveSessionEvent => {
  return event.type.endsWith("-delta") || event.type === "stage";
};

// One usage window of the Claude plan, as the claude program reports it: how much is used (0 to 1) and when it resets.
export interface ClaudeWindow {
  utilization: number;
  // Seconds since the epoch.
  resetsAt: number;
}

// What the claude program last said about the plan. A window can read 100 percent used while calls still succeed, if the plan
// has extra usage switched on, so `limitedUntil` is set only when a request was actually refused.
export interface ClaudeLimits {
  status: string;
  fiveHour?: ClaudeWindow;
  sevenDay?: ClaudeWindow;
  usingOverage?: boolean;
  // Milliseconds since the epoch.
  limitedUntil?: number;
  // Milliseconds since the epoch.
  observedAt: number;
}

// Where Claude stands, for the page: whether it can be used now, and what the plan has left.
export interface ClaudeStatus {
  // False until a Claude reply has been seen, because the program only reports the plan with a reply.
  readable: boolean;
  available: boolean;
  device?: string;
  limitedUntil?: number;
  fiveHour?: ClaudeWindow;
  sevenDay?: ClaudeWindow;
  usingOverage?: boolean;
  observedAt?: number;
  // The model the program last said it used, and its window. Absent until a reply has named one.
  model?: string;
  contextWindow?: number;
}

// What one model has used, over some span of calls. `estimated` is true if any of the counts were estimated, not reported by the model server.
export interface ModelUsage {
  model: string;
  device: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
}

// Usage over the last `days` days, from the ledger of every model call.
export interface UsageSummary {
  days: number;
  since: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  byModel: ModelUsage[];
  byDevice: { device: string; calls: number; promptTokens: number; completionTokens: number }[];
  // Tokens (prompt plus completion) per day and model, for the chart. `day` is YYYY-MM-DD in the caller's time zone.
  byDay: { day: string; model: string; tokens: number }[];
}

// One conversation's use of models, and how full the context was after the latest call.
export interface ConversationUsage {
  // The fraction of the context at which a conversation compacts itself (0.8 is 80 percent), or 0 when that is off.
  compactAt?: number;
  last?: { time: number; model: string; device: string; promptTokens: number; completionTokens: number; contextLength?: number; estimated: boolean };
  byModel: ModelUsage[];
}

export interface SessionInfo {
  id: string;
  model: string;
  device: string;
  root: string;
  busy: boolean;
  events: number;
  created: number;
  updated: number;
  // A chat has no device or files; a code conversation works on a device's project root.
  kind: "chat" | "code";
  title: string;
  // Whether the device is connected now. A session whose device is away can be read but not continued.
  deviceConnected: boolean;
  // How hard the model is asked to think, when one has been chosen (and the model can be told).
  effort?: Effort;
  // How changes are treated in this conversation.
  mode?: PermissionMode;
  // With the model set to "auto": what was chosen for the latest turn, and why.
  chosen?: { model: string; device: string; reason: string };
  // The conversation that started this one as a sub-agent, if any.
  parent?: string;
  // Pinned to the top of the sidebar.
  pinned?: boolean;
  // What the conversation is waiting for the person to answer, if anything: an approval or a question.
  waiting?: "approval" | "question";
  // How many of its events the person has read, in any client. Fewer than `events` means there is something new to read; absent means all of it.
  read?: number;
}

// Loading or unloading a model on a device.
export const ModelLoad = z.object({ model: z.string().min(1), contextLength: z.number().int().optional() });
export const ModelUnload = z.object({ model: z.string().min(1).optional() });

// Yields the `data:` payload of each server-sent event in a response body.

// eslint-disable-next-line func-style -- generators cannot be arrow functions
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => {
          return line.startsWith("data:");
        })
        .map((line) => {
          return line.slice(5).trim();
        })
        .join(String.fromCharCode(10));
      if (data) {
        yield data;
      }
    }
  }
}

export const TUNNEL_PATH = "/tunnel";

export const HEARTBEAT_INTERVAL_MS = 10_000;
export const NODE_TTL_MS = 30_000;

// An environment variable that is set but empty counts as not set.
export const nonEmpty = (value: string | undefined): string | undefined => {
  return value === undefined || value === "" ? undefined : value;
};

// The text of a WebSocket message, which the library hands over as a Buffer, several Buffers or an ArrayBuffer.
export const rawToString = (data: Buffer | ArrayBuffer | Buffer[]): string => {
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  return Array.isArray(data) ? Buffer.concat(data).toString("utf8") : Buffer.from(data).toString("utf8");
};

export const authHeaders = (apiKey?: string): Record<string, string> => {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
};
