import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TunnelMessage } from "@harness/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createToolServer, parseRoots } from "./toolserver.js";

describe("parseRoots", () => {
  it("parses name=path entries and names a bare path after its folder", () => {
    const a = path.resolve("/tmp/alpha");
    const b = path.resolve("/tmp/beta");
    expect(parseRoots([`one=${a}`, b].join(path.delimiter))).toEqual({ one: a, beta: b });
  });

  it("returns nothing for an empty or missing value, so no tools are exposed", () => {
    expect(parseRoots(undefined)).toEqual({});
    expect(parseRoots("  ")).toEqual({});
  });
});

let dir: string;
let outside: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-root-"));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), "harness-outside-"));
  await fs.writeFile(path.join(dir, "a.txt"), "alpha\nbeta\n");
  await fs.writeFile(path.join(outside, "secret.txt"), "top secret");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

async function call(allowed: string[], root: string, name: string, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
  const server = createToolServer({ roots: { proj: dir }, allowed });
  let result: TunnelMessage | undefined;
  await server.handle({ type: "tool", id: "t1", root, name, args }, (m) => (result = m));
  expect(result).toMatchObject({ type: "tool-result", id: "t1" });
  const r = result as unknown as { ok: boolean; output: string };
  return { ok: r.ok, output: r.output };
}

describe("createToolServer", () => {
  const readOnly = ["read_file", "list_dir", "grep"];

  it("reads, lists and searches inside the project root", async () => {
    expect(await call(readOnly, "proj", "read_file", { path: "a.txt" })).toEqual({ ok: true, output: "1\talpha\n2\tbeta\n3\t" });
    expect((await call(readOnly, "proj", "list_dir", {})).output).toContain("a.txt");
    expect((await call(readOnly, "proj", "grep", { pattern: "beta" })).output).toContain("a.txt:2:beta");
  });

  it("refuses paths outside the project root, including ..", async () => {
    const r = await call(readOnly, "proj", "read_file", { path: path.join("..", path.basename(outside), "secret.txt") });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("outside the working directory");
  });

  it("refuses a symlink that points outside the project root", async (ctx) => {
    try {
      await fs.symlink(outside, path.join(dir, "link"), "junction");
    } catch {
      return ctx.skip();
    }
    const r = await call(readOnly, "proj", "read_file", { path: "link/secret.txt" });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("outside the working directory");
  });

  it("refuses an unknown root, including inherited object keys", async () => {
    expect(await call(readOnly, "other", "read_file", { path: "a.txt" })).toEqual({ ok: false, output: 'unknown project root "other"' });
    expect((await call(readOnly, "constructor", "read_file", { path: "a.txt" })).ok).toBe(false);
  });

  it("refuses tools that are not on this device's allow list, and tools that do not exist", async () => {
    expect((await call(readOnly, "proj", "write_file", { path: "x", content: "y" })).output).toContain("not allowed");
    expect((await call(readOnly, "proj", "run_command", { command: "echo hi" })).output).toContain("not allowed");
    expect((await call(readOnly, "proj", "nope", {})).output).toContain("not allowed");
    await expect(fs.access(path.join(dir, "x"))).rejects.toThrow();
  });

  it("reports a tool error as a failed result instead of throwing", async () => {
    const r = await call(readOnly, "proj", "read_file", { path: "missing.txt" });
    expect(r.ok).toBe(false);
  });
});
