import fs from "node:fs";
import path from "node:path";

// Checks the documentation: every page in docs/ has a title, a description and a sidebar order in its front matter, and every
// relative link in the docs, the README and the glossary points at a file that exists (and, for markdown, a heading that exists).
// Run by `pnpm docs:check` and by the tests, so CI fails on a broken link or a page without its front matter.

export interface Problem {
  file: string;
  message: string;
}

// The agent-skill configuration files are not pages of the documentation.
const NOT_PAGES = ["docs/agents/"];
// Files outside docs/ whose links are checked too.
const LINKED_FILES = ["README.md", "GLOSSARY.md", "AGENTS.md"];

const walk = (dir: string): string[] => {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : e.name.endsWith(".md") ? [full] : [];
  });
};

export const frontMatter = (text: string): { title?: string; description?: string; order?: number } | undefined => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) {
    return undefined;
  }
  const out: { title?: string; description?: string; order?: number } = {};
  const unquote = (v: string): string => {
    const q = /^(["'])([\s\S]*)\1$/.exec(v.trim());
    return q ? (q[2] ?? "") : v.trim();
  };
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const top = /^(title|description):\s*(.*)$/.exec(line);
    if (top?.[1] === "title") {
      out.title = unquote(top[2] ?? "");
    } else if (top?.[1] === "description") {
      out.description = unquote(top[2] ?? "");
    }
    const order = /^\s+order:\s*(\d+)\s*$/.exec(line);
    if (order) {
      out.order = Number(order[1]);
    }
  }
  return out;
};

// The anchor GitHub gives a heading: lower case, punctuation dropped, spaces to hyphens.
export const slug = (heading: string): string => {
  return heading.trim().toLowerCase().replace(/<[^>]*>/g, "").replace(/[`*_~]/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");
};

const body = (text: string): string => {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
};

// Lines outside fenced code blocks.
const prose = (text: string): { line: number; text: string }[] => {
  const out: { line: number; text: string }[] = [];
  let fenced = false;
  body(text).split(/\r?\n/).forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) {
      fenced = !fenced;
    } else if (!fenced) {
      out.push({ line: i + 1, text: l });
    }
  });
  return out;
};

const anchors = (file: string, cache: Map<string, Set<string>>): Set<string> => {
  const known = cache.get(file);
  if (known) {
    return known;
  }
  const found = new Set<string>();
  const counts = new Map<string, number>();
  for (const { text } of prose(fs.readFileSync(file, "utf8"))) {
    const h = /^#{1,6}\s+(.*?)\s*#*$/.exec(text);
    if (h) {
      const base = slug(h[1] ?? "");
      const n = counts.get(base) ?? 0;
      counts.set(base, n + 1);
      found.add(n === 0 ? base : `${base}-${String(n)}`);
    }
  }
  cache.set(file, found);
  return found;
};

export const checkDocs = (root: string): Problem[] => {
  const problems: Problem[] = [];
  const cache = new Map<string, Set<string>>();
  const docsDir = path.join(root, "docs");
  const pages = fs.existsSync(docsDir) ? walk(docsDir) : [];
  const rel = (f: string): string => {
    return path.relative(root, f).split(path.sep).join("/");
  };

  const isPage = (f: string): boolean => {
    return !NOT_PAGES.some((p) => {
      return rel(f).startsWith(p);
    });
  };

  for (const file of pages.filter(isPage)) {
    const fm = frontMatter(fs.readFileSync(file, "utf8"));
    if (!fm) {
      problems.push({ file: rel(file), message: "no front matter (title, description, sidebar order)" });
      continue;
    }
    if (!fm.title) {
      problems.push({ file: rel(file), message: "front matter has no title" });
    }
    if (!fm.description) {
      problems.push({ file: rel(file), message: "front matter has no description" });
    }
    if (fm.order === undefined) {
      problems.push({ file: rel(file), message: "front matter has no sidebar order" });
    }
  }

  const linked = [...pages, ...LINKED_FILES.map((f) => {
    return path.join(root, f);
  }).filter((f) => {
    return fs.existsSync(f);
  })];
  for (const file of linked) {
    for (const { line, text } of prose(fs.readFileSync(file, "utf8"))) {
      // Inline code is not a link.
      const stripped = text.replace(/`[^`]*`/g, "");
      for (const m of stripped.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = m[1] ?? "";
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
          continue;
        }
        const where = `${rel(file)}:${String(line)}`;
        if (target.startsWith("/")) {
          problems.push({ file: where, message: `"${target}" is an absolute path; use a relative link` });
          continue;
        }
        const [filePart = "", fragment] = target.split("#");
        const resolved = filePart === "" ? file : path.resolve(path.dirname(file), decodeURIComponent(filePart));
        if (!fs.existsSync(resolved)) {
          problems.push({ file: where, message: `"${target}" points at a file that does not exist` });
        } else if (fragment && resolved.endsWith(".md") && !anchors(resolved, cache).has(fragment.toLowerCase())) {
          problems.push({ file: where, message: `"${target}" points at a heading that does not exist` });
        }
      }
    }
  }
  return problems;
};

// `tsx scripts/docs-check.ts`
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const problems = checkDocs(path.resolve(import.meta.dirname, ".."));
  for (const p of problems) {
    console.error(`${p.file}: ${p.message}`);
  }
  console.log(problems.length === 0 ? "docs ok" : `${String(problems.length)} problem${problems.length === 1 ? "" : "s"} in the docs`);
  process.exitCode = problems.length === 0 ? 0 : 1;
}
