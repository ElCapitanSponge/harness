import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearFinishedTasks, listTasks, startTask, stopAllTasks, stopSessionTasks, stopTask, taskOutput } from "./tasks.js";
import { findTool, toolNamesFor } from "./tools.js";

let dir: string;

const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 300 && !check(); i++) {
    await new Promise((r) => {
      return setTimeout(r, 20);
    });
  }
  expect(check()).toBe(true);
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "tasks-"));
  // A program that prints and then keeps running, like a dev server.
  await fs.writeFile(path.join(dir, "server.js"), "console.log('listening on 3000'); setInterval(() => {}, 1000);\n");
  await fs.writeFile(path.join(dir, "quick.js"), "console.log('built'); process.exit(3);\n");
  // Prints, waits, and prints again, to see output arrive while the command is still running.
  await fs.writeFile(path.join(dir, "slow.js"), "console.log('first'); setTimeout(() => { console.log('second'); }, 1500);\n");
});

afterEach(async () => {
  stopAllTasks();
  await new Promise((r) => {
    return setTimeout(r, 100);
  });
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {
    return undefined;
  });
});

describe("background tasks", () => {
  it("starts a command and returns at once, reads its output while it runs, and stops it", async () => {
    const task = startTask("s1", "node server.js", dir);
    expect(task).toMatchObject({ id: expect.stringMatching(/^t\d+$/) as string, status: "running" });

    await until(() => {
      return taskOutput("s1", task.id, 50).output.includes("listening on 3000");
    });
    expect(taskOutput("s1", task.id, 50).info.status).toBe("running");

    expect(stopTask("s1", task.id).status).toBe("stopped");
    await until(() => {
      return taskOutput("s1", task.id, 5).info.code !== undefined;
    });
    expect(listTasks("s1")).toEqual([expect.objectContaining({ id: task.id, status: "stopped" }) as unknown]);
  });

  it("records how a command that ends by itself finished", async () => {
    const task = startTask("s1", "node quick.js", dir);
    await until(() => {
      return taskOutput("s1", task.id, 5).info.status === "exited";
    });
    expect(taskOutput("s1", task.id, 5)).toMatchObject({ info: { status: "exited", code: 3 }, output: expect.stringContaining("built") as string });
  });

  it("keeps each session's tasks to itself", () => {
    const task = startTask("s1", "node server.js", dir);
    expect(() => {
      return taskOutput("s2", task.id, 5);
    }).toThrow("no task");
    expect(() => {
      return stopTask("s2", task.id);
    }).toThrow("no task");
    expect(listTasks("s2")).toEqual([]);
  });

  it("stops everything a session started, and only that session's, and limits how many run at once", async () => {
    const mineOne = startTask("s1", "node server.js", dir);
    const other = startTask("s2", "node server.js", dir);
    expect(stopSessionTasks("s1")).toBe(1);
    expect(listTasks("s1")[0]?.status).toBe("stopped");
    expect(listTasks("s2")[0]).toMatchObject({ id: other.id, status: "running" });
    expect(mineOne.id).not.toBe(other.id);

    for (let i = 0; i < 8; i++) {
      startTask("s3", "node server.js", dir);
    }
    expect(() => {
      return startTask("s3", "node server.js", dir);
    }).toThrow("already running");
  });
});

describe("clearing finished tasks", () => {
  it("forgets the ones that exited or were stopped, keeps the running ones, and only for that session", async () => {
    const quick = startTask("clear-a", "node quick.js", dir);
    const stopped = startTask("clear-a", "node server.js", dir);
    const running = startTask("clear-a", "node server.js", dir);
    const other = startTask("clear-b", "node quick.js", dir);
    stopTask("clear-a", stopped.id);
    await until(() => {
      return taskOutput("clear-a", quick.id, 5).info.status === "exited" && taskOutput("clear-b", other.id, 5).info.status === "exited";
    });
    expect(clearFinishedTasks("clear-a")).toBe(2);
    expect(listTasks("clear-a")).toEqual([expect.objectContaining({ id: running.id, status: "running" }) as unknown]);
    expect(listTasks("clear-b")).toHaveLength(1);
    expect(clearFinishedTasks("clear-a")).toBe(0);
    expect(await findTool("tasks_clear_finished")?.run({}, { cwd: dir, session: "clear-b" })).toBe("cleared 1 tasks");
  });
});

describe("the task tools", () => {
  it("run_command starts a background task and the other tools read and stop it, for the session in the call", async () => {
    const run = findTool("run_command");
    const started = await run?.run({ command: "node server.js", background: true }, { cwd: dir, session: "s9" });
    const id = /task (t\d+)/.exec(started ?? "")?.[1] ?? "";
    expect(id).not.toBe("");
    await until(() => {
      return taskOutput("s9", id, 5).output.includes("listening");
    });
    expect(await findTool("task_output")?.run({ id }, { cwd: dir, session: "s9" })).toContain("is running");
    expect(JSON.parse(await findTool("tasks_list")?.run({}, { cwd: dir, session: "s9" }) ?? "[]")).toHaveLength(1);
    expect(await findTool("task_stop")?.run({ id }, { cwd: dir, session: "s9" })).toBe(`task ${id} is stopped`);
    await expect(findTool("task_output")?.run({ id }, { cwd: dir, session: "other" }) ?? Promise.resolve("")).rejects.toThrow("no task");
  });

  it("need the change level like run_command, and the list and stop-all are not offered to the model", () => {
    expect(toolNamesFor("read", "off")).not.toContain("task_output");
    expect(toolNamesFor("change", "off")).toEqual(expect.arrayContaining(["run_command", "task_output", "task_stop"]));
    expect(toolNamesFor("change", "change")).not.toContain("tasks_list");
    expect(toolNamesFor("change", "change")).not.toContain("tasks_stop_all");
    expect(toolNamesFor("change", "change")).not.toContain("tasks_clear_finished");
    expect(findTool("run_command")?.needsApproval).toBe(true);
    expect(toolNamesFor("change", "off")).toContain("task_wait");
  });
});

describe("waiting for a task", () => {
  const start = async (command: string, session: string): Promise<string> => {
    const started = await findTool("run_command")?.run({ command, background: true }, { cwd: dir, session });
    return /task (t\d+)/.exec(started ?? "")?.[1] ?? "";
  };
  const call = (name: string, args: Record<string, unknown>, session: string): Promise<string> => {
    return findTool(name)?.run(args, { cwd: dir, session }) ?? Promise.reject(new Error(`no tool ${name}`));
  };

  it("shows the first line at once, and task_wait returns the second when it arrives, saying the task ended", async () => {
    const id = await start("node slow.js", "w1");
    await until(() => {
      return taskOutput("w1", id, 5).output.includes("first");
    });
    const early = await call("task_output", { id }, "w1");
    expect(early).toContain("is running");
    expect(early).toContain("first");
    expect(early).not.toContain("second");

    const waited = await call("task_wait", { id, timeout: 20 }, "w1");
    expect(waited).toContain("exited");
    expect(waited).toContain("second");
    // Only what came since the last read.
    expect(waited).not.toContain("first");
  });

  it("returns early when the timeout is shorter than the command, says it is still running, and leaves it running", async () => {
    const id = await start("node server.js", "w2");
    const began = Date.now();
    const waited = await call("task_wait", { id, timeout: 0.5 }, "w2");
    expect(Date.now() - began).toBeLessThan(5000);
    expect(waited).toContain("still running");
    expect(waited).toContain("timed out");
    expect(taskOutput("w2", id, 5).info.status).toBe("running");
  });

  it("still lets task_stop stop a task that was waited on", async () => {
    const id = await start("node server.js", "w3");
    await call("task_wait", { id, timeout: 0.3 }, "w3");
    expect(await call("task_stop", { id }, "w3")).toBe(`task ${id} is stopped`);
    await until(() => {
      return taskOutput("w3", id, 5).info.code !== undefined;
    });
    expect(taskOutput("w3", id, 5).info.status).toBe("stopped");
  });

  it("only waits for the session's own tasks", async () => {
    const id = await start("node server.js", "w4");
    await expect(call("task_wait", { id, timeout: 0.3 }, "other")).rejects.toThrow("no task");
  });
});

describe("stopping tasks", () => {
  // The ids of node processes whose command line names the script, found the way a person would look for a leftover.
  const running = (script: string): number[] => {
    const found = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*${script}*' } | ForEach-Object { $_.ProcessId }`], { encoding: "utf8", windowsHide: true });
    return found.stdout.split(/\s+/).filter(Boolean).map(Number);
  };

  it.skipIf(process.platform !== "win32")("leaves no process running when many tasks are stopped straight after they start", async () => {
    const script = `leak-${String(process.pid)}-${String(Date.now())}.js`;
    await fs.writeFile(path.join(dir, script), "setInterval(() => {}, 1000);\n");
    // Stopped after every delay from nothing up to about a third of a second, which covers the shell still starting its program.
    for (let i = 0; i < 40; i++) {
      const task = startTask(`leak-${String(i)}`, `node ${script}`, dir);
      await new Promise((resolve) => {
        return setTimeout(resolve, i * 8);
      });
      stopTask(`leak-${String(i)}`, task.id);
    }
    await new Promise((resolve) => {
      return setTimeout(resolve, 4000);
    });
    const left = running(script);
    for (const pid of left) {
      process.kill(pid);
    }
    expect(left).toEqual([]);
  }, 60_000);
});
