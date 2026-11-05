import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findTool, resolveInside, tools, truncate } from "./tools.js";

let dir: string;
let outside: string;

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "harness-cwd-")));
  outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "harness-out-")));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

const run = (name: string, args: Record<string, unknown>) => {
  return findTool(name)!.run(args, { cwd: dir });
};

describe("resolveInside", () => {
  it("accepts existing and not-yet-existing paths inside the directory", async () => {
    await fs.writeFile(path.join(dir, "a.txt"), "x");
    expect(await resolveInside(dir, "a.txt")).toBe(path.join(dir, "a.txt"));
    expect(await resolveInside(dir, "new/deep/file.ts")).toBe(path.join(dir, "new", "deep", "file.ts"));
    expect(await resolveInside(dir, ".")).toBe(dir);
  });

  it("rejects parent traversal and absolute paths outside", async () => {
    await expect(resolveInside(dir, "../x")).rejects.toThrow("outside the working directory");
    await expect(resolveInside(dir, path.join(outside, "x"))).rejects.toThrow("outside the working directory");
  });

  it("rejects a symlink that points outside", async () => {
    await fs.symlink(outside, path.join(dir, "link"), "junction");
    await expect(resolveInside(dir, "link/secret.txt")).rejects.toThrow("outside the working directory");
  });
});

describe("read_file", () => {
  it("returns numbered lines and supports offset and limit", async () => {
    await fs.writeFile(path.join(dir, "f.txt"), "one\ntwo\nthree\nfour");
    expect(await run("read_file", { path: "f.txt" })).toBe("1\tone\n2\ttwo\n3\tthree\n4\tfour");
    const part = await run("read_file", { path: "f.txt", offset: 2, limit: 2 });
    expect(part).toContain("2\ttwo\n3\tthree");
    expect(part).toContain("1 more line; use offset 4");
  });

  it("refuses directories, binary files and paths outside", async () => {
    await fs.mkdir(path.join(dir, "d"));
    await fs.writeFile(path.join(dir, "b.bin"), Buffer.from([1, 0, 2]));
    await expect(run("read_file", { path: "d" })).rejects.toThrow("directory");
    await expect(run("read_file", { path: "b.bin" })).rejects.toThrow("binary");
    await expect(run("read_file", { path: "../nope" })).rejects.toThrow("outside");
  });

  it("rejects a non-string path", async () => {
    await expect(run("read_file", { path: 5 })).rejects.toThrow("\"path\" must be a string");
  });
});

describe("list_dir", () => {
  it("marks directories with a slash", async () => {
    await fs.mkdir(path.join(dir, "src"));
    await fs.writeFile(path.join(dir, "a.txt"), "");
    expect((await run("list_dir", {})).split("\n")).toEqual(["a.txt", "src/"]);
  });
});

describe("grep", () => {
  it("finds matches with file and line, and skips node_modules", async () => {
    await fs.mkdir(path.join(dir, "src"));
    await fs.mkdir(path.join(dir, "node_modules"));
    await fs.writeFile(path.join(dir, "src", "a.ts"), "const foo = 1;\nconst bar = 2;");
    await fs.writeFile(path.join(dir, "node_modules", "x.js"), "foo");
    const out = await run("grep", { pattern: "foo" });
    expect(out).toBe(`${path.join("src", "a.ts")}:1:const foo = 1;`);
  });

  it("reports no matches and bad patterns", async () => {
    await fs.writeFile(path.join(dir, "a.txt"), "hello");
    expect(await run("grep", { pattern: "zzz" })).toBe("no matches");
    await expect(run("grep", { pattern: "(" })).rejects.toThrow("invalid regular expression");
  });
});

describe("write_file", () => {
  it("creates parent directories and writes content", async () => {
    await run("write_file", { path: "a/b/c.txt", content: "hi" });
    expect(await fs.readFile(path.join(dir, "a", "b", "c.txt"), "utf8")).toBe("hi");
  });

  it("refuses to write outside the directory", async () => {
    await expect(run("write_file", { path: "../evil.txt", content: "x" })).rejects.toThrow("outside");
    await expect(fs.stat(path.join(dir, "..", "evil.txt"))).rejects.toThrow();
  });
});

describe("edit_file", () => {
  beforeEach(async () => {
    await fs.writeFile(path.join(dir, "f.txt"), "alpha beta\ngamma beta");
  });

  it("replaces a single exact occurrence", async () => {
    await run("edit_file", { path: "f.txt", old_string: "alpha", new_string: "ALPHA" });
    expect(await fs.readFile(path.join(dir, "f.txt"), "utf8")).toBe("ALPHA beta\ngamma beta");
  });

  it("does not interpret $ patterns in the replacement", async () => {
    await run("edit_file", { path: "f.txt", old_string: "alpha", new_string: "$& $1" });
    expect(await fs.readFile(path.join(dir, "f.txt"), "utf8")).toBe("$& $1 beta\ngamma beta");
  });

  it("fails when the text is missing, ambiguous or empty", async () => {
    await expect(run("edit_file", { path: "f.txt", old_string: "zzz", new_string: "x" })).rejects.toThrow("not found");
    await expect(run("edit_file", { path: "f.txt", old_string: "beta", new_string: "x" })).rejects.toThrow("matches 2 times");
    await expect(run("edit_file", { path: "f.txt", old_string: "", new_string: "x" })).rejects.toThrow("empty");
  });
});

describe("run_command", () => {
  it("returns output and the exit code", async () => {
    expect(await run("run_command", { command: "node -e \"console.log('hi')\"" })).toBe("exit code 0\nhi");
  });

  it("reports a failing command", async () => {
    const out = await run("run_command", { command: "node -e \"process.exit(3)\"" });
    expect(out).toContain("exit code 3");
  });

  it("runs in the working directory", async () => {
    await fs.writeFile(path.join(dir, "marker.txt"), "");
    const out = await run("run_command", { command: "node -e \"console.log(require('fs').readdirSync('.').join())\"" });
    expect(out).toContain("marker.txt");
  });
});

describe("tool metadata", () => {
  it("only asks approval for tools that change things", () => {
    const needs = Object.fromEntries(tools.map((t) => {
      return [t.def.function.name, t.needsApproval];
    }));
    // Fetching a page asks too, because an address can carry information out. Reading with gh, git, jq and fzf does not.
    expect(needs).toEqual({
      read_file: false,
      list_dir: false,
      grep: false,
      write_file: true,
      edit_file: true,
      run_command: true,
      web_fetch: true,
      gh_read: false,
      gh_write: true,
      git_read: false,
      git_write: true,
      jq: false,
      fzf_filter: false,
      skill: false,
      start_skill: false,
      project_context: false,
      read_instruction: false,
      write_instruction: false,
      browser_open: true,
      browser_read: false,
      browser_click: true,
      browser_type: true,
      browser_screenshot: false,
      browser_close: false,
      task_output: false,
      task_stop: false,
      tasks_list: false,
      tasks_stop_all: false,
      tasks_clear_finished: false,
    });
  });
});

describe("truncate", () => {
  it("cuts long output and says how much was dropped", () => {
    expect(truncate("abcdef", 3)).toBe("abc\n[... truncated 3 characters]");
    expect(truncate("abc", 3)).toBe("abc");
  });
});
