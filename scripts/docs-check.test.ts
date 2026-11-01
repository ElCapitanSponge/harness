import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkDocs, frontMatter, slug } from "./docs-check.js";

let root: string;

const write = (file: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};

const page = (title: string, body: string): string => {
  return `---\ntitle: ${title}\ndescription: About ${title}\nsidebar:\n  order: 1\n---\n\n# ${title}\n\n${body}\n`;
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-check-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("the real documentation", () => {
  it("has front matter on every page and no broken link", () => {
    expect(checkDocs(path.resolve(import.meta.dirname, ".."))).toEqual([]);
  });
});

describe("docs check", () => {
  it("passes pages with front matter and links that resolve, including to a heading", () => {
    write("docs/a.md", page("A", "See [b](guides/b.md#the-heading) and [home](#a) and [web](https://example.com/x)."));
    write("docs/guides/b.md", page("B", "## The heading\n\nText."));
    expect(checkDocs(root)).toEqual([]);
  });

  it("fails a page with no front matter, or missing a field", () => {
    write("docs/a.md", "# A\n");
    write("docs/b.md", "---\ntitle: B\n---\n\n# B\n");
    const messages = checkDocs(root).map((p) => {
      return `${p.file}: ${p.message}`;
    });
    expect(messages).toContain("docs/a.md: no front matter (title, description, sidebar order)");
    expect(messages).toContain("docs/b.md: front matter has no description");
    expect(messages).toContain("docs/b.md: front matter has no sidebar order");
  });

  it("fails a link to a file or heading that does not exist, an absolute link, and checks the README too", () => {
    write("docs/a.md", page("A", "[x](missing.md) [y](b.md#nope) [z](/docs/b.md)"));
    write("docs/b.md", page("B", "Text."));
    write("README.md", "[gone](docs/gone.md)\n");
    const messages = checkDocs(root).map((p) => {
      return p.message;
    });
    expect(messages).toEqual(expect.arrayContaining([
      "\"missing.md\" points at a file that does not exist",
      "\"b.md#nope\" points at a heading that does not exist",
      "\"/docs/b.md\" is an absolute path; use a relative link",
      "\"docs/gone.md\" points at a file that does not exist",
    ]));
  });

  it("ignores links inside code, and files that are not pages", () => {
    write("docs/a.md", page("A", "Use `[x](nope.md)` like this:\n\n```\n[y](nope.md)\n```"));
    write("docs/agents/issue-tracker.md", "no front matter here\n");
    expect(checkDocs(root)).toEqual([]);
  });
});

describe("front matter and anchors", () => {
  it("reads the three fields, quoted or not", () => {
    expect(frontMatter("---\ntitle: \"A: b\"\ndescription: Plain\nsidebar:\n  order: 4\n---\n")).toEqual({ title: "A: b", description: "Plain", order: 4 });
    expect(frontMatter("# no front matter")).toBeUndefined();
  });

  it("makes anchors the way GitHub does", () => {
    expect(slug("The shell")).toBe("the-shell");
    expect(slug("Tailscale ACL example")).toBe("tailscale-acl-example");
    expect(slug("What's `new`?")).toBe("whats-new");
  });
});
