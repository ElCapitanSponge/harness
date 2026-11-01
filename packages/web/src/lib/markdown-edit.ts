// Editing markdown in the message box: wrapping a selection, prefixing lines, code blocks, continuing a list. Each takes the
// text and the selection and returns the new text and selection, so it can be tested without a browser.

export interface Edit {
  text: string;
  start: number;
  end: number;
}

const FENCE = "```";

// Wraps the selection in `before` and `after`, or unwraps it if it is already wrapped. With nothing selected it inserts the
// markers around a placeholder and selects the placeholder, ready to be typed over.
export const wrapSelection = (text: string, start: number, end: number, before: string, after: string = before, placeholder = "text"): Edit => {
  const selected = text.slice(start, end);
  if (selected === "") {
    const inserted = `${before}${placeholder}${after}`;
    return { text: text.slice(0, start) + inserted + text.slice(end), start: start + before.length, end: start + before.length + placeholder.length };
  }
  const wrapped = text.slice(start - before.length, start) === before && text.slice(end, end + after.length) === after && start >= before.length;
  if (wrapped) {
    return { text: text.slice(0, start - before.length) + selected + text.slice(end + after.length), start: start - before.length, end: end - before.length };
  }
  return { text: text.slice(0, start) + before + selected + after + text.slice(end), start: start + before.length, end: end + before.length };
};

// A link: the selection becomes the link text and "url" is selected to be replaced; with nothing selected both are placeholders.
export const link = (text: string, start: number, end: number): Edit => {
  const label = text.slice(start, end) || "link text";
  const inserted = `[${label}](url)`;
  const urlStart = start + label.length + 3;
  return { text: text.slice(0, start) + inserted + text.slice(end), start: urlStart, end: urlStart + 3 };
};

const lineBounds = (text: string, start: number, end: number): { from: number; to: number } => {
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const stop = text.indexOf("\n", end);
  return { from, to: stop === -1 ? text.length : stop };
};

const BULLET = /^(\s*)([-*+])\s+/;
const NUMBER = /^(\s*)(\d+)[.)]\s+/;
const QUOTE = /^(\s*)>\s?/;

// Turns the selected lines into a bulleted or numbered list or a quote, or back into plain lines if they all are one already.
export const prefixLines = (text: string, start: number, end: number, kind: "bullet" | "number" | "quote"): Edit => {
  const { from, to } = lineBounds(text, start, end);
  const lines = text.slice(from, to).split("\n");
  const pattern = kind === "bullet" ? BULLET : kind === "number" ? NUMBER : QUOTE;
  const all = lines.every((l) => {
    return pattern.test(l);
  });
  const changed = lines.map((line, i) => {
    if (all) {
      return line.replace(pattern, "$1");
    }
    const bare = line.replace(BULLET, "$1").replace(NUMBER, "$1").replace(QUOTE, "$1");
    return `${kind === "bullet" ? "- " : kind === "number" ? `${String(i + 1)}. ` : "> "}${bare}`;
  }).join("\n");
  return { text: text.slice(0, from) + changed + text.slice(to), start: from, end: from + changed.length };
};

// A fenced code block around the selection, or an empty one with the cursor inside it.
export const codeBlock = (text: string, start: number, end: number): Edit => {
  const selected = text.slice(start, end);
  const lead = start > 0 && text[start - 1] !== "\n" ? "\n" : "";
  const block = `${lead}${FENCE}\n${selected}\n${FENCE}\n`;
  const inside = start + lead.length + FENCE.length + 1;
  return { text: text.slice(0, start) + block + text.slice(end), start: inside, end: inside + selected.length };
};

// True when the cursor is inside a fenced code block that has been opened and not closed, where Enter should add a line and not send.
export const insideFence = (text: string, cursor: number): boolean => {
  const fences = text.slice(0, cursor).split("\n").filter((line) => {
    return line.trimStart().startsWith(FENCE);
  });
  return fences.length % 2 === 1;
};

// Shift+Enter in a list carries the list on: a new bullet or the next number, or ends the list if the item was empty.
export const continueList = (text: string, cursor: number): Edit | undefined => {
  const from = text.lastIndexOf("\n", cursor - 1) + 1;
  const line = text.slice(from, cursor);
  if (insideFence(text, cursor)) {
    return undefined;
  }
  const bullet = BULLET.exec(line);
  const number = NUMBER.exec(line);
  const quote = QUOTE.exec(line);
  const match = bullet ?? number ?? quote;
  if (!match) {
    return undefined;
  }
  // An empty item ends the list.
  if (line.slice(match[0].length).trim() === "") {
    return { text: text.slice(0, from) + text.slice(cursor), start: from, end: from };
  }
  const marker = bullet ? `${bullet[1] ?? ""}${bullet[2] ?? "-"} ` : number ? `${number[1] ?? ""}${String(Number(number[2]) + 1)}. ` : match[0];
  const inserted = `\n${marker}`;
  const at = cursor + inserted.length;
  return { text: text.slice(0, cursor) + inserted + text.slice(cursor), start: at, end: at };
};
