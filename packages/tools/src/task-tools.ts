import { num, show, str, truncate, type ToolSpec } from "./helpers.js";
import { clearFinishedTasks, listTasks, stopSessionTasks, stopTask, taskOutput, waitTask, type TaskInfo } from "./tasks.js";

// Tools for commands started with run_command's background option. They only act on the session's own tasks.

const owner = (session: string | undefined): string => {
  return session ?? "local";
};

const stateOf = (info: TaskInfo): string => {
  return info.status === "running" ? "running" : `${info.status}${info.code === undefined || info.code === null ? "" : ` with exit code ${String(info.code)}`}`;
};

const WAIT_DEFAULT = 30;
const WAIT_MAX = 120;

const taskOutputTool: ToolSpec = {
  def: {
    type: "function",
    function: {
      name: "task_output",
      description: "Read the latest output of a background task started with run_command, and whether it is still running.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "The task id, such as t1" }, lines: { type: "number", description: "How many of the last lines to return (default 100)" } },
        required: ["id"],
      },
    },
  },
  needsApproval: false,
  group: "device",
  level: "change",
  describe: (a) => {
    return `read output of task ${show(a.id)}`;
  },
  // A task that is not there is an error the model is told, so it comes back as a rejected promise.
  run(a, ctx) {
    return Promise.resolve().then(() => {
      const { info, output } = taskOutput(owner(ctx.session), str(a, "id"), Math.max(1, Math.floor(num(a, "lines") ?? 100)));
      return `task ${info.id} (${info.command}) is ${stateOf(info)}\n${truncate(output.trim() || "(no output yet)")}`;
    });
  },
};

const taskWaitTool: ToolSpec = {
  def: {
    type: "function",
    function: {
      name: "task_wait",
      description: `Wait for a background task started with run_command to end, or for the timeout, whichever comes first, and return the output written since the last read. It says which happened. If the timeout comes first the task is left running. Use this instead of sleeping.`,
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The task id, such as t1" },
          timeout: { type: "number", description: `Seconds to wait (default ${String(WAIT_DEFAULT)}, at most ${String(WAIT_MAX)})` },
        },
        required: ["id"],
      },
    },
  },
  needsApproval: false,
  group: "device",
  level: "change",
  describe: (a) => {
    return `wait for task ${show(a.id)}`;
  },
  run(a, ctx) {
    return Promise.resolve().then(async () => {
      const seconds = Math.min(WAIT_MAX, Math.max(0.1, num(a, "timeout") ?? WAIT_DEFAULT));
      const { info, output, timedOut } = await waitTask(owner(ctx.session), str(a, "id"), seconds);
      const head = timedOut
        ? `task ${info.id} (${info.command}) is still running: timed out after ${String(seconds)} seconds, and it was left running`
        : `task ${info.id} (${info.command}) ${stateOf(info)}`;
      return `${head}\n${truncate(output.trim() || "(no new output)")}`;
    });
  },
};

const taskStopTool: ToolSpec = {
  def: {
    type: "function",
    function: {
      name: "task_stop",
      description: "Stop a background task started with run_command, with everything it started.",
      parameters: { type: "object", properties: { id: { type: "string", description: "The task id, such as t1" } }, required: ["id"] },
    },
  },
  needsApproval: false,
  group: "device",
  level: "change",
  describe: (a) => {
    return `stop task ${show(a.id)}`;
  },
  run(a, ctx) {
    return Promise.resolve().then(() => {
      const info = stopTask(owner(ctx.session), str(a, "id"));
      return `task ${info.id} is ${info.status}`;
    });
  },
};

// Not offered to the model: the gateway asks for the list to show in the side panel, and to stop a deleted session's tasks.
const tasksListTool: ToolSpec = {
  def: { type: "function", function: { name: "tasks_list", description: "The background tasks of this session.", parameters: { type: "object", properties: {} } } },
  needsApproval: false,
  group: "device",
  level: "read",
  hidden: true,
  describe: () => {
    return "list background tasks";
  },
  run(_a, ctx) {
    return Promise.resolve(JSON.stringify(listTasks(owner(ctx.session))));
  },
};

const tasksStopAllTool: ToolSpec = {
  def: { type: "function", function: { name: "tasks_stop_all", description: "Stop the background tasks of this session.", parameters: { type: "object", properties: {} } } },
  needsApproval: false,
  group: "device",
  level: "read",
  hidden: true,
  describe: () => {
    return "stop background tasks";
  },
  run(_a, ctx) {
    // The conversation's browser goes with its tasks.
    return (ctx.browser?.close(owner(ctx.session)) ?? Promise.resolve()).then(() => {
      return `stopped ${String(stopSessionTasks(owner(ctx.session)))} tasks`;
    });
  },
};

// Not offered to the model: the person's Clear finished button in the side panel. Running tasks are kept.
const tasksClearFinishedTool: ToolSpec = {
  def: { type: "function", function: { name: "tasks_clear_finished", description: "Forget the background tasks of this session that have ended.", parameters: { type: "object", properties: {} } } },
  needsApproval: false,
  group: "device",
  level: "read",
  hidden: true,
  describe: () => {
    return "clear finished background tasks";
  },
  run(_a, ctx) {
    return Promise.resolve(`cleared ${String(clearFinishedTasks(owner(ctx.session)))} tasks`);
  },
};

export const taskTools: ToolSpec[] = [taskOutputTool, taskWaitTool, taskStopTool, tasksListTool, tasksStopAllTool, tasksClearFinishedTool];
