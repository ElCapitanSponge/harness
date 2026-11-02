import { describe, expect, it } from "vitest";
import { MAX_SUBAGENTS, MAX_SUBAGENT_DEPTH, agentTool, readSubagentTask } from "./subagent.js";

describe("the agent tool's arguments", () => {
  it("takes a task, and optionally a model and the tools to give it", () => {
    expect(readSubagentTask({ task: " find it ", model: " qwen ", tools: ["read_file"] })).toEqual({ task: "find it", model: "qwen", tools: ["read_file"] });
    expect(readSubagentTask({ task: "x" })).toEqual({ task: "x" });
  });

  it("says what is wrong in words the model can act on", () => {
    expect(() => {
      return readSubagentTask({});
    }).toThrow("\"task\" must say what");
    expect(() => {
      return readSubagentTask({ task: "x", model: "" });
    }).toThrow("\"model\" must be a model name");
    expect(() => {
      return readSubagentTask({ task: "x", tools: "read_file" });
    }).toThrow("\"tools\" must be a list");
  });

  it("states the limits in its description, which are small and fixed", () => {
    expect(MAX_SUBAGENTS).toBe(8);
    expect(MAX_SUBAGENT_DEPTH).toBe(2);
    expect(agentTool.def.function.description).toContain("At most 8 per conversation");
    expect(agentTool.needsApproval).toBe(false);
  });
});
