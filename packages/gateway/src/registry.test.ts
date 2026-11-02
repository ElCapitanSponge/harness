import { NODE_TTL_MS, type Heartbeat } from "@harness/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Registry } from "./registry.js";

const hb = (nodeId: string): Heartbeat => {
  return {
    nodeId,
    kind: "local",
    busy: false,
    models: [],
  };
};

describe("Registry", () => {
  beforeEach(() => {
    return vi.useFakeTimers();
  });
  afterEach(() => {
    return vi.useRealTimers();
  });

  it("returns nodes that have heartbeated recently", () => {
    const r = new Registry();
    r.upsert(hb("pc"));
    expect(r.live().map((n) => {
      return n.nodeId;
    })).toEqual(["pc"]);
  });

  it("drops nodes whose heartbeat is older than the TTL", () => {
    const r = new Registry();
    r.upsert(hb("pc"));
    vi.advanceTimersByTime(NODE_TTL_MS + 1);
    expect(r.live()).toEqual([]);
  });

  it("replaces a node's record on a new heartbeat and refreshes lastSeen", () => {
    const r = new Registry();
    r.upsert(hb("pc"));
    vi.advanceTimersByTime(NODE_TTL_MS - 1000);
    r.upsert({ ...hb("pc"), busy: true });
    vi.advanceTimersByTime(5000);
    expect(r.live()).toHaveLength(1);
    expect(r.live()[0]?.busy).toBe(true);
  });
});

describe("a limited device", () => {
  const big = { id: "big-34b", loaded: true, sizeBytes: 20e9 };
  const small = { id: "small-7b", loaded: false, sizeBytes: 4e9 };
  const unknown = { id: "mystery", loaded: false };
  const limited = (): Heartbeat => {
    return { ...hb("anakin"), models: [big, small, unknown], limit: { reason: "Teams is running", maxBytes: 8e9 } };
  };

  it("shows only the models small enough, and the ones whose size is not known, and lists what was left out", () => {
    const registry = new Registry();
    registry.upsert(limited());
    const [node] = registry.live();
    expect(node?.models.map((m) => {
      return m.id;
    })).toEqual(["small-7b", "mystery"]);
    expect(node?.limitedOut).toEqual([{ id: "big-34b", sizeBytes: 20e9 }]);
    expect(node?.busy).toBe(false);
  });

  it("shows everything again once the limit goes away", () => {
    const registry = new Registry();
    registry.upsert(limited());
    registry.upsert({ ...limited(), limit: undefined });
    expect(registry.live()[0]?.models).toHaveLength(3);
    expect(registry.live()[0]?.limitedOut).toBeUndefined();
  });

  it("leaves a limited device alone when nothing on it is too big", () => {
    const registry = new Registry();
    registry.upsert({ ...limited(), models: [small] });
    expect(registry.live()[0]?.limitedOut).toBeUndefined();
  });
});
