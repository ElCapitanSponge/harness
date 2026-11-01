import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FileChange } from "@harness/core";
import { fileChange } from "./diff.js";
import { readPlan } from "./plan.js";
import { findTool } from "./tools.js";

describe("fileChange", () => {
  it("counts and shows a change in the middle with context, as unified hunks", () => {
    const before = "a\nb\nc\nd\ne\nf\ng\nh\n";
    const after = "a\nb\nc\nD\ne\nf\ng\nh\n";
    expect(fileChange("x.txt", before, after)).toEqual({
      path: "x.txt",
      created: false,
      added: 1,
      removed: 1,
      patch: "@@ -1,7 +1,7 @@\n a\n b\n c\n-d\n+D\n e\n f\n g",
    });
  });

  it("lists a new file as created with every line added", () => {
    expect(fileChange("n.txt", undefined, "one\ntwo\n")).toEqual({ path: "n.txt", created: true, added: 2, removed: 0, patch: "@@ -0,0 +1,2 @@\n+one\n+two" });
  });

  it("splits far apart changes into separate hunks and counts insertions and deletions", () => {
    const before = Array.from({ length: 30 }, (_, i) => {
      return `line ${String(i)}`;
    });
    const after = [...before];
    after.splice(2, 1);
    after.splice(25, 0, "new");
    const change = fileChange("f", before.join("\n"), after.join("\n"));
    expect(change).toMatchObject({ added: 1, removed: 1 });
    expect(change.patch?.match(/^@@/gm)).toHaveLength(2);
  });

  it("has no patch when nothing changed", () => {
    expect(fileChange("same", "a\nb", "a\nb")).toEqual({ path: "same", created: false, added: 0, removed: 0 });
  });

  it("summarises a binary file and a very large one instead of diffing them", () => {
    expect(fileChange("a.bin", "x", "y\u0000z")).toMatchObject({ added: 0, removed: 0, note: "binary file, not shown" });
    const big = Array.from({ length: 6000 }, (_, i) => {
      return String(i);
    }).join("\n");
    const large = fileChange("big.txt", big, `${big}\nmore`);
    expect(large).toMatchObject({ note: "large file, not shown", added: 6001 });
    expect(large.patch).toBeUndefined();
  });
});

describe("write and edit report what they changed", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "diff-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const run = async (name: string, args: Record<string, unknown>): Promise<{ output: string; changes: FileChange[] }> => {
    const changes: FileChange[] = [];
    const output = await (findTool(name)?.run(args, { cwd: dir, report: (c) => {
      changes.push(c);
    } }) ?? Promise.reject(new Error("no tool")));
    return { output, changes };
  };

  it("reports a created file, an overwrite and an edit, with paths relative to the folder, and puts none of it in the output", async () => {
    const created = await run("write_file", { path: "sub/a.txt", content: "one\ntwo\n" });
    expect(created.changes).toEqual([expect.objectContaining({ path: path.join("sub", "a.txt"), created: true, added: 2 }) as unknown]);
    expect(created.output).toBe(`wrote 8 characters to ${path.join("sub", "a.txt")}`);

    const over = await run("write_file", { path: "sub/a.txt", content: "one\nTWO\n" });
    expect(over.changes[0]).toMatchObject({ created: false, added: 1, removed: 1 });

    const edit = await run("edit_file", { path: "sub/a.txt", old_string: "one", new_string: "1" });
    expect(edit.changes[0]).toMatchObject({ created: false, added: 1, removed: 1, patch: expect.stringContaining("-one") as string });
    // Nothing the model is told contains the diff.
    for (const r of [created, over, edit]) {
      expect(r.output).not.toContain("@@");
    }
  });

  it("notes a file it cannot read as text instead of diffing it", async () => {
    await fs.writeFile(path.join(dir, "b.bin"), Buffer.from([0, 1, 2]));
    const r = await run("write_file", { path: "b.bin", content: "text" });
    expect(r.changes[0]).toMatchObject({ created: false, note: "binary or large file, not shown" });
  });
});

describe("plan steps", () => {
  it("accepts a plan and rejects anything the model could have got wrong, in words it can read", () => {
    expect(readPlan({ steps: [{ text: " read the code ", status: "done" }, { text: "fix it", status: "in_progress" }] })).toEqual([{ text: "read the code", status: "done" }, { text: "fix it", status: "in_progress" }]);
    for (const bad of [{}, { steps: [] }, { steps: "do it" }, { steps: [{ text: "x", status: "finished" }] }, { steps: [{ text: "", status: "done" }] }, { steps: Array.from({ length: 31 }, () => {
      return { text: "x", status: "pending" };
    }) }]) {
      expect(() => {
        return readPlan(bad);
      }).toThrow("must be a list of 1 to 30 steps");
    }
  });
});
