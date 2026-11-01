import { describe, expect, it } from "vitest";
import { loadRenderer } from "./renderer.js";

const r = loadRenderer();
const TICK = String.fromCharCode(96);
const FENCE = TICK + TICK + TICK;
const NL = String.fromCharCode(10);
const lines = (...l: string[]): string => l.join(NL);

describe("markdown blocks", () => {
  it("renders headings, paragraphs and rules", () => {
    expect(r.markdown("# Title")).toBe("<h1>Title</h1>");
    expect(r.markdown("### Smaller ###")).toBe("<h3>Smaller</h3>");
    expect(r.markdown(lines("one", "two"))).toBe("<p>one<br>two</p>");
    expect(r.markdown(lines("first", "", "second"))).toBe("<p>first</p><p>second</p>");
    expect(r.markdown("---")).toBe("<hr>");
  });

  it("renders unordered, ordered and nested lists", () => {
    expect(r.markdown(lines("- a", "- b"))).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(r.markdown(lines("1. a", "2. b"))).toBe("<ol><li>a</li><li>b</li></ol>");
    expect(r.markdown(lines("- a", "  - b", "- c"))).toBe("<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>");
  });

  it("renders blockquotes, which can contain markdown", () => {
    expect(r.markdown(lines("> **hi**", "> there"))).toBe("<blockquote><p><strong>hi</strong><br>there</p></blockquote>");
  });

  it("renders a table", () => {
    const html = r.markdown(lines("| a | b |", "|---|---|", "| 1 | **2** |"));
    expect(html).toContain("<th>a</th><th>b</th>");
    expect(html).toContain("<td>1</td><td><strong>2</strong></td>");
  });

  it("does not treat a lone pipe line as a table", () => {
    expect(r.markdown("a | b")).toBe("<p>a | b</p>");
  });
});

describe("markdown inline", () => {
  it("renders bold, italic, strikethrough and code", () => {
    expect(r.markdown("**b** and *i* and _j_ and ~~s~~")).toBe("<p><strong>b</strong> and <em>i</em> and <em>j</em> and <del>s</del></p>");
    expect(r.markdown(`use ${TICK}a < b${TICK} here`)).toBe("<p>use <code>a &lt; b</code> here</p>");
  });

  it("leaves markdown characters inside code alone", () => {
    expect(r.markdown(`${TICK}**not bold**${TICK}`)).toBe("<p><code>**not bold**</code></p>");
  });

  it("does not italicise snake_case or multiplication", () => {
    expect(r.markdown("a snake_case_name and 2*3*4")).toBe("<p>a snake_case_name and 2*3*4</p>");
  });

  it("renders links, and turns bare web addresses into links", () => {
    expect(r.markdown("[docs](https://example.com/a?b=1&c=2)")).toBe('<p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">docs</a></p>');
    expect(r.markdown("see https://example.com/x.")).toContain('<a href="https://example.com/x"');
  });
});

describe("code blocks", () => {
  it("renders a fenced block with its language and a copy button", () => {
    const html = r.markdown(lines(`${FENCE}ts`, "const x = 1;", FENCE));
    expect(html).toContain('<div class="code">');
    expect(html).toContain("<span>ts</span>");
    expect(html).toContain('class="copy"');
    expect(html).toContain('<span class="tk-k">const</span>');
    expect(html).toContain('<span class="tk-n">1</span>');
  });

  it("renders an unclosed fence, which is what a half-streamed reply looks like", () => {
    const html = r.markdown(lines(`${FENCE}js`, "let a = 1;"));
    expect(html).toContain("<pre>");
    expect(html).toContain('<span class="tk-k">let</span>');
  });

  it("keeps markdown out of code, and does not run on past a closing fence", () => {
    const html = r.markdown(lines(FENCE, "# not a heading", FENCE, "after"));
    expect(html).toContain("# not a heading");
    expect(html).not.toContain("<h1>");
    expect(html.endsWith("<p>after</p>")).toBe(true);
  });

  it("supports longer fences so code can contain a shorter one", () => {
    const four = TICK.repeat(4);
    const html = r.markdown(lines(`${four}md`, `${FENCE}js`, "x", FENCE, four));
    expect(html.match(/<pre>/g)).toHaveLength(1);
    expect(html).toContain(FENCE);
  });
});

describe("syntax colouring", () => {
  it("colours comments, strings, numbers, keywords and calls", () => {
    const html = r.highlight(lines("// note", 'const s = "a" + 12;', "call(x);"), "javascript");
    expect(html).toContain('<span class="tk-c">// note</span>');
    expect(html).toContain('<span class="tk-s">&quot;a&quot;</span>');
    expect(html).toContain('<span class="tk-n">12</span>');
    expect(html).toContain('<span class="tk-f">call</span>');
  });

  it("ends an unterminated string at the end of the line", () => {
    const html = r.highlight(lines('x = "open', "y = 2"), "js");
    expect(html).toContain('<span class="tk-n">2</span>');
  });

  it("colours Python, shell, JSON, CSS and HTML", () => {
    expect(r.highlight("def f(): # hi", "python")).toContain('<span class="tk-k">def</span>');
    expect(r.highlight("echo hi # c", "bash")).toContain('<span class="tk-c"># c</span>');
    const json = r.highlight('{"a": 1, "b": true}', "json");
    expect(json).toContain('<span class="tk-p">&quot;a&quot;</span>');
    expect(json).toContain('<span class="tk-k">true</span>');
    expect(r.highlight("a { color: #fff; }", "css")).toContain('<span class="tk-p">color</span>');
    const html = r.highlight('<a href="x">hi</a>', "html");
    expect(html).toContain('<span class="tk-k">&lt;a</span>');
    expect(html).toContain('<span class="tk-s">&quot;x&quot;</span>');
  });

  it("escapes code in a language it does not know", () => {
    expect(r.highlight("<b>&</b>", "klingon")).toBe("&lt;b&gt;&amp;&lt;/b&gt;");
  });
});

describe("diffs", () => {
  const diff = lines("diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -1,2 +1,2 @@", " same", "-old", "+new");

  it("colours added, removed, hunk and header lines", () => {
    const html = r.diff(diff);
    expect(html).toContain(`<span class="d-meta">diff --git a/x b/x${NL}</span>`);
    expect(html).toContain(`<span class="d-hunk">@@ -1,2 +1,2 @@${NL}</span>`);
    expect(html).toContain(`<span class="d-del">-old${NL}</span>`);
    expect(html).toContain(`<span class="d-add">+new${NL}</span>`);
    expect(html).toContain(`<span class="d-ctx"> same${NL}</span>`);
    // The file headers start with --- and +++ but are headers, not changes.
    expect(html).toContain(`<span class="d-meta">--- a/x${NL}</span>`);
    expect(html).toContain(`<span class="d-meta">+++ b/x${NL}</span>`);
  });

  it("is used for diff fences", () => {
    const html = r.markdown(lines(`${FENCE}diff`, "-a", "+b", FENCE));
    expect(html).toContain('class="diff"');
    expect(html).toContain(`<span class="d-add">+b${NL}</span>`);
  });
});

describe("hostile input", () => {
  const dangerous = ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", '<a href="javascript:alert(1)">x</a>', "<svg onload=alert(1)>"];

  it("never lets model text become markup", () => {
    for (const text of dangerous) {
      const html = r.markdown(text);
      expect(html, text).not.toMatch(/<(script|img|svg|a )/i);
      expect(html, text).toContain("&lt;");
    }
  });

  it("escapes markup inside every kind of block and inline", () => {
    const text = lines("# <script>x</script>", "- <img src=x>", "> <b>q</b>", "| <i> |", "|---|", "| <u> |", `${TICK}<s>${TICK}`, "**<em>**");
    const html = r.markdown(text);
    expect(html).not.toMatch(/<(script|img|b|i|u|s)\b/);
  });

  it("escapes code and highlight output, including a fence that tries to close the page's markup", () => {
    const html = r.markdown(lines(`${FENCE}html`, "</code></pre><script>alert(1)</script>", FENCE));
    expect(html).not.toContain("<script>");
    expect(html.match(/<pre>/g)).toHaveLength(1);
  });

  it("only links to web and mail addresses", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,<script>1</script>", "vbscript:x", "file:///etc/passwd", "//evil.example"]) {
      const html = r.markdown(`[click](${url})`);
      expect(html, url).not.toContain("<a ");
      expect(html, url).not.toContain("href");
    }
    expect(r.markdown("[m](mailto:a@b.co)")).toContain('href="mailto:a@b.co"');
  });

  it("cannot break out of the href attribute", () => {
    const html = r.markdown('[x](https://a.co/"onmouseover="alert(1))');
    expect(html).not.toMatch(/ onmouseover=/);
    expect(html).toContain("&quot;");
  });

  it("is not fooled by its own placeholder characters in the text", () => {
    const html = r.markdown(`a${String.fromCharCode(0)}0${String.fromCharCode(1)}b ${TICK}code${TICK}`);
    expect(html).toBe("<p>a0b <code>code</code></p>");
  });

  it("handles empty and huge input without throwing", () => {
    expect(r.markdown("")).toBe("");
    expect(() => r.markdown("*".repeat(50_000))).not.toThrow();
    expect(() => r.markdown(`${FENCE}js` + NL + "x".repeat(200_000))).not.toThrow();
    expect(() => r.markdown("[".repeat(20_000))).not.toThrow();
  });
});
