import { describe, expect, it } from "vitest";
import { asSkillInfo, BUILTIN_COMMANDS, INIT_PROMPT, isCommand, parseCommand, permissionArg, resolveModel, unavailable } from "./commands";

describe("the built-in commands", () => {
  it("are the five, each with a description, and are told apart from skills", () => {
    expect(BUILTIN_COMMANDS.map((c) => {
      return c.name;
    })).toEqual(["compact", "clear", "model", "permissions", "init"]);
    expect(BUILTIN_COMMANDS.every((c) => {
      return c.description.length > 0;
    })).toBe(true);
    const listed = asSkillInfo(BUILTIN_COMMANDS[2] ?? { name: "", description: "" });
    expect(listed).toMatchObject({ name: "model", hint: "[model]", source: "command" });
    expect(isCommand(listed)).toBe(true);
    expect(isCommand({ ...listed, source: "project" })).toBe(false);
  });
});

describe("recognising a command in a message", () => {
  it("reads the name and the rest as arguments", () => {
    expect(parseCommand("/compact")).toEqual({ name: "compact", args: "" });
    expect(parseCommand("  /model  qwen 3  ")).toEqual({ name: "model", args: "qwen 3" });
    expect(parseCommand("/permissions plan")).toEqual({ name: "permissions", args: "plan" });
  });

  it("leaves skills, ordinary messages and unknown commands to be sent", () => {
    expect(parseCommand("/review the diff")).toBeUndefined();
    expect(parseCommand("please /compact")).toBeUndefined();
    expect(parseCommand("compact")).toBeUndefined();
  });
});

describe("where a command applies", () => {
  it("lets /model work anywhere, and the others only where there is something to act on", () => {
    expect(unavailable("model", { conversation: false, code: false })).toBeUndefined();
    expect(unavailable("compact", { conversation: true, code: false })).toBeUndefined();
    expect(unavailable("compact", { conversation: false, code: false })).toContain("started");
    expect(unavailable("clear", { conversation: false, code: false })).toContain("started");
    expect(unavailable("permissions", { conversation: true, code: true })).toBeUndefined();
    expect(unavailable("permissions", { conversation: true, code: false })).toContain("coding sessions");
    expect(unavailable("init", { conversation: true, code: true })).toBeUndefined();
    expect(unavailable("init", { conversation: true, code: false })).toContain("coding session");
  });
});

describe("the arguments", () => {
  it("takes a permission mode by name, in any case", () => {
    expect(permissionArg("Plan")).toBe("plan");
    expect(permissionArg(" bypass ")).toBe("bypass");
    expect(permissionArg("yolo")).toBeUndefined();
    expect(permissionArg("")).toBeUndefined();
  });

  it("takes a model by its exact name or the only one that contains the words", () => {
    const ids = ["auto", "qwen3-coder", "qwen3-8b", "claude-sonnet"];
    expect(resolveModel("QWEN3-8B", ids)).toEqual({ id: "qwen3-8b" });
    expect(resolveModel("sonnet", ids)).toEqual({ id: "claude-sonnet" });
    expect(resolveModel("coder", ids)).toEqual({ id: "qwen3-coder" });
  });

  it("says when no model fits, or several do", () => {
    const ids = ["auto", "qwen3-coder", "qwen3-8b"];
    expect(resolveModel("llama", ids)).toEqual({ error: "No model matches \"llama\"." });
    expect(resolveModel("qwen", ids)).toEqual({ error: "\"qwen\" fits 2 models: qwen3-coder, qwen3-8b. Be more specific." });
  });

  it("asks the model to show the draft and ask before writing AGENTS.md", () => {
    expect(INIT_PROMPT).toContain("AGENTS.md");
    expect(INIT_PROMPT).toContain("ask me before you write");
  });
});
