import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { argList, checkGh, checkGit, checkJqFilter, devTools, runProgram, safeEnv } from "./dev-tools.js";
import { findTool, tools } from "./tools.js";

const installed = (program: string): boolean => {
  return spawnSync(program, ["--version"], { stdio: "ignore" }).status === 0;
};

describe("the argument list", () => {
  it("must be a modest list of short strings", () => {
    expect(argList(["pr", "view", "12"])).toEqual(["pr", "view", "12"]);
    expect(() => {
      return argList("pr view");
    }).toThrow("must be a list");
    expect(() => {
      return argList([]);
    }).toThrow("must be a list");
    expect(() => {
      return argList([1]);
    }).toThrow("must be a string");
    expect(() => {
      return argList(["a\0b"]);
    }).toThrow("must be a string");
    expect(() => {
      return argList(["x".repeat(2001)]);
    }).toThrow("must be a string");
    expect(() => {
      return argList(Array.from({ length: 41 }, () => {
        return "a";
      }));
    }).toThrow("must be a list");
  });
});

describe("gh", () => {
  it("lets the reading tool read and the writing tool change, and points to the other when asked the wrong one", () => {
    expect(() => {
      checkGh("read", ["pr", "view", "12", "--json", "title"]);
    }).not.toThrow();
    expect(() => {
      checkGh("write", ["pr", "create", "--title", "t", "--body", "b"]);
    }).not.toThrow();
    expect(() => {
      checkGh("read", ["pr", "create"]);
    }).toThrow("use gh_write");
    expect(() => {
      checkGh("write", ["pr", "view"]);
    }).toThrow("use gh_read");
  });

  it("refuses commands that could do real harm or are not listed, and flags that open a browser, an editor or a file", () => {
    for (const bad of [["repo", "delete", "x"], ["auth", "token"], ["api", "/user"], ["secret", "list"], ["ssh-key", "list"], ["extension", "install", "x"], []]) {
      expect(() => {
        checkGh("read", bad);
      }).toThrow();
      expect(() => {
        checkGh("write", bad);
      }).toThrow();
    }
    expect(() => {
      checkGh("read", ["pr", "view", "1", "--web"]);
    }).toThrow("opens a browser");
    expect(() => {
      checkGh("write", ["issue", "create", "--body-file", "/etc/passwd"]);
    }).toThrow("reads a file");
    expect(() => {
      checkGh("write", ["pr", "comment", "1", "-e"]);
    }).toThrow("editor");
  });
});

describe("git", () => {
  it("allows reading commands and refuses changing ones in the reading tool", () => {
    for (const ok of [["status"], ["log", "--oneline", "-20"], ["diff", "HEAD~1"], ["show", "abc123"], ["branch", "--show-current"], ["branch", "-a"], ["branch", "--list", "feat/*"], ["remote", "-v"], ["tag", "--list"], ["stash", "list"]]) {
      expect(() => {
        checkGit("read", ok);
      }).not.toThrow();
    }
    for (const bad of [["commit", "-m", "x"], ["push"], ["branch", "newbranch"], ["branch", "-D", "x"], ["tag", "v1"], ["remote", "add", "o", "u"], ["stash", "pop"], ["stash"], ["reset"]]) {
      expect(() => {
        checkGit("read", bad);
      }).toThrow();
    }
  });

  it("refuses options that move git elsewhere, run another program or discard work, and forced or deleting pushes", () => {
    for (const bad of [["-c", "core.pager=x", "status"], ["status", "-C", "/"], ["--git-dir=/x", "status"], ["diff", "--output=/tmp/x"], ["log", "--ext-diff"]]) {
      expect(() => {
        checkGit("read", bad);
      }).toThrow();
    }
    for (const bad of [["commit", "--no-verify", "-m", "x"], ["reset", "--hard"], ["rebase", "-i", "main"], ["push", "--force"], ["push", "-f", "origin", "main"], ["push", "--force-with-lease"], ["push", "origin", "+main"], ["push", "origin", "--delete", "x"]]) {
      expect(() => {
        checkGit("write", bad);
      }).toThrow();
    }
    for (const ok of [["add", "a.ts"], ["commit", "-m", "x"], ["push", "origin", "feat"], ["checkout", "-b", "feat"], ["stash", "pop"]]) {
      expect(() => {
        checkGit("write", ok);
      }).not.toThrow();
    }
  });

  it("does not take an option first, or an unknown command", () => {
    expect(() => {
      checkGit("read", ["--version"]);
    }).toThrow("not an option");
    expect(() => {
      checkGit("read", ["daemon"]);
    }).toThrow("not allowed");
    expect(() => {
      checkGit("write", ["clean", "-fd"]);
    }).toThrow("not allowed");
  });
});

describe("the jq filter", () => {
  it("may not reach the environment, other files or modules", () => {
    for (const ok of [".items[] | .name", ".env", ".a.env.b", "map(select(.x > 1))", "to_entries"]) {
      expect(() => {
        checkJqFilter(ok);
      }).not.toThrow();
    }
    for (const bad of ["env", "$ENV.HOME", "env.HARNESS_API_KEY", "import \"x\" as y; .", "include \"x\"; .", "input_filename", "-1", "", "x".repeat(2001)]) {
      expect(() => {
        checkJqFilter(bad);
      }).toThrow();
    }
  });
});

describe("what a program is given", () => {
  it("is a short list of variables, never the agent's own, and the GitHub token only for gh", () => {
    const source = { PATH: "/bin", HOME: "/h", HARNESS_API_KEY: "secret", GH_TOKEN: "ghp_x", GITHUB_TOKEN: "ghp_y", NODE_OPTIONS: "--inspect", SOMETHING_ELSE: "1" };
    const plain = safeEnv([], source);
    expect(plain.PATH).toBe("/bin");
    expect(plain.HARNESS_API_KEY).toBeUndefined();
    expect(plain.GH_TOKEN).toBeUndefined();
    expect(plain.NODE_OPTIONS).toBeUndefined();
    expect(plain.SOMETHING_ELSE).toBeUndefined();
    expect(plain.GIT_TERMINAL_PROMPT).toBe("0");
    expect(safeEnv(["GH_TOKEN", "GITHUB_TOKEN"], source).GH_TOKEN).toBe("ghp_x");
    expect(safeEnv(["GH_TOKEN"], source).HARNESS_API_KEY).toBeUndefined();
  });

  it("really does not reach the program, which is started without a shell", async () => {
    process.env.HARNESS_API_KEY = "must-not-leak";
    try {
      const result = await runProgram(process.execPath, ["-e", "console.log(JSON.stringify({ key: process.env.HARNESS_API_KEY ?? null, arg: process.argv[1] }))", "a; echo hacked $(whoami)"], { cwd: os.tmpdir() });
      expect(JSON.parse(result.stdout)).toEqual({ key: null, arg: "a; echo hacked $(whoami)" });
    } finally {
      delete process.env.HARNESS_API_KEY;
    }
  });

  it("is stopped when it takes too long, and reported plainly when it is not installed", async () => {
    await expect(runProgram(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { cwd: os.tmpdir(), timeoutMs: 300 })).rejects.toThrow("was stopped");
    await expect(runProgram("definitely-not-a-program-xyz", [], { cwd: os.tmpdir() })).rejects.toThrow("is not installed on this device");
  });
});

describe("the tools as offered", () => {
  it("are registered, need a program, and ask only when they change something", () => {
    const byName = Object.fromEntries(devTools.map((t) => {
      return [t.def.function.name, t];
    }));
    expect(Object.keys(byName).sort()).toEqual(["fzf_filter", "gh_read", "gh_write", "git_read", "git_write", "jq"]);
    expect(byName.gh_read?.needsApproval).toBe(false);
    expect(byName.gh_write?.needsApproval).toBe(true);
    expect(byName.git_read?.needsApproval).toBe(false);
    expect(byName.git_write?.needsApproval).toBe(true);
    expect(byName.jq?.needsApproval).toBe(false);
    expect(byName.git_read?.requires).toBe("git");
    expect(byName.gh_write?.requires).toBe("gh");
    for (const t of devTools) {
      expect(findTool(t.def.function.name)).toBe(t);
      expect(tools).toContain(t);
    }
    expect(findTool("web_fetch")?.needsApproval).toBe(true);
  });

  it("describe a call the way a person would type it", () => {
    expect(findTool("gh_read")?.describe({ args: ["pr", "view", "12"] })).toBe("gh pr view 12");
    expect(findTool("git_write")?.describe({ args: ["commit", "-m", "x"] })).toBe("git commit -m x");
  });
});

describe.skipIf(!installed("git"))("git on a real repository", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-git-"));
    const git = (...args: string[]) => {
      return execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    };
    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "T");
    await fs.writeFile(path.join(dir, "a.txt"), "one\n");
    git("add", "a.txt");
    git("commit", "-q", "-m", "first");
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reads status and log, and changes things only through the writing tool", async () => {
    const read = findTool("git_read");
    const write = findTool("git_write");
    expect(await read?.run({ args: ["log", "--oneline"] }, { cwd: dir })).toContain("first");
    await fs.writeFile(path.join(dir, "b.txt"), "two\n");
    expect(await read?.run({ args: ["status", "--short"] }, { cwd: dir })).toContain("b.txt");
    await expect(read?.run({ args: ["add", "b.txt"] }, { cwd: dir })).rejects.toThrow("use git_write");
    await write?.run({ args: ["add", "b.txt"] }, { cwd: dir });
    await write?.run({ args: ["commit", "-q", "-m", "second"] }, { cwd: dir });
    expect(await read?.run({ args: ["log", "--oneline"] }, { cwd: dir })).toContain("second");
  });

  it("reports a failing command with what git said", async () => {
    await expect(findTool("git_read")?.run({ args: ["show", "nonexistent-ref"] }, { cwd: dir })).rejects.toThrow("git exited with");
  });
});

describe.skipIf(!installed("jq"))("jq on real data", () => {
  it("filters inline JSON and a file, and refuses a file outside the folder", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-jq-"));
    try {
      await fs.writeFile(path.join(dir, "d.json"), "{\"items\":[{\"n\":\"a\"},{\"n\":\"b\"}]}");
      const jq = findTool("jq");
      expect(await jq?.run({ filter: ".items[].n", input: "{\"items\":[{\"n\":\"x\"}]}", raw: true }, { cwd: dir })).toBe("x");
      expect(await jq?.run({ filter: ".items | length", file: "d.json" }, { cwd: dir })).toBe("2");
      await expect(jq?.run({ filter: ".", file: "../outside.json" }, { cwd: dir })).rejects.toThrow("outside the working directory");
      await expect(jq?.run({ filter: "env" }, { cwd: dir })).rejects.toThrow("may not use");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
