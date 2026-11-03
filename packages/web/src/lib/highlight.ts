// Marks up the markdown a person is typing so the message box can colour it. Kept free of React so it can be tested.
//
// This only classifies stretches of the text; it never produces markup. The segments always join back into exactly the text given, so what is
// sent is what was typed, and whatever draws them draws text, never HTML.

export type MdKind = "plain" | "marker" | "heading" | "bold" | "italic" | "code" | "link" | "quote" | "fence" | "fenced";

export interface MdSegment {
  text: string;
  kind: MdKind;
}

// Inline forms, tried left to right: code, bold, italics and links. An underscore only counts at the edge of a word, so snake_case is left alone.
const INLINE = /`[^`\n]+`|\*\*[^*\n]+\*\*|(?<!\w)__[^_\n]+__(?!\w)|\*[^*\s](?:[^*\n]*[^*\s])?\*|(?<!\w)_[^_\s](?:[^_\n]*[^_\s])?_(?!\w)|\[[^\]\n]*\]\([^)\s]*\)/g;

const inlineKind = (match: string): MdKind => {
  if (match.startsWith("`")) {
    return "code";
  }
  if (match.startsWith("[")) {
    return "link";
  }
  return match.startsWith("**") || match.startsWith("__") ? "bold" : "italic";
};

const inline = (text: string, base: MdKind = "plain"): MdSegment[] => {
  const out: MdSegment[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) {
      out.push({ text: text.slice(at, m.index), kind: base });
    }
    out.push({ text: m[0], kind: inlineKind(m[0]) });
    at = m.index + m[0].length;
  }
  if (at < text.length) {
    out.push({ text: text.slice(at), kind: base });
  }
  return out;
};

const FENCE = /^ {0,3}(```|~~~)/;
const HEADING = /^ {0,3}#{1,6}[ \t]+/;
const QUOTE = /^ {0,3}>[ \t]?/;
const LIST = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/;

// A line that starts with a marker: the marker, then the rest of the line.
const led = (line: string, pattern: RegExp, rest: (text: string) => MdSegment[]): MdSegment[] | undefined => {
  const m = pattern.exec(line);
  if (!m) {
    return undefined;
  }
  return [{ text: m[0], kind: "marker" }, ...rest(line.slice(m[0].length))];
};

export const highlightMarkdown = (text: string): MdSegment[] => {
  const out: MdSegment[] = [];
  let fenced = false;
  // Each line keeps its own line break, so the pieces join back into the text.
  for (const line of text.split(/(?<=\n)/)) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      out.push({ text: line, kind: "fence" });
    } else if (fenced) {
      out.push({ text: line, kind: "fenced" });
    } else {
      out.push(...(led(line, HEADING, (rest) => {
        return rest === "" ? [] : [{ text: rest, kind: "heading" }];
      }) ?? led(line, QUOTE, (rest) => {
        return inline(rest, "quote");
      }) ?? led(line, LIST, (rest) => {
        return inline(rest);
      }) ?? inline(line)));
    }
  }
  return out;
};
