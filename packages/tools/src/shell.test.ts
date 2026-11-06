import fs from "node:fs";
import os from "node:os";
import { beforeAll, describe, expect, it } from "vitest";
import { commandEnv, runShell, shellAdvice, shellFor, shellName } from "./shell.js";
import { findTool } from "./tools.js";

// The first look for PowerShell starts it, and a cold start can take many seconds on a busy machine. The answer is kept, so it is done
// once here, with time to spare, and no test pays for it or times out because of it.
beforeAll(() => {
  shellFor("win32", "");
}, 60_000);

describe("which shell a device uses", () => {
  it("is PowerShell 7 on Windows if it is installed, then Windows PowerShell, then the command prompt", () => {
    const shell = shellFor("win32", "dir");
    expect(["pwsh", "powershell.exe", "cmd.exe"]).toContain(shell.bin);
    if (shell.bin === "cmd.exe") {
      expect(shell).toMatchObject({ name: "cmd", verbatim: true });
      expect(shell.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
      expect(shell.args[3]).toContain("dir");
    } else {
      expect(shell.name).toBe(shell.bin === "pwsh" ? "PowerShell" : "Windows PowerShell");
      expect(shell.args.at(-1)).toContain("dir");
      expect(shell.args).toEqual(expect.arrayContaining(["-NoProfile", "-NonInteractive", "-Command"]));
    }
  });

  it.skipIf(process.platform === "win32")("is the login shell on macOS and Linux if it is bash or zsh, and bash or sh otherwise", () => {
    expect(shellFor("linux", "ls", { SHELL: "/bin/bash" })).toMatchObject({ bin: "/bin/bash", args: ["-c", "ls"], name: "bash" });
    expect(["bash", "sh"]).toContain(shellFor("linux", "ls", { SHELL: "/usr/bin/fish" }).name);
    expect(["bash", "sh"]).toContain(shellFor("darwin", "ls", {}).name);
  });

  it("reports the name a device would use, for the model to be told", () => {
    expect(["PowerShell", "Windows PowerShell", "cmd"]).toContain(shellName("win32"));
    expect(shellName("linux")).toMatch(/^(bash|sh)$/);
  });

  it("tells the model what syntax to write", () => {
    expect(shellAdvice("win32", "PowerShell")).toContain("PowerShell");
    expect(shellAdvice("win32", "cmd")).toContain("cmd.exe");
    expect(shellAdvice("win32", "cmd")).toContain("Neither PowerShell 7 nor Windows PowerShell");
    expect(shellAdvice("win32", "Windows PowerShell")).toContain("5.1");
    expect(shellAdvice("win32", "Windows PowerShell")).toContain("'&&' and '||' operators");
    expect(shellAdvice("win32")).toContain("cmd.exe");
    expect(shellAdvice("darwin", "zsh")).toContain("zsh on macOS");
    expect(shellAdvice("linux")).toContain("bash on Linux");
  });
});

describe("the environment a command gets", () => {
  it("keeps what a program needs, and drops anything that holds a secret, the gateway key above all", () => {
    const env = commandEnv({
      PATH: "/bin",
      HOME: "/h",
      JAVA_HOME: "/jdk",
      HARNESS_API_KEY: "secret",
      HARNESS_ANYTHING: "x",
      GITHUB_TOKEN: "ghp",
      AWS_SECRET_ACCESS_KEY: "s",
      DB_PASSWORD: "p",
      OPENAI_API_KEY: "k",
      SSH_AUTH_SOCK: "/tmp/agent",
    });
    expect(env.PATH).toBe("/bin");
    expect(env.JAVA_HOME).toBe("/jdk");
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/agent");
    for (const name of ["HARNESS_API_KEY", "HARNESS_ANYTHING", "GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY", "DB_PASSWORD", "OPENAI_API_KEY"]) {
      expect(env[name]).toBeUndefined();
    }
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
  });
});

describe("running a command", () => {
  it("runs it in the shell, in the folder given, and returns what it printed with the exit code", async () => {
    const ok = await runShell("node -p 1+1", os.tmpdir());
    expect(ok).toMatchObject({ code: 0, timedOut: false });
    expect(ok.output.trim()).toBe("2");
    const failed = await runShell("node -e \"process.exit(3)\"", os.tmpdir());
    expect(failed.code).toBe(3);
    const where = await runShell("node -p \"process.cwd()\"", os.tmpdir());
    expect(fs.realpathSync(where.output.trim()).toLowerCase()).toBe(fs.realpathSync(os.tmpdir()).toLowerCase());
  });

  it("does not let a command read the gateway key, even though the agent has it", async () => {
    process.env.HARNESS_API_KEY = "must-not-leak";
    try {
      const result = await runShell("node -p process.env.HARNESS_API_KEY", os.tmpdir());
      expect(result.output).not.toContain("must-not-leak");
      expect(result.output.trim()).toBe("undefined");
    } finally {
      delete process.env.HARNESS_API_KEY;
    }
  });

  it("is stopped when it takes too long", async () => {
    const result = await runShell("node -e \"setTimeout(function(){},60000)\"", os.tmpdir(), { timeoutMs: 700 });
    expect(result.timedOut).toBe(true);
  });

  it("is what the run_command tool does, and still asks first", async () => {
    const tool = findTool("run_command");
    expect(tool?.needsApproval).toBe(true);
    expect(tool?.def.function.description).toContain("PowerShell on Windows");
    expect(await tool?.run({ command: "node -p 6*7" }, { cwd: os.tmpdir() })).toBe("exit code 0\n42");
  });
});
