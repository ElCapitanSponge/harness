import { describe, expect, it } from "vitest";
import { highlightMarkdown, type MdKind } from "./highlight.js";

const kindsOf = (text: string): [string, MdKind][] => {
  return highlightMarkdown(text).map((s) => {
    return [s.text, s.kind];
  });
};

describe("highlightMarkdown", () => {
  it("always joins back into exactly the text typed", () => {
    const samples = [
      "",
      "plain",
      "# Title\n\n- one **two** `three`\n1. [x](http://a.b) _y_ *z*\n> quoted *text*\n\n```ts\nconst a = 1;\n\n",
      "unclosed `code and **bold\n\r\n\ttabbed\n",
      "snake_case_name and 2*3*4 and <script>alert(1)</script>\n",
    ];
    for (const sample of samples) {
      expect(highlightMarkdown(sample).map((s) => {
        return s.text;
      }).join("")).toBe(sample);
    }
  });

  it("styles inline forms", () => {
    expect(kindsOf("a **b** and *c* and `d` and [e](f)")).toEqual([
      ["a ", "plain"], ["**b**", "bold"], [" and ", "plain"], ["*c*", "italic"], [" and ", "plain"], ["`d`", "code"], [" and ", "plain"], ["[e](f)", "link"],
    ]);
  });

  it("styles headings, lists and quotes with their marker", () => {
    expect(kindsOf("## Hi\n- item **x**\n> q")).toEqual([
      ["## ", "marker"], ["Hi\n", "heading"], ["- ", "marker"], ["item ", "plain"], ["**x**", "bold"], ["\n", "plain"], ["> ", "marker"], ["q", "quote"],
    ]);
  });

  it("styles a fenced block across lines and leaves its inside alone, even when unclosed", () => {
    expect(kindsOf("```js\n**not bold**\n- not a list\n```\nafter **x**")).toEqual([
      ["```js\n", "fence"], ["**not bold**\n", "fenced"], ["- not a list\n", "fenced"], ["```\n", "fence"], ["after ", "plain"], ["**x**", "bold"],
    ]);
    expect(kindsOf("```\nopen\n**x**").map(([, kind]) => {
      return kind;
    })).toEqual(["fence", "fenced", "fenced"]);
  });

  it("leaves snake_case and spaced asterisks alone", () => {
    expect(kindsOf("my_var_name and 2 * 3 * 4")).toEqual([["my_var_name and 2 * 3 * 4", "plain"]]);
  });

  it("treats raw html as plain text", () => {
    expect(kindsOf("<img src=x onerror=alert(1)>")).toEqual([["<img src=x onerror=alert(1)>", "plain"]]);
  });
});
