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
}

const MAX_RUNNING = 8;
const MAX_KEPT = 200_000;
const MAX_FINISHED = 20;

const tasks = new Map<string, Task>();
let counter = 0;

const kill = (child: ChildProcess): void => {
  if (child.pid === undefined) {
    return;
  }
  if (process.platform === "win32") {
    // A child of the shell would be left running, so the whole tree is stopped.
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
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
  const task: Task = { id: `t${String(counter)}`, session, command, status: "running", startedAt: Date.now(), child, output: "" };
  tasks.set(task.id, task);
  const add = (d: Buffer): void => {
    task.output += d.toString("utf8");
    if (task.output.length > MAX_KEPT) {
      task.output = task.output.slice(-MAX_KEPT / 2);
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
  return { info: info(task), output: lines.slice(-tail).join("\n") };
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
  for (const t of tasks.values()) {
    if (t.status === "running") {
      t.status = "stopped";
      kill(t.child);
    }
  }
};

process.once("exit", stopAllTasks);
