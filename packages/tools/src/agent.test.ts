import type { ChatMessage, ToolCall } from "@harness/core";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTurn, systemPrompt, type AgentDeps } from "./agent.js";

let dir: string;
beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "harness-agent-")));
});
afterEach(() => {
  return fs.rm(dir, { recursive: true, force: true });
});

const call = (id: string, name: string, args: unknown): ToolCall => {
  return {
    id,
    type: "function",
    function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
  };
};

// A scripted "model": returns the queued replies in order.
const script = (...replies: ChatMessage[]) => {
  const queue = [...replies];
  return vi.fn(async (): Promise<ChatMessage> => {
    return queue.shift() ?? { role: "assistant", content: "done" };
  });
};

const deps = (over: Partial<AgentDeps> & Pick<AgentDeps, "complete">): AgentDeps => {
  return { approve: vi.fn(async () => {
    return true;
  }), ctx: { cwd: dir }, onText: vi.fn(), onTool: vi.fn(), ...over };
};

const history = (): ChatMessage[] => {
  return [{ role: "system", content: "sys" }, { role: "user", content: "go" }];
};

describe("runTurn", () => {
  it("runs a tool call, feeds the result back, then returns the final answer", async () => {
    await fs.writeFile(path.join(dir, "a.txt"), "hello");
    const complete = script(
      { role: "assistant", content: null, tool_calls: [call("1", "read_file", { path: "a.txt" })] },
      { role: "assistant", content: "It says hello." },
    );
    const d = deps({ complete });
    const h = history();

    expect(await runTurn(h, d)).toEqual({ stopped: false });
    expect(d.onText).toHaveBeenCalledWith("It says hello.");
    expect(d.onTool).toHaveBeenCalledWith("read a.txt", "read_file");
    expect(h.map((m) => {
      return m.role;
    })).toEqual(["system", "user", "assistant", "tool", "assistant"]);
    expect(h[3]).toMatchObject({ role: "tool", tool_call_id: "1", content: "1\thello" });
    expect(h[2]?.tool_calls).toHaveLength(1);
  });

  it("does not ask approval for read-only tools", async () => {
    const approve = vi.fn(async () => {
      return true;
    });
    const complete = script({ role: "assistant", content: "", tool_calls: [call("1", "list_dir", {})] });
    await runTurn(history(), deps({ complete, approve }));
    expect(approve).not.toHaveBeenCalled();
  });

  it("asks approval for changes and applies them when approved", async () => {
    const approve = vi.fn(async () => {
      return true;
    });
    const complete = script({ role: "assistant", content: "", tool_calls: [call("1", "write_file", { path: "n.txt", content: "x" })] });
    await runTurn(history(), deps({ complete, approve }));
    expect(approve).toHaveBeenCalledWith("write_file", "write n.txt (1 characters)", { path: "n.txt", content: "x" });
    expect(await fs.readFile(path.join(dir, "n.txt"), "utf8")).toBe("x");
  });

  it("does not run a declined action, tells the model, and ends the turn", async () => {
    const complete = script({ role: "assistant", content: "", tool_calls: [call("1", "write_file", { path: "n.txt", content: "x" })] });
    const h = history();
    const result = await runTurn(h, deps({ complete, approve: async () => {
      return false;
    } }));
    expect(result).toEqual({ stopped: false, declined: true });
    expect(complete).toHaveBeenCalledTimes(1);
    await expect(fs.stat(path.join(dir, "n.txt"))).rejects.toThrow();
    expect(h.find((m) => {
      return m.role === "tool";
    })?.content).toContain("declined");
  });

  it("answers every tool call after a decline, skipping the rest", async () => {
    const complete = script({
      role: "assistant",
      content: "",
      tool_calls: [call("1", "write_file", { path: "a.txt", content: "x" }), call("2", "write_file", { path: "b.txt", content: "y" }), call("3", "list_dir", {})],
    });
    const h = history();
    await runTurn(h, deps({ complete, approve: async () => {
      return false;
    } }));
    const tool = h.filter((m) => {
      return m.role === "tool";
    });
    expect(tool.map((m) => {
      return m.tool_call_id;
    })).toEqual(["1", "2", "3"]);
    expect(tool[1]?.content).toContain("Skipped");
    expect(tool[2]?.content).toContain("Skipped");
    await expect(fs.stat(path.join(dir, "b.txt"))).rejects.toThrow();
  });

  it("returns errors to the model instead of throwing", async () => {
    const complete = script({
      role: "assistant",
      content: "",
      tool_calls: [
        call("1", "nope", {}),
        call("2", "read_file", "{not json"),
        call("3", "read_file", { path: "../escape" }),
        call("4", "read_file", { path: "missing.txt" }),
      ],
    });
    const h = history();
    await runTurn(h, deps({ complete }));
    const results = h.filter((m) => {
      return m.role === "tool";
    }).map((m) => {
      return m.content as string;
    });
    expect(results[0]).toContain("unknown tool \"nope\"");
    expect(results[1]).toContain("valid JSON");
    expect(results[2]).toContain("outside the working directory");
    expect(results[3]).toMatch(/^error:/);
  });

  it("stops at the step limit if the model keeps calling tools", async () => {
    const complete = vi.fn(async (): Promise<ChatMessage> => {
      return { role: "assistant", content: "", tool_calls: [call("x", "list_dir", {})] };
    });
    const result = await runTurn(history(), deps({ complete, maxSteps: 3 }));
    expect(result).toEqual({ stopped: true });
    expect(complete).toHaveBeenCalledTimes(3);
  });

  it("sends the tool definitions to the model", async () => {
    const complete = script({ role: "assistant", content: "hi" });
    await runTurn(history(), deps({ complete }));
    const sentTools = (complete.mock.calls[0] as unknown as [ChatMessage[], { function: { name: string } }[]])[1];
    expect(sentTools.map((t) => {
      return t.function.name;
    })).toEqual(["read_file", "list_dir", "grep", "write_file", "edit_file", "run_command", "web_fetch", "gh_read", "gh_write", "git_read", "git_write", "jq", "fzf_filter", "skill", "task_output", "task_stop"]);
  });
});

describe("systemPrompt", () => {
  it("names the working directory", () => {
    expect(systemPrompt("/work/x", "linux")).toContain("/work/x");
  });
});
