import { NODE_TTL_MS, type Heartbeat } from "@harness/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Registry } from "./registry.js";

const hb = (nodeId: string): Heartbeat => ({
  nodeId,
  kind: "local",
  baseUrl: "http://localhost:1234",
  busy: false,
  models: [],
});

describe("Registry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns nodes that have heartbeated recently", () => {
    const r = new Registry();
    r.upsert(hb("pc"));
    expect(r.live().map((n) => n.nodeId)).toEqual(["pc"]);
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
