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
    parameters: z.record(z.unknown()).optional(),
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
  baseUrl: z.string().url(),
  busy: z.boolean(),
  busyReason: z.string().optional(),
  models: z.array(ModelInfo),
});
export type Heartbeat = z.infer<typeof Heartbeat>;

export interface NodeRecord extends Heartbeat {
  lastSeen: number;
}

export const HEARTBEAT_INTERVAL_MS = 10_000;
export const NODE_TTL_MS = 30_000;

export function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}
