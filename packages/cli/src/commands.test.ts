import { describe, expect, it } from "vitest";
import { parseCommand } from "./commands.js";

describe("parseCommand", () => {
  it("shows help with no arguments, 'help' or -h", () => {
    expect(parseCommand([])).toEqual({ name: "help" });
    expect(parseCommand(["help"])).toEqual({ name: "help" });
    expect(parseCommand(["nodes", "-h"])).toEqual({ name: "help" });
  });

  it("parses nodes and models", () => {
    expect(parseCommand(["nodes"])).toEqual({ name: "nodes" });
    expect(parseCommand(["models"])).toEqual({ name: "models" });
  });

  it("defaults chat to the auto model and joins the prompt words", () => {
    expect(parseCommand(["chat", "write", "a", "haiku"])).toEqual({ name: "chat", model: "auto", prompt: "write a haiku" });
  });

  it("takes the chat model from -m and allows an empty prompt", () => {
    expect(parseCommand(["chat", "-m", "claude:sonnet"])).toEqual({ name: "chat", model: "claude:sonnet", prompt: "" });
  });

  it("parses load with and without a context length", () => {
    expect(parseCommand(["load", "qwen3.5-9b"])).toEqual({ name: "load", model: "qwen3.5-9b", contextLength: undefined });
    expect(parseCommand(["load", "qwen3.5-9b", "-c", "32768"])).toEqual({ name: "load", model: "qwen3.5-9b", contextLength: 32768 });
  });

  it("rejects load without a model or with a bad context", () => {
    expect(() => parseCommand(["load"])).toThrow("needs a model");
    expect(() => parseCommand(["load", "m", "-c", "abc"])).toThrow("invalid context");
    expect(() => parseCommand(["load", "m", "--context=-5"])).toThrow("invalid context");
    expect(() => parseCommand(["load", "m", "--context=1.5"])).toThrow("invalid context");
  });

  it("parses unload with and without a model", () => {
    expect(parseCommand(["unload"])).toEqual({ name: "unload", model: undefined });
    expect(parseCommand(["unload", "qwen3.5-9b"])).toEqual({ name: "unload", model: "qwen3.5-9b" });
  });

  it("rejects unknown commands", () => {
    expect(() => parseCommand(["frobnicate"])).toThrow("unknown command");
  });
});
