import type { ChatRequest, NodeRecord } from "@harness/core";
import { describe, expect, it } from "vitest";
import { CLAUDE_MODEL_IDS, catalogue, explainNoRoute, isClaudeModel, pickLoadable, pickRoute } from "./router.js";

const node = (over: Partial<NodeRecord> & { nodeId: string }): NodeRecord => {
  return {
    kind: "local",
    busy: false,
    models: [],
    lastSeen: Date.now(),
    ...over,
  };
};

const req = (model: string): ChatRequest => {
  return { model, messages: [{ role: "user", content: "hi" }] };
};

describe("pickRoute", () => {
  const loaded = (id: string) => {
    return { id, loaded: true };
  };

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

describe("a limited device in the catalogue and in explanations", () => {
  const limited = node({
    nodeId: "anakin",
    modelControl: true,
    limit: { reason: "Teams is running", maxBytes: 8e9 },
    models: [{ id: "small-7b", loaded: false, sizeBytes: 4e9 }],
    limitedOut: [{ id: "big-34b", sizeBytes: 20e9 }],
  });

  it("lists the models left out as greyed out, with the size and the reason", () => {
    const entries = catalogue([limited]);
    expect(entries.find((e) => {
      return e.id === "small-7b";
    })).toMatchObject({ state: "loads-on-use" });
    expect(entries.find((e) => {
      return e.id === "big-34b";
    })).toMatchObject({ state: "limited", device: "anakin", busyReason: "20 GB, too big while Teams is running" });
  });

  it("says why a model that is too big cannot be used, and what to do", () => {
    const why = explainNoRoute([limited], { model: "big-34b", messages: [{ role: "user", content: "hi" }] });
    expect(why).toContain("anakin has \"big-34b\" but it is too big while Teams is running");
    expect(why).toContain("only models up to 8.0 GB");
  });

  it("does not route to a model that is too big, or load it", () => {
    const registryLike = [limited];
    expect(pickRoute(registryLike, { model: "big-34b", messages: [{ role: "user", content: "hi" }] })).toBeUndefined();
    expect(pickLoadable(registryLike, { model: "big-34b", messages: [{ role: "user", content: "hi" }] })).toBeUndefined();
    expect(pickLoadable(registryLike, { model: "small-7b", messages: [{ role: "user", content: "hi" }] })?.model).toBe("small-7b");
  });
});
