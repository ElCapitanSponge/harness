import { z } from "zod";

// OpenAI-style message content: a string, null (assistant turns that only call tools), or text parts.
export const ContentPart = z.object({ type: z.string(), text: z.string().optional() }).passthrough();
export const MessageContent = z.union([z.string(), z.array(ContentPart), z.null()]);

export const ToolCall = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({ name: z.string(), arguments: z.string() }),
});
export type ToolCall = z.infer<typeof ToolCall>;

export const ChatMessage = z
  .object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: MessageContent.optional(),
    tool_calls: z.array(ToolCall).optional(),
    tool_call_id: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough();
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
export const ChatRequest = z
  .object({
    model: z.string(),
    messages: z.array(ChatMessage).min(1),
    temperature: z.number().optional(),
    max_tokens: z.number().int().positive().optional(),
    stream: z.boolean().optional(),
    tools: z.array(Tool).optional(),
    tool_choice: z.unknown().optional(),
  })
  .passthrough();
export type ChatRequest = z.infer<typeof ChatRequest>;

export function textOf(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!content) return "";
  return content.map((part) => part.text ?? "").join("");
}

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

// Body of a request to run one tool on a device, and the device's answer.
export const DeviceToolRequest = z.object({ root: z.string(), name: z.string(), args: z.record(z.string(), z.unknown()).default({}) });
export const DeviceToolResult = z.object({ ok: z.boolean(), output: z.string() });
export type DeviceToolResult = z.infer<typeof DeviceToolResult>;

// Starting a coding session, and sending it a message.
export const SessionCreate = z.object({
  model: z.string().min(1),
  device: z.string().min(1),
  root: z.string().min(1),
  // Skip approval prompts for this session. An explicit opt-in by whoever starts it.
  autoApprove: z.boolean().optional(),
});
export const SessionApproval = z.object({ approve: z.boolean(), always: z.boolean().optional() });
export const SessionMessage = z.object({ text: z.string().min(1) });

// What happens in a coding session, in order. Sent to clients as server-sent events.
export type SessionEvent =
  | { type: "user"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; summary: string }
  | { type: "approval"; id: string; tool: string; summary: string }
  | { type: "approval-resolved"; id: string; approved: boolean }
  | { type: "done"; stopped: boolean; declined?: boolean }
  | { type: "cancelled" }
  | { type: "error"; message: string };

export interface SessionInfo {
  id: string;
  model: string;
  device: string;
  root: string;
  busy: boolean;
  events: number;
  created: number;
  // Whether the device is connected now. A session whose device is away can be read but not continued.
  deviceConnected: boolean;
}

// Loading or unloading a model on a device.
export const ModelLoad = z.object({ model: z.string().min(1), contextLength: z.number().int().optional() });
export const ModelUnload = z.object({ model: z.string().min(1).optional() });

export const TUNNEL_PATH = "/tunnel";

export const HEARTBEAT_INTERVAL_MS = 10_000;
export const NODE_TTL_MS = 30_000;

export function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}
