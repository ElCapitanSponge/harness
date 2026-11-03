import type { ChatMessage, Tool } from "@harness/core";
import { describe, expect, it } from "vitest";
import { runClaude } from "./index.js";
import { parseToolCalls } from "./tools.js";

const tool = (name: string): Tool => {
  return { type: "function", function: { name, description: `does ${name}`, parameters: { type: "object", properties: { path: { type: "string" } } } } };
};
const tools = [tool("read_file"), tool("list_dir")];
const stream = (text: string): string => {
  return JSON.stringify({ type: "result", is_error: false, result: text });
};
const UNREADABLE = "(unreadable tool request)";
const CLOSE = "\u003c/tool_call>";
const CALL = `<tool_call>{"name":"read_file","arguments":{"path":"a.ts"}}${CLOSE}`;

describe("markup the reader cannot turn into a call", () => {
  it("cuts the invoke form and says it was unreadable", () => {
    const parsed = parseToolCalls("Let me check.\n<invoke name=\"read_file\">\n<parameter name=\"path\">a.ts</parameter>\n</invoke>", tools);
    expect(parsed).toEqual({ text: "Let me check.", calls: [], unknown: [UNREADABLE] });
  });

  it("cuts a function_calls wrapper", () => {
    expect(parseToolCalls("On it.\n<function_calls>\n<invoke name=\"x\"></invoke>\n</function_calls>", tools).text).toBe("On it.");
    expect(parseToolCalls("On it.\n<function_calls>\n</function_calls>", tools).text).toBe("On it.");
  });

  it("cuts a lone parameter tag", () => {
    expect(parseToolCalls("Reading <parameter name=\"path\">a.ts", tools)).toEqual({ text: "Reading", calls: [], unknown: [UNREADABLE] });
  });

  it("cuts a closing tag that has no opening", () => {
    expect(parseToolCalls(`done${CLOSE}`, tools)).toEqual({ text: "done", calls: [], unknown: [UNREADABLE] });
  });

  it("still makes a call of a good block that comes before the leftover", () => {
    const parsed = parseToolCalls(`First.\n${CALL}\nThen <invoke name="x">`, tools);
    expect(parsed.text).toBe("First.\n\nThen");
    expect(parsed.calls.map((c) => {
      return c.function.name;
    })).toEqual(["read_file"]);
    expect(parsed.unknown).toEqual([UNREADABLE]);
  });
});

describe("markup in code is shown as written", () => {
  it("leaves a tool block inside a fenced code block alone, and does not run it", () => {
    const reply = `The form is:\n\`\`\`\n${CALL}\n\`\`\`\nThat is all.`;
    expect(parseToolCalls(reply, tools)).toEqual({ text: reply, calls: [], unknown: [] });
  });

  it("leaves invoke and parameter tags in inline code alone", () => {
    const reply = "Some models write `<invoke name=\"x\">` with a `<parameter>` inside.";
    expect(parseToolCalls(reply, tools)).toEqual({ text: reply, calls: [], unknown: [] });
  });

  it("reads a real block that comes after a mention in inline code", () => {
    const parsed = parseToolCalls(`I use \`<tool_call>\` blocks.\n${CALL}`, tools);
    expect(parsed.text).toBe("I use `<tool_call>` blocks.");
    expect(parsed.calls).toHaveLength(1);
    expect(parsed.unknown).toEqual([]);
  });
});

describe("a Claude reply with leftover markup", () => {
  it("never reaches the chat as raw tags", async () => {
    const messages: ChatMessage[] = [{ role: "user", content: "hi" }];
    const result = await runClaude("claude", { model: "claude", messages, tools }, () => {
      return Promise.resolve(stream("Checking.\n<invoke name=\"read_file\"><parameter name=\"path\">a.ts</parameter></invoke>"));
    });
    expect(result.text).toContain("Checking.");
    expect(result.text).toContain(UNREADABLE);
    expect(result.text).not.toMatch(/<invoke|<parameter|<function_calls|<tool_call>/);
    expect(result.toolCalls).toBeUndefined();
  });
});
