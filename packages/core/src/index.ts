import { z } from "zod";

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
});
export type Heartbeat = z.infer<typeof Heartbeat>;

export interface NodeRecord extends Heartbeat {
  lastSeen: number;
}

// Messages a device sends over its outbound tunnel to the gateway: its state, and replies to relayed requests.
export const TunnelMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heartbeat"), heartbeat: Heartbeat }),
  z.object({ type: z.literal("head"), id: z.string(), status: z.number().int(), contentType: z.string().optional() }),
  z.object({ type: z.literal("chunk"), id: z.string(), data: z.string() }),
  z.object({ type: z.literal("end"), id: z.string() }),
  z.object({ type: z.literal("fail"), id: z.string(), message: z.string() }),
  // The single reply to a tool call or a Claude request.
  z.object({ type: z.literal("tool-result"), id: z.string(), ok: z.boolean(), output: z.string() }),
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
});
export type DeviceSettings = z.infer<typeof DeviceSettings>;
export const SETTING_KEYS = ["projectRoots", "readOnlyRoots", "onDeviceTools", "remoteTools", "modelControl", "claude", "gameProcesses", "idleUnloadMinutes"] as const;
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
export const SessionCreate = z.object({
  model: z.string().min(1),
  device: z.string().min(1).optional(),
  root: z.string().min(1).optional(),
  // Skip approval prompts for this session. An explicit opt-in by whoever starts it.
  autoApprove: z.boolean().optional(),
});
export const SessionApproval = z.object({ approve: z.boolean(), always: z.boolean().optional() });
// `model` picks the model for this message and those after it, so one conversation can move between models, devices and Claude.
export const SessionMessage = z.object({ text: z.string().min(1), model: z.string().min(1).optional() });
export const SessionRename = z.object({ title: z.string().trim().min(1).max(120) });

// What happens in a coding session, in order. Sent to clients as server-sent events.
export type SessionEvent
  = | { type: "user"; text: string }
    | { type: "text"; text: string; model?: string; device?: string }
    | { type: "thinking"; text: string }
    | { type: "tool"; summary: string }
    | { type: "approval"; id: string; tool: string; summary: string }
    | { type: "approval-resolved"; id: string; approved: boolean }
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
