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
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #151413; --surface: #1f1d1c; --text: #f5f5f4; --muted: #a8a29e; --line: #353230;
      --accent: #60a5fa; --accent-text: #0b1220; --user: #1e293b; --error: #f87171;
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
    <select id="model" aria-label="Model"></select>
    <button id="new" type="button">New chat</button>
    <button id="lock" type="button">Sign out</button>
  </header>
  <div id="log" hidden></div>
  <form id="send" hidden>
    <textarea id="input" rows="1" placeholder="Message" aria-label="Message"></textarea>
    <button id="go" class="primary" type="submit">Send</button>
    <button id="stop" type="button" hidden>Stop</button>
  </form>
</div>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var key = "";
  var history = [];
  var controller = null;

  try { key = sessionStorage.getItem("harness-key") || ""; } catch (e) {}

  function authHeaders() { return { "authorization": "Bearer " + key }; }

  function show(signedIn) {
    $("gate").hidden = signedIn;
    $("top").hidden = !signedIn;
    $("log").hidden = !signedIn;
    $("send").hidden = !signedIn;
    if (signedIn) $("input").focus(); else $("key").focus();
  }

  function addMessage(role, text, cls) {
    var box = document.createElement("div");
    box.className = "msg " + (cls || role);
    var label = document.createElement("div");
    label.className = "role";
    label.textContent = role;
    var body = document.createElement("div");
    body.textContent = text;
    box.appendChild(label);
    box.appendChild(body);
    $("log").appendChild(box);
    $("log").scrollTop = $("log").scrollHeight;
    return body;
  }

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
    $("log").textContent = "";
    show(false);
  });

  $("new").addEventListener("click", function () {
    if (controller) controller.abort();
    history = [];
    $("log").textContent = "";
    loadModels().catch(function () {});
  });

  $("stop").addEventListener("click", function () { if (controller) controller.abort(); });

  function setBusy(busy) {
    $("go").disabled = busy;
    $("stop").hidden = !busy;
    $("model").disabled = busy;
  }

  // Reads an SSE stream and calls onDelta with each piece of text.
  async function readStream(res, onDelta) {
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
          if (!payload || payload === "[DONE]") continue;
          var parsed;
          try { parsed = JSON.parse(payload); } catch (e) { continue; }
          if (parsed.error) throw new Error(parsed.error.message || "stream error");
          var delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
          if (delta && delta.content) onDelta(delta.content);
        }
      }
    }
  }

  async function send(text) {
    history.push({ role: "user", content: text });
    addMessage("you", text, "user");
    var body = addMessage($("model").value, "");
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
      await readStream(res, function (piece) {
        reply += piece;
        body.textContent = reply;
        $("log").scrollTop = $("log").scrollHeight;
      });
      if (reply) history.push({ role: "assistant", content: reply });
      else body.textContent = "(empty reply)";
    } catch (err) {
      if (err.name === "AbortError") {
        if (reply) history.push({ role: "assistant", content: reply });
        else history.pop();
      } else {
        history.pop();
        body.parentNode.classList.add("error");
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
    if (!text || controller) return;
    $("input").value = "";
    $("input").style.height = "";
    send(text);
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
