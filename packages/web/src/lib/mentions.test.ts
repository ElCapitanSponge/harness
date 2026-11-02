import { describe, expect, it } from "vitest";
import { applyMention, mentionAt, rank, splitQuery } from "./mentions";

describe("finding the @ word being typed", () => {
  it("finds it at the start, after a space and after a new line, up to the caret", () => {
    expect(mentionAt("@src", 4)).toEqual({ start: 0, end: 4, query: "src" });
    expect(mentionAt("look at @src/ap", 15)).toEqual({ start: 8, end: 15, query: "src/ap" });
    expect(mentionAt("one\n@a", 6)).toEqual({ start: 4, end: 6, query: "a" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("uses the word the caret is in, not the rest of the line", () => {
    expect(mentionAt("see @src and more", 8)).toEqual({ start: 4, end: 8, query: "src" });
  });

  it("leaves an address, a finished word and plain text alone", () => {
    expect(mentionAt("me@example.com", 14)).toBeUndefined();
    expect(mentionAt("@src done", 9)).toBeUndefined();
    expect(mentionAt("hello", 5)).toBeUndefined();
  });
});

describe("working out which folder to list", () => {
  it("lists the project folder for a bare word, and the folder named before the last slash", () => {
    expect(splitQuery("comp")).toEqual({ dir: "", prefix: "comp" });
    expect(splitQuery("src/comp")).toEqual({ dir: "src", prefix: "comp" });
    expect(splitQuery("src/components/")).toEqual({ dir: "src/components", prefix: "" });
    expect(splitQuery("src\\comp")).toEqual({ dir: "src", prefix: "comp" });
  });

  it("offers nothing outside the project folder", () => {
    expect(splitQuery("../secret")).toBeUndefined();
    expect(splitQuery("src/../../x")).toBeUndefined();
    expect(splitQuery("/etc/passwd")).toBeUndefined();
    expect(splitQuery("C:/Windows")).toBeUndefined();
  });
});

describe("ranking a folder's names", () => {
  const entries = ["src/", "README.md", "package.json", ".git/", "docs/", "app.ts", "[... 3 more entries]"];

  it("puts names that start with what was typed first, folders before files, and drops notes and hidden names", () => {
    expect(rank("", entries, "").map((c) => {
      return c.path;
    })).toEqual(["docs/", "src/", "app.ts", "package.json", "README.md"]);
    expect(rank("", entries, "p").map((c) => {
      return c.path;
    })).toEqual(["package.json", "app.ts"]);
  });

  it("shows hidden names when a dot is typed, and builds the path from the folder", () => {
    expect(rank("", entries, ".")[0]?.path).toBe(".git/");
    expect(rank("", entries, "g").map((c) => {
      return c.path;
    })).not.toContain(".git/");
    expect(rank("src/lib", ["util.ts"], "u")[0]).toEqual({ path: "src/lib/util.ts", name: "util.ts", isDir: false });
  });

  it("matches without regard to case and gives at most eight", () => {
    expect(rank("", entries, "readme")[0]?.name).toBe("README.md");
    expect(rank("", Array.from({ length: 20 }, (_, i) => {
      return `f${String(i)}.ts`;
    }), "f")).toHaveLength(8);
  });
});

describe("putting the choice in the message", () => {
  const mention = { start: 8, end: 13, query: "src/" };

  it("ends a file with a space and leaves the caret after it", () => {
    expect(applyMention("look at @src/ then", mention, { path: "src/app.ts", name: "app.ts", isDir: false })).toEqual({ text: "look at @src/app.ts  then", caret: 20 });
  });

  it("keeps the word open after a folder so the person can go on", () => {
    expect(applyMention("@sr", { start: 0, end: 3, query: "sr" }, { path: "src/", name: "src", isDir: true })).toEqual({ text: "@src/", caret: 5 });
  });
});
