import { describe, expect, it } from "vitest";
import { codeBlock, continueList, insideFence, link, prefixLines, wrapSelection } from "./markdown-edit";

describe("wrapping a selection", () => {
  it("wraps it, and unwraps it when it is already wrapped", () => {
    const wrapped = wrapSelection("say hello now", 4, 9, "**");
    expect(wrapped).toEqual({ text: "say **hello** now", start: 6, end: 11 });
    expect(wrapSelection(wrapped.text, wrapped.start, wrapped.end, "**")).toEqual({ text: "say hello now", start: 4, end: 9 });
  });

  it("inserts the markers around a placeholder, selected, when nothing is selected", () => {
    expect(wrapSelection("a ", 2, 2, "`")).toEqual({ text: "a `text`", start: 3, end: 7 });
  });

  it("does not mistake text at the start of the box for a wrapped selection", () => {
    expect(wrapSelection("hello", 0, 5, "*")).toEqual({ text: "*hello*", start: 1, end: 6 });
  });
});

describe("a link", () => {
  it("makes the selection the link text and selects the address to type over", () => {
    const edit = link("see docs here", 4, 8);
    expect(edit.text).toBe("see [docs](url) here");
    expect(edit.text.slice(edit.start, edit.end)).toBe("url");
  });

  it("starts from placeholders when nothing is selected", () => {
    const edit = link("", 0, 0);
    expect(edit.text).toBe("[link text](url)");
    expect(edit.text.slice(edit.start, edit.end)).toBe("url");
  });
});

describe("lists and quotes", () => {
  it("makes each selected line a bullet, and takes the bullets off again", () => {
    const on = prefixLines("one\ntwo\nthree", 0, 13, "bullet");
    expect(on.text).toBe("- one\n- two\n- three");
    expect(prefixLines(on.text, on.start, on.end, "bullet").text).toBe("one\ntwo\nthree");
  });

  it("numbers lines, and swaps one kind of list for another rather than stacking them", () => {
    const numbered = prefixLines("a\nb", 0, 3, "number");
    expect(numbered.text).toBe("1. a\n2. b");
    expect(prefixLines(numbered.text, numbered.start, numbered.end, "bullet").text).toBe("- a\n- b");
  });

  it("works on just the lines the selection touches", () => {
    expect(prefixLines("keep\nchange\nkeep", 6, 8, "quote").text).toBe("keep\n> change\nkeep");
  });
});

describe("a code block", () => {
  it("fences the selection, and leaves a gap with the cursor inside when nothing is selected", () => {
    expect(codeBlock("x = 1", 0, 5).text).toBe("```\nx = 1\n```\n");
    const empty = codeBlock("", 0, 0);
    expect(empty.text).toBe("```\n\n```\n");
    expect(empty.start).toBe(4);
  });

  it("starts on a new line when it is added after other text", () => {
    expect(codeBlock("look:", 5, 5).text).toBe("look:\n```\n\n```\n");
  });
});

describe("whether the cursor is inside a code block", () => {
  it("is true after an opening fence that has not been closed", () => {
    expect(insideFence("text\n```ts\nconst a = 1;\n", 25)).toBe(true);
    expect(insideFence("```\ncode\n```\nmore", 17)).toBe(false);
    expect(insideFence("no fences", 5)).toBe(false);
    expect(insideFence("  ```\nindented", 14)).toBe(true);
  });
});

describe("continuing a list with Shift+Enter", () => {
  it("adds the next bullet, or the next number", () => {
    expect(continueList("- one", 5)).toEqual({ text: "- one\n- ", start: 8, end: 8 });
    expect(continueList("1. one", 6)).toEqual({ text: "1. one\n2. ", start: 10, end: 10 });
    expect(continueList("> quoted", 8)?.text).toBe("> quoted\n> ");
    expect(continueList("  * nested", 10)?.text).toBe("  * nested\n  * ");
  });

  it("ends the list when the item is empty", () => {
    expect(continueList("- one\n- ", 8)).toEqual({ text: "- one\n", start: 6, end: 6 });
  });

  it("leaves a plain line, and anything inside a code block, alone", () => {
    expect(continueList("just text", 9)).toBeUndefined();
    expect(continueList("```\n- not a list\n", 16)).toBeUndefined();
  });
});
