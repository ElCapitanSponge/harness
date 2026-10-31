import type { ChatRequest, NodeRecord } from "@harness/core";

export interface Route {
  node: NodeRecord;
  model: string;
}

// Advertised in /v1/models so chat apps can pick Claude from their model list.
export const CLAUDE_MODEL_IDS = ["claude", "claude:sonnet", "claude:opus", "claude:haiku"];

// Models named "claude" or "claude:<alias>" (e.g. claude:sonnet) go to the Claude backend.
export function isClaudeModel(model: string): boolean {
  return model === "claude" || model.startsWith("claude:");
}

// "auto" picks any loaded model on an idle node. Otherwise the model id must match exactly.
// Policy lives here only, so tiering and cost rules can be added later without touching transport.
export function pickRoute(nodes: NodeRecord[], req: ChatRequest): Route | undefined {
  const candidates = nodes.filter((n) => n.kind === "local" && !n.busy);
  for (const node of candidates) {
    const loaded = node.models.filter((m) => m.loaded);
    const match = req.model === "auto" ? loaded[0] : loaded.find((m) => m.id === req.model);
    if (match) return { node, model: match.id };
  }
  return undefined;
}
