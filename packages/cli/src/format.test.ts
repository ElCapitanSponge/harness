import type { NodeRecord, SettingsReport } from "@harness/core";
import { describe, expect, it } from "vitest";
import { formatModels, formatNodes, formatSessions, formatSettings } from "./format.js";

const node = (over: Partial<NodeRecord> & { nodeId: string }): NodeRecord => {
  return {
    kind: "local",
    busy: false,
    models: [],
    lastSeen: 100_000,
    ...over,
  };
};

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

describe("formatSessions and formatSettings", () => {
  const session = { id: "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d", model: "qwen", device: "", root: "", busy: false, events: 3, created: 0, updated: 0, kind: "chat" as const, title: "Why the build fails", deviceConnected: true };

  it("lists conversations with their kind, title and where a coding session works", () => {
    const out = formatSessions([session, { ...session, id: "ffffffff-4f50-4a6b-8c7d-9e0f1a2b3c4d", kind: "code", device: "pc", root: "proj", deviceConnected: false, title: "" }], 120_000);
    expect(out).toContain("0b1c2d3e  chat");
    expect(out).toContain("Why the build fails");
    expect(out).toContain("pc:proj (offline)");
    expect(out).toContain("(new)");
    expect(formatSessions([])).toBe("No saved conversations.");
  });

  it("shows each setting with its source and whether changes are accepted", () => {
    const report = {
      settings: { projectRoots: {}, readOnlyRoots: [], onDeviceTools: "read", remoteTools: "off", modelControl: false, claude: true, gameProcesses: [], idleUnloadMinutes: 20 },
      sources: { projectRoots: "default", onDeviceTools: "file", remoteTools: "default", readOnlyRoots: "default", modelControl: "default", claude: "env", gameProcesses: "default", idleUnloadMinutes: "default" },
      locked: ["claude"],
      remoteConfig: false,
    } satisfies SettingsReport;
    const out = formatSettings(report);
    expect(out).toContain("fixed by environment");
    expect(out).toContain("onDeviceTools");
    expect(out).toContain("\"read\"");
    expect(out).toContain("REMOTE_CONFIG=1");
  });
});
