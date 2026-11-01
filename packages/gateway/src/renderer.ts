// The page's markdown, code and diff renderer, kept apart from the page so it can be tested. It is plain JavaScript in a
// string because the page has no build step and its content security policy allows no external scripts. It turns text
// from a model into HTML and must never let that text become markup: everything is escaped before anything is added,
// and links are limited to a few safe schemes.
//
// Written without template literals or backtick characters so it can sit inside the page's own template string.
export const RENDERER_SOURCE = String.raw`function (root) {
  var TICK = String.fromCharCode(96);
  var NL = String.fromCharCode(10);

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function span(cls, text) { return '<span class="tk-' + cls + '">' + esc(text) + "</span>"; }

  // ---- syntax colouring -------------------------------------------------------------------------------------------

  var KEYWORDS = {
    js: "break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await null true false undefined interface type enum implements public private protected readonly abstract as from declare namespace",
    py: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self",
    sh: "if then else elif fi for while do done case esac function in return export local echo cd ls rm mv cp cat grep sed awk git npm pnpm node sudo exit set unset source",
    json: "true false null",
    css: ""
  };
  var KEYSETS = {};
  Object.keys(KEYWORDS).forEach(function (k) {
    var set = {};
    KEYWORDS[k].split(" ").forEach(function (w) { if (w) set[w] = true; });
    KEYSETS[k] = set;
  });

  var ALIASES = {
    javascript: "js", js: "js", jsx: "js", mjs: "js", cjs: "js", typescript: "js", ts: "js", tsx: "js",
    python: "py", py: "py",
    sh: "sh", bash: "sh", shell: "sh", zsh: "sh", console: "sh",
    json: "json", jsonc: "json",
    html: "html", xml: "html", svg: "html", vue: "html",
    css: "css", scss: "css",
    diff: "diff", patch: "diff"
  };

  // Index just past a string that opens at i with quote q. A string ends at its closing quote, or at the end of the line
  // (or of the text) if it never closes, so one stray quote cannot colour the rest of the block.
  function stringEnd(code, i, q, multiline) {
    var j = i + 1;
    while (j < code.length) {
      var c = code.charAt(j);
      if (c === "\\") { j += 2; continue; }
      if (c === q) return j + 1;
      if (c === NL && !multiline) return j;
      j++;
    }
    return code.length;
  }

  function isIdentStart(c) { return /[A-Za-z_$]/.test(c); }
  function isIdentPart(c) { return /[\w$]/.test(c); }

  // Colours code that looks like C, Python, shell, JSON or CSS: comments, strings, numbers and keywords.
  function scanCode(code, lang) {
    var out = "";
    var i = 0;
    var n = code.length;
    var keys = KEYSETS[lang] || {};
    var hashComments = lang === "py" || lang === "sh";
    var slashComments = lang === "js" || lang === "css" || lang === "json";
    while (i < n) {
      var c = code.charAt(i);
      var two = code.substr(i, 2);
      var j;
      if ((hashComments && c === "#") || (slashComments && two === "//")) {
        j = code.indexOf(NL, i);
        if (j < 0) j = n;
        out += span("c", code.slice(i, j));
        i = j;
      } else if (slashComments && two === "/*") {
        j = code.indexOf("*/", i + 2);
        j = j < 0 ? n : j + 2;
        out += span("c", code.slice(i, j));
        i = j;
      } else if (lang === "py" && (code.substr(i, 3) === '"""' || code.substr(i, 3) === "'''")) {
        var q3 = code.substr(i, 3);
        j = code.indexOf(q3, i + 3);
        j = j < 0 ? n : j + 3;
        out += span("s", code.slice(i, j));
        i = j;
      } else if (c === '"' || c === "'" || (c === TICK && lang === "js")) {
        j = stringEnd(code, i, c, c === TICK);
        var text = code.slice(i, j);
        var k = j;
        while (k < n && (code.charAt(k) === " " || code.charAt(k) === "\t")) k++;
        // In JSON, a string followed by a colon is a property name.
        out += span(lang === "json" && code.charAt(k) === ":" ? "p" : "s", text);
        i = j;
      } else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(code.charAt(i + 1)))) {
        j = i + 1;
        while (j < n && /[0-9a-zA-Z_.]/.test(code.charAt(j))) j++;
        out += span("n", code.slice(i, j));
        i = j;
      } else if (lang === "css" && c === "#" && /[0-9a-fA-F]/.test(code.charAt(i + 1))) {
        j = i + 1;
        while (j < n && /[0-9a-fA-F]/.test(code.charAt(j))) j++;
        out += span("n", code.slice(i, j));
        i = j;
      } else if (lang === "css" && c === "@") {
        j = i + 1;
        while (j < n && /[\w-]/.test(code.charAt(j))) j++;
        out += span("k", code.slice(i, j));
        i = j;
      } else if (isIdentStart(c) || (lang === "css" && c === "-")) {
        j = i + 1;
        while (j < n && (isIdentPart(code.charAt(j)) || (lang === "css" && code.charAt(j) === "-"))) j++;
        var word = code.slice(i, j);
        var after = j;
        while (after < n && code.charAt(after) === " ") after++;
        if (keys[word] === true) out += span("k", word);
        else if (lang === "css" && code.charAt(after) === ":") out += span("p", word);
        else if (lang !== "json" && lang !== "css" && code.charAt(after) === "(") out += span("f", word);
        else out += esc(word);
        i = j;
      } else {
        out += esc(c);
        i++;
      }
    }
    return out;
  }

  // Tags, attribute names and values, and comments.
  function scanHtml(code) {
    var out = "";
    var i = 0;
    var n = code.length;
    while (i < n) {
      if (code.substr(i, 4) === "<!--") {
        var e = code.indexOf("-->", i + 4);
        e = e < 0 ? n : e + 3;
        out += span("c", code.slice(i, e));
        i = e;
      } else if (code.charAt(i) === "<" && /[A-Za-z\/!?]/.test(code.charAt(i + 1))) {
        var j = i + 1;
        var quote = "";
        while (j < n) {
          var ch = code.charAt(j);
          if (quote) { if (ch === quote) quote = ""; }
          else if (ch === '"' || ch === "'") quote = ch;
          else if (ch === ">") break;
          j++;
        }
        var tag = code.slice(i, Math.min(n, j + 1));
        var m = /^<\/?[\w:-]*/.exec(tag);
        out += span("k", m[0]);
        var rest = tag.slice(m[0].length);
        var parts = rest.split(/("[^"]*"?|'[^']*'?)/);
        for (var p = 0; p < parts.length; p++) {
          var part = parts[p];
          if (part.charAt(0) === '"' || part.charAt(0) === "'") out += span("s", part);
          else out += esc(part).replace(/([\w:-]+)(?==)/g, '<span class="tk-p">$1</span>');
        }
        i += tag.length;
      } else {
        var next = code.indexOf("<", i + 1);
        if (next < 0) next = n;
        out += esc(code.slice(i, next));
        i = next;
      }
    }
    return out;
  }

  // A unified diff, as git diff or diff -u print it: one coloured row per line.
  function renderDiff(code) {
    var lines = String(code).replace(/\r\n?/g, NL).split(NL);
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines.map(function (line) {
      var cls = "ctx";
      if (/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) |old mode|new mode)/.test(line)) cls = "meta";
      else if (line.indexOf("@@") === 0) cls = "hunk";
      else if (line.charAt(0) === "+") cls = "add";
      else if (line.charAt(0) === "-") cls = "del";
      // Each row is a block, so its own line break goes inside it: the rows do not double up, and copying keeps the lines.
      return '<span class="d-' + cls + '">' + (esc(line) || " ") + NL + "</span>";
    }).join("");
  }

  function highlight(code, language) {
    var lang = ALIASES[String(language || "").toLowerCase()];
    if (lang === "diff") return renderDiff(code);
    if (lang === "html") return scanHtml(code);
    if (lang) return scanCode(code, lang);
    return esc(code);
  }

  function codeBlock(language, code) {
    var lang = ALIASES[String(language || "").toLowerCase()];
    var label = esc(language || "text");
    return '<div class="code"><div class="code-head"><span>' + label + '</span><button type="button" class="copy">Copy</button></div>' +
      "<pre><code" + (lang === "diff" ? ' class="diff"' : "") + ">" + highlight(code, language) + "</code></pre></div>";
  }

  // ---- markdown ---------------------------------------------------------------------------------------------------

  function safeUrl(url) { return /^(https?:\/\/|mailto:)/i.test(url); }

  function inline(text) {
    var stash = [];
    function keep(html) { stash.push(html); return String.fromCharCode(0) + (stash.length - 1) + String.fromCharCode(1); }
    var src = String(text).replace(/[\u0000\u0001]/g, "");

    // Code spans first, so nothing inside them is touched.
    src = src.replace(new RegExp(TICK + "([^" + TICK + NL + "]+)" + TICK, "g"), function (_, c) { return keep("<code>" + esc(c) + "</code>"); });

    // Links: [text](url). An unsafe url leaves just the text.
    src = src.replace(/\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, function (_, label, url) {
      if (!safeUrl(url)) return keep(esc(label));
      return keep('<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + "</a>");
    });

    // Bare web addresses.
    src = src.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, function (_, lead, url) {
      return lead + keep('<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + "</a>");
    });

    var html = esc(src);
    html = html.replace(/\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/g, function (_, a, b) { return "<strong>" + (a || b) + "</strong>"; });
    html = html.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, function (_, lead, t) { return lead + "<em>" + t + "</em>"; });
    html = html.replace(/(^|[^_\w])_([^_\n]+?)_(?!\w)/g, function (_, lead, t) { return lead + "<em>" + t + "</em>"; });
    html = html.replace(/~~([^~\n]+?)~~/g, "<del>$1</del>");

    return html.replace(/\u0000(\d+)\u0001/g, function (_, i) { return stash[Number(i)]; });
  }

  function paragraphText(lines) { return inline(lines.join(NL)).replace(/\n/g, "<br>"); }

  var LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  var FENCE_OPEN = new RegExp("^\\s{0,3}(" + TICK + "{3,}|~{3,})\\s*([\\w+.#-]*)");
  var TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  function startsBlock(line) {
    return FENCE_OPEN.test(line) || /^\s{0,3}#{1,6}\s/.test(line) || /^\s{0,3}>/.test(line) || LIST_ITEM.test(line) || /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line);
  }

  function splitRow(line) {
    var t = line.trim();
    if (t.charAt(0) === "|") t = t.slice(1);
    if (t.charAt(t.length - 1) === "|") t = t.slice(0, -1);
    return t.split("|").map(function (c) { return c.trim(); });
  }

  function renderList(items) {
    // items: { indent, ordered, text }, rendered as nested lists by indentation.
    var html = "";
    var stack = [];
    function close(toIndent) {
      while (stack.length && stack[stack.length - 1].indent >= toIndent) {
        var top = stack.pop();
        html += "</li></" + (top.ordered ? "ol" : "ul") + ">";
      }
    }
    items.forEach(function (it) {
      var top = stack[stack.length - 1];
      if (top && it.indent === top.indent) {
        html += "</li>";
      } else if (!top || it.indent > top.indent) {
        stack.push({ indent: it.indent, ordered: it.ordered });
        html += "<" + (it.ordered ? "ol" : "ul") + ">";
      } else {
        close(it.indent + 1);
        html += "</li>";
        if (!stack.length || stack[stack.length - 1].indent < it.indent) {
          stack.push({ indent: it.indent, ordered: it.ordered });
          html += "<" + (it.ordered ? "ol" : "ul") + ">";
        }
      }
      html += "<li>" + inline(it.text);
    });
    close(0);
    return html;
  }

  function markdown(source) {
    var lines = String(source).replace(/\r\n?/g, NL).split(NL);
    var html = "";
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      var m;

      if (/^\s*$/.test(line)) { i++; continue; }

      // Fenced code. An unclosed fence runs to the end, which is what a half-streamed reply looks like.
      if ((m = FENCE_OPEN.exec(line))) {
        var marker = m[1].charAt(0);
        var len = m[1].length;
        var body = [];
        i++;
        while (i < lines.length) {
          var close = new RegExp("^\\s{0,3}" + (marker === "~" ? "~" : TICK) + "{" + len + ",}\\s*$");
          if (close.test(lines[i])) { i++; break; }
          body.push(lines[i]);
          i++;
        }
        html += codeBlock(m[2], body.join(NL));
        continue;
      }

      if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
        html += "<h" + m[1].length + ">" + inline(m[2]) + "</h" + m[1].length + ">";
        i++;
        continue;
      }

      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { html += "<hr>"; i++; continue; }

      if (/^\s{0,3}>/.test(line)) {
        var quote = [];
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) { quote.push(lines[i].replace(/^\s{0,3}>\s?/, "")); i++; }
        html += "<blockquote>" + markdown(quote.join(NL)) + "</blockquote>";
        continue;
      }

      if (LIST_ITEM.test(line)) {
        var items = [];
        while (i < lines.length) {
          var lm = LIST_ITEM.exec(lines[i]);
          if (lm) {
            items.push({ indent: lm[1].replace(/\t/g, "    ").length, ordered: /\d/.test(lm[2]), text: lm[3] });
            i++;
          } else if (/^\s+\S/.test(lines[i]) && items.length && !FENCE_OPEN.test(lines[i])) {
            items[items.length - 1].text += NL + lines[i].trim();
            i++;
          } else break;
        }
        html += renderList(items);
        continue;
      }

      if (line.indexOf("|") >= 0 && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].indexOf("-") >= 0) {
        var head = splitRow(line);
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].indexOf("|") >= 0 && !/^\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
        html += "<div class=\"table\"><table><thead><tr>" + head.map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("") + "</tr></thead><tbody>" +
          rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>";
        continue;
      }

      var para = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !startsBlock(lines[i])) { para.push(lines[i]); i++; }
      html += "<p>" + paragraphText(para) + "</p>";
    }
    return html;
  }

  root.harnessRender = { markdown: markdown, highlight: highlight, diff: renderDiff, escape: esc, codeBlock: codeBlock };
}`;

export interface Renderer {
  markdown(source: string): string;
  highlight(code: string, language?: string): string;
  diff(code: string): string;
  escape(text: string): string;
  codeBlock(language: string, code: string): string;
}

// Runs the renderer outside a page, for tests.
export function loadRenderer(): Renderer {
  const root: { harnessRender?: Renderer } = {};
  new Function("root", `(${RENDERER_SOURCE})(root);`)(root);
  return root.harnessRender as Renderer;
}
