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

  it("parses code with a prompt, a model and the auto-approve flag", () => {
    expect(parseCommand(["code", "fix", "the", "bug"])).toEqual({ name: "code", model: "auto", prompt: "fix the bug", yes: false });
    expect(parseCommand(["code", "-m", "claude:sonnet", "-y"])).toEqual({ name: "code", model: "claude:sonnet", prompt: "", yes: true });
  });

  it("parses load with and without a context length", () => {
    expect(parseCommand(["load", "qwen3.5-9b"])).toEqual({ name: "load", model: "qwen3.5-9b", contextLength: undefined });
    expect(parseCommand(["load", "qwen3.5-9b", "-c", "32768"])).toEqual({ name: "load", model: "qwen3.5-9b", contextLength: 32768 });
  });

  it("rejects load without a model or with a bad context", () => {
    expect(() => {
      return parseCommand(["load"]);
    }).toThrow("needs a model");
    expect(() => {
      return parseCommand(["load", "m", "-c", "abc"]);
    }).toThrow("invalid context");
    expect(() => {
      return parseCommand(["load", "m", "--context=-5"]);
    }).toThrow("invalid context");
    expect(() => {
      return parseCommand(["load", "m", "--context=1.5"]);
    }).toThrow("invalid context");
  });

  it("parses code with a device and root to work on a connected device's files", () => {
    expect(parseCommand(["code", "-d", "anakin", "-r", "proj", "-m", "qwen", "fix it"])).toEqual({
      name: "code",
      model: "qwen",
      prompt: "fix it",
      yes: false,
      device: "anakin",
      root: "proj",
    });
  });

  it("parses tool with a device, root, tool and optional JSON args", () => {
    expect(parseCommand(["tool", "pc", "proj", "list_dir"])).toEqual({ name: "tool", device: "pc", root: "proj", tool: "list_dir", args: {} });
    expect(parseCommand(["tool", "pc", "proj", "read_file", "{\"path\":\"a.txt\"}"])).toMatchObject({ args: { path: "a.txt" } });
  });

  it("rejects tool with missing parts, invalid JSON, or non-object args", () => {
    expect(() => {
      return parseCommand(["tool", "pc", "proj"]);
    }).toThrow("tool needs");
    expect(() => {
      return parseCommand(["tool", "pc", "proj", "x", "{bad"]);
    }).toThrow("valid JSON");
    expect(() => {
      return parseCommand(["tool", "pc", "proj", "x", "[1]"]);
    }).toThrow("JSON object");
  });

  it("parses load and unload with a device, to control a connected device's LM Studio", () => {
    expect(parseCommand(["load", "qwen", "-c", "8192", "-d", "anakin"])).toEqual({ name: "load", model: "qwen", contextLength: 8192, device: "anakin" });
    expect(parseCommand(["unload", "-d", "anakin"])).toEqual({ name: "unload", model: undefined, device: "anakin" });
    expect(parseCommand(["load", "qwen"])).toMatchObject({ device: undefined });
  });

  it("parses unload with and without a model", () => {
    expect(parseCommand(["unload"])).toEqual({ name: "unload", model: undefined });
    expect(parseCommand(["unload", "qwen3.5-9b"])).toEqual({ name: "unload", model: "qwen3.5-9b" });
  });

  it("rejects unknown commands", () => {
    expect(() => {
      return parseCommand(["frobnicate"]);
    }).toThrow("unknown command");
  });
});

describe("parseCommand for conversations and device settings", () => {
  it("parses sessions", () => {
    expect(parseCommand(["sessions"])).toEqual({ name: "sessions" });
  });

  it("shows a device's settings, or changes one with a JSON value", () => {
    expect(parseCommand(["settings", "anakin"])).toEqual({ name: "settings", device: "anakin" });
    expect(parseCommand(["settings", "anakin", "claude", "true"])).toEqual({ name: "settings", device: "anakin", key: "claude", value: true });
    expect(parseCommand(["settings", "anakin", "allowedTools", "[\"grep\"]"])).toEqual({ name: "settings", device: "anakin", key: "allowedTools", value: ["grep"] });
  });

  it("refuses settings without a device, a value, or valid JSON", () => {
    expect(() => {
      return parseCommand(["settings"]);
    }).toThrow("needs a <device>");
    expect(() => {
      return parseCommand(["settings", "anakin", "claude"]);
    }).toThrow("needs a JSON value");
    expect(() => {
      return parseCommand(["settings", "anakin", "claude", "yes"]);
    }).toThrow("valid JSON");
  });
});

describe("export and import", () => {
  it("parses export, and import with a number, all, or neither", () => {
    expect(parseCommand(["export", "abc"])).toEqual({ name: "export", id: "abc" });
    expect(parseCommand(["import", "c.json"])).toEqual({ name: "import", file: "c.json", all: false, pick: undefined, model: undefined });
    expect(parseCommand(["import", "c.json", "-n", "2", "-m", "qwen"])).toMatchObject({ pick: 2, model: "qwen" });
    expect(parseCommand(["import", "c.json", "--all"])).toMatchObject({ all: true });
  });

  it("asks for what is missing", () => {
    expect(() => {
      return parseCommand(["export"]);
    }).toThrow("conversation id");
    expect(() => {
      return parseCommand(["import"]);
    }).toThrow("needs a file");
    expect(() => {
      return parseCommand(["import", "c.json", "-n", "0"]);
    }).toThrow("invalid number");
  });
});
