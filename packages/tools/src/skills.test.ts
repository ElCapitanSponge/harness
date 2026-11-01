import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contextPrompt, discoverSkills, loadInstructions, parseFrontMatter, projectContext } from "./skills.js";
import { findTool } from "./tools.js";

let base: string;
let home: string;
let root: string;

const write = async (file: string, text: string): Promise<void> => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, "utf8");
};

const skill = async (dir: string, name: string, front: string, body = "Do the thing."): Promise<void> => {
  await write(path.join(dir, name, "SKILL.md"), `---\n${front}\n---\n\n${body}\n`);
};

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "torii-skills-"));
  home = path.join(base, "home");
  root = path.join(base, "project");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(root, { recursive: true });
});

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

const run = async (name: string, args: Record<string, unknown>): Promise<string> => {
  const tool = findTool(name);
  if (!tool) {
    throw new Error(`no tool ${name}`);
  }
  return tool.run(args, { cwd: root, home });
};

describe("front matter", () => {
  it("reads plain, quoted, folded and block values, booleans, and passes over nested maps", () => {
    const parsed = parseFrontMatter([
      "---",
      "name: tdd",
      "description: >",
      "  Test-driven development.",
      "  Use when asked.",
      "argument-hint: \"What to build?\"",
      "disable-model-invocation: true",
      "metadata:",
      "  credits:",
      "    author: someone",
      "---",
      "Body text",
    ].join("\n"));
    expect(parsed?.data).toEqual({ "name": "tdd", "description": "Test-driven development. Use when asked.", "argument-hint": "What to build?", "disable-model-invocation": true });
    expect(parsed?.body).toBe("Body text");
  });

  it("is undefined without front matter", () => {
    expect(parseFrontMatter("# Just a heading")).toBeUndefined();
  });
});

describe("discovering skills", () => {
  it("finds the person's skills and the project's, the project's winning on a clash, and skips what is broken with a reason", async () => {
    await skill(path.join(home, ".claude", "skills"), "tdd", "name: tdd\ndescription: Test first.");
    await skill(path.join(home, ".claude", "skills"), "shared", "name: shared\ndescription: From the person.");
    await skill(path.join(root, ".claude", "skills"), "shared", "name: shared\ndescription: From the project.");
    await skill(path.join(home, ".agents", "skills"), "quiet", "name: quiet\ndescription: Only the person starts it.\ndisable-model-invocation: true");
    await write(path.join(home, ".claude", "skills", "nofront", "SKILL.md"), "no front matter at all");
    await skill(path.join(home, ".claude", "skills"), "nodesc", "name: nodesc");
    await skill(path.join(home, ".claude", "skills"), "bad", "name: \"not a name!\"\ndescription: x");
    await fs.mkdir(path.join(home, ".claude", "skills", "empty-folder"), { recursive: true });

    const { skills, skipped } = await discoverSkills(root, home);
    expect(skills.map((s) => {
      return `${s.name}:${s.source}:${String(s.modelInvocable)}`;
    })).toEqual(["quiet:user:false", "shared:project:true", "tdd:user:true"]);
    expect(skills.find((s) => {
      return s.name === "shared";
    })?.description).toBe("From the project.");
    expect(skipped.map((s) => {
      return path.basename(path.dirname(s.path));
    }).sort()).toEqual(["bad", "nodesc", "nofront"]);
    expect(skipped.find((s) => {
      return s.path.includes("nofront");
    })?.reason).toContain("no front matter");
  });

  it("tells the model only the names and descriptions of the skills it may start", async () => {
    await skill(path.join(home, ".claude", "skills"), "tdd", "name: tdd\ndescription: Test first.\nargument-hint: \"[what]\"");
    await skill(path.join(home, ".claude", "skills"), "quiet", "name: quiet\ndescription: Hidden.\ndisable-model-invocation: true", "SECRET BODY");
    const prompt = contextPrompt(await projectContext(root, home));
    expect(prompt).toContain("- tdd [what]: Test first.");
    expect(prompt).not.toContain("quiet");
    expect(prompt).not.toContain("Do the thing.");
  });
});

describe("the skill tool", () => {
  beforeEach(async () => {
    const dir = path.join(home, ".claude", "skills");
    await skill(dir, "tdd", "name: tdd\ndescription: Test first.", "Write the test. $ARGUMENTS");
    await write(path.join(dir, "tdd", "REFERENCE.md"), "reference text");
    await skill(dir, "quiet", "name: quiet\ndescription: Hidden.\ndisable-model-invocation: true", "SECRET BODY");
    await write(path.join(base, "outside.txt"), "outside text");
  });

  it("loads the instructions with the arguments filled in, and appends them when the skill has no place for them", async () => {
    expect(await run("skill", { name: "tdd", arguments: "the parser" })).toContain("Write the test. the parser");
    await skill(path.join(home, ".claude", "skills"), "plain", "name: plain\ndescription: No slot.", "Just do it.");
    expect(await run("skill", { name: "plain", arguments: "now" })).toContain("Just do it.\n\nARGUMENTS: now");
  });

  it("never starts a skill that only the person starts, and refuses an unknown one", async () => {
    await expect(run("skill", { name: "quiet" })).rejects.toThrow("started by the person");
    await expect(run("skill", { name: "nope" })).rejects.toThrow("no skill named");
  });

  it("reads files inside the skill's own folder, even though it is outside the project, and nothing else", async () => {
    expect(await run("skill", { name: "tdd", file: "REFERENCE.md" })).toBe("reference text");
    await expect(run("skill", { name: "tdd", file: "../../../../outside.txt" })).rejects.toThrow("not inside the folder");
    await expect(run("skill", { name: "tdd", file: path.join(base, "outside.txt") })).rejects.toThrow("not inside the folder");
    // Reading a file of a skill the model may not start is refused too.
    await expect(run("skill", { name: "quiet", file: "SKILL.md" })).rejects.toThrow("started by the person");
  });

  it("is a reading tool that needs no approval, and the project context tool is not offered to the model", () => {
    expect(findTool("skill")).toMatchObject({ group: "device", level: "read", needsApproval: false });
    expect(findTool("project_context")?.hidden).toBe(true);
  });
});

describe("instruction files", () => {
  it("adds the person's CLAUDE.md and the project's, following imports so a CLAUDE.md that only says @AGENTS.md works", async () => {
    await write(path.join(home, ".claude", "CLAUDE.md"), "Be kind.");
    await write(path.join(root, "CLAUDE.md"), "@AGENTS.md\n");
    await write(path.join(root, "AGENTS.md"), "Use pnpm.\n@docs/more.md\n");
    await write(path.join(root, "docs", "more.md"), "More rules.");
    const found = await loadInstructions(root, home);
    expect(found).toEqual([
      { source: "your own CLAUDE.md", text: "Be kind." },
      { source: "CLAUDE.md", text: "Use pnpm.\nMore rules." },
    ]);
  });

  it("follows no import outside its fence, none twice, and leaves one it cannot read as written", async () => {
    await write(path.join(base, "secret.txt"), "TOP SECRET");
    await write(path.join(root, "AGENTS.md"), "@../secret.txt\n@missing.md\n@AGENTS.md\nSee @types/node in prose.\n```\n@code.md\n```\n");
    await write(path.join(root, "code.md"), "CODE IMPORT");
    const [only] = await loadInstructions(root, home);
    expect(only?.text).not.toContain("TOP SECRET");
    expect(only?.text).not.toContain("CODE IMPORT");
    expect(only?.text).toContain("@missing.md");
    expect(only?.text).toContain("See @types/node in prose.");
  });

  it("goes in the context when there are no skills", async () => {
    await write(path.join(root, "AGENTS.md"), "Use pnpm.");
    expect(contextPrompt(await projectContext(root, home))).toBe("Instructions from AGENTS.md:\nUse pnpm.");
  });
});

// The owner's real folder: every skill installed there has to load. Skipped on a machine that has none.
describe("the skills installed on this machine", () => {
  it("all load without being skipped", async () => {
    const real = path.join(os.homedir(), ".claude", "skills");
    const present = await fs.stat(real).then(() => {
      return true;
    }, () => {
      return false;
    });
    if (!present) {
      return;
    }
    const { skills, skipped } = await discoverSkills(root, os.homedir());
    expect(skipped).toEqual([]);
    expect(skills.length).toBeGreaterThan(0);
  });
});
