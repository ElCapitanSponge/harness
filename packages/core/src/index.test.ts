import { describe, expect, it } from "vitest";
import { ChatRequest, Heartbeat, authHeaders, textOf } from "./index.js";

describe("tool calling schema", () => {
  const toolCalls = [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } }];

  it("accepts tools, tool calls, tool results and null content, and keeps them", () => {
    const parsed = ChatRequest.parse({
      model: "auto",
      stream: true,
      tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }],
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: null, tool_calls: toolCalls },
        { role: "tool", tool_call_id: "c1", content: "text" },
      ],
    });
    expect(parsed.tools?.[0]?.function.name).toBe("read_file");
    expect(parsed.messages[1]?.tool_calls).toEqual(toolCalls);
    expect(parsed.messages[2]?.tool_call_id).toBe("c1");
  });

  it("passes unknown request fields through", () => {
    const parsed = ChatRequest.parse({ model: "m", messages: [{ role: "user", content: "x" }], top_p: 0.5, seed: 7 });
    expect(parsed).toMatchObject({ top_p: 0.5, seed: 7 });
  });

  it("accepts content given as text parts", () => {
    expect(ChatRequest.safeParse({ model: "m", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }).success).toBe(true);
  });
});

describe("textOf", () => {
  it("handles strings, parts, null and undefined", () => {
    expect(textOf("hi")).toBe("hi");
    expect(textOf([{ type: "text", text: "a" }, { type: "image_url" }, { type: "text", text: "b" }])).toBe("ab");
    expect(textOf(null)).toBe("");
    expect(textOf(undefined)).toBe("");
  });
});

describe("authHeaders", () => {
  it("builds a bearer header when a key is set", () => {
    expect(authHeaders("k")).toEqual({ authorization: "Bearer k" });
  });

  it("returns no headers without a key", () => {
    expect(authHeaders()).toEqual({});
    expect(authHeaders("")).toEqual({});
  });
});

describe("ChatRequest", () => {
  it("accepts a minimal request", () => {
    expect(ChatRequest.safeParse({ model: "auto", messages: [{ role: "user", content: "hi" }] }).success).toBe(true);
  });

  it("rejects an empty messages array", () => {
    expect(ChatRequest.safeParse({ model: "auto", messages: [] }).success).toBe(false);
  });

  it("rejects an unknown role", () => {
    expect(ChatRequest.safeParse({ model: "auto", messages: [{ role: "robot", content: "hi" }] }).success).toBe(false);
  });
});

describe("Heartbeat", () => {
  const valid = { nodeId: "pc", kind: "local", busy: false, models: [{ id: "qwen", loaded: true }] };

  it("accepts a valid heartbeat", () => {
    expect(Heartbeat.safeParse(valid).success).toBe(true);
  });

  it("rejects an unknown node kind", () => {
    expect(Heartbeat.safeParse({ ...valid, kind: "cloud" }).success).toBe(false);
  });
});
