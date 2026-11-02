import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isInside, resolveInside, show, str, truncate, type ToolContext, type ToolSpec } from "./helpers.js";

// Skills and instruction files. A skill is a folder with a SKILL.md (front matter with a name and a description, then the
// instructions) and any files it refers to: the Agent Skills layout, so the skills installed for Claude Code work unchanged. The model
// is told only each skill's name and description; the `skill` tool loads the rest when it is asked for. The instruction files of a
// project (AGENTS.md, CLAUDE.md) and the person's own are added to what the model is told.

export interface SkillSummary {
  name: string;
  description: string;
  // What to type after the name, such as "[issue number]".
  hint?: string;
  // How long the SKILL.md is, in characters.
  length: number;
  // False when the person starts it and the model does not (`disable-model-invocation: true`).
  modelInvocable: boolean;
  // "user" for the person's own folders, or the project root's name.
  source: string;
}

interface FoundSkill extends SkillSummary {
  folder: string;
}

export interface SkippedSkill {
  path: string;
  reason: string;
}

export interface Instruction {
  source: string;
  text: string;
}

export interface ProjectContext {
  instructions: Instruction[];
  skills: SkillSummary[];
  skipped: SkippedSkill[];
}

const MAX_SKILL_BYTES = 200_000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_INSTRUCTION_CHARS = 20_000;
const MAX_IMPORT_DEPTH = 4;
const FRONT_MATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
// Letters, digits and hyphens, as the Agent Skills layout names them.
export const NAME_RULE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

type Value = string | boolean;

// Reads the front matter of a SKILL.md: the top-level keys with text, true/false, and quoted or block (`>`, `|`) text. Anything nested
// (such as `metadata:`) is passed over, as nothing here uses it.
export const parseFrontMatter = (text: string): { data: Record<string, Value>; body: string } | undefined => {
  const match = FRONT_MATTER.exec(text);
  if (!match) {
    return undefined;
  }
  const lines = (match[1] ?? "").split(/\r?\n/);
  const data: Record<string, Value> = {};
  for (let i = 0; i < lines.length; i++) {
    const head = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(lines[i] ?? "");
    if (!head) {
      continue;
    }
    const key = head[1] ?? "";
    const rest = (head[2] ?? "").trim();
    // The indented lines that belong to this key.
    const more: string[] = [];
    while (i + 1 < lines.length && /^(\s+\S|\s*$)/.test(lines[i + 1] ?? "")) {
      more.push((lines[i + 1] ?? "").trim());
      i++;
    }
    const block = /^([>|])[+-]?$/.exec(rest);
    if (block) {
      data[key] = more.join(block[1] === ">" ? " " : "\n").replace(/\s+$/, "");
    } else if (rest === "") {
      // A nested map or list, or a key with no value.
      continue;
    } else {
      const joined = [rest, ...more.filter(Boolean)].join(" ");
      const quoted = /^(["'])([\s\S]*)\1$/.exec(joined);
      data[key] = quoted ? (quoted[2] ?? "") : joined === "true" ? true : joined === "false" ? false : joined;
    }
  }
  return { data, body: text.slice(match[0].length) };
};

const asText = (value: Value | undefined): string => {
  return typeof value === "string" ? value.trim() : "";
};

const readSmall = async (file: string, limit: number): Promise<string> => {
  const stat = await fs.stat(file);
  if (!stat.isFile()) {
    throw new Error("not a file");
  }
  if (stat.size > limit) {
    throw new Error(`larger than ${String(limit)} bytes`);
  }
  return fs.readFile(file, "utf8");
};

// The skills in a folder: each sub-folder holding a SKILL.md. One that cannot be used is skipped with the reason, never fatal.
const scan = async (dir: string, source: string, found: Map<string, FoundSkill>, skipped: SkippedSkill[]): Promise<void> => {
  let entries: string[];
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => {
      return e.isDirectory() || e.isSymbolicLink();
    }).map((e) => {
      return e.name;
    }).sort();
  } catch {
    return;
  }
  for (const entry of entries) {
    const folder = path.join(dir, entry);
    const file = path.join(folder, "SKILL.md");
    let text: string;
    try {
      text = await readSmall(file, MAX_SKILL_BYTES);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT" && (err as NodeJS.ErrnoException).code !== "ENOTDIR") {
        skipped.push({ path: file, reason: `cannot read SKILL.md: ${(err as Error).message}` });
      }
      continue;
    }
    const parsed = parseFrontMatter(text);
    if (!parsed) {
      skipped.push({ path: file, reason: "SKILL.md has no front matter (--- ... ---) with a name and a description" });
      continue;
    }
    const name = asText(parsed.data.name) || entry;
    const description = asText(parsed.data.description);
    if (!NAME_RULE.test(name)) {
      skipped.push({ path: file, reason: `"${name}" is not a usable skill name (letters, digits, hyphens; up to 64)` });
      continue;
    }
    if (description === "") {
      skipped.push({ path: file, reason: "the front matter has no description" });
      continue;
    }
    const hint = asText(parsed.data["argument-hint"]);
    // A later folder (the project's) replaces an earlier one (the person's) of the same name.
    found.set(name, { name, description, ...(hint ? { hint } : {}), length: text.length, modelInvocable: parsed.data["disable-model-invocation"] !== true, source, folder });
  }
};

// The folders skills are looked for in: the person's own, then the project's.
export const skillFolders = (root: string, home: string, extra: string[] = [], rootName = path.basename(root)): { dir: string; source: string }[] => {
  return [
    { dir: path.join(home, ".claude", "skills"), source: "user" },
    { dir: path.join(home, ".agents", "skills"), source: "user" },
    // Folders the owner added for this device count as their own.
    ...extra.map((dir) => {
      return { dir, source: "user" };
    }),
    { dir: path.join(root, ".claude", "skills"), source: rootName },
    { dir: path.join(root, ".agents", "skills"), source: rootName },
  ];
};

// The skills in one folder, for a library kept somewhere other than a device's usual places.
export const discoverSkillsIn = async (dir: string, source: string): Promise<{ skills: (SkillSummary & { folder: string })[]; skipped: SkippedSkill[] }> => {
  const found = new Map<string, FoundSkill>();
  const skipped: SkippedSkill[] = [];
  await scan(dir, source, found, skipped);
  return { skills: [...found.values()].sort((a, b) => {
    return a.name.localeCompare(b.name);
  }), skipped };
};

export const discoverSkills = async (root: string, home: string, extra: string[] = []): Promise<{ skills: FoundSkill[]; skipped: SkippedSkill[] }> => {
  const found = new Map<string, FoundSkill>();
  const skipped: SkippedSkill[] = [];
  for (const { dir, source } of skillFolders(root, home, extra)) {
    await scan(dir, source, found, skipped);
  }
  return { skills: [...found.values()].sort((a, b) => {
    return a.name.localeCompare(b.name);
  }), skipped };
};

// An instruction file with its `@file` imports followed. An import is only followed inside `fence` (a project file cannot pull in
// anything outside its project), only once, and only so deep; one that cannot be read is left as written.
const expand = async (file: string, fence: string, seen: Set<string>, depth: number): Promise<string | undefined> => {
  let real: string;
  let text: string;
  try {
    real = await fs.realpath(file);
    if (seen.has(real) || !isInside(fence, real)) {
      return undefined;
    }
    text = await readSmall(real, MAX_FILE_BYTES);
  } catch {
    return undefined;
  }
  seen.add(real);
  const out: string[] = [];
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
    }
    const token = fenced || depth >= MAX_IMPORT_DEPTH ? undefined : /^\s*@(\S+)\s*$/.exec(line);
    if (token) {
      const target = path.resolve(path.dirname(real), (token[1] ?? "").replace(/^~(?=[\\/])/, os.homedir()));
      const inner = await expand(target, fence, seen, depth + 1);
      out.push(inner ?? line);
    } else {
      out.push(line);
    }
  }
  return out.join("\n").trim();
};

// What the model is told about the project and its owner: the person's own CLAUDE.md, then the project's CLAUDE.md and AGENTS.md. A
// file that another has already pulled in with an import (a CLAUDE.md that only says @AGENTS.md) is not repeated.
export const loadInstructions = async (root: string, home: string): Promise<Instruction[]> => {
  const seen = new Set<string>();
  const out: Instruction[] = [];
  const candidates: { file: string; fence: string; source: string }[] = [
    { file: path.join(home, ".claude", "CLAUDE.md"), fence: path.join(home, ".claude"), source: "your own CLAUDE.md" },
    { file: path.join(root, "CLAUDE.md"), fence: root, source: "CLAUDE.md" },
    { file: path.join(root, "AGENTS.md"), fence: root, source: "AGENTS.md" },
  ];
  for (const c of candidates) {
    const text = await expand(c.file, c.fence, seen, 0);
    if (text) {
      out.push({ source: c.source, text: text.length > MAX_INSTRUCTION_CHARS ? `${text.slice(0, MAX_INSTRUCTION_CHARS)}\n[... shortened]` : text });
    }
  }
  return out;
};

export const projectContext = async (root: string, home: string = os.homedir(), extra: string[] = []): Promise<ProjectContext> => {
  const [instructions, { skills, skipped }] = await Promise.all([loadInstructions(root, home), discoverSkills(root, home, extra)]);
  return {
    instructions,
    skills: skills.map((s) => {
      return { name: s.name, description: s.description, ...(s.hint ? { hint: s.hint } : {}), length: s.length, modelInvocable: s.modelInvocable, source: s.source };
    }),
    skipped,
  };
};

// The part of the model's instructions that lists what is available. Only the model-invocable skills are named.
export const contextPrompt = (context: ProjectContext): string => {
  const parts: string[] = [];
  for (const i of context.instructions) {
    parts.push(`Instructions from ${i.source}:\n${i.text}`);
  }
  const offered = context.skills.filter((s) => {
    return s.modelInvocable;
  });
  if (offered.length > 0) {
    parts.push([
      "Skills you can use. Each is a set of instructions for a kind of task. When one fits the task, load it with the skill tool (name, and arguments if it takes any) and follow it. A skill may refer to files in its own folder; read them with the skill tool's file argument.",
      ...offered.map((s) => {
        return `- ${s.name}${s.hint ? ` ${s.hint}` : ""}: ${s.description}`;
      }),
    ].join("\n"));
  }
  return parts.join("\n\n");
};

const homeOf = (ctx: ToolContext): string => {
  return ctx.home ?? os.homedir();
};

// The skill's instructions with the arguments filled in, or with `file`, a file from inside its folder.
export const loadSkill = async (skill: Pick<FoundSkill, "name" | "folder">, a: Record<string, unknown>): Promise<string> => {
  const name = skill.name;
  if (typeof a.file === "string" && a.file !== "") {
    // Only inside the skill's own folder, however the path is written (or linked).
    const file = await resolveInside(skill.folder, a.file).catch(() => {
      throw new Error(`"${a.file as string}" is not inside the folder of the skill "${name}"`);
    });
    return truncate(await readSmall(file, MAX_FILE_BYTES));
  }
  const parsed = parseFrontMatter(await readSmall(path.join(skill.folder, "SKILL.md"), MAX_SKILL_BYTES));
  const given = typeof a.arguments === "string" ? a.arguments.trim() : "";
  const body = (parsed?.body ?? "").trim();
  const filled = body.includes("$ARGUMENTS") ? body.replaceAll("$ARGUMENTS", given) : given ? `${body}\n\nARGUMENTS: ${given}` : body;
  return truncate(`Skill "${name}" (folder: ${skill.folder}; read its other files with the skill tool's file argument)\n\n${filled}`);
};

const skillTool: ToolSpec = {
  def: {
    type: "function",
    function: {
      name: "skill",
      description: "Load a skill by name and get its instructions. Use it when a listed skill fits the task. With file, read a file from inside that skill's own folder instead (they can be read even though they are outside the project).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The skill's name, as listed" },
          arguments: { type: "string", description: "What the person asked for, passed to the skill as its arguments" },
          file: { type: "string", description: "A file inside the skill's folder, relative to it, such as REFERENCE.md" },
        },
        required: ["name"],
      },
    },
  },
  needsApproval: false,
  group: "device",
  level: "read",
  describe: (a) => {
    return `skill ${show(a.name)}${typeof a.file === "string" ? ` (${a.file})` : ""}`;
  },
  async run(a, ctx) {
    const name = str(a, "name");
    const { skills } = await discoverSkills(ctx.cwd, homeOf(ctx), ctx.skillFolders);
    const skill = skills.find((s) => {
      return s.name === name;
    });
    if (!skill) {
      throw new Error(`there is no skill named "${name}"`);
    }
    if (!skill.modelInvocable) {
      throw new Error(`the skill "${name}" is started by the person, not by you`);
    }
    return loadSkill(skill, a);
  },
};

// Not offered to the model: the person started this skill (with / in the page), so one the model may not start can run too.
const startSkillTool: ToolSpec = {
  def: { type: "function", function: { name: "start_skill", description: "A skill the person started.", parameters: { type: "object", properties: { name: { type: "string" }, arguments: { type: "string" } }, required: ["name"] } } },
  needsApproval: false,
  group: "device",
  level: "read",
  hidden: true,
  describe: (a) => {
    return `start skill ${show(a.name)}`;
  },
  async run(a, ctx) {
    const name = str(a, "name");
    const skill = (await discoverSkills(ctx.cwd, homeOf(ctx), ctx.skillFolders)).skills.find((s) => {
      return s.name === name;
    });
    if (!skill) {
      throw new Error(`there is no skill named "${name}"`);
    }
    return loadSkill(skill, { name, arguments: a.arguments });
  },
};

// Not offered to the model: the gateway asks for it at the start of a turn to learn what to tell the model.
const projectContextTool: ToolSpec = {
  def: { type: "function", function: { name: "project_context", description: "The instruction files and skills of this project and its owner.", parameters: { type: "object", properties: {} } } },
  needsApproval: false,
  group: "device",
  level: "read",
  hidden: true,
  describe: () => {
    return "read the project's instructions and skills";
  },
  async run(_a, ctx) {
    return JSON.stringify(await projectContext(ctx.cwd, homeOf(ctx), ctx.skillFolders));
  },
};

export const skillTools: ToolSpec[] = [skillTool, startSkillTool, projectContextTool];
