import { z } from "zod";

export const ChatMessage = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ChatRequest = z.object({
  model: z.string(),
  messages: z.array(ChatMessage).min(1),
  temperature: z.number().optional(),
  max_tokens: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

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
