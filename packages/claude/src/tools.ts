import { randomUUID } from "node:crypto";
import type { Tool, ToolCall } from "@harness/core";

// The claude program takes a prompt and answers in text; it cannot be handed our tool definitions. So tools are done in the prompt:
// Claude is told which tools there are and the exact form of a request for one, the history is shown with each earlier request and
// its result in that same form, and the reply is read for requests, which become ordinary tool calls for the coding loop.

const OPEN = "<tool_call>";
const CLOSE = "</tool_call>";

// What Claude is told about the tools. It must not believe it has other tools, or the ones it was started with.
export const toolInstructions = (tools: Tool[]): string => {
  const described = tools.map((t) => {
    return JSON.stringify({ name: t.function.name, description: t.function.description ?? "", parameters: t.function.parameters ?? {} });
  }).join("\n");
  return [
    "You are working for the user through a coding assistant that runs tools on their machine. You have no tools of your own here and cannot run anything yourself.",
    "These are the only tools, one JSON description per line:",
    described,
    `To use a tool, reply with a block of exactly this form, with the arguments as JSON: ${OPEN}{"name": "<tool name>", "arguments": { ... }}${CLOSE}`,
    "You may write a sentence before the blocks. You may ask for several tools in one reply, each in its own block. Then stop: the results come back, each as a <tool_result> block, and you carry on from them.",
    "Never say you have done something you have not asked a tool to do. When you have finished, reply in plain text with no tool block.",
  ].join("\n");
};

// A tool call as it is shown to Claude in the history, in the same form it is asked for.
const argumentsOf = (call: ToolCall): unknown => {
  try {
    return JSON.parse(call.function.arguments || "{}");
  } catch {
    return call.function.arguments;
  }
};

export const renderToolCall = (call: ToolCall): string => {
  const args = argumentsOf(call);
  return `${OPEN}${JSON.stringify({ name: call.function.name, arguments: args })}${CLOSE}`;
};

export const renderToolResult = (name: string, content: string): string => {
  return `<tool_result name="${name}">\n${content}\n</tool_result>`;
};

export interface ParsedReply {
  // What Claude wrote, without the tool blocks.
  text: string;
  calls: ToolCall[];
  // Names Claude asked for that are not among the tools, so the person can be told rather than the request silently dropped.
  unknown: string[];
}

// Reads Claude's reply for tool requests. A block that is not valid JSON, or names no tool, is not a call.
export const parseToolCalls = (reply: string, tools: Tool[]): ParsedReply => {
  const known = new Set(tools.map((t) => {
    return t.function.name;
  }));
  const calls: ToolCall[] = [];
  const unknown: string[] = [];
  let text = "";
  let rest = reply;
  for (;;) {
    const open = rest.indexOf(OPEN);
    const close = open === -1 ? -1 : rest.indexOf(CLOSE, open + OPEN.length);
    if (open === -1 || close === -1) {
      text += rest;
      break;
    }
    text += rest.slice(0, open);
    const body = rest.slice(open + OPEN.length, close).trim();
    rest = rest.slice(close + CLOSE.length);
    try {
      const parsed = JSON.parse(body) as { name?: unknown; arguments?: unknown };
      if (typeof parsed.name !== "string") {
        throw new Error("no name");
      }
      if (!known.has(parsed.name)) {
        unknown.push(parsed.name);
        continue;
      }
      const args = typeof parsed.arguments === "object" && parsed.arguments !== null ? parsed.arguments : {};
      calls.push({ id: `call_${randomUUID().slice(0, 8)}`, type: "function", function: { name: parsed.name, arguments: JSON.stringify(args) } });
    } catch {
      // Not a call. Left out, rather than shown as half-written markup.
      unknown.push("(unreadable tool request)");
    }
  }
  return { text: text.trim(), calls, unknown };
};
