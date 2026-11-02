import type { PlanStep } from "@harness/core";
import type { ToolSpec } from "./helpers.js";

// The model's own to-do list for a session. It touches no files and runs on the gateway, which keeps the plan with the session and
// shows it in the side panel, so it is not one of the tools a device reports.

const STATUSES = ["pending", "in_progress", "done"];

// Checks the steps the model sent. A plan that is not well formed is an error the model can read and fix.
export const readPlan = (args: Record<string, unknown>): PlanStep[] => {
  const steps = args.steps;
  const bad = (): never => {
    throw new Error("\"steps\" must be a list of 1 to 30 steps, each { text, status } with status pending, in_progress or done");
  };
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > 30) {
    return bad();
  }
  return steps.map((s: unknown): PlanStep => {
    const step = s as { text?: unknown; status?: unknown } | null;
    if (typeof step?.text !== "string" || step.text.trim() === "" || typeof step.status !== "string" || !STATUSES.includes(step.status)) {
      return bad();
    }
    return { text: step.text.trim().slice(0, 300), status: step.status as PlanStep["status"] };
  });
};

// What the plan tool says in plan mode: the model can only read until the person approves the plan it sends.
export const planToolForPlanMode = (): ToolSpec => {
  return {
    ...planTool,
    def: {
      ...planTool.def,
      function: {
        ...planTool.def.function,
        description: "You are in plan mode: you can look at things but not change anything. Investigate, then send your plan with this tool. The person has to approve it before you can make changes; if they do not, you are told why, and you revise it.",
      },
    },
  };
};

export const planTool: ToolSpec = {
  def: {
    type: "function",
    function: {
      name: "plan",
      description: "Keep a short plan for this task and update it as you work. Send the whole list each time, with each step pending, in_progress or done; keep one step in_progress at a time. Use it for work with more than a couple of steps.",
      parameters: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            description: "The whole plan, in order",
            items: {
              type: "object",
              properties: { text: { type: "string", description: "What to do, in a few words" }, status: { type: "string", enum: ["pending", "in_progress", "done"] } },
              required: ["text", "status"],
            },
          },
        },
        required: ["steps"],
      },
    },
  },
  needsApproval: false,
  group: "device",
  level: "read",
  describe: (a) => {
    return Array.isArray(a.steps) ? `update the plan (${String(a.steps.length)} steps)` : "update the plan";
  },
  run(a) {
    const steps = readPlan(a);
    const done = steps.filter((s) => {
      return s.status === "done";
    }).length;
    return Promise.resolve(`plan saved: ${String(done)} of ${String(steps.length)} steps done`);
  },
};
