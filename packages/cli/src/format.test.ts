import type { NodeRecord } from "@harness/core";
import { describe, expect, it } from "vitest";
import { formatModels, formatNodes } from "./format.js";

const node = (over: Partial<NodeRecord> & { nodeId: string }): NodeRecord => ({
  kind: "local",
  baseUrl: "http://localhost:1234",
  busy: false,
  models: [],
  lastSeen: 100_000,
  ...over,
});

describe("formatNodes", () => {
  it("says so when there are no nodes", () => {
    expect(formatNodes([])).toMatch(/No nodes/);
  });

  it("shows idle and busy status, loaded counts and age", () => {
    const out = formatNodes(
      [
        node({ nodeId: "pc", models: [{ id: "a", loaded: true }, { id: "b", loaded: false }] }),
        node({ nodeId: "mac", busy: true, busyReason: "game running: cs2.exe", lastSeen: 95_000 }),
      ],
      105_000,
    );
    expect(out).toContain("pc");
    expect(out).toContain("idle");
    expect(out).toContain("busy (game running: cs2.exe)");
    expect(out).toContain("5s ago");
    expect(out).toContain("10s ago");
  });
});

describe("formatModels", () => {
  it("says so when no models are reported", () => {
    expect(formatModels([node({ nodeId: "pc" })])).toMatch(/No models/);
  });

  it("lists loaded models before unloaded ones", () => {
    const out = formatModels([
      node({ nodeId: "pc", models: [{ id: "zzz", loaded: false }, { id: "aaa", loaded: false }, { id: "qwen", loaded: true, contextLength: 16384 }] }),
    ]);
    const lines = out.split("\n");
    expect(lines[1]).toContain("qwen");
    expect(lines[1]).toContain("16384");
    expect(lines[2]).toContain("aaa");
    expect(lines[3]).toContain("zzz");
  });
});
