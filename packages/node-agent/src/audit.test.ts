import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TunnelMessage } from "@harness/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuditLog, type AuditEntry } from "./audit.js";
import { createToolServer } from "./toolserver.js";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-audit-"));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  time: "2026-11-01T00:00:00.000Z",
  root: "proj",
  tool: "read_file",
  summary: "read a.txt",
  outcome: "ok",
  ms: 1,
  ...over,
});

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 100));

describe("createAuditLog", () => {
  it("appends one JSON line per entry, in order, creating the folder", async () => {
    const file = path.join(dir, "nested", "audit.log");
    const log = createAuditLog(file);
    log(entry({ summary: "first" }));
    log(entry({ summary: "second", outcome: "error" }));
    await settle();
    const lines = (await fs.readFile(file, "utf8")).trim().split(String.fromCharCode(10));
    expect(lines.map((l) => JSON.parse(l).summary)).toEqual(["first", "second"]);
  });

  it("warns once, not on every entry, if the log cannot be written", async () => {
    const blocker = path.join(dir, "file");
    await fs.writeFile(blocker, "x");
    const warnings: string[] = [];
    const log = createAuditLog(path.join(blocker, "audit.log"), (m) => warnings.push(m));
    log(entry());
    log(entry());
    await settle();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("audit log");
  });
});

describe("tool server auditing", () => {
  async function run(roots: Record<string, string>, allowed: string[], msg: { root: string; name: string; args: Record<string, unknown>; session?: string }) {
    const entries: AuditEntry[] = [];
    const server = createToolServer({ roots, allowed, audit: (e) => entries.push(e) });
    const sent: TunnelMessage[] = [];
    await server.handle({ type: "tool", id: "t", ...msg }, (m) => sent.push(m));
    return { entries, sent };
  }

  it("records a successful call with its session, without file contents", async () => {
    await fs.writeFile(path.join(dir, "a.txt"), "secret contents");
    const { entries } = await run({ proj: dir }, ["read_file"], { root: "proj", name: "read_file", args: { path: "a.txt" }, session: "s1" });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ session: "s1", root: "proj", tool: "read_file", summary: "read a.txt", outcome: "ok" });
    expect(JSON.stringify(entries[0])).not.toContain("secret contents");
  });

  it("records what a write or command was, but not the content written", async () => {
    const { entries } = await run({ proj: dir }, ["write_file"], { root: "proj", name: "write_file", args: { path: "n.txt", content: "do not log me" } });
    expect(entries[0]?.summary).toBe("write n.txt (13 characters)");
    expect(JSON.stringify(entries[0])).not.toContain("do not log me");
  });

  it("records refused calls, which matter most: a tool that is not allowed, and an unknown root", async () => {
    const notAllowed = await run({ proj: dir }, ["read_file"], { root: "proj", name: "run_command", args: { command: "rm -rf /" } });
    expect(notAllowed.entries[0]).toMatchObject({ tool: "run_command", outcome: "refused", summary: "run: rm -rf /" });
    expect(notAllowed.sent[0]).toMatchObject({ ok: false });

    const unknownRoot = await run({ proj: dir }, ["read_file"], { root: "other", name: "read_file", args: { path: "a" } });
    expect(unknownRoot.entries[0]).toMatchObject({ outcome: "refused" });
  });

  it("records a tool that failed", async () => {
    const { entries } = await run({ proj: dir }, ["read_file"], { root: "proj", name: "read_file", args: { path: "missing.txt" } });
    expect(entries[0]).toMatchObject({ outcome: "error" });
    expect(entries[0]?.detail).toBeTruthy();
  });
});
