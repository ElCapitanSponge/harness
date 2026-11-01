import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { devTools } from "./dev-tools.js";
import { MAX_OUTPUT, num, resolveInside, show, str, truncate, type ToolSpec } from "./helpers.js";
import { webFetch } from "./web-fetch.js";

export { resolveInside, truncate, type ToolContext, type ToolSpec } from "./helpers.js";

const MAX_FILE_BYTES = 1_000_000;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", ".next", "bench-results"]);

const readText = async (file: string): Promise<string> => {
  const stat = await fs.stat(file);
  if (stat.isDirectory()) {
    throw new Error("path is a directory; use list_dir");
  }
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`file is larger than ${MAX_FILE_BYTES} bytes`);
  }
  const buf = await fs.readFile(file);
  if (buf.includes(0)) {
    throw new Error("file looks binary");
  }
  return buf.toString("utf8");
};

const rel = (cwd: string, file: string) => {
  return path.relative(cwd, file) || ".";
};

const readFile: ToolSpec = {
  def: {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file. Returns numbered lines. Use offset and limit for large files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to the working directory" },
          offset: { type: "number", description: "1-based line to start at" },
          limit: { type: "number", description: "Maximum lines to return (default 2000)" },
        },
        required: ["path"],
      },
    },
  },
  needsApproval: false,
  describe: (a) => {
    return `read ${show(a.path)}`;
  },
  async run(a, ctx) {
    const lines = (await readText(await resolveInside(ctx.cwd, str(a, "path")))).split("\n");
    const start = Math.max(1, Math.floor(num(a, "offset") ?? 1));
    const limit = Math.max(1, Math.floor(num(a, "limit") ?? 2000));
    const end = start - 1 + limit;
    const body = lines.slice(start - 1, end).map((l, i) => {
      return `${start + i}\t${l}`;
    }).join("\n");
    const left = lines.length - end;
    const more = left > 0 ? `\n[... ${left} more line${left === 1 ? "" : "s"}; use offset ${end + 1}]` : "";
    return truncate(body + more);
  },
};

const listDir: ToolSpec = {
  def: {
    type: "function",
    function: {
      name: "list_dir",
      description: "List the entries of a directory. Directories end with a slash.",
      parameters: { type: "object", properties: { path: { type: "string", description: "Directory, default is the working directory" } } },
    },
  },
  needsApproval: false,
  describe: (a) => {
    return `list ${show(a.path, ".")}`;
  },
  async run(a, ctx) {
    const dir = await resolveInside(ctx.cwd, typeof a.path === "string" ? a.path : ".");
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const names = entries.map((e) => {
      return (e.isDirectory() ? `${e.name}/` : e.name);
    }).sort();
    return truncate(names.slice(0, 500).join("\n") + (names.length > 500 ? `\n[... ${names.length - 500} more]` : "")) || "(empty)";
  },
};

// eslint-disable-next-line func-style -- generators cannot be arrow functions
async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        yield* walk(path.join(dir, entry.name));
      }
    } else if (entry.isFile()) {
      yield path.join(dir, entry.name);
    }
  }
}

const grep: ToolSpec = {
  def: {
    type: "function",
    function: {
      name: "grep",
      description: "Search text files under a path for a regular expression. Skips .git and node_modules. Returns file:line:text.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "JavaScript regular expression" },
          path: { type: "string", description: "File or directory, default is the working directory" },
        },
        required: ["pattern"],
      },
    },
  },
  needsApproval: false,
  describe: (a) => {
    return `grep ${show(a.pattern)} in ${show(a.path, ".")}`;
  },
  async run(a, ctx) {
    let re: RegExp;
    try {
      re = new RegExp(str(a, "pattern"));
    } catch (err) {
      throw new Error(`invalid regular expression: ${(err as Error).message}`, { cause: err });
    }
    const start = await resolveInside(ctx.cwd, typeof a.path === "string" ? a.path : ".");
    const files = (await fs.stat(start)).isDirectory() ? walk(start) : [start];
    const hits: string[] = [];
    for await (const file of files) {
      if (hits.length >= 100) {
        break;
      }
      let text: string;
      try {
        text = await readText(file);
      } catch {
        continue;
      }
      text.split("\n").forEach((line, i) => {
        if (hits.length < 100 && re.test(line)) {
          hits.push(`${rel(ctx.cwd, file)}:${i + 1}:${line.slice(0, 300)}`);
        }
      });
    }
    return hits.length ? truncate(hits.join("\n") + (hits.length >= 100 ? "\n[... stopped at 100 matches]" : "")) : "no matches";
  },
};

const writeFile: ToolSpec = {
  def: {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a file with the given content. Creates parent directories.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
  },
  needsApproval: true,
  describe: (a) => {
    return `write ${show(a.path)} (${typeof a.content === "string" ? a.content.length : 0} characters)`;
  },
  async run(a, ctx) {
    const file = await resolveInside(ctx.cwd, str(a, "path"));
    const content = str(a, "content");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, "utf8");
    return `wrote ${content.length} characters to ${rel(ctx.cwd, file)}`;
  },
};

const editFile: ToolSpec = {
  def: {
    type: "function",
    function: {
      name: "edit_file",
      description: "Replace one exact occurrence of old_string with new_string in a file. old_string must match exactly once, so include enough context.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  needsApproval: true,
  describe: (a) => {
    return `edit ${show(a.path)}`;
  },
  async run(a, ctx) {
    const file = await resolveInside(ctx.cwd, str(a, "path"));
    const oldText = str(a, "old_string");
    const newText = str(a, "new_string");
    if (!oldText) {
      throw new Error("old_string must not be empty");
    }
    const text = await readText(file);
    const count = text.split(oldText).length - 1;
    if (count === 0) {
      throw new Error("old_string was not found; read the file again and copy it exactly");
    }
    if (count > 1) {
      throw new Error(`old_string matches ${count} times; include more surrounding context`);
    }
    await fs.writeFile(file, text.replace(oldText, () => {
      return newText;
    }), "utf8");
    return `edited ${rel(ctx.cwd, file)}`;
  },
};

const runCommand: ToolSpec = {
  def: {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command in the working directory and return its combined output and exit code. Times out after 120 seconds.",
      parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    },
  },
  needsApproval: true,
  describe: (a) => {
    return `run: ${show(a.command)}`;
  },
  run(a, ctx) {
    const command = str(a, "command");
    return new Promise((resolve) => {
      const child = spawn(command, { shell: true, cwd: ctx.cwd });
      let out = "";
      const add = (d: Buffer) => {
        out += d.toString();
        if (out.length > MAX_OUTPUT * 4) {
          out = out.slice(-MAX_OUTPUT * 2);
        }
      };
      child.stdout.on("data", add);
      child.stderr.on("data", add);
      const timer = setTimeout(() => {
        child.kill();
        out += "\n[timed out after 120 seconds]";
      }, 120_000);
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve(`failed to start: ${err.message}`);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(`exit code ${code}\n${truncate(out.trim() || "(no output)")}`);
      });
    });
  },
};

export const tools: ToolSpec[] = [readFile, listDir, grep, writeFile, editFile, runCommand, webFetch, ...devTools];

export const findTool = (name: string): ToolSpec | undefined => {
  return tools.find((t) => {
    return t.def.function.name === name;
  });
};
