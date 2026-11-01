import type { ChatRequest, NodeRecord } from "@harness/core";
import { describe, expect, it } from "vitest";
import { CLAUDE_MODEL_IDS, isClaudeModel, pickRoute } from "./router.js";

const node = (over: Partial<NodeRecord> & { nodeId: string }): NodeRecord => ({
  kind: "local",
  busy: false,
  models: [],
  lastSeen: Date.now(),
  ...over,
});

const req = (model: string): ChatRequest => ({ model, messages: [{ role: "user", content: "hi" }] });

describe("pickRoute", () => {
  const loaded = (id: string) => ({ id, loaded: true });

  it("routes an exact model id to the node that has it loaded", () => {
    const a = node({ nodeId: "a", models: [loaded("qwen")] });
    const b = node({ nodeId: "b", models: [loaded("glm")] });
    expect(pickRoute([a, b], req("glm"))?.node.nodeId).toBe("b");
  });

  it("picks any loaded model for 'auto'", () => {
    const a = node({ nodeId: "a", models: [{ id: "idle", loaded: false }, loaded("qwen")] });
    expect(pickRoute([a], req("auto"))).toMatchObject({ model: "qwen" });
  });

  it("skips busy nodes", () => {
    const busy = node({ nodeId: "pc", busy: true, models: [loaded("qwen")] });
    const free = node({ nodeId: "mac", models: [loaded("qwen")] });
    expect(pickRoute([busy, free], req("qwen"))?.node.nodeId).toBe("mac");
  });

  it("ignores models that are not loaded", () => {
    const a = node({ nodeId: "a", models: [{ id: "qwen", loaded: false }] });
    expect(pickRoute([a], req("qwen"))).toBeUndefined();
  });

  it("returns undefined when every node is busy", () => {
    const a = node({ nodeId: "a", busy: true, models: [loaded("qwen")] });
    expect(pickRoute([a], req("auto"))).toBeUndefined();
  });

  it("never routes to a claude-kind node as a local model", () => {
    const c = node({ nodeId: "c", kind: "claude", models: [loaded("qwen")] });
    expect(pickRoute([c], req("qwen"))).toBeUndefined();
  });
});

describe("isClaudeModel", () => {
  it("matches claude and claude:<alias> only", () => {
    expect(isClaudeModel("claude")).toBe(true);
    expect(isClaudeModel("claude:sonnet")).toBe(true);
    expect(isClaudeModel("claude-3")).toBe(false);
    expect(isClaudeModel("qwen3.5-9b")).toBe(false);
  });
});

describe("claude model list", () => {
  it("advertises plain claude and the common aliases", () => {
    expect(CLAUDE_MODEL_IDS).toEqual(expect.arrayContaining(["claude", "claude:sonnet", "claude:opus", "claude:haiku"]));
  });
});
