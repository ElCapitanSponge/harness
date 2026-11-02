import { IMAGE_TOKENS, textOf, type ChatMessage } from "@harness/core";
import { estimateTokens } from "./ledger.js";

// Compaction keeps a long conversation going: older turns are replaced by a short summary the model writes, and the system
// prompt and the most recent turns stay exactly as they were. The conversation shown to the person is untouched; only what is
// sent to the model gets shorter.

export const SUMMARY_PROMPT = [
  "You are condensing the earlier part of a conversation so it can continue with less text.",
  "Write a faithful summary for your own later use: what the person wanted, what has been decided, facts and names that matter,",
  "files and commands touched and what happened, errors seen and how they were resolved, and anything still to do.",
  "Keep exact identifiers, paths and numbers. Do not answer anything in the conversation. Reply with the summary only.",
].join(" ");

export interface CompactionPlan {
  // Leading system messages, kept as they are.
  head: ChatMessage[];
  // The older turns that will be replaced by a summary.
  older: ChatMessage[];
  // The most recent turns, kept as they are.
  keep: ChatMessage[];
}

// How much to keep: this many of the latest user messages and everything after the first of them. A turn is a user message and
// all that follows it up to the next, so tool calls stay with their results.
export const KEEP_TURNS = 2;

// Splits a history into what to summarise and what to keep, or says there is nothing worth summarising.
export const planCompaction = (history: ChatMessage[], keepTurns: number = KEEP_TURNS): CompactionPlan | undefined => {
  let head = 0;
  while (history[head]?.role === "system") {
    head++;
  }
  const body = history.slice(head);
  const users = body.flatMap((m, i) => {
    return m.role === "user" ? [i] : [];
  });
  if (users.length <= keepTurns) {
    return undefined;
  }
  const keepFrom = users[users.length - keepTurns] ?? 0;
  if (keepFrom === 0) {
    return undefined;
  }
  return { head: history.slice(0, head), older: body.slice(0, keepFrom), keep: body.slice(keepFrom) };
};

const clip = (text: string, max: number): string => {
  return text.length > max ? `${text.slice(0, max)}... (shortened)` : text;
};

// The older turns as plain text for the model to summarise. Long tool output is shortened, and if the whole is still too long
// the middle goes, because the start says what was asked and the end says where things stand.
export const transcriptOf = (older: ChatMessage[], maxChars: number): string => {
  const lines = older.map((m) => {
    if (m.role === "tool") {
      return `Tool result${m.name ? ` (${m.name})` : ""}: ${clip(textOf(m.content), 800)}`;
    }
    const calls = (m.tool_calls ?? []).map((c) => {
      return `${c.function.name}(${clip(c.function.arguments, 200)})`;
    });
    const said = clip(textOf(m.content), 3000);
    const label = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "System";
    return calls.length > 0 ? `${label}: ${said} [called ${calls.join(", ")}]`.trim() : `${label}: ${said}`;
  });
  const whole = lines.join("\n\n");
  if (whole.length <= maxChars) {
    return whole;
  }
  const half = Math.floor(maxChars / 2);
  return `${whole.slice(0, half)}\n\n... (the middle of the earlier conversation was left out) ...\n\n${whole.slice(-half)}`;
};

// The history after compaction: the system prompt, the summary as a further system message, then the recent turns.
export const compacted = (plan: CompactionPlan, summary: string): ChatMessage[] => {
  return [...plan.head, { role: "system", content: `Summary of the earlier conversation (older messages were compacted to save space):\n${summary.trim()}` }, ...plan.keep];
};

// The size of a conversation in tokens. A picture counts as a fixed amount, not as its encoded bytes.
export const historyTokens = (history: ChatMessage[]): number => {
  let images = 0;
  const text = JSON.stringify(history, (key, value: unknown) => {
    if (key === "url" && typeof value === "string" && value.startsWith("data:")) {
      images++;
      return "";
    }
    return value;
  });
  return estimateTokens(text) + images * IMAGE_TOKENS;
};
