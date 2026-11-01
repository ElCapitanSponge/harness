import { describe, expect, it } from "vitest";
import { limitTurns, parseImportFile, parseTranscript, toMarkdown } from "./transcripts.js";

const roles = (text: string): string[] => {
  return parseTranscript(text).conversations[0]?.turns.map((t) => {
    return t.role[0] ?? "";
  }) ?? [];
};

describe("pasted transcripts", () => {
  it("splits headings, keeping markdown and code fences intact", () => {
    const text = "## User\n\nHow do I reverse a list?\n\n## Assistant\n\nUse this:\n\n```py\nxs[::-1]\n## User\n```\n\nDone.\n\n## User\n\nThanks";
    const parsed = parseTranscript(text);
    expect(parsed.format).toBe("headings");
    expect(parsed.conversations[0]?.turns).toEqual([
      { role: "user", text: "How do I reverse a list?" },
      { role: "assistant", text: "Use this:\n\n```py\nxs[::-1]\n## User\n```\n\nDone." },
      { role: "user", text: "Thanks" },
    ]);
    expect(parsed.conversations[0]?.title).toBe("How do I reverse a list?");
  });

  it("splits ChatGPT and Claude.ai copied chats", () => {
    expect(parseTranscript("You said:\nHello\n\nChatGPT said:\nHi there\n\nYou said:\nBye").format).toBe("said");
    expect(roles("You said:\nHello\n\nClaude said:\nHi there\n\nYou said:\nBye")).toEqual(["u", "a", "u"]);
  });

  it("splits User: and Assistant: labels, with the text on the same line", () => {
    const parsed = parseTranscript("User: what is 2+2?\nAssistant: 4\nand then some\nHuman: thanks\nAI: you are welcome");
    expect(parsed.format).toBe("labels");
    expect(parsed.conversations[0]?.turns[1]).toEqual({ role: "assistant", text: "4\nand then some" });
    expect(roles("User: a\nAssistant: b\nHuman: c\nAI: d")).toEqual(["u", "a", "u", "a"]);
  });

  it("splits a Claude Code /export, merging the parts of one reply and un-indenting them", () => {
    const text = "╭─────╮\n│ Claude Code │\n╰─────╯\n\n> fix the bug\n\n⏺ I will look.\n\n⏺ Read(src/a.ts)\n  ⎿  Read 10 lines\n\n⏺ Fixed it.\n\n> thanks";
    const parsed = parseTranscript(text);
    expect(parsed.format).toBe("claude-code-export");
    expect(roles(text)).toEqual(["u", "a", "u"]);
    expect(parsed.conversations[0]?.turns[1]?.text).toContain("Read(src/a.ts)\n⎿  Read 10 lines");
  });

  it("offers the whole text as one message when it cannot be split, and never fails", () => {
    const parsed = parseTranscript("just some notes\nwith no speakers");
    expect(parsed).toMatchObject({ split: false, format: "unsplit" });
    expect(parsed.conversations[0]?.turns).toEqual([{ role: "user", text: "just some notes\nwith no speakers" }]);
    expect(parseTranscript("   ").conversations[0]?.turns).toEqual([]);
    // One message that starts with a label is not evidence of a layout.
    expect(parseTranscript("User: remind me what to do").split).toBe(false);
  });

  it("copes with a very large transcript", () => {
    const text = Array.from({ length: 3000 }, (_, i) => {
      return `## User\n\nquestion ${String(i)}\n\n## Assistant\n\nanswer ${String(i)}`;
    }).join("\n\n");
    const turns = parseTranscript(text).conversations[0]?.turns ?? [];
    expect(turns).toHaveLength(6000);
    expect(() => {
      return limitTurns(turns);
    }).toThrow("limit");
  });
});

describe("export files", () => {
  it("reads a Claude Code transcript, keeping tool calls and results inside the reply", () => {
    const lines = [
      { type: "summary", summary: "x" },
      { type: "user", timestamp: "2026-01-02T03:04:05Z", message: { role: "user", content: "fix the bug" } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Looking." }, { type: "tool_use", name: "Read", input: { path: "a.ts" } }] } },
      { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "file text" }] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Fixed." }] } },
      { type: "user", isMeta: true, message: { role: "user", content: "meta" } },
      { type: "user", message: { role: "user", content: [{ type: "text", text: "thanks" }] } },
    ].map((l) => {
      return JSON.stringify(l);
    });
    lines.splice(3, 0, "not json at all");
    const parsed = parseImportFile("session.jsonl", lines.join("\n"));
    const c = parsed.conversations[0];
    expect(parsed.format).toBe("claude-code");
    expect(c?.source).toBe("Claude Code");
    expect(c?.created).toBe(Date.parse("2026-01-02T03:04:05Z"));
    expect(c?.turns.map((t) => {
      return t.role;
    })).toEqual(["user", "assistant", "user"]);
    expect(c?.turns[1]?.text).toContain("[tool: Read");
    expect(c?.turns[1]?.text).toContain("file text");
    expect(c?.turns[1]?.text).toContain("Fixed.");
    expect(() => {
      return parseImportFile("empty.jsonl", "{\"type\":\"summary\"}");
    }).toThrow("no messages");
  });

  it("reads a ChatGPT export along the visible branch, skipping hidden and system messages", () => {
    const node = (id: string, parent: string | null, role: string, text: string, hidden = false) => {
      return [id, { id, parent, message: { author: { role }, content: { content_type: "text", parts: [text] }, metadata: hidden ? { is_visually_hidden_from_conversation: true } : {} } }] as const;
    };
    const conversation = {
      title: "Sorting",
      create_time: 1_700_000_000,
      current_node: "d",
      mapping: Object.fromEntries([
        node("a", null, "system", "You are ChatGPT", true),
        node("b", "a", "user", "How do I sort?"),
        node("x", "b", "assistant", "An abandoned branch"),
        node("c", "b", "assistant", "Use `sorted()`."),
        node("d", "c", "user", "And descending?"),
      ]),
    };
    const parsed = parseImportFile("conversations.json", JSON.stringify([conversation, { title: "Empty", mapping: {} }]));
    expect(parsed.format).toBe("chatgpt");
    expect(parsed.conversations).toHaveLength(1);
    expect(parsed.conversations[0]).toMatchObject({ title: "Sorting", source: "ChatGPT", created: 1_700_000_000_000 });
    expect(parsed.conversations[0]?.turns.map((t) => {
      return t.text;
    })).toEqual(["How do I sort?", "Use `sorted()`.", "And descending?"]);
  });

  it("reads a Claude.ai export", () => {
    const data = [{ name: "Haiku", created_at: "2026-02-03T00:00:00Z", chat_messages: [{ sender: "human", text: "Write a haiku" }, { sender: "assistant", text: "", content: [{ type: "text", text: "Old pond" }] }] }];
    const parsed = parseImportFile("claude.json", JSON.stringify(data));
    expect(parsed.format).toBe("claude-ai");
    expect(parsed.conversations[0]?.turns).toEqual([{ role: "user", text: "Write a haiku" }, { role: "assistant", text: "Old pond" }]);
  });

  it("reads a markdown file as a pasted transcript, and refuses JSON that is neither export, or broken", () => {
    expect(parseImportFile("chat.md", "## User\n\nhi\n\n## Assistant\n\nhello").format).toBe("headings");
    expect(() => {
      return parseImportFile("x.json", "{\"a\":1}");
    }).toThrow("not a ChatGPT or Claude.ai export");
    expect(() => {
      return parseImportFile("x.json", "[{");
    }).toThrow("could not be read");
  });
});

describe("exporting", () => {
  it("writes markdown that the pasted-transcript reader takes back", () => {
    const md = toMarkdown("Sorting", [{ type: "imported", source: "ChatGPT", turns: 2 }, { type: "user", text: "How?" }, { type: "tool", summary: "read a.txt" }, { type: "text", text: "Like this:\n\n```\n## User\n```", model: "qwen" }]);
    expect(md.startsWith("# Sorting\n")).toBe(true);
    expect(md).toContain("<!-- qwen -->");
    const back = parseTranscript(md).conversations[0]?.turns;
    expect(back?.map((t) => {
      return t.role;
    })).toEqual(["user", "assistant"]);
    expect(back?.[1]?.text).toContain("```\n## User\n```");
  });
});
