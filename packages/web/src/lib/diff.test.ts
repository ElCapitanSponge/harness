import { describe, expect, it } from "vitest";
import { parseDiff } from "./diff";

const numbers = (patch: string) => {
  return parseDiff(patch).map((r) => {
    return `${r.kind}:${String(r.old ?? "")}:${String(r.new ?? "")}`;
  });
};

describe("numbering the lines of a unified diff", () => {
  it("gives a removed line its old number, an added line its new one, and context both", () => {
    expect(numbers("@@ -3,3 +3,3 @@\n a\n-b\n+B\n c")).toEqual(["hunk::", "context:3:3", "del:4:", "add::4", "context:5:5"]);
  });

  it("lets the two sides drift apart when lines are added or removed", () => {
    expect(numbers("@@ -1,2 +1,3 @@\n a\n+x\n+y\n b")).toEqual(["hunk::", "context:1:1", "add::2", "add::3", "context:2:4"]);
  });

  it("starts a new file at line 1", () => {
    expect(numbers("@@ -0,0 +1,2 @@\n+one\n+two")).toEqual(["hunk::", "add::1", "add::2"]);
  });

  it("restarts the numbers at each hunk header", () => {
    expect(numbers("@@ -1,1 +1,1 @@\n-a\n+A\n@@ -20,1 +20,1 @@\n-z\n+Z")).toEqual(["hunk::", "del:1:", "add::1", "hunk::", "del:20:", "add::20"]);
  });

  it("reads a hunk header without counts", () => {
    expect(numbers("@@ -1 +1 @@\n-a\n+b")).toEqual(["hunk::", "del:1:", "add::1"]);
  });

  it("leaves file headers and the no-newline marker without numbers, and drops a trailing empty line", () => {
    expect(numbers("--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+b\n")).toEqual(["meta::", "meta::", "hunk::", "del:1:", "meta::", "add::1"]);
  });

  it("counts a blank context line, which a patch writes as a single space or nothing", () => {
    expect(numbers("@@ -1,3 +1,3 @@\n a\n\n-c\n+C")).toEqual(["hunk::", "context:1:1", "context:2:2", "del:3:", "add::3"]);
  });
});
