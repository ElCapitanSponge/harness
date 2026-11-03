import { describe, expect, it } from "vitest";
import { claudeArgs, isClaudeModel } from "./claudecode.js";

describe("isClaudeModel", () => {
  it("matches claude and claude:<alias> only", () => {
    expect(isClaudeModel("claude")).toBe(true);
    expect(isClaudeModel("claude:sonnet")).toBe(true);
    expect(isClaudeModel("claude-3")).toBe(false);
    expect(isClaudeModel("auto")).toBe(false);
  });
});

describe("claudeArgs", () => {
  it("passes the alias as --model and the prompt as the first argument", () => {
    expect(claudeArgs("claude:sonnet", "fix it")).toEqual(["--model", "sonnet", "fix it"]);
  });

  it("hands print mode to Claude Code, which has the same flags", () => {
    expect(claudeArgs("claude:sonnet", "fix it", { format: "text" })).toEqual(["-p", "--model", "sonnet", "fix it"]);
    expect(claudeArgs("claude", "fix it", { format: "json" })).toEqual(["-p", "--output-format", "json", "fix it"]);
    expect(claudeArgs("claude", "fix it")).toEqual(["fix it"]);
  });

  it("omits --model for plain 'claude' and omits an empty prompt", () => {
    expect(claudeArgs("claude", "")).toEqual([]);
    expect(claudeArgs("claude:opus", "")).toEqual(["--model", "opus"]);
  });
});
