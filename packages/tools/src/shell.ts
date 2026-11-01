import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Running a command the way the device's own terminal would: PowerShell on Windows, the login shell (bash or zsh) elsewhere. A model
// that can use the shell can do nearly anything else a coding session needs (build, test, install, move files, git, curl), so this one
// tool covers what separate tools would, without each needing its own option.

export type ShellName = "PowerShell" | "cmd" | "bash" | "zsh" | "sh";

export interface ShellInvocation {
  bin: string;
  args: string[];
  // What the model should call it, so it writes the right syntax.
  name: ShellName;
  // Pass the arguments to the program as they are, with no quoting added (cmd.exe needs this).
  verbatim?: boolean;
}

const hasProgram = (bin: string): boolean => {
  return spawnSync(bin, ["-NoLogo", "-NoProfile", "-Command", "exit 0"], { stdio: "ignore", windowsHide: true }).status === 0;
};

let windowsShell: "pwsh" | "cmd.exe" | undefined;

// PowerShell 7 (pwsh) if it is installed, otherwise the command prompt that every Windows has.
const windowsBin = (): "pwsh" | "cmd.exe" => {
  windowsShell ??= hasProgram("pwsh") ? "pwsh" : "cmd.exe";
  return windowsShell;
};

// The shell for a platform, with the arguments that make it run one command and exit. On Windows the output is switched to UTF-8 so
// accents and symbols are not mangled on the way back.
export const shellFor = (platform: NodeJS.Platform, command: string, env: NodeJS.ProcessEnv = process.env): ShellInvocation => {
  if (platform === "win32") {
    if (windowsBin() === "pwsh") {
      // PowerShell exits with 1 when the last program failed, whatever its own code was; the program's own code is what is wanted.
      const script = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $ErrorActionPreference = 'Continue'; try { $PSStyle.OutputRendering = 'PlainText' } catch { }; $global:LASTEXITCODE = $null\n${command}\nif ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`;
      return { bin: "pwsh", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], name: "PowerShell" };
    }
    return { bin: "cmd.exe", args: ["/d", "/s", "/c", `"chcp 65001 >nul & ${command}"`], name: "cmd", verbatim: true };
  }
  const chosen = path.basename(env.SHELL ?? "");
  if ((chosen === "zsh" || chosen === "bash") && env.SHELL && fs.existsSync(env.SHELL)) {
    return { bin: env.SHELL, args: ["-c", command], name: chosen };
  }
  if (fs.existsSync("/bin/bash")) {
    return { bin: "/bin/bash", args: ["-c", command], name: "bash" };
  }
  return { bin: "/bin/sh", args: ["-c", command], name: "sh" };
};

// The name of the shell a device would use, for it to report to the gateway.
export const shellName = (platform: NodeJS.Platform = process.platform): ShellName => {
  return shellFor(platform, "").name;
};

// What to tell the model about the shell, in the system prompt: which one, and what that means for the commands it writes. `shell` is
// what the device reported; without it the platform's usual one is assumed.
export const shellAdvice = (platform: string, shell?: string): string => {
  if (shell === "PowerShell") {
    return "Commands run in PowerShell (pwsh) on Windows: use PowerShell syntax (Get-ChildItem, Select-String, Get-Content, ';' to chain, backslash or forward-slash paths) and do not assume Unix tools such as grep, sed or cat exist.";
  }
  if (shell === "cmd" || (platform === "win32" && shell === undefined)) {
    return "Commands run in cmd.exe, the Windows command prompt: use dir, type, findstr, copy, del and '&&' to chain, with backslash paths, and do not assume Unix tools such as grep, sed or cat exist. PowerShell is not installed here.";
  }
  if (platform === "darwin") {
    return `Commands run in ${shell ?? "zsh"} on macOS, so the usual BSD command-line tools are there (sed and date differ from the GNU versions).`;
  }
  return `Commands run in ${shell ?? "bash"} on Linux, so the usual GNU command-line tools are there.`;
};

// Names that hold secrets. A command the model asks for must not be able to read the gateway key or any token or password the agent has.
const SECRET_NAME = /(^HARNESS_)|(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)/i;
// Not secrets, though their names look like it.
const KEEP = new Set(["SSH_AUTH_SOCK", "GPG_AGENT_INFO", "KEYBOARD", "XDG_SESSION_KEY"]);

export const commandEnv = (source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && (KEEP.has(name) || !SECRET_NAME.test(name))) {
      env[name] = value;
    }
  }
  return { ...env, NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat", PAGER: "cat" };
};

export interface CommandResult {
  code: number | null;
  output: string;
  timedOut: boolean;
}

const MAX_KEPT = 200_000;

// Runs one command in the device's shell, in `cwd`, and gathers what it printed (both streams, in the order they came). It is stopped,
// with whatever it started, if it takes longer than the limit.
export const runShell = (command: string, cwd: string, options: { timeoutMs?: number; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {}): Promise<CommandResult> => {
  const shell = shellFor(options.platform ?? process.platform, command);
  const limit = options.timeoutMs ?? 120_000;
  return new Promise((resolve) => {
    const child = spawn(shell.bin, shell.args, { cwd, env: options.env ?? commandEnv(), windowsHide: true, windowsVerbatimArguments: shell.verbatim === true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let timedOut = false;
    const add = (d: Buffer): void => {
      output += d.toString("utf8");
      if (output.length > MAX_KEPT) {
        output = output.slice(-MAX_KEPT / 2);
      }
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const timer = setTimeout(() => {
      timedOut = true;
      // On Windows a child of the shell would be left running, so the whole tree is stopped.
      if (process.platform === "win32" && child.pid !== undefined) {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      } else {
        child.kill("SIGKILL");
      }
    }, limit);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, output: `failed to start ${shell.name}: ${err.message}`, timedOut: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output, timedOut });
    });
  });
};
