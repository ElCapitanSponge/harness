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
    <select id="model" aria-label="Model"></select>
    <button id="new" type="button">New chat</button>
    <button id="lock" type="button">Sign out</button>
  </header>
  <div id="codebar" hidden>
    <select id="device" aria-label="Device"></select>
    <select id="root" aria-label="Project folder"></select>
    <button id="start" class="primary" type="button">Start session</button>
    <select id="past" aria-label="Past sessions"></select>
    <button id="forget" type="button">Delete</button>
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
  var history = [];
  var controller = null;
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

  async function loadModels() {
    var res = await fetch("/v1/models", { headers: authHeaders() });
    if (res.status === 401) throw new Error("That key was not accepted.");
    if (!res.ok) throw new Error(await errorText(res));
    var data = await res.json();
    var select = $("model");
    var previous = select.value;
    select.textContent = "";
    data.data.forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.id + " (" + m.owned_by + ")";
      select.appendChild(opt);
    });
    if (previous) select.value = previous;
  }

  async function connect(candidate) {
    key = candidate;
    try {
      await loadModels();
    } catch (err) {
      key = "";
      throw err;
    }
    try { sessionStorage.setItem("harness-key", key); } catch (e) {}
    show(true);
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
    history = [];
    endSession();
    $("log").textContent = "";
    show(false);
  });

  $("new").addEventListener("click", function () {
    if (mode === "code") { setMode("code"); return; }
    if (controller) controller.abort();
    history = [];
    $("log").textContent = "";
    loadModels().catch(function () {});
  });

  $("stop").addEventListener("click", function () {
    if (mode === "code" && session) {
      fetch("/sessions/" + session.id + "/cancel", { method: "POST", headers: Object.assign({ "content-type": "application/json" }, authHeaders()), body: "{}" }).catch(function () {});
      return;
    }
    if (controller) controller.abort();
  });

  function setBusy(busy) {
    $("go").disabled = busy;
    $("stop").hidden = !busy;
    $("model").disabled = busy;
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

  // Reads a chat completion stream. onDelta gets each piece of the answer; onThought gets the model's reasoning,
  // which some models (Qwen 3.5, for one) stream first, for a long time, before any answer text.
  async function readStream(res, onDelta, onThought) {
    await eachEvent(res, function (payload) {
      if (payload === "[DONE]") return;
      var parsed;
      try { parsed = JSON.parse(payload); } catch (e) { return; }
      if (parsed.error) throw new Error(parsed.error.message || "stream error");
      var delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
      if (delta && delta.reasoning_content && onThought) onThought(delta.reasoning_content);
      if (delta && delta.content) onDelta(delta.content);
    });
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

  function setMode(next) {
    if (controller) controller.abort();
    endSession();
    mode = next;
    history = [];
    $("log").textContent = "";
    $("tab-chat").setAttribute("aria-pressed", String(next === "chat"));
    $("tab-code").setAttribute("aria-pressed", String(next === "code"));
    $("codebar").hidden = next !== "code";
    $("new").textContent = next === "code" ? "New session" : "New chat";
    $("input").placeholder = next === "code" ? "Message (start a session first)" : "Message";
    loadModels()
      .then(function () { return next === "code" ? Promise.all([loadDevices(), loadPast()]) : null; })
      .catch(function (err) { note(err.message || "Could not load.", "msg error"); });
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
    if (event.type === "user") addMessage("you", event.text, "user");
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

  var pastList = [];

  async function loadPast() {
    var res = await fetch("/sessions", { headers: authHeaders() });
    if (!res.ok) return;
    pastList = await res.json();
    var past = $("past");
    past.textContent = "";
    option(past, "", "Past sessions (" + pastList.length + ")");
    pastList.forEach(function (s) {
      option(past, s.id, new Date(s.created).toLocaleString() + " - " + s.device + ":" + s.root + " - " + s.model + (s.deviceConnected ? "" : " (device offline)"));
    });
    if (session) past.value = session.id;
  }

  // Reopens a saved session: its history replays, and it can continue if its device is connected.
  function openPast(id) {
    var info = pastList.filter(function (s) { return s.id === id; })[0];
    if (!info) return;
    endSession();
    $("log").textContent = "";
    session = { id: info.id, model: info.model, cursor: 0 };
    note(info.deviceConnected ? "Resumed. Changes ask for your approval." : "The device " + info.device + " is offline, so this session is read-only until it reconnects.");
    follow(session);
  }

  async function forgetPast() {
    var id = $("past").value;
    if (!id || !window.confirm("Delete this session and its history?")) return;
    var res = await fetch("/sessions/" + id, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) { note(await errorText(res), "msg error"); return; }
    if (session && session.id === id) { endSession(); $("log").textContent = ""; }
    await loadPast();
  }

  async function startSession() {
    if (!$("device").value || !$("root").value) { note("Pick a device and folder first.", "msg error"); return; }
    endSession();
    $("log").textContent = "";
    var res = await fetch("/sessions", {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify({ model: $("model").value, device: $("device").value, root: $("root").value })
    });
    if (!res.ok) { note(await errorText(res), "msg error"); return; }
    var info = await res.json();
    session = { id: info.id, model: info.model, cursor: 0 };
    note("Working on " + info.device + ":" + info.root + " with " + info.model + ". Changes ask for your approval.");
    follow(session);
    $("input").placeholder = "Message";
    $("input").focus();
    loadPast().catch(function () {});
  }

  async function sendCode(text) {
    if (!session) { note("Start a session first.", "msg error"); return; }
    setBusy(true);
    var res = await fetch("/sessions/" + session.id + "/messages", {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify({ text: text })
    });
    if (!res.ok) { setBusy(false); note(await errorText(res), "msg error"); }
  }

  $("tab-chat").addEventListener("click", function () { if (mode !== "chat") setMode("chat"); });
  $("tab-code").addEventListener("click", function () { if (mode !== "code") setMode("code"); });
  $("device").addEventListener("change", fillRoots);
  $("past").addEventListener("change", function () { if ($("past").value) openPast($("past").value); });
  $("forget").addEventListener("click", function () { forgetPast().catch(function (err) { note(err.message || "Could not delete.", "msg error"); }); });
  $("start").addEventListener("click", function () { startSession().catch(function (err) { note(err.message || "Could not start.", "msg error"); }); });

  async function send(text) {
    history.push({ role: "user", content: text });
    addMessage("you", text, "user");
    var body = addMessage($("model").value, "", undefined, true);
    var reply = "";
    controller = new AbortController();
    setBusy(true);
    try {
      var res = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
        body: JSON.stringify({ model: $("model").value, messages: history, stream: true }),
        signal: controller.signal
      });
      if (res.status === 401) throw new Error("The key was rejected. Sign out and enter it again.");
      if (!res.ok) throw new Error(await errorText(res));
      var thought = null;
      await readStream(res, function (piece) {
        if (thought) thought.finish();
        reply += piece;
        streamMarkdown(body, reply);
      }, function (piece) {
        if (!thought) thought = makeThought(body.parentNode, body, false);
        keepScroll(function () { thought.add(piece); });
      });
      if (thought) thought.finish();
      if (reply) flushMarkdown(body, reply);
      if (reply) history.push({ role: "assistant", content: reply });
      else body.textContent = "(empty reply)";
    } catch (err) {
      if (err.name === "AbortError") {
        if (reply) history.push({ role: "assistant", content: reply });
        else history.pop();
      } else {
        history.pop();
        body.parentNode.classList.add("error");
        if (body._timer) { clearTimeout(body._timer); body._timer = null; }
        body.classList.remove("md");
        body.textContent = (reply ? reply + "\n\n" : "") + (err.message || "Request failed.");
      }
    } finally {
      controller = null;
      setBusy(false);
      $("input").focus();
    }
  }

  $("send").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var text = $("input").value.trim();
    if (!text || controller || $("go").disabled) return;
    $("input").value = "";
    $("input").style.height = "";
    if (mode === "code") sendCode(text); else send(text);
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
  });

  show(false);
  if (key) connect(key).catch(function () { try { sessionStorage.removeItem("harness-key"); } catch (e) {} show(false); });
})();
</script>
</body>
</html>
`;
