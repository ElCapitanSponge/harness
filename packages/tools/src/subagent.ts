import type { ToolSpec } from "./helpers.js";

// A sub-agent: a task run in a fresh child conversation, on a model and with a set of tools the caller chooses, whose final answer
// comes back as the tool's result. The gateway runs it (it is a session of its own), so it is not one of the tools a device reports.

// How deep sub-agents may nest (a sub-agent may start one of its own, but that one may not start another), and how many one
// conversation may start in all.
export const MAX_SUBAGENT_DEPTH = 2;
export const MAX_SUBAGENTS = 8;

export interface SubagentTask {
  task: string;
  model?: string;
  tools?: string[];
}

export const readSubagentTask = (args: Record<string, unknown>): SubagentTask => {
  const task = typeof args.task === "string" ? args.task.trim() : "";
  if (task === "") {
    throw new Error("\"task\" must say what the sub-agent is to do, as text");
  }
  if (args.model !== undefined && (typeof args.model !== "string" || args.model.trim() === "")) {
    throw new Error("\"model\" must be a model name, or left out to use the same model");
  }
  if (args.tools !== undefined && (!Array.isArray(args.tools) || args.tools.some((t) => {
    return typeof t !== "string";
  }))) {
    throw new Error("\"tools\" must be a list of tool names, or left out to give it the tools you have");
  }
  return { task, ...(typeof args.model === "string" ? { model: args.model.trim() } : {}), ...(Array.isArray(args.tools) ? { tools: args.tools as string[] } : {}) };
};

export const agentTool: ToolSpec = {
  def: {
    type: "function",
    function: {
      name: "agent",
      description: `Hand a self-contained task to a sub-agent: a fresh conversation with its own context that does the work and returns its final answer. Use it for research or a side task that would clutter this conversation. Say everything it needs in the task, since it cannot see this conversation. It can have a different model, and only the tools you name (never more than you have). At most ${String(MAX_SUBAGENTS)} per conversation.`,
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "What to do and what to report back, with all the context needed" },
          model: { type: "string", description: "A model name; default is the model you are using" },
          tools: { type: "array", items: { type: "string" }, description: "Names of the tools it may use; default is all of yours" },
        },
        required: ["task"],
      },
    },
  },
  needsApproval: false,
  group: "device",
  level: "read",
  describe: (a) => {
    return typeof a.task === "string" ? `sub-agent: ${a.task.slice(0, 80)}` : "start a sub-agent";
  },
  run(a) {
    // The gateway runs this itself; here it only checks the arguments.
    return Promise.resolve().then(() => {
      return readSubagentTask(a).task;
    });
  },
};
