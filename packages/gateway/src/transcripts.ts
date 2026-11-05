import type { SessionEvent } from "@harness/core";

// Bringing a conversation in from another tool, and writing one out. Pure functions of text, so each format can be tested. The
// formats and what is kept are in docs/guides/importing.md.

export interface Turn {
  role: "user" | "assistant";
  text: string;
  // When it was sent, in milliseconds since the epoch, when the export says.
  at?: number;
}

export interface ImportedConversation {
  title: string;
  // Where it came from, shown on the conversation: "Claude Code", "ChatGPT", "Claude.ai" or "pasted transcript".
  source: string;
  turns: Turn[];
  // When it was started, in milliseconds since the epoch, when the export says.
  created?: number;
}

export interface ParsedImport {
  conversations: ImportedConversation[];
  // What was recognised: "headings", "said", "labels", "claude-code-export", "claude-code", "chatgpt", "claude-ai", or "unsplit".
  format: string;
  // False when the text could not be split into turns and is one message the person can divide by hand.
  split: boolean;
}

const MAX_TURNS = 5000;
const MAX_TURN_CHARS = 200_000;
const TOOL_RESULT_CHARS = 2000;

const roleOf = (label: string): "user" | "assistant" | undefined => {
  const l = label.toLowerCase();
  if (["user", "human", "you", "me"].includes(l)) {
    return "user";
  }
  if (["assistant", "ai", "claude", "chatgpt", "gpt", "gemini", "model", "bot"].includes(l)) {
    return "assistant";
  }
  return undefined;
};

interface Marker {
  line: number;
  role: "user" | "assistant";
  // Text on the marker's own line after the label.
  rest: string;
}

const NAMES = "user|human|you|me|assistant|ai|claude|chatgpt|gpt|gemini|model|bot";
const HEADING = new RegExp(`^#{1,4}\\s*(${NAMES})\\s*:?\\s*$`, "i");
const SAID = new RegExp(`^\\**\\s*(${NAMES})\\s+said\\s*:?\\s*\\**\\s*$`, "i");
const LABEL = new RegExp(`^\\**(${NAMES})\\**\\s*:\\s*\\**\\s*(.*)$`, "i");

// Finds where each turn starts. A line inside a fenced code block never starts one.
const markers = (lines: string[], match: (line: string) => { role: "user" | "assistant"; rest: string } | undefined): Marker[] => {
  const found: Marker[] = [];
  let fenced = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    const m = fenced ? undefined : match(line);
    if (m) {
      found.push({ line: i, ...m });
    }
  });
  return found;
};

const turnsFrom = (lines: string[], found: Marker[], clean: (text: string) => string = (t) => {
  return t;
}): Turn[] => {
  const turns: Turn[] = [];
  found.forEach((m, i) => {
    const end = found[i + 1]?.line ?? lines.length;
    const text = clean([m.rest, ...lines.slice(m.line + 1, end)].join("\n")).trim();
    if (text !== "") {
      turns.push({ role: m.role, text: text.slice(0, MAX_TURN_CHARS) });
    }
  });
  return turns;
};

const byHeading = (line: string) => {
  const m = HEADING.exec(line.trim());
  const role = m ? roleOf(m[1] ?? "") : undefined;
  return role ? { role, rest: "" } : undefined;
};

const bySaid = (line: string) => {
  const m = SAID.exec(line.trim());
  const role = m ? roleOf(m[1] ?? "") : undefined;
  return role ? { role, rest: "" } : undefined;
};

const byLabel = (line: string) => {
  const m = LABEL.exec(line.trim());
  const role = m ? roleOf(m[1] ?? "") : undefined;
  return role && m ? { role, rest: m[2] ?? "" } : undefined;
};

// Claude Code's /export: the person's prompts follow "> " and each reply part follows a bullet, with continuation lines indented.
const byClaudeCode = (line: string) => {
  if (line.startsWith("> ")) {
    return { role: "user" as const, rest: line.slice(2) };
  }
  if (line.startsWith("⏺ ")) {
    return { role: "assistant" as const, rest: line.slice(2) };
  }
  return undefined;
};

const unindent = (text: string): string => {
  return text.split("\n").map((l) => {
    return l.startsWith("  ") ? l.slice(2) : l;
  }).join("\n");
};

// Neighbouring parts by the same speaker are one turn.
const merged = (turns: Turn[]): Turn[] => {
  const out: Turn[] = [];
  for (const t of turns) {
    const last = out.at(-1);
    if (last?.role === t.role) {
      last.text = `${last.text}\n\n${t.text}`;
    } else {
      out.push({ ...t });
    }
  }
  return out;
};

const titleOf = (turns: Turn[]): string => {
  const first = turns.find((t) => {
    return t.role === "user";
  })?.text ?? turns[0]?.text ?? "Imported conversation";
  const line = (first.split("\n").find((l) => {
    return l.trim() !== "";
  }) ?? "").replace(/[#*`>_]/g, "").trim();
  return line.length > 60 ? `${line.slice(0, 57)}...` : (line || "Imported conversation");
};

// Splits a pasted transcript into turns. It tries each known layout and takes the one that finds the most turns; a text none of them
// fits comes back as one message, for the person to divide by hand.
export const parseTranscript = (text: string): ParsedImport => {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const attempts: { format: string; turns: Turn[] }[] = [
    { format: "headings", turns: turnsFrom(lines, markers(lines, byHeading)) },
    { format: "said", turns: turnsFrom(lines, markers(lines, bySaid)) },
    { format: "labels", turns: turnsFrom(lines, markers(lines, byLabel)) },
    { format: "claude-code-export", turns: merged(turnsFrom(lines, markers(lines, byClaudeCode), unindent)) },
  ];
  const best = attempts.reduce((a, b) => {
    return b.turns.length > a.turns.length ? b : a;
  });
  // One user turn alone is no evidence of a layout: an ordinary message can start with "You:".
  if (best.turns.length >= 2 || (best.turns.length === 1 && best.turns[0]?.role === "assistant")) {
    return { format: best.format, split: true, conversations: [{ title: titleOf(best.turns), source: "pasted transcript", turns: best.turns }] };
  }
  const whole = text.trim();
  const turns: Turn[] = whole === "" ? [] : [{ role: "user", text: whole.slice(0, MAX_TURN_CHARS) }];
  return { format: "unsplit", split: false, conversations: [{ title: titleOf(turns), source: "pasted transcript", turns }] };
};

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const textBlocks = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map((block) => {
    if (typeof block === "string") {
      return block;
    }
    if (!isObject(block)) {
      return "";
    }
    if (block.type === "text" && typeof block.text === "string") {
      return block.text;
    }
    if (block.type === "tool_use") {
      const input = JSON.stringify(block.input ?? {});
      return `\`[tool: ${typeof block.name === "string" ? block.name : "tool"} ${input.length > 300 ? `${input.slice(0, 300)}...` : input}]\``;
    }
    if (block.type === "tool_result") {
      const out = textBlocks(block.content);
      return `\`\`\`\n[tool result]\n${out.length > TOOL_RESULT_CHARS ? `${out.slice(0, TOOL_RESULT_CHARS)}\n... (shortened)` : out}\n\`\`\``;
    }
    return "";
  }).filter(Boolean).join("\n\n");
};

const time = (value: unknown): number | undefined => {
  const ms = typeof value === "number" ? value * 1000 : typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? ms : undefined;
};

// The `at` of a turn, when the export gave a time for it.
const stamp = (value: unknown): { at?: number } => {
  const at = time(value);
  return at === undefined ? {} : { at };
};

// A Claude Code session file: one JSON object per line. Tool calls and their results are kept as short collapsed text inside the
// reply they belong to, not as turns of their own.
const parseClaudeCodeFile = (text: string): ParsedImport => {
  const turns: Turn[] = [];
  let created: number | undefined;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) {
      continue;
    }
    let entry: unknown;
    try {
      entry = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!isObject(entry) || (entry.type !== "user" && entry.type !== "assistant") || entry.isMeta === true || !isObject(entry.message)) {
      continue;
    }
    created ??= time(entry.timestamp);
    const content = entry.message.content;
    const body = textBlocks(content).trim();
    if (body === "") {
      continue;
    }
    // A user entry that only carries tool results belongs to the reply that asked for them.
    const onlyResults = entry.type === "user" && Array.isArray(content) && content.every((b) => {
      return isObject(b) && b.type === "tool_result";
    });
    if (onlyResults && turns.at(-1)?.role === "assistant") {
      const last = turns.at(-1);
      if (last) {
        last.text = `${last.text}\n\n${body}`;
      }
      continue;
    }
    const role = entry.type === "user" ? "user" : "assistant";
    const last = turns.at(-1);
    if (last?.role === role && role === "assistant") {
      last.text = `${last.text}\n\n${body}`;
      // The reply finished with its last part.
      Object.assign(last, stamp(entry.timestamp));
    } else {
      turns.push({ role, text: body.slice(0, MAX_TURN_CHARS), ...stamp(entry.timestamp) });
    }
  }
  return { format: "claude-code", split: true, conversations: [{ title: titleOf(turns), source: "Claude Code", turns, created }] };
};

// ChatGPT's conversations.json: each conversation is a tree of messages; the visible branch runs from the current node up to the root.
const chatgptConversation = (c: Json): ImportedConversation => {
  const mapping = isObject(c.mapping) ? c.mapping : {};
  const path: Json[] = [];
  const seen = new Set<string>();
  let id = typeof c.current_node === "string" ? c.current_node : undefined;
  while (id && !seen.has(id) && isObject(mapping[id])) {
    seen.add(id);
    const node = mapping[id] as Json;
    path.push(node);
    id = typeof node.parent === "string" ? node.parent : undefined;
  }
  const turns: Turn[] = [];
  for (const node of path.reverse()) {
    const m = node.message;
    if (!isObject(m) || !isObject(m.author) || (m.author.role !== "user" && m.author.role !== "assistant")) {
      continue;
    }
    if (isObject(m.metadata) && m.metadata.is_visually_hidden_from_conversation === true) {
      continue;
    }
    const content = isObject(m.content) ? m.content : {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const text = parts.map((p) => {
      return typeof p === "string" ? p : "";
    }).filter(Boolean).join("\n\n").trim();
    if (text !== "") {
      turns.push({ role: m.author.role, text: text.slice(0, MAX_TURN_CHARS), ...stamp(m.create_time) });
    }
  }
  const title = typeof c.title === "string" && c.title.trim() !== "" ? c.title.trim() : titleOf(turns);
  return { title, source: "ChatGPT", turns, created: time(c.create_time) };
};

// Claude.ai's export: a conversation has a name and a list of chat messages from "human" or "assistant".
const claudeAiConversation = (c: Json): ImportedConversation => {
  const turns: Turn[] = [];
  for (const m of Array.isArray(c.chat_messages) ? c.chat_messages : []) {
    if (!isObject(m)) {
      continue;
    }
    const role = m.sender === "human" ? "user" : m.sender === "assistant" ? "assistant" : undefined;
    const text = (typeof m.text === "string" && m.text.trim() !== "" ? m.text : textBlocks(m.content)).trim();
    if (role && text !== "") {
      turns.push({ role, text: text.slice(0, MAX_TURN_CHARS), ...stamp(m.created_at) });
    }
  }
  const title = typeof c.name === "string" && c.name.trim() !== "" ? c.name.trim() : titleOf(turns);
  return { title, source: "Claude.ai", turns, created: time(c.created_at) };
};

// A file the person dropped: a Claude Code transcript (.jsonl), a ChatGPT or Claude.ai export (.json), or text in one of the pasted
// layouts. Throws a plain message if it is none of them.
export const parseImportFile = (name: string, content: string): ParsedImport => {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const first = text.trimStart();
  if (name.toLowerCase().endsWith(".jsonl") || (first.startsWith("{") && /\n\s*\{/.test(first) && !name.toLowerCase().endsWith(".json"))) {
    const parsed = parseClaudeCodeFile(text);
    if ((parsed.conversations[0]?.turns.length ?? 0) === 0) {
      throw new Error("no messages found in that Claude Code transcript");
    }
    return parsed;
  }
  if (first.startsWith("[") || first.startsWith("{")) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("that file looks like JSON but could not be read");
    }
    const items = Array.isArray(data) ? data : [data];
    const chatgpt = items.filter((i): i is Json => {
      return isObject(i) && isObject(i.mapping);
    });
    if (chatgpt.length > 0) {
      return { format: "chatgpt", split: true, conversations: chatgpt.map(chatgptConversation).filter((c) => {
        return c.turns.length > 0;
      }) };
    }
    const claudeAi = items.filter((i): i is Json => {
      return isObject(i) && Array.isArray(i.chat_messages);
    });
    if (claudeAi.length > 0) {
      return { format: "claude-ai", split: true, conversations: claudeAi.map(claudeAiConversation).filter((c) => {
        return c.turns.length > 0;
      }) };
    }
    throw new Error("that JSON is not a ChatGPT or Claude.ai export");
  }
  return parseTranscript(text);
};

export const limitTurns = (turns: Turn[]): Turn[] => {
  if (turns.length > MAX_TURNS) {
    throw new Error(`that conversation has ${String(turns.length)} messages; the limit is ${String(MAX_TURNS)}`);
  }
  return turns;
};

// A conversation as markdown, for carrying to another tool: a heading for each speaker and the text as it was.
export const toMarkdown = (title: string, events: SessionEvent[]): string => {
  const parts: string[] = [`# ${title || "Conversation"}`];
  for (const e of events) {
    if (e.type === "user") {
      parts.push(`## You\n\n${e.text}`);
    } else if (e.type === "text") {
      parts.push(`## Assistant\n\n${e.model ? `<!-- ${e.model} -->\n\n` : ""}${e.text}`);
    } else if (e.type === "skill") {
      parts.push(`> Skill: ${e.name}${e.arguments ? ` ${e.arguments}` : ""}`);
    } else if (e.type === "tool") {
      parts.push(`> ${e.summary}`);
    } else if (e.type === "compacted") {
      // Only the finished compaction marks the export; its start and a failure are left out on purpose.
      parts.push("> (earlier messages were summarised here)");
    }
  }
  return `${parts.join("\n\n")}\n`;
};
