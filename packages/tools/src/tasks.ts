import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { commandEnv, shellFor } from "./shell.js";

// Commands that keep running after the tool call returns: a dev server, a long build. They belong to one session, run in the
// device's shell like any command, and are stopped with the session or when the agent exits.

export interface TaskInfo {
  id: string;
  command: string;
  status: "running" | "exited" | "stopped";
  // The exit code once it has ended, when there is one.
  code?: number | null;
  startedAt: number;
}

interface Task extends TaskInfo {
  session: string;
  child: ChildProcess;
  output: string;
  // How many characters have been cut from the front of output, and how many of all it ever held the model has been shown, so a read
  // can give only what is new even after the front is trimmed.
  dropped: number;
  read: number;
}

const MAX_RUNNING = 8;
const MAX_KEPT = 200_000;
const MAX_FINISHED = 20;

const tasks = new Map<string, Task>();
let counter = 0;

// taskkill stops the processes the shell has when it looks. A shell stopped while it was still starting its program leaves that program
// running, with the dead shell's id as its parent, so whatever still has a stopped shell as its parent is stopped too.
// With wait the sweep is done when this returns, which the exit hook needs; without it the sweep runs on its own and does not hold up the agent.
const sweep = (pids: number[], wait: boolean): void => {
  const filter = pids.map((pid) => {
    return `ParentProcessId=${String(pid)}`;
  }).join(" or ");
  const script = `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { taskkill /pid $_.ProcessId /T /F | Out-Null }`;
  const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script];
  if (wait) {
    spawnSync("powershell.exe", args, { stdio: "ignore", windowsHide: true });
    return;
  }
  spawn("powershell.exe", args, { stdio: "ignore", windowsHide: true }).on("error", () => {
    return undefined;
  }).unref();
};

const killAll = (children: ChildProcess[], wait: boolean): void => {
  const pids = children.flatMap((child) => {
    return child.pid === undefined ? [] : [child.pid];
  });
  if (process.platform === "win32") {
    for (const pid of pids) {
      // A child of the shell would be left running, so the whole tree is stopped.
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    }
    if (pids.length > 0) {
      sweep(pids, wait);
    }
    return;
  }
  for (const child of children) {
    if (child.pid === undefined) {
      continue;
    }
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
};

const kill = (child: ChildProcess): void => {
  killAll([child], false);
};

const info = (t: Task): TaskInfo => {
  return { id: t.id, command: t.command, status: t.status, startedAt: t.startedAt, ...(t.code === undefined ? {} : { code: t.code }) };
};

const mine = (session: string, id: string): Task => {
  const task = tasks.get(id);
  if (task?.session !== session) {
    throw new Error(`there is no task "${id}" in this session`);
  }
  return task;
};

export const startTask = (session: string, command: string, cwd: string): TaskInfo => {
  const running = [...tasks.values()].filter((t) => {
    return t.session === session && t.status === "running";
  });
  if (running.length >= MAX_RUNNING) {
    throw new Error(`${String(MAX_RUNNING)} tasks are already running in this session; stop one first`);
  }
  const shell = shellFor(process.platform, command);
  const child = spawn(shell.bin, shell.args, { cwd, env: commandEnv(), windowsHide: true, windowsVerbatimArguments: shell.verbatim === true, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  counter++;
  const task: Task = { id: `t${String(counter)}`, session, command, status: "running", startedAt: Date.now(), child, output: "", dropped: 0, read: 0 };
  tasks.set(task.id, task);
  const add = (d: Buffer): void => {
    task.output += d.toString("utf8");
    if (task.output.length > MAX_KEPT) {
      const cut = task.output.length - MAX_KEPT / 2;
      task.dropped += cut;
      task.output = task.output.slice(cut);
    }
  };
  child.stdout.on("data", add);
  child.stderr.on("data", add);
  child.on("error", (err) => {
    task.output += `failed to start ${shell.name}: ${err.message}\n`;
    task.status = "exited";
    task.code = null;
  });
  child.on("close", (code) => {
    if (task.status === "running") {
      task.status = "exited";
    }
    task.code = code;
  });
  // Keep the list short: the oldest finished tasks go.
  const finished = [...tasks.values()].filter((t) => {
    return t.session === session && t.status !== "running";
  });
  for (const old of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED))) {
    tasks.delete(old.id);
  }
  return info(task);
};

export const taskOutput = (session: string, id: string, tail: number): { info: TaskInfo; output: string } => {
  const task = mine(session, id);
  const lines = task.output.split("\n");
  task.read = task.dropped + task.output.length;
  return { info: info(task), output: lines.slice(-tail).join("\n") };
};

// Waits until the task ends or the seconds pass, whichever is first, and gives the output written since the last read. The task is left
// running when the time runs out.
export const waitTask = async (session: string, id: string, seconds: number): Promise<{ info: TaskInfo; output: string; timedOut: boolean }> => {
  const task = mine(session, id);
  const deadline = Date.now() + seconds * 1000;
  while (task.status === "running" && Date.now() < deadline) {
    await new Promise((resolve) => {
      return setTimeout(resolve, Math.max(1, Math.min(50, deadline - Date.now())));
    });
  }
  const output = task.output.slice(Math.max(0, task.read - task.dropped));
  task.read = task.dropped + task.output.length;
  return { info: info(task), output, timedOut: task.status === "running" };
};

export const stopTask = (session: string, id: string): TaskInfo => {
  const task = mine(session, id);
  if (task.status === "running") {
    task.status = "stopped";
    kill(task.child);
  }
  return info(task);
};

export const listTasks = (session: string): TaskInfo[] => {
  return [...tasks.values()].filter((t) => {
    return t.session === session;
  }).map(info).reverse();
};

// Forgets the session's tasks that have ended (exited or stopped), for the person's Clear finished. A running task is never touched.
export const clearFinishedTasks = (session: string): number => {
  let cleared = 0;
  for (const t of tasks.values()) {
    if (t.session === session && t.status !== "running") {
      tasks.delete(t.id);
      cleared++;
    }
  }
  return cleared;
};

// Stops everything a session started, when it is deleted or the agent exits.
export const stopSessionTasks = (session: string): number => {
  let stopped = 0;
  for (const t of tasks.values()) {
    if (t.session === session && t.status === "running") {
      stopTask(session, t.id);
      stopped++;
    }
  }
  return stopped;
};

export const stopAllTasks = (): void => {
  const stopping: ChildProcess[] = [];
  for (const t of tasks.values()) {
    if (t.status === "running") {
      t.status = "stopped";
      stopping.push(t.child);
    }
  }
  killAll(stopping, true);
};

process.once("exit", stopAllTasks);
