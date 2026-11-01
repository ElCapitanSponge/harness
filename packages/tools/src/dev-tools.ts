import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { MAX_OUTPUT, resolveInside, show, truncate, type ToolSpec } from "./helpers.js";

// Developer programs the model may use on a device: gh, git, jq and fzf. Each is a named tool with checked arguments, never a
// shell: the model supplies a list of arguments, they are checked against what the tool allows, and the program is started
// with that list. A tool that only reads is separate from one that changes things, so reading needs no approval and changing
// always asks.

const MAX_ARGS = 40;
const MAX_ARG_LENGTH = 2000;
const TIMEOUT_MS = 30_000;
const MAX_CAPTURE = 2_000_000;

// The environment a program gets: what it needs to find itself and its own settings, and nothing else. In particular none of
// the agent's own variables, which hold the gateway key, reach a program the model asked for.
const BASE_ENV = ["PATH", "Path", "PATHEXT", "HOME", "USERPROFILE", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "COMSPEC"];
const GH_ENV = ["GH_TOKEN", "GITHUB_TOKEN", "GH_HOST", "GH_CONFIG_DIR", "GH_ENTERPRISE_TOKEN"];

export const safeEnv = (extra: string[] = [], source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { NO_COLOR: "1", GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat", PAGER: "cat", GIT_EDITOR: "true" };
  for (const name of [...BASE_ENV, ...extra]) {
    const value = source[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return env;
};

interface RunOptions {
  cwd: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

// Runs a program with an argument list (no shell), a time limit and a cap on what it can print.
export const runProgram = (bin: string, args: string[], options: RunOptions): Promise<{ code: number; stdout: string; stderr: string }> => {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: options.cwd, env: options.env ?? safeEnv(), shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${bin} took longer than ${String((options.timeoutMs ?? TIMEOUT_MS) / 1000)} seconds and was stopped`));
    }, options.timeoutMs ?? TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => {
      if (stdout.length < MAX_CAPTURE) {
        stdout += d.toString("utf8");
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < MAX_CAPTURE) {
        stderr += d.toString("utf8");
      }
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new Error(err.code === "ENOENT" ? `${bin} is not installed on this device` : err.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.on("error", () => {
      return undefined;
    });
    child.stdin.end(options.input ?? "");
  });
};

// Shows a program's output, or its failure as an error with what it said.
const outcome = (bin: string, result: { code: number; stdout: string; stderr: string }): string => {
  if (result.code !== 0) {
    throw new Error(`${bin} exited with ${String(result.code)}: ${truncate((result.stderr || result.stdout).trim() || "no output", 2000)}`);
  }
  const out = result.stdout.trim();
  return out === "" ? (result.stderr.trim() || "(no output)") : truncate(out, MAX_OUTPUT);
};

// The list of arguments the model supplied, checked to be a modest list of short text.
export const argList = (value: unknown, label = "args"): string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ARGS) {
    throw new Error(`"${label}" must be a list of 1 to ${String(MAX_ARGS)} strings`);
  }
  return value.map((item) => {
    if (typeof item !== "string" || item.length > MAX_ARG_LENGTH || item.includes("\0")) {
      throw new Error(`every item in "${label}" must be a string of at most ${String(MAX_ARG_LENGTH)} characters`);
    }
    return item;
  });
};

const hasFlag = (args: string[], flags: string[]): string | undefined => {
  return args.find((a) => {
    return flags.some((f) => {
      return a === f || a.startsWith(`${f}=`);
    });
  });
};

// ---- gh ------------------------------------------------------------------------------------------------------------------------

export const GH_READ: Record<string, string[]> = {
  pr: ["view", "list", "status", "diff", "checks"],
  issue: ["view", "list", "status"],
  repo: ["view", "list"],
  run: ["list", "view"],
  release: ["list", "view"],
  workflow: ["list", "view"],
  search: ["issues", "prs", "repos", "code", "commits"],
  label: ["list"],
};

export const GH_WRITE: Record<string, string[]> = {
  pr: ["create", "comment", "merge", "close", "reopen", "edit", "review", "ready"],
  issue: ["create", "comment", "close", "reopen", "edit"],
  label: ["create", "edit"],
};

// What opens a browser or an editor, or reads a file into a message, which a tool run for a model must not do.
const GH_REFUSED_FLAGS = ["--web", "-w", "--editor", "-e", "--body-file", "-F"];

export const checkGh = (mode: "read" | "write", args: string[]): void => {
  const table = mode === "read" ? GH_READ : GH_WRITE;
  const [group = "", sub = ""] = args;
  if (!(table[group] ?? []).includes(sub)) {
    const other = mode === "read" ? GH_WRITE : GH_READ;
    const hint = (other[group] ?? []).includes(sub) ? ` That is a ${mode === "read" ? "changing" : "reading"} command: use ${mode === "read" ? "gh_write" : "gh_read"}.` : "";
    const allowed = Object.entries(table).map(([g, subs]) => {
      return `${g} (${subs.join(", ")})`;
    }).join("; ");
    throw new Error(`"gh ${group} ${sub}" is not allowed in ${mode === "read" ? "gh_read" : "gh_write"}.${hint} Allowed: ${allowed}`);
  }
  const bad = hasFlag(args.slice(2), GH_REFUSED_FLAGS);
  if (bad) {
    throw new Error(`gh ${bad} is not allowed (it opens a browser or an editor, or reads a file into the message)`);
  }
};

const ghTool = (mode: "read" | "write"): ToolSpec => {
  const name = mode === "read" ? "gh_read" : "gh_write";
  return {
    def: {
      type: "function",
      function: {
        name,
        description: mode === "read"
          ? "Run a read-only GitHub CLI command in the project folder, for example [\"pr\",\"view\",\"12\"] or [\"issue\",\"list\",\"--state\",\"open\"]. Allowed: " + Object.entries(GH_READ).map(([g, s]) => {
            return `${g} ${s.join("/")}`;
          }).join(", ") + "."
          : "Run a GitHub CLI command that changes something (asks the user first), for example [\"pr\",\"create\",\"--title\",\"...\",\"--body\",\"...\"]. Allowed: " + Object.entries(GH_WRITE).map(([g, s]) => {
            return `${g} ${s.join("/")}`;
          }).join(", ") + ".",
        parameters: { type: "object", properties: { args: { type: "array", items: { type: "string" }, description: "The arguments after gh, one per item" } }, required: ["args"] },
      },
    },
    needsApproval: mode === "write",
    requires: "gh",
    describe: (a) => {
      return `gh ${Array.isArray(a.args)
        ? a.args.map((x) => {
            return show(x);
          }).join(" ")
        : ""}`;
    },
    async run(a, ctx) {
      const args = argList(a.args);
      checkGh(mode, args);
      return outcome("gh", await runProgram("gh", args, { cwd: ctx.cwd, env: safeEnv(GH_ENV) }));
    },
  };
};

// ---- git -----------------------------------------------------------------------------------------------------------------------

const GIT_READ = new Set(["status", "log", "diff", "show", "blame", "ls-files", "ls-tree", "rev-parse", "describe", "shortlog", "grep", "cat-file", "branch", "remote", "tag", "stash"]);
const GIT_WRITE = new Set(["add", "commit", "checkout", "switch", "restore", "branch", "tag", "stash", "merge", "push", "pull", "fetch", "cherry-pick", "revert", "mv", "rm", "reset", "rebase"]);

// What changes where git works, runs another program, or writes outside the working tree.
const GIT_REFUSED_FLAGS = ["-c", "-C", "--config-env", "--git-dir", "--work-tree", "--exec-path", "--output", "-o", "--ext-diff", "--upload-pack", "--receive-pack", "--exec", "--open-files-in-pager", "--no-verify", "--hard", "--interactive", "-i"];
const GIT_PUSH_REFUSED = ["--force", "-f", "--force-with-lease", "--delete", "-d", "--mirror", "--prune"];

// `branch`, `tag`, `remote` and `stash` read or change depending on their arguments; as reads they may only list.
const GIT_LIST_ONLY: Record<string, string[]> = {
  branch: ["-a", "-r", "-v", "-vv", "--list", "--show-current", "--merged", "--no-merged", "--contains", "--all", "--remotes", "--verbose"],
  tag: ["-l", "--list", "-n", "--sort", "--contains", "--points-at"],
  remote: ["-v", "--verbose"],
  stash: [],
};

export const checkGit = (mode: "read" | "write", args: string[]): void => {
  const sub = args[0] ?? "";
  if (sub === "" || sub.startsWith("-")) {
    throw new Error("the first argument must be a git command such as status or log, not an option");
  }
  const allowed = mode === "read" ? GIT_READ : GIT_WRITE;
  if (!allowed.has(sub)) {
    const hint = (mode === "read" ? GIT_WRITE : GIT_READ).has(sub) ? ` That is a ${mode === "read" ? "changing" : "reading"} command: use ${mode === "read" ? "git_write" : "git_read"}.` : "";
    throw new Error(`"git ${sub}" is not allowed in ${mode === "read" ? "git_read" : "git_write"}.${hint} Allowed: ${[...allowed].join(", ")}`);
  }
  const bad = hasFlag(args.slice(1), GIT_REFUSED_FLAGS);
  if (bad) {
    throw new Error(`git ${bad} is not allowed (it changes where git works, runs another program, skips checks or discards work)`);
  }
  if (mode === "write" && sub === "push") {
    const force = hasFlag(args.slice(1), GIT_PUSH_REFUSED) ?? args.slice(1).find((a) => {
      return a.startsWith("+");
    });
    if (force) {
      throw new Error(`git push ${force} is not allowed: forced and deleting pushes are left for the person to run`);
    }
  }
  if (mode === "read" && sub in GIT_LIST_ONLY) {
    const flags = GIT_LIST_ONLY[sub] ?? [];
    const rest = args.slice(1);
    const other = rest.find((a) => {
      return a.startsWith("-") && !flags.some((f) => {
        return a === f || a.startsWith(`${f}=`);
      });
    });
    const sub2 = sub === "stash" ? rest[0] : undefined;
    // "git branch name" would create one, so a name is only allowed after --list or a filter flag.
    const names = rest.filter((a) => {
      return !a.startsWith("-");
    });
    const listing = rest.some((a) => {
      return ["--list", "-l", "--contains", "--merged", "--no-merged", "--show-current", "--points-at"].includes(a);
    });
    if (other || (sub === "stash" && sub2 !== "list" && sub2 !== "show") || (sub !== "stash" && names.length > 0 && !listing && sub !== "remote")) {
      throw new Error(`git ${sub} in git_read may only list; use git_write to change anything`);
    }
    if (sub === "remote" && names.length > 0) {
      throw new Error("git remote in git_read may only list (git remote -v)");
    }
  }
};

const gitTool = (mode: "read" | "write"): ToolSpec => {
  const name = mode === "read" ? "git_read" : "git_write";
  return {
    def: {
      type: "function",
      function: {
        name,
        description: mode === "read"
          ? `Run a read-only git command in the project folder, for example ["status"], ["log","--oneline","-20"] or ["diff","HEAD~1"]. Allowed: ${[...GIT_READ].join(", ")}.`
          : `Run a git command that changes the repository (asks the user first), for example ["add","src/a.ts"] or ["commit","-m","message"]. Allowed: ${[...GIT_WRITE].join(", ")}. Forced pushes, --no-verify and --hard are refused.`,
        parameters: { type: "object", properties: { args: { type: "array", items: { type: "string" }, description: "The arguments after git, one per item" } }, required: ["args"] },
      },
    },
    needsApproval: mode === "write",
    requires: "git",
    describe: (a) => {
      return `git ${Array.isArray(a.args)
        ? a.args.map((x) => {
            return show(x);
          }).join(" ")
        : ""}`;
    },
    async run(a, ctx) {
      const args = argList(a.args);
      checkGit(mode, args);
      return outcome("git", await runProgram("git", ["--no-pager", ...args], { cwd: ctx.cwd }));
    },
  };
};

// ---- jq and fzf ----------------------------------------------------------------------------------------------------------------

const MAX_INPUT = 5_000_000;

// A jq filter may read the environment, other files or modules; none of that is wanted here, so those words are refused.
export const checkJqFilter = (filter: string): void => {
  if (filter.trim() === "" || filter.length > MAX_ARG_LENGTH) {
    throw new Error(`the filter must be 1 to ${String(MAX_ARG_LENGTH)} characters`);
  }
  if (filter.trimStart().startsWith("-")) {
    throw new Error("the filter cannot start with \"-\"; write 0 - .x for a negative");
  }
  if (/(^|[^.\w"])(import|include|env|input_filename|get_search_list)\b/.test(filter) || /\$ENV|\$__prog|\$__loc__/.test(filter)) {
    throw new Error("the filter may not use import, include, env, $ENV or input_filename");
  }
};

// Where a tool's data comes from: text given inline, or a file inside the project folder.
const dataOf = async (a: Record<string, unknown>, cwd: string): Promise<string> => {
  if (typeof a.file === "string" && a.file !== "") {
    const file = await resolveInside(cwd, a.file);
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_INPUT) {
      throw new Error(`"${a.file}" must be a file of at most ${String(MAX_INPUT)} bytes`);
    }
    return fs.readFile(file, "utf8");
  }
  if (typeof a.input === "string") {
    if (a.input.length > MAX_INPUT) {
      throw new Error(`"input" is longer than ${String(MAX_INPUT)} characters`);
    }
    return a.input;
  }
  throw new Error("give either \"input\" (the text) or \"file\" (a path in the project folder)");
};

const jqTool: ToolSpec = {
  def: {
    type: "function",
    function: {
      name: "jq",
      description: "Run a jq filter over JSON, given as text in \"input\" or as a file in the project folder. Returns the result. Cannot read the environment or other files.",
      parameters: {
        type: "object",
        properties: {
          filter: { type: "string", description: "The jq filter, for example .items[] | .name" },
          input: { type: "string", description: "The JSON text" },
          file: { type: "string", description: "A JSON file in the project folder (instead of input)" },
          raw: { type: "boolean", description: "Print strings without quotes (jq -r)" },
        },
        required: ["filter"],
      },
    },
  },
  needsApproval: false,
  requires: "jq",
  describe: (a) => {
    return `jq ${show(a.filter)}${typeof a.file === "string" ? ` ${a.file}` : ""}`;
  },
  async run(a, ctx) {
    const filter = typeof a.filter === "string" ? a.filter : "";
    checkJqFilter(filter);
    const input = await dataOf(a, ctx.cwd);
    return outcome("jq", await runProgram("jq", [...(a.raw === true ? ["-r"] : []), filter], { cwd: ctx.cwd, input }));
  },
};

const fzfTool: ToolSpec = {
  def: {
    type: "function",
    function: {
      name: "fzf_filter",
      description: "Fuzzy-filter lines of text, given in \"input\" or as a file in the project folder, with fzf in non-interactive mode. Returns the best matches first.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to look for" },
          input: { type: "string", description: "The lines, one per line" },
          file: { type: "string", description: "A text file in the project folder (instead of input)" },
          exact: { type: "boolean", description: "Exact substring matching instead of fuzzy" },
          limit: { type: "number", description: "At most this many lines (default 50)" },
        },
        required: ["query"],
      },
    },
  },
  needsApproval: false,
  requires: "fzf",
  describe: (a) => {
    return `fzf --filter ${show(a.query)}${typeof a.file === "string" ? ` ${a.file}` : ""}`;
  },
  async run(a, ctx) {
    const query = typeof a.query === "string" ? a.query : "";
    if (query === "" || query.length > 500) {
      throw new Error("\"query\" must be 1 to 500 characters");
    }
    const limit = typeof a.limit === "number" && Number.isFinite(a.limit) ? Math.min(Math.max(Math.floor(a.limit), 1), 500) : 50;
    const input = await dataOf(a, ctx.cwd);
    // fzf exits 1 when nothing matches, which is an answer and not a failure.
    const result = await runProgram("fzf", [`--filter=${query}`, ...(a.exact === true ? ["--exact"] : [])], { cwd: ctx.cwd, input });
    if (result.code === 1) {
      return "(no matches)";
    }
    return outcome("fzf", { ...result, stdout: result.stdout.split(/\r?\n/).slice(0, limit).join("\n") });
  },
};

export const devTools: ToolSpec[] = [ghTool("read"), ghTool("write"), gitTool("read"), gitTool("write"), jqTool, fzfTool];
