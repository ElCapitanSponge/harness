---
title: Web experience v2
description: A specification for rebuilding the harness web interface after the first real deployment
status: proposed
---

# Web experience v2

**Status:** proposed. **Source:** the owner's feedback after the first deployment to TrueNAS, 2026-11-01.

The first web page proved the idea: a device connects out, the gateway routes to it, a coding session works on its files. Using it for real showed that it works but does not feel like the tools it should sit beside (Claude Code, ChatGPT, T3 Chat). This document turns that feedback into a plan. Each section ends with the ticket that carries the work.

## 1. The feedback, and what is behind it

| What was said | What is behind it | Ticket |
|---|---|---|
| The desktop's agent showed as connected, but no model could be used | The gateway lists only models that are **loaded** right now, and none was (LM Studio on that machine had nothing loaded). A person expects to pick any model the device has and have it load. Loading from the gateway is also switched off by default on every device. | A |
| Settings mean editing `.env` on every machine | Node settings exist only as environment variables read at start | B |
| Lose the chat or code session on refresh or navigation | Chat history lives in the page's memory. Code sessions are saved on the gateway but the page does not reopen one. There are no addresses (URLs) for conversations. | C |
| The interface should look and work like Claude Code, ChatGPT, T3 Chat | One long script in a string, no sidebar, no model picker in the header, no real composer | D |
| No feedback while the model works before a reply | The page shows nothing until the first token, and a model load or a cold start can take a minute | E |
| Show context total, a per-model breakdown, when to compact; usage overall and per model; time left on the Claude plan | Designed in #26 and #27, not built | F |
| Work on the files of the device I am connecting from, with the harness as the model picker, like Claude Code | A browser cannot read the Mac's files. The flow needs an agent on that Mac, and the page needs to know which device it is being used from. | G, H |
| Documentation needs a great deal of improvement; should feed a wiki or an Astro site later | One long README plus a security page | I |

**Note on one word.** The feedback asks that conversations are "ephemeral" when navigating or refreshing. It is read here as the opposite: they must **survive** navigation and refresh. If ephemeral (disposable) was meant for some conversations, that is a small addition to ticket C (a "temporary chat" that is not saved).

## 2. Principles

1. **Pick a model and go.** The person chooses a model; loading, routing and waiting are the system's job, and it says what it is doing.
2. **The device still owns what it will do.** Making settings editable from the page must not let a compromised gateway turn on commands everywhere (see [ADR 0003](../adr/0003-tools-run-on-the-device-the-gateway-runs-the-loop.md)). Remote configuration is opt-in per device.
3. **A conversation has an address.** Chats and coding sessions are saved on the gateway and open from a URL, so refresh, back and a second browser all work.
4. **No external scripts.** The page keeps its strict content security policy. Anything it needs is built into what the gateway serves.
5. **Documentation ships with the feature.** A ticket is not done until its docs page is written.

## 3. The target experience

```
+--------------------+----------------------------------------------------------+
| [+ New chat]       |  Qwen3.5 9B  v   anakin (loaded)      [ctx 41%] [Claude 62%]|
| [</> New code]     +----------------------------------------------------------+
| Search...          |                                                          |
|                    |  You                                                     |
| Today              |  Why does test.js fail?                                  |
|  Fix sum bug  anakin|                                                         |
|  Plan the docs     |  Qwen3.5 9B                                              |
| Yesterday          |  > Thought for 4s                                        |
|  ...               |  The loop uses <=, so ...                                |
|                    |  ```js ... ```        [Copy]                              |
| Devices            |                                                          |
|  anakin     online +----------------------------------------------------------+
|  bastila    online |  Message...                                              |
|  [Settings]        |  [B][I][</>][list]  [attach]        [Model v]   [Send]   |
+--------------------+----------------------------------------------------------+
```

- **Sidebar:** new chat, new code session, search, history grouped by day, the devices list with status. A drawer on a phone.
- **Header:** the model picker, the device the conversation runs on, a context meter and the Claude usage meter. Selecting either opens its detail panel.
- **Thread:** markdown, code with colours and a copy button, diffs, collapsible thinking, tool calls, approval cards. Already built; kept.
- **Composer:** a growing text area (Enter sends, Shift+Enter makes a new line), markdown shortcuts and a small toolbar (bold, italic, code, code block, list, link), a preview toggle, a stop button while running, drafts that survive refresh. Image attach arrives with #31.
- **Right panel (code sessions):** plan, changed files, tasks (#28 to #30).

**Model picker.** Grouped by device, then by Claude. Each model shows a state: *loaded*, *will load on first use*, *device busy*, *device offline*. The Claude group shows how much of the plan is left and goes grey with a reset time when a limit is hit. A search box filters across devices.

**Feedback while working.** From the moment Send is pressed the thread shows a single status line that changes as things happen, with a running timer: *Sending* → *Routing to anakin* → *Loading Qwen3.5 9B on anakin (14 s)* → *Waiting for the first token* → *Thinking (8 s)* → *Writing*. Errors replace it with a reason and a Retry button.

## 4. Work areas

### A. Model catalogue and loading on demand

- A new catalogue endpoint lists every model every connected device has (loaded or not), with device, context length and whether the device allows loading. `/v1/models` keeps its OpenAI-compatible meaning (loaded models and Claude) so other chat apps are unaffected.
- A chat or session request that names a model that is available but not loaded makes the gateway ask that device to load it, wait, then continue. One load at a time per device; a second request for the same model waits for the first.
- A per-device policy decides what happens to other loaded models: keep them, or unload them first (the default on a 12 GB card, since two models usually will not fit).
- If the device does not allow loading, the picker says so and offers to turn it on (needs B). LM Studio can also load a model itself when a request names it ("just-in-time loading"); the ticket should check whether that is on and whether it can be used instead of, or as well as, an explicit load with a chosen context length.
- Failure is explained: not enough memory, the device went busy (a game started), the model file is missing.

### B. Node settings from the web page

**Settings that move off `.env`:** device name, project roots, allowed tools, remote model control and its policy, Claude on/off and its program path, game processes, the model server address, default context length. The gateway address and key stay local; they are how a device finds the gateway at all.

**How it works.** The gateway keeps the wanted settings per device and sends them down the tunnel. The agent applies them, saves them to a small local file so it starts correctly even when the gateway is down, and reports what is now in effect and any error. Environment variables still work and win: a setting fixed by an environment variable shows as *locked by this device's environment*.

**Trust model (needs a decision record, see §6).** Letting the page change *project roots*, *allowed tools* and *Claude* remotely means a compromised gateway could widen a device's reach, which today it cannot. Proposed: a device accepts remote configuration only if it was started with `REMOTE_CONFIG=1` (one line, set once, or chosen when the agent is installed). Without it the page shows the settings read-only. Every remote change is written to the device's own audit log. A device can be locked again by removing the line.

**Adding a device.** An *Add a device* dialog produces the one command to run on that machine (per operating system), so the first setup is a single paste and everything after is in the page.

### C. Conversations that survive refresh

- One idea, **conversation**, with two kinds: *chat* (no files) and *code* (a device and a project root). Both are saved on the gateway.
- A chat runs the same way a coding session does, without tools: a saved sequence of events that the page follows. That gives chats refresh-survival and *resume while generating* for free: reload mid-answer and the page reattaches to the running reply.
- Every conversation has an address, for example `/#/c/<id>`. The sidebar lists them, newest first, with rename, delete and search.
- The text in the composer is kept per conversation, so a half-written message survives a refresh.
- An optional *temporary chat* is not saved (see the note in §1).

### D. A new application shell

The single-string page cannot carry sidebar, panels, settings, a command palette and tests. Decided: a real front-end package (`packages/web`) built with **Vite, React and TypeScript**, using the **React Compiler**, with output served by the gateway from its own files (the content security policy stays strict and external-script-free). The Docker image gains a build stage. The standards in §8 apply from the first line. The decision is recorded in an ADR (§6).

Because React draws elements rather than HTML strings, the markdown renderer in this package produces React elements instead of HTML text. That removes the need for `dangerouslySetInnerHTML`, which the strict lint rules would forbid, and makes injection through model text structurally impossible rather than a matter of careful escaping.

Includes: the layout in §3, light and dark themes, keyboard shortcuts (new chat, switch model, switch conversation, focus composer, stop), a command palette (Ctrl or Cmd+K), a settings area (devices, models, usage), phone layout, accessibility (focus, labels, contrast), and component tests.

### E. Immediate feedback

The gateway reports stages as they happen: accepted, routed to a device, loading a model (with progress where LM Studio gives it), waiting for the first token, thinking, writing. For chats these travel as extra lines in the event stream that other OpenAI-compatible clients ignore (SSE comments). The page turns them into the status line in §3. A request that cannot be served (no device, device busy) answers within a second with the reason.

### F. Context and usage

- **Context** (extends #26): per conversation, the window of the model in use, tokens used, and a fill bar. A breakdown per model when the model changed mid-conversation. A marker where compaction happens (default 80%), a compact button, and a note in the thread when it ran.
- **Usage:** a ledger of every model call (time, conversation, device, model, prompt tokens, completion tokens, how long it took). A usage page shows totals overall and per model and per device, for today, 7 days and 30 days.
- **Claude plan** (extends #27): the five-hour window and the weekly window, each with percent used, percent left and time to reset, from what the `claude` program reports. If it cannot be read the page says so. While the plan is at its limit Claude is greyed out with the reset time and requests use local models.
- Token counts come from the model server's reported usage (asking for it on streamed requests) and are estimated, and marked as estimated, when it does not give them.

### G. Work on the files of the device you browse from

A browser cannot read the Mac's files, and the browser File System Access API is Chromium-only and cannot run commands, so it is not used. The flow instead is: the Mac runs the agent (installed as a service, #14) with the folders it chooses, and the page works out that *this browser is on that Mac*.

- **Finding "this device".** The gateway compares the address a browser connects from with the address each agent connected from; on a tailnet both are the machine's tailnet address, so they match. This must be checked behind the TrueNAS container's port publishing (whether the real source address is preserved). If it cannot be matched, the person picks *This device is...* once and the page remembers it.
- **One click.** On a device with an agent the sidebar offers *New code session here* with that device's folders (and recent ones). On a device without an agent the page says so and links to the install guide.

### H. Use the pool from Claude Code itself

The gateway also answers the Anthropic Messages API (`/v1/messages`, streaming and tools) so that pointing Claude Code (CLI or desktop) at the gateway with `ANTHROPIC_BASE_URL` makes the harness's models appear in its own model picker, and Claude Code's own file tools, planning and background tasks work on the machine it runs on with a local model behind it. Requests for Claude models pass through to a device that serves Claude. This is the most direct way to get "the whole flow like Claude Code" without rebuilding it. It needs A (model loading) first, and a check of exactly which parts of the Messages API Claude Code uses.

### I. Documentation

Reorganise `docs/` so it reads well on GitHub, can be copied into the GitHub wiki, and can feed an Astro site later (Starlight). Every page has front matter (`title`, `description`, `sidebar.order`) and uses relative links with no GitHub-only features.

```
docs/
  index.md                  what it is, where to start
  getting-started/
    concepts.md             gateway, device, tunnel, session (from the glossary)
    quickstart.md           one machine, ten minutes
  guides/
    truenas.md              the gateway as a TrueNAS app, step by step
    tailscale.md            names, addresses, ACLs
    devices-windows.md  devices-macos.md  devices-linux.md
    claude.md               serving Claude, usage, limits
    coding-sessions.md      roots, tools, approvals, audit log
    models.md               loading, context, choosing
  reference/
    configuration.md        every setting, its default and where it can be set
    cli.md                  every command
    http-api.md             every route
    tunnel-protocol.md      messages between gateway and agent
    web-interface.md        the page, shortcuts
  security.md  troubleshooting.md  contributing.md
  adr/  specs/  glossary.md
```

The README shrinks to an overview and links. A link checker runs in CI. Each feature ticket lists its docs page in its acceptance criteria.

## 5. Order of work

```
A model catalogue and loading  ----+--> E progress feedback --+
B node settings from the page  ----+--> G this device --------+--> (usable day to day)
C conversations that persist  -----+--> D app shell ----------+
#26 context, #27 Claude usage -----------> F context and usage panel
A -----------------------------------------> H Anthropic-compatible endpoint
I documentation: structure first, then a page with every feature
#28 to #31 (panels, plan, tasks, images) land inside D's layout
```

| Letter | Ticket |
|---|---|
| A | #34 Model catalogue and on-demand loading |
| B | #35 Edit node settings from the web page |
| C | #36 Conversations that survive refresh |
| D | #37 Front-end package and application shell, #38 Model picker and composer |
| E | #39 Immediate progress feedback |
| F | #40 Context and usage panels (with #26 and #27) |
| G | #41 Work on the files of the device you browse from |
| H | #42 Anthropic-compatible endpoint |
| I | #43 Documentation structure, #44 Reference documentation and link check |
| Standards | #46 Strict ESLint for the whole repository (comes before the shell, #37) |

The epic is #33.

The shortest route to the reported problem ("I could not use any model") is **A** with the device setting it needs. **C** and **E** are the biggest changes to how it feels. **D** is the largest piece and can start once C and A give it data to show.

## 6. Decisions that need recording

| Decision | Why it needs a record |
|---|---|
| Remote configuration of devices, and how a device opts in (§4 B) | It changes who decides what a device will run |
| A front-end build step: Vite, React, the React Compiler, and the code standards in §8 (§4 D) | It changes how the page is built, served, linted and tested |
| Chats as saved event streams, one conversation model (§4 C) | It changes what the gateway stores |
| Which Messages API features the Claude Code endpoint supports (§4 H) | A compatibility promise |

## 8. Code standards

These apply to the new front-end package from its first commit and, through their own ticket, to the rest of the repository.

**Tools (checked against the npm registry on 2026-11-01).** Vite 8, React 19, `@vitejs/plugin-react` 6, `babel-plugin-react-compiler` 1.0 (stable), ESLint 10 with typescript-eslint 8, `eslint-plugin-react-hooks` 7 (its recommended set includes the rules powered by the React Compiler, which replace the separate `eslint-plugin-react-compiler`), `eslint-plugin-react`, `eslint-plugin-jsx-a11y`. There is no Prettier.

**React Compiler.** Enabled for every component. With Vite 8 and plugin-react 6 there are two ways to run it: a native build (`react({ compiler: true })`, which the plugin marks experimental) or the official Babel plugin through `@rolldown/plugin-babel` and its `reactCompilerPreset` helper. The Babel route is proposed because it is the stable compiler. The ticket confirms the choice with a build. Compiler diagnostics fail the build, so code the compiler cannot optimise is fixed rather than silently left slow.

**ESLint, flat config, strict.**

| Rule | Setting |
|---|---|
| Base | typescript-eslint `strictTypeChecked` and `stylisticTypeChecked`, with type information (`projectService`) |
| `any` | `@typescript-eslint/no-explicit-any` as an error, and the `no-unsafe-*` rules, so an `any` cannot arrive from elsewhere either |
| `var` | `no-var` and `prefer-const` as errors |
| Functions | arrow functions only: `func-style: expression`, `prefer-arrow-callback`, and a restriction on function declarations and function expressions. Exceptions that cannot be arrows: class methods, constructors, and generators (`function*`) |
| Function bodies | arrow functions may use a concise body. If every arrow must use braces (`() => {}`), set `arrow-body-style` to `always`; this is one line to change |
| Hooks | `eslint-plugin-react-hooks` recommended: rules of hooks, exhaustive dependencies, and the compiler rules |
| React | `eslint-plugin-react` with the JSX runtime config; `react/no-danger` as an error |
| Accessibility | `eslint-plugin-jsx-a11y` strict |
| Imports | `consistent-type-imports`, `no-non-null-assertion`, `no-floating-promises`, `no-misused-promises` |
| Formatting | enforced by ESLint itself with `@stylistic/eslint-plugin` (the repository's current style: two spaces, double quotes, semicolons, trailing commas), not a separate formatter |
| Warnings | none: a rule is an error or it is off |

`pnpm lint` runs in CI and fails on any error. Existing code is measured against the same rules (about 97 function declarations and expressions, 3 generators, 1 `any`, no `var` at the time of writing), and the migration is its own ticket so that it does not hide inside a feature.

## 7. Open questions

- Is a *temporary chat* wanted (§1 note)?
- Should loading a model unload the others on that device by default? (Proposed: yes.)
- For the Anthropic endpoint, which Claude Code models should the local models appear as, since Claude Code expects Claude model names?
- Are there other devices than the Mac, the desktop and the TrueNAS box that the "this device" detection must handle (a phone, for instance, has no agent)?
