import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listTasks, startTask, stopAllTasks, stopSessionTasks, stopTask, taskOutput } from "./tasks.js";
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
    expect(findTool("run_command")?.needsApproval).toBe(true);
  });
});
