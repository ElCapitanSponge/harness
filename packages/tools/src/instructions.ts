import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import { INSTRUCTION_NAMES, instructionFits, type InstructionName } from "@harness/core";
import { MAX_OUTPUT, resolveInside, show, str, type Args, type ToolSpec } from "./helpers.js";

// The project's instruction files, for the person to read and change from the page. Not offered to the model: the gateway asks for them on
// the person's behalf. Only these two names, only in the project root, so a request cannot name any other file.

// The version of a file that does not exist yet.
export const ABSENT = "absent";

const isName = (name: string): name is InstructionName => {
  return INSTRUCTION_NAMES.some((n) => {
    return n === name;
  });
};

const nameOf = (a: Args): InstructionName => {
  const name = str(a, "name");
  if (!isName(name)) {
    throw new Error(`only ${INSTRUCTION_NAMES.join(" and ")} can be read or changed here`);
  }
  return name;
};

// A file's version is its modified time and its size, so a change made after it was opened is noticed.
const versionOf = (stat: Stats): string => {
  return `${stat.mtimeMs}-${stat.size}`;
};

const look = async (cwd: string, name: InstructionName): Promise<{ file: string; stat: Stats | undefined }> => {
  // Refuses a link that leads out of the project.
  const file = await resolveInside(cwd, name);
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) {
      throw new Error(`${name} is not a file`);
    }
    return { file, stat };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { file, stat: undefined };
    }
    throw err;
  }
};

// What comes back is cut at MAX_OUTPUT, and saving a cut file would destroy the rest of it, so a file that would not fit is refused, not cut.
const tooLong = (name: InstructionName, length: number): Error => {
  return new Error(`${name} is too long to edit here (${length} characters); edit it on the device`);
};

const readInstruction: ToolSpec = {
  def: {
    type: "function",
    function: {
      name: "read_instruction",
      description: "One of the project's instruction files (AGENTS.md or CLAUDE.md), with its version.",
      parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
  },
  needsApproval: false,
  group: "device",
  level: "read",
  hidden: true,
  describe: (a) => {
    return `read ${show(a.name)}`;
  },
  async run(a, ctx) {
    const name = nameOf(a);
    const { file, stat } = await look(ctx.cwd, name);
    if (!stat) {
      return JSON.stringify({ name, exists: false, text: "", version: ABSENT });
    }
    if (stat.size > MAX_OUTPUT) {
      throw tooLong(name, stat.size);
    }
    const text = await fs.readFile(file, "utf8");
    if (text.includes("\u0000")) {
      throw new Error(`${name} is not a text file`);
    }
    if (!instructionFits(name, text)) {
      throw tooLong(name, text.length);
    }
    return JSON.stringify({ name, exists: true, text, version: versionOf(stat) });
  },
};

// A save is the person's own act, so it asks for no approval. It is refused, as a result and not an error, when the file is not as it was
// when they opened it. The file's own line endings are kept, and the new text replaces it in one step.
const writeInstruction: ToolSpec = {
  def: {
    type: "function",
    function: {
      name: "write_instruction",
      description: "Save one of the project's instruction files (AGENTS.md or CLAUDE.md), if it is still at the version given.",
      parameters: { type: "object", properties: { name: { type: "string" }, text: { type: "string" }, version: { type: "string" } }, required: ["name", "text", "version"] },
    },
  },
  needsApproval: false,
  group: "device",
  level: "change",
  hidden: true,
  describe: (a) => {
    return `save ${show(a.name)} (${typeof a.text === "string" ? a.text.length : 0} characters)`;
  },
  async run(a, ctx) {
    const name = nameOf(a);
    const text = str(a, "text");
    const opened = str(a, "version");
    if (text.includes("\u0000")) {
      throw new Error("the text has a null character, so it is not text");
    }
    const { file, stat } = await look(ctx.cwd, name);
    const current = stat ? versionOf(stat) : ABSENT;
    if (current !== opened) {
      const message = !stat
        ? `${name} was removed after you opened it; reload it`
        : opened === ABSENT
          ? `${name} was created after you opened this; reload it to see it`
          : `${name} changed on disk after you opened it; reload it to see what changed`;
      return JSON.stringify({ saved: false, conflict: true, message, version: current });
    }
    const before = stat ? await fs.readFile(file, "utf8") : "";
    const body = text.replace(/\r\n|\r|\n/g, before.includes("\r\n") ? "\r\n" : "\n");
    // What is saved must be something the page can open again.
    if (!instructionFits(name, body)) {
      throw tooLong(name, body.length);
    }
    const temp = `${file}.${process.pid}-${Date.now()}.tmp`;
    try {
      await fs.writeFile(temp, body, "utf8");
      await fs.rename(temp, file);
    } catch (err) {
      await fs.rm(temp, { force: true });
      throw err;
    }
    return JSON.stringify({ saved: true, version: versionOf(await fs.stat(file)), length: body.length });
  },
};

export const instructionTools: ToolSpec[] = [readInstruction, writeInstruction];
