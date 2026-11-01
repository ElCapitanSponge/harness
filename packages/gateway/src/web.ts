import { RENDERER_SOURCE } from "./renderer.js";

// A single self-contained page: no external scripts, styles or fonts. It carries no secrets, so it is served
// without auth; the API key is typed into it and sent only as a header to this same origin.
export const WEB_PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Harness chat</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #fafaf9; --surface: #ffffff; --text: #1c1917; --muted: #78716c; --line: #e7e5e4;
    --accent: #2563eb; --accent-text: #ffffff; --user: #eff6ff; --error: #b91c1c;
    --code-bg: #f5f5f4; --tk-k: #7c3aed; --tk-s: #15803d; --tk-c: #78716c; --tk-n: #c2410c; --tk-p: #1d4ed8; --tk-f: #a16207;
    --diff-add: #dcfce7; --diff-del: #fee2e2; --diff-hunk: #e0e7ff;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #151413; --surface: #1f1d1c; --text: #f5f5f4; --muted: #a8a29e; --line: #353230;
      --accent: #60a5fa; --accent-text: #0b1220; --user: #1e293b; --error: #f87171;
      --code-bg: #12100f; --tk-k: #c4b5fd; --tk-s: #86efac; --tk-c: #a8a29e; --tk-n: #fdba74; --tk-p: #93c5fd; --tk-f: #fde68a;
      --diff-add: #14532d; --diff-del: #7f1d1d; --diff-hunk: #312e81;
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
  .app { display: flex; flex-direction: column; height: 100%; max-width: 820px; margin: 0 auto; }
  header { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--line); }
  header h1 { font-size: 16px; margin: 0; }
  select, input, textarea, button { font: inherit; color: inherit; }
  select, input, textarea { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
  select { flex: 1 1 10rem; min-width: 0; }
  button { white-space: nowrap; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; cursor: pointer; }
  button.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
  button:disabled { opacity: .5; cursor: default; }
  #log { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .msg { padding: 10px 12px; border-radius: 10px; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--line); background: var(--surface); }
  .msg.user { background: var(--user); }
  .msg.error { color: var(--error); }
  .tabs { display: flex; gap: 4px; }
  .tabs button[aria-pressed="true"] { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
  #codebar { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--line); }
  #codebar select { flex: 1 1 8rem; }
  .tool { font: 13px/1.4 ui-monospace, monospace; color: var(--muted); padding: 0 4px; overflow-wrap: anywhere; }
  .approval { border: 1px solid var(--accent); border-radius: 10px; padding: 10px 12px; background: var(--surface); }
  .approval .summary { font: 14px/1.4 ui-monospace, monospace; overflow-wrap: anywhere; margin: 4px 0 8px; }
  .approval .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .approval.answered .actions { display: none; }
  .note { color: var(--muted); font-size: 14px; }
  .md { white-space: normal; overflow-wrap: anywhere; }
  .md > :first-child { margin-top: 0; }
  .md > :last-child { margin-bottom: 0; }
  .md p, .md ul, .md ol, .md blockquote, .md .code, .md .table { margin: 0 0 10px; }
  .md h1, .md h2, .md h3, .md h4 { margin: 14px 0 6px; line-height: 1.25; }
  .md h1 { font-size: 20px; } .md h2 { font-size: 18px; } .md h3 { font-size: 16px; } .md h4, .md h5, .md h6 { font-size: 15px; }
  .md ul, .md ol { padding-left: 22px; }
  .md blockquote { border-left: 3px solid var(--line); padding-left: 12px; color: var(--muted); }
  .md hr { border: 0; border-top: 1px solid var(--line); margin: 12px 0; }
  .md a { color: var(--accent); }
  .md code { background: var(--code-bg); border-radius: 4px; padding: 1px 5px; font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .md .table { overflow-x: auto; }
  .md table { border-collapse: collapse; font-size: 14px; }
  .md th, .md td { border: 1px solid var(--line); padding: 4px 8px; text-align: left; }
  .code { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--code-bg); }
  .code-head { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--line); }
  .code-head button { padding: 2px 8px; font-size: 12px; }
  .code pre { margin: 0; padding: 10px 12px; overflow-x: auto; }
  .code pre code { background: none; padding: 0; font-size: 13px; white-space: pre; }
  .tk-k { color: var(--tk-k); } .tk-s { color: var(--tk-s); } .tk-c { color: var(--tk-c); font-style: italic; }
  .tk-n { color: var(--tk-n); } .tk-p { color: var(--tk-p); } .tk-f { color: var(--tk-f); }
  code.diff { display: block; }
  code.diff span { display: block; padding: 0 4px; min-width: max-content; }
  .d-add { background: var(--diff-add); } .d-del { background: var(--diff-del); } .d-hunk { background: var(--diff-hunk); color: var(--muted); } .d-meta { color: var(--muted); }
  .thought { color: var(--muted); font-size: 13px; margin-bottom: 6px; }
  .thought div { white-space: pre-wrap; overflow-wrap: anywhere; }
  .role { font-size: 12px; color: var(--muted); margin-bottom: 2px; }
  form#send { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--line); }
  form#send textarea { flex: 1; resize: none; max-height: 40vh; }
  #gate { margin: auto; padding: 24px 16px; width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 12px; }
  #gate h1 { margin: 0; }
  #gate p { margin: 0; color: var(--muted); }
  #gate .err { color: var(--error); min-height: 1.5em; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<div class="app">
  <form id="gate" autocomplete="off">
    <h1>Harness</h1>
    <p>Enter the gateway key to continue. It is kept for this browser tab only.</p>
    <input id="key" type="password" placeholder="API key" autocomplete="off" required>
    <button class="primary" type="submit">Connect</button>
    <div class="err" id="gate-err" role="alert"></div>
  </form>

  <header id="top" hidden>
    <h1>Harness</h1>
    <div class="tabs" role="group" aria-label="Mode">
      <button id="tab-chat" type="button" aria-pressed="true">Chat</button>
      <button id="tab-code" type="button" aria-pressed="false">Code</button>
    </div>
    <select id="past" aria-label="Conversations"></select>
    <select id="model" aria-label="Model"></select>
    <button id="new" type="button">New</button>
    <button id="rename" type="button" disabled>Rename</button>
    <button id="forget" type="button" disabled>Delete</button>
    <button id="lock" type="button">Sign out</button>
  </header>
  <div id="codebar" hidden>
    <select id="device" aria-label="Device"></select>
    <select id="root" aria-label="Project folder"></select>
    <button id="start" class="primary" type="button">Start session</button>
  </div>
  <div id="log" hidden></div>
  <form id="send" hidden>
    <textarea id="input" rows="1" placeholder="Message" aria-label="Message"></textarea>
    <button id="go" class="primary" type="submit">Send</button>
    <button id="stop" type="button" hidden>Stop</button>
  </form>
</div>
<script>(${RENDERER_SOURCE})(window);</script>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var key = "";
  var mode = "chat";
  var session = null;
  var follower = null;
  var cards = {};
  // The model call in progress in a coding session: its thinking block and the reply being written.
  var live = { thought: null, body: null, reply: "" };
  var nodes = [];

  try { key = sessionStorage.getItem("harness-key") || ""; } catch (e) {}

  function authHeaders() { return { "authorization": "Bearer " + key }; }

  function show(signedIn) {
    $("gate").hidden = signedIn;
    $("top").hidden = !signedIn;
    $("codebar").hidden = !signedIn || mode !== "code";
    $("log").hidden = !signedIn;
    $("send").hidden = !signedIn;
    if (signedIn) $("input").focus(); else $("key").focus();
  }

  // A collapsible block for a model's reasoning. While it is still thinking the title counts the seconds, so a long
  // silence reads as work in progress. Pass keepStatic for reasoning that already happened (a reopened session).
  function makeThought(parent, before, keepStatic) {
    var details = document.createElement("details");
    details.className = "thought";
    details.open = !keepStatic;
    var title = document.createElement("summary");
    var text = document.createElement("div");
    details.appendChild(title);
    details.appendChild(text);
    parent.insertBefore(details, before || null);
    var started = Date.now();
    var timer = null;
    var finished = Boolean(keepStatic);
    function label() {
      var seconds = Math.max(0, Math.round((Date.now() - started) / 1000));
      title.textContent = finished ? (keepStatic ? "Thinking" : "Thought for " + seconds + "s") : "Thinking... " + seconds + "s";
    }
    label();
    if (!finished) timer = setInterval(label, 1000);
    return {
      add: function (piece) { text.textContent += piece; },
      set: function (full) { text.textContent = full; },
      finish: function () {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        label();
        details.open = false;
      }
    };
  }

  // Runs a change to the log and then, only if the reader was already at the bottom, keeps them there. Someone who has
  // scrolled up to read is not pulled back down by every new token.
  function keepScroll(change) {
    var log = $("log");
    var stuck = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    change();
    if (stuck) log.scrollTop = log.scrollHeight;
  }

  function showMarkdown(el, text) {
    el.classList.add("md");
    el.innerHTML = window.harnessRender.markdown(text);
  }

  // Re-rendering a long reply on every token would be wasteful, so streamed updates are batched a few times a second.
  function streamMarkdown(el, text) {
    el._text = text;
    if (el._timer) return;
    el._timer = setTimeout(function () {
      el._timer = null;
      keepScroll(function () { showMarkdown(el, el._text); });
    }, 60);
  }

  function flushMarkdown(el, text) {
    if (el._timer) { clearTimeout(el._timer); el._timer = null; }
    keepScroll(function () { showMarkdown(el, text); });
  }

  function addMessage(role, text, cls, markdown) {
    var box = document.createElement("div");
    box.className = "msg " + (cls || role);
    var label = document.createElement("div");
    label.className = "role";
    label.textContent = role;
    var body = document.createElement("div");
    if (markdown && text) showMarkdown(body, text);
    else body.textContent = text;
    box.appendChild(label);
    box.appendChild(body);
    keepScroll(function () { $("log").appendChild(box); });
    return body;
  }

  document.addEventListener("click", function (ev) {
    var button = ev.target && ev.target.closest ? ev.target.closest("button.copy") : null;
    if (!button) return;
    var text = button.closest(".code").querySelector("pre").textContent;
    function done() {
      button.textContent = "Copied";
      setTimeout(function () { button.textContent = "Copy"; }, 1500);
    }
    function fallback() {
      var area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try { if (document.execCommand("copy")) done(); } catch (e) {}
      area.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  });

  async function errorText(res) {
    try {
      var data = await res.json();
      var e = data && data.error;
      return (e && (e.message || JSON.stringify(e))) || ("HTTP " + res.status);
    } catch (e) { return "HTTP " + res.status; }
  }

  // What choosing a model will do, in a few words, for the picker.
  function stateLabel(m) {
    if (m.state === "loaded") return "";
    if (m.state === "loads-on-use") return " - loads when used";
    if (m.state === "busy") return " - busy" + (m.busyReason ? " (" + m.busyReason + ")" : "");
    return " - cannot load here";
  }

  function addOption(group, value, label, disabled) {
    var opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    opt.disabled = Boolean(disabled);
    group.appendChild(opt);
  }

  // Lists every model on every device, grouped by device, whether or not it is loaded: choosing one that is not loaded
  // loads it on that device. Claude is listed while a device that is logged in to it is connected.
  async function loadModels() {
    var res = await fetch("/catalogue", { headers: authHeaders() });
    if (res.status === 401) throw new Error("That key was not accepted.");
    if (!res.ok) throw new Error(await errorText(res));
    var data = await res.json();
    var select = $("model");
    var previous = select.value;
    select.textContent = "";
    var groups = {};
    data.models.forEach(function (m) {
      var group = groups[m.device];
      if (!group) {
        group = document.createElement("optgroup");
        group.label = m.device;
        groups[m.device] = group;
        select.appendChild(group);
      }
      addOption(group, m.id, m.id + stateLabel(m), m.state === "busy" || m.state === "cannot-load");
    });
    if (data.claude.available) {
      var claudeGroup = document.createElement("optgroup");
      claudeGroup.label = "Claude (through " + data.claude.device + ")";
      data.claude.models.forEach(function (id) { addOption(claudeGroup, id, id, false); });
      select.appendChild(claudeGroup);
    }
    if (!select.options.length) {
      addOption(select, "", "No models: connect a device", true);
      return;
    }
    if (previous) select.value = previous;
    // Never leave a model that cannot be used selected.
    if (!select.value || (select.selectedOptions[0] && select.selectedOptions[0].disabled)) {
      for (var i = 0; i < select.options.length; i++) {
        if (!select.options[i].disabled) { select.value = select.options[i].value; break; }
      }
    }
  }

  async function connect(candidate) {
    key = candidate;
    try {
      await loadModels();
      await loadConversations();
    } catch (err) {
      key = "";
      throw err;
    }
    try { sessionStorage.setItem("harness-key", key); } catch (e) {}
    show(true);
    // An address like #/c/<id> opens that conversation, so a refresh or a shared link lands where it was.
    var wanted = idFromHash();
    if (wanted) await openConversation(wanted);
  }

  $("gate").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    $("gate-err").textContent = "";
    var value = $("key").value;
    $("key").value = "";
    try { await connect(value); } catch (err) { $("gate-err").textContent = err.message || "Could not connect."; }
  });

  $("lock").addEventListener("click", function () {
    try { sessionStorage.removeItem("harness-key"); } catch (e) {}
    key = "";
    closeConversation();
    show(false);
  });

  $("new").addEventListener("click", function () {
    closeConversation();
    $("input").focus();
  });

  $("stop").addEventListener("click", function () {
    if (!session) return;
    fetch("/sessions/" + session.id + "/cancel", { method: "POST", headers: Object.assign({ "content-type": "application/json" }, authHeaders()), body: "{}" }).catch(function () {});
  });

  function setBusy(busy) {
    $("go").disabled = busy;
    $("stop").hidden = !busy;
    $("model").disabled = busy || Boolean(session);
  }

  // Calls onData with the payload of each server-sent event in a response body.
  async function eachEvent(res, onData) {
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    for (;;) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var events = buffer.split("\n\n");
      buffer = events.pop();
      for (var i = 0; i < events.length; i++) {
        var lines = events[i].split("\n");
        for (var j = 0; j < lines.length; j++) {
          if (lines[j].indexOf("data:") !== 0) continue;
          var payload = lines[j].slice(5).trim();
          if (payload) onData(payload);
        }
      }
    }
  }

  function note(text, cls) {
    var el = document.createElement("div");
    el.className = cls || "note";
    el.textContent = text;
    $("log").appendChild(el);
    $("log").scrollTop = $("log").scrollHeight;
    return el;
  }

  function endSession() {
    clearWaiting();
    if (follower) follower.abort();
    follower = null;
    session = null;
    cards = {};
    setBusy(false);
  }

  function option(select, value, label, disabled) {
    var opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    opt.disabled = Boolean(disabled);
    select.appendChild(opt);
  }

  function fillRoots() {
    var root = $("root");
    root.textContent = "";
    var node = nodes.filter(function (n) { return n.nodeId === $("device").value; })[0];
    ((node && node.roots) || []).forEach(function (r) { option(root, r, r); });
  }

  async function loadDevices() {
    var res = await fetch("/nodes", { headers: authHeaders() });
    if (!res.ok) throw new Error(await errorText(res));
    nodes = (await res.json()).filter(function (n) { return n.roots && n.roots.length; });
    var device = $("device");
    device.textContent = "";
    nodes.forEach(function (n) { option(device, n.nodeId, n.nodeId); });
    fillRoots();
    if (!nodes.length) note("No connected device exposes a project folder. Set PROJECT_ROOTS on a device's node agent.");
    // Claude models cannot drive a coding session through the gateway yet.
    var model = $("model");
    var firstUsable = null;
    for (var i = 0; i < model.options.length; i++) {
      var local = model.options[i].value.indexOf("claude") !== 0;
      model.options[i].disabled = !local;
      if (local && !firstUsable) firstUsable = model.options[i].value;
    }
    if (model.selectedOptions[0] && model.selectedOptions[0].disabled && firstUsable) model.value = firstUsable;
    if (!firstUsable) note("No local model is loaded. Load one on a device first.");
  }

  function answer(id, approve, always) {
    fetch("/sessions/" + session.id + "/approvals/" + id, {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify({ approve: approve, always: always })
    }).catch(function () {});
  }

  function approvalCard(event) {
    var card = document.createElement("div");
    card.className = "approval";
    var title = document.createElement("div");
    title.className = "role";
    title.textContent = "approval needed: " + event.tool;
    var summary = document.createElement("div");
    summary.className = "summary";
    summary.textContent = event.summary;
    var actions = document.createElement("div");
    actions.className = "actions";
    [["Allow", true, false, "primary"], ["Always allow " + event.tool, true, true, ""], ["Decline", false, false, ""]].forEach(function (a) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = a[0];
      if (a[3]) b.className = a[3];
      b.addEventListener("click", function () { answer(event.id, a[1], a[2]); });
      actions.appendChild(b);
    });
    card.appendChild(title);
    card.appendChild(summary);
    card.appendChild(actions);
    $("log").appendChild(card);
    $("log").scrollTop = $("log").scrollHeight;
    cards[event.id] = { card: card, summary: summary };
  }

  function endLive() {
    if (live.thought) live.thought.finish();
    live = { thought: null, body: null, reply: "" };
  }

  function render(event) {
    if (event.type !== "user") clearWaiting();
    if (event.type === "user") {
      addMessage("you", event.text, "user");
      if (sending) {
        sending = false;
        startWaiting(session.model);
      }
    }
    else if (event.type === "thinking-delta") {
      if (!live.thought) live.thought = makeThought($("log"), null, false);
      live.thought.add(event.text);
    } else if (event.type === "text-delta") {
      if (live.thought) live.thought.finish();
      if (!live.body) live.body = addMessage(session.model, "", undefined, true);
      live.reply += event.text;
      streamMarkdown(live.body, live.reply);
    } else if (event.type === "thinking") {
      // The finished reasoning. If it streamed in live, keep that block; if the session was reopened, show it collapsed.
      if (live.thought) live.thought.set(event.text);
      else makeThought($("log"), null, true).set(event.text);
    } else if (event.type === "text") {
      if (live.body) flushMarkdown(live.body, event.text);
      else addMessage(session.model, event.text, undefined, true);
      endLive();
    }
    else if (event.type === "tool") { endLive(); note("> " + event.summary, "tool"); }
    else if (event.type === "approval") approvalCard(event);
    else if (event.type === "approval-resolved") {
      var c = cards[event.id];
      if (c) {
        c.card.classList.add("answered");
        c.summary.textContent += event.approved ? "  (allowed)" : "  (declined)";
      }
    } else if (event.type === "done") {
      endLive();
      setBusy(false);
      loadConversations().catch(function () {});
      if (event.declined) note("Declined. Nothing was changed. Tell me what to do instead.");
      else if (event.stopped) note("Stopped at the step limit. Say continue to go on.");
    } else if (event.type === "cancelled") {
      endLive();
      setBusy(false);
      note("Cancelled.");
    } else if (event.type === "error") {
      endLive();
      setBusy(false);
      note(event.message, "msg error");
    }
    $("log").scrollTop = $("log").scrollHeight;
  }

  // Follows the session's events, resuming from where it left off if the connection drops.
  async function follow(s) {
    var abort = new AbortController();
    follower = abort;
    while (session === s && !abort.signal.aborted) {
      try {
        var res = await fetch("/sessions/" + s.id + "/events?from=" + s.cursor, { headers: authHeaders(), signal: abort.signal });
        if (res.status === 404) {
          note("This session no longer exists.", "msg error");
          endSession();
          return;
        }
        if (!res.ok) throw new Error(await errorText(res));
        await eachEvent(res, function (payload) {
          var event;
          try { event = JSON.parse(payload); } catch (e) { return; }
          if (!/-delta$/.test(event.type)) s.cursor++;
          render(event);
        });
      } catch (err) {
        if (abort.signal.aborted) return;
      }
      await new Promise(function (r) { setTimeout(r, 1500); });
    }
  }

  // ---- conversations: chats and coding sessions are saved on the gateway and open from an address --------------------------

  var convos = [];
  var waiting = null;
  var sending = false;

  function convoLabel(c) {
    var label = (c.kind === "chat" ? "Chat" : "Code") + " - " + (c.title || "New conversation");
    if (c.kind === "code") label += " (" + c.device + ":" + c.root + (c.deviceConnected ? "" : ", device offline") + ")";
    return label;
  }

  async function loadConversations() {
    var res = await fetch("/sessions", { headers: authHeaders() });
    if (!res.ok) throw new Error(await errorText(res));
    convos = await res.json();
    var select = $("past");
    select.textContent = "";
    option(select, "", convos.length ? "Conversations (" + convos.length + ")" : "No conversations yet");
    convos.forEach(function (c) { option(select, c.id, convoLabel(c)); });
    select.value = session ? session.id : "";
    $("rename").disabled = !session;
    $("forget").disabled = !session;
  }

  function idFromHash() {
    var m = /^#\/c\/([0-9a-f-]{36})$/.exec(window.location.hash);
    return m ? m[1] : "";
  }

  function setHash(id) {
    window.history.replaceState(null, "", id ? "#/c/" + id : window.location.pathname + window.location.search);
  }

  // What was typed and not sent is kept for each conversation, so a refresh does not lose it.
  function draftKey() { return "harness-draft-" + (session ? session.id : "new"); }
  function saveDraft() {
    try {
      if ($("input").value) localStorage.setItem(draftKey(), $("input").value);
      else localStorage.removeItem(draftKey());
    } catch (e) {}
  }
  function restoreDraft() {
    var text = "";
    try { text = localStorage.getItem(draftKey()) || ""; } catch (e) {}
    $("input").value = text;
    $("input").style.height = "";
  }

  function startWaiting(label) {
    clearWaiting();
    var el = note("", "note");
    var started = Date.now();
    function tick() { el.textContent = "Waiting for " + label + "... " + Math.round((Date.now() - started) / 1000) + "s"; }
    tick();
    waiting = { el: el, timer: setInterval(tick, 1000) };
  }

  function clearWaiting() {
    if (!waiting) return;
    clearInterval(waiting.timer);
    if (waiting.el.parentNode) waiting.el.parentNode.removeChild(waiting.el);
    waiting = null;
  }

  // Shows the Chat or Code controls. The model list is reloaded because coding sessions cannot use Claude.
  async function applyMode(next) {
    mode = next;
    $("tab-chat").setAttribute("aria-pressed", String(next === "chat"));
    $("tab-code").setAttribute("aria-pressed", String(next === "code"));
    $("codebar").hidden = next !== "code";
    $("input").placeholder = next === "code" && !session ? "Message (start a session first)" : "Message";
    await loadModels();
    if (next === "code") await loadDevices();
  }

  // Leaves the open conversation (it stays saved) and goes back to an empty one.
  function closeConversation() {
    endSession();
    $("log").textContent = "";
    setHash("");
    restoreDraft();
    loadConversations().catch(function () {});
  }

  async function openConversation(id) {
    var info = convos.filter(function (c) { return c.id === id; })[0];
    if (!info) {
      await loadConversations();
      info = convos.filter(function (c) { return c.id === id; })[0];
    }
    if (!info) {
      note("That conversation no longer exists.", "msg error");
      setHash("");
      return;
    }
    endSession();
    $("log").textContent = "";
    if (info.kind !== mode) await applyMode(info.kind);
    session = { id: info.id, model: info.model, cursor: 0, kind: info.kind };
    var known = Array.prototype.some.call($("model").options, function (o) { return o.value === info.model; });
    if (known) $("model").value = info.model;
    setHash(info.id);
    if (info.kind === "code" && !info.deviceConnected) note("The device " + info.device + " is offline, so this conversation is read-only until it reconnects.");
    follow(session);
    setBusy(info.busy);
    restoreDraft();
    await loadConversations();
  }

  async function createConversation(body) {
    var res = await fetch("/sessions", {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      note(await errorText(res), "msg error");
      return false;
    }
    var info = await res.json();
    session = { id: info.id, model: info.model, cursor: 0, kind: info.kind };
    setHash(info.id);
    follow(session);
    loadConversations().catch(function () {});
    return true;
  }

  async function startSession() {
    if (!$("device").value || !$("root").value) { note("Pick a device and folder first.", "msg error"); return; }
    endSession();
    $("log").textContent = "";
    if (!(await createConversation({ model: $("model").value, device: $("device").value, root: $("root").value }))) return;
    note("Working on " + $("device").value + ":" + $("root").value + " with " + session.model + ". Changes ask for your approval.");
    $("input").placeholder = "Message";
    $("input").focus();
  }

  // A chat starts with its first message; a coding session has to be started on a device first.
  async function sendText(text) {
    if (!session) {
      if (mode === "code") { note("Start a session first.", "msg error"); return; }
      if (!$("model").value) { note("Pick a model first.", "msg error"); return; }
      $("log").textContent = "";
      if (!(await createConversation({ model: $("model").value }))) return;
    }
    sending = true;
    setBusy(true);
    var res = await fetch("/sessions/" + session.id + "/messages", {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify({ text: text })
    });
    if (!res.ok) {
      sending = false;
      setBusy(false);
      note(await errorText(res), "msg error");
    }
  }

  $("tab-chat").addEventListener("click", function () { if (mode !== "chat") { closeConversation(); applyMode("chat").catch(function (err) { note(err.message || "Could not load.", "msg error"); }); } });
  $("tab-code").addEventListener("click", function () { if (mode !== "code") { closeConversation(); applyMode("code").catch(function (err) { note(err.message || "Could not load.", "msg error"); }); } });
  $("device").addEventListener("change", fillRoots);
  $("past").addEventListener("change", function () {
    var id = $("past").value;
    if (!id) { closeConversation(); return; }
    openConversation(id).catch(function (err) { note(err.message || "Could not open it.", "msg error"); });
  });
  window.addEventListener("hashchange", function () {
    var id = idFromHash();
    if (id && (!session || session.id !== id)) openConversation(id).catch(function () {});
  });
  $("rename").addEventListener("click", function () {
    if (!session) return;
    var current = (convos.filter(function (c) { return c.id === session.id; })[0] || {}).title || "";
    var title = window.prompt("Rename this conversation", current);
    if (!title || !title.trim()) return;
    fetch("/sessions/" + session.id, {
      method: "PATCH",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify({ title: title.trim() })
    }).then(function (res) {
      if (!res.ok) return errorText(res).then(function (m) { note(m, "msg error"); });
      return loadConversations();
    }).catch(function (err) { note(err.message || "Could not rename.", "msg error"); });
  });
  $("forget").addEventListener("click", function () {
    if (!session || !window.confirm("Delete this conversation and its history?")) return;
    fetch("/sessions/" + session.id, { method: "DELETE", headers: authHeaders() }).then(function (res) {
      if (!res.ok) return errorText(res).then(function (m) { note(m, "msg error"); });
      try { localStorage.removeItem(draftKey()); } catch (e) {}
      closeConversation();
    }).catch(function (err) { note(err.message || "Could not delete.", "msg error"); });
  });
  $("start").addEventListener("click", function () { startSession().catch(function (err) { note(err.message || "Could not start.", "msg error"); }); });

  $("send").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var text = $("input").value.trim();
    if (!text || $("go").disabled) return;
    try { localStorage.removeItem(draftKey()); } catch (e) {}
    $("input").value = "";
    $("input").style.height = "";
    sendText(text).catch(function (err) {
      sending = false;
      clearWaiting();
      setBusy(false);
      note(err.message || "Could not send.", "msg error");
    });
  });

  $("input").addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      $("send").requestSubmit();
    }
  });

  $("input").addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, window.innerHeight * 0.4) + "px";
    saveDraft();
  });

  show(false);
  if (key) connect(key).catch(function () { try { sessionStorage.removeItem("harness-key"); } catch (e) {} show(false); });
})();
</script>
</body>
</html>
`;
