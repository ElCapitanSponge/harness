import type { ChatMessage, Tool } from "@harness/core";
import { describe, expect, it, vi } from "vitest";
import { runClaude, toOpenAIResponse, toPrompt, toSse } from "./index.js";
import { parseToolCalls, renderToolCall, toolInstructions } from "./tools.js";

const tool = (name: string): Tool => {
  return { type: "function", function: { name, description: `does ${name}`, parameters: { type: "object", properties: { path: { type: "string" } } } } };
};
const tools = [tool("read_file"), tool("list_dir")];
const stream = (text: string): string => {
  return JSON.stringify({ type: "result", is_error: false, result: text });
};

describe("telling Claude about the tools", () => {
  it("lists each tool and the exact form of a request, and says it has no others", () => {
    const text = toolInstructions(tools);
    expect(text).toContain("\"name\":\"read_file\"");
    expect(text).toContain("\"name\":\"list_dir\"");
    expect(text).toContain("<tool_call>");
    expect(text).toContain("no tools of your own");
  });
});

describe("reading Claude's reply for tool requests", () => {
  it("turns each block into a tool call and keeps what was written around them", () => {
    const parsed = parseToolCalls("Let me look.\n<tool_call>{\"name\":\"read_file\",\"arguments\":{\"path\":\"a.ts\"}}</tool_call>\n<tool_call>{\"name\":\"list_dir\",\"arguments\":{}}</tool_call>", tools);
    expect(parsed.text).toBe("Let me look.");
    expect(parsed.calls.map((c) => {
      return [c.function.name, c.function.arguments, c.type];
    })).toEqual([["read_file", "{\"path\":\"a.ts\"}", "function"], ["list_dir", "{}", "function"]]);
    expect(new Set(parsed.calls.map((c) => {
      return c.id;
    })).size).toBe(2);
    expect(parsed.unknown).toEqual([]);
  });

  it("is plain text when there is no block", () => {
    expect(parseToolCalls("All done: the name is harness.", tools)).toEqual({ text: "All done: the name is harness.", calls: [], unknown: [] });
  });

  it("does not make a call of a tool that does not exist, or of unreadable JSON, and says so", () => {
    const parsed = parseToolCalls("<tool_call>{\"name\":\"format_disk\",\"arguments\":{}}</tool_call><tool_call>{not json}</tool_call>ok", tools);
    expect(parsed.calls).toEqual([]);
    expect(parsed.unknown).toEqual(["format_disk", "(unreadable tool request)"]);
    expect(parsed.text).toBe("ok");
  });

  it("cuts a block that was never closed and says it was unreadable, rather than showing the raw tag", () => {
    expect(parseToolCalls("start <tool_call>{\"name\":", tools)).toEqual({ text: "start", calls: [], unknown: ["(unreadable tool request)"] });
  });

  it("treats arguments that are not an object as none", () => {
    expect(parseToolCalls("<tool_call>{\"name\":\"list_dir\",\"arguments\":\"x\"}</tool_call>", tools).calls[0]?.function.arguments).toBe("{}");
  });
});

describe("showing Claude a conversation that used tools", () => {
  it("renders each earlier request, and its result under the name of the tool, in the same form it is asked for", () => {
    const call = { id: "c1", type: "function" as const, function: { name: "read_file", arguments: "{\"path\":\"a.ts\"}" } };
    const messages: ChatMessage[] = [
      { role: "system", content: "You work in C:/proj." },
      { role: "user", content: "read a.ts" },
      { role: "assistant", content: "Reading.", tool_calls: [call] },
      { role: "tool", tool_call_id: "c1", content: "file text" },
    ];
    const { system, prompt } = toPrompt({ model: "claude", messages, tools });
    expect(system).toContain("You work in C:/proj.");
    expect(system).toContain("<tool_call>");
    expect(prompt).toBe(`User: read a.ts\n\nAssistant: Reading.\n${renderToolCall(call)}\n\n<tool_result name="read_file">\nfile text\n</tool_result>`);
  });

  it("sends a single plain message as it is, tools or not", () => {
    expect(toPrompt({ model: "claude", messages: [{ role: "user", content: "hi" }], tools }).prompt).toBe("hi");
  });
});

describe("a Claude request with tools", () => {
  it("returns the tool calls and the words before them", async () => {
    const exec = vi.fn(() => {
      return Promise.resolve(stream("On it.\n<tool_call>{\"name\":\"read_file\",\"arguments\":{\"path\":\"package.json\"}}</tool_call>"));
    });
    const result = await runClaude("claude", { model: "claude", messages: [{ role: "user", content: "name?" }], tools }, exec);
    expect(result.text).toBe("On it.");
    expect(result.toolCalls?.[0]?.function).toEqual({ name: "read_file", arguments: "{\"path\":\"package.json\"}" });
  });

  it("returns no tool calls for a plain answer, and notes a request for a tool that is not there", async () => {
    const plain = await runClaude("claude", { model: "claude", messages: [{ role: "user", content: "hi" }], tools }, () => {
      return Promise.resolve(stream("hello"));
    });
    expect(plain).toEqual({ text: "hello", model: "claude" });

    const odd = await runClaude("claude", { model: "claude", messages: [{ role: "user", content: "hi" }], tools }, () => {
      return Promise.resolve(stream("<tool_call>{\"name\":\"nope\",\"arguments\":{}}</tool_call>"));
    });
    expect(odd.toolCalls).toBeUndefined();
    expect(odd.text).toContain("not available: nope");
  });

  it("is left alone when no tools were offered, even if the text looks like a request", async () => {
    const result = await runClaude("claude", { model: "claude", messages: [{ role: "user", content: "hi" }] }, () => {
      return Promise.resolve(stream("<tool_call>{\"name\":\"read_file\"}</tool_call>"));
    });
    expect(result.text).toContain("<tool_call>");
    expect(result.toolCalls).toBeUndefined();
  });
});

describe("answering other clients with tool calls", () => {
  const result = { text: "", model: "claude", toolCalls: [{ id: "call_1", type: "function" as const, function: { name: "read_file", arguments: "{}" } }] };

  it("puts the calls in a standard response and says the model stopped to use a tool", () => {
    const body = toOpenAIResponse(result);
    expect(body.choices[0]?.finish_reason).toBe("tool_calls");
    expect(body.choices[0]?.message).toMatchObject({ tool_calls: [{ id: "call_1", function: { name: "read_file" } }] });
    expect(toOpenAIResponse({ text: "hi", model: "claude" }).choices[0]?.finish_reason).toBe("stop");
  });

  it("streams them whole in the first chunk, then a tool_calls stop", () => {
    const events = toSse(result).split("\n\n").filter(Boolean);
    expect(JSON.parse(events[0]?.replace("data: ", "") ?? "{}")).toMatchObject({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1" }] } }] });
    expect(JSON.parse(events[1]?.replace("data: ", "") ?? "{}")).toMatchObject({ choices: [{ finish_reason: "tool_calls" }] });
  });
});
