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

const call = async (allowed: string[], root: string, name: string, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> => {
  const server = createToolServer({ roots: { proj: dir }, allowed });
  let result: TunnelMessage | undefined;
  await server.handle({ type: "tool", id: "t1", root, name, args }, (m) => {
    return (result = m);
  });
  expect(result).toMatchObject({ type: "tool-result", id: "t1" });
  const r = result as unknown as { ok: boolean; output: string };
  return { ok: r.ok, output: r.output };
};

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
    expect(await call(readOnly, "other", "read_file", { path: "a.txt" })).toEqual({ ok: false, output: "unknown project root \"other\"" });
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

describe("tools that need a program", () => {
  it("are not offered, and are refused, when the program is not on the device", async () => {
    const audit: string[] = [];
    const server = createToolServer({
      roots: { proj: dir },
      allowed: ["read_file", "git_read", "jq"],
      installed: (program) => {
        return program === "jq";
      },
      audit: (e) => {
        audit.push(`${e.tool}:${e.outcome}`);
      },
    });
    expect(server.allowedNames()).toEqual(["read_file", "jq"]);

    const out: TunnelMessage[] = [];
    await server.handle({ type: "tool", id: "1", root: "proj", name: "git_read", args: { args: ["status"] } }, (m) => {
      out.push(m);
    });
    expect(out[0]).toMatchObject({ ok: false, output: "git is not installed on this device" });
    expect(audit).toEqual(["git_read:refused"]);
  });

  it("are all offered when nothing says otherwise", () => {
    expect(createToolServer({ roots: { proj: dir }, allowed: ["git_read", "jq"] }).allowedNames()).toEqual(["git_read", "jq"]);
  });
});

describe("a folder that can only be read", () => {
  const ask = async (name: string, args: Record<string, unknown>, root = "locked"): Promise<TunnelMessage> => {
    const audit: string[] = [];
    const server = createToolServer({
      roots: { locked: dir, open: dir },
      allowed: ["read_file", "write_file", "edit_file", "run_command", "git_write", "git_read"],
      readOnly: ["locked"],
      audit: (e) => {
        audit.push(`${e.tool}:${e.outcome}`);
      },
    });
    const out: TunnelMessage[] = [];
    await server.handle({ type: "tool", id: "1", root, name, args }, (m) => {
      out.push(m);
    });
    expect(out).toHaveLength(1);
    return out[0]!;
  };

  it("lets files be read", async () => {
    expect(await ask("read_file", { path: "a.txt" })).toMatchObject({ ok: true });
  });

  it("refuses everything that could write, edit, delete or commit there, and says why", async () => {
    for (const [name, args] of [["write_file", { path: "b.txt", content: "x" }], ["edit_file", { path: "a.txt", old_string: "alpha", new_string: "z" }], ["run_command", { command: "rm a.txt" }], ["git_write", { args: ["commit", "-m", "x"] }]] as const) {
      expect(await ask(name, { ...args })).toMatchObject({ ok: false, output: `project root "locked" is read-only on this device, so ${name} is not allowed there` });
    }
    // Nothing was touched.
    expect(await fs.readFile(path.join(dir, "a.txt"), "utf8")).toBe("alpha\nbeta\n");
    await expect(fs.access(path.join(dir, "b.txt"))).rejects.toThrow();
  });

  it("leaves another folder on the same device free to change", async () => {
    expect(await ask("write_file", { path: "b.txt", content: "x" }, "open")).toMatchObject({ ok: true });
  });

  it("reports which roots are read-only, only those that exist", () => {
    const server = createToolServer({ roots: { locked: dir }, allowed: [], readOnly: ["locked", "gone"] });
    expect(server.readOnlyNames()).toEqual(["locked"]);
    server.configure({ roots: { locked: dir }, allowed: [], readOnly: [] });
    expect(server.readOnlyNames()).toEqual([]);
  });
});

describe("the project context tool", () => {
  it("answers the gateway wherever the device allows any of its own tools, and is not reported as a tool for the model", async () => {
    expect((await call(["read_file"], "proj", "project_context", {})).ok).toBe(true);
    const refused = await call(["web_fetch"], "proj", "project_context", {});
    expect(refused.ok).toBe(false);
    expect(refused.output).toContain("not allowed");
    expect(createToolServer({ roots: { proj: dir }, allowed: ["read_file"] }).allowedNames()).not.toContain("project_context");
  });
});
