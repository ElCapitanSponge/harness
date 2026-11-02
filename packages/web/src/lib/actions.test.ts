import { describe, expect, it } from "vitest";
import { kindOf, summariseActions, type ActionEntry } from "./actions.js";

const read: ActionEntry = { name: "read_file", summary: "read a.txt" };
const cmd: ActionEntry = { name: "run_command", summary: "run npm test" };
const edit = (path: string): ActionEntry => {
  return { name: "edit_file", summary: `edit ${path}`, change: { path, created: false } };
};

describe("kindOf", () => {
  it("sorts calls by what they do, and an unnamed one is other", () => {
    expect(kindOf(read)).toBe("read");
    expect(kindOf({ name: "grep", summary: "s" })).toBe("search");
    expect(kindOf(cmd)).toBe("command");
    expect(kindOf(edit("a.ts"))).toBe("modified");
    expect(kindOf({ summary: "old" })).toBe("other");
  });
});

describe("summariseActions", () => {
  it("counts reads, commands and modified files, each file once", () => {
    expect(summariseActions([read, read, cmd, cmd, edit("a.ts"), edit("a.ts")])).toBe("Read 2 files, ran 2 commands, modified 1 file");
  });

  it("uses singular forms and counts failures", () => {
    expect(summariseActions([read, { ...cmd, failed: true }])).toBe("Read 1 file, ran 1 command, 1 failed");
  });

  it("has a plain heading when nothing is known", () => {
    expect(summariseActions([])).toBe("Actions");
  });
});
