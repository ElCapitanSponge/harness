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
| Work on the files of the device I am connecting from, with the harness as the model picker, like Claude Code | A browser cannot read the Mac's files. The flow needs an agent on that Mac, and the page needs to know which device it is being used from. | G, K |
| Keep the Claude Code workflow (desktop most, CLI on Linux) on the home network and over Tailscale, with local models as well as Claude | The harness already serves both. The tooling around it (the app, the portal, the approvals) is what needs work. Running through Claude Code itself is not wanted (§4 H). | D to G, K, L |
| Own app and web portal, both able to configure selected agents; the family will use it later | More than one person means accounts, roles and per-person history | J, K |
| Take inspiration from PewDiePie's interface | Its reported ideas (several models answering and voting, many small models at once) fit a pool of models | M |
| The confirmation flow needs work | Approvals are a plain Allow or Decline card | L |
| The harness must work with the skills used in Claude Code and other AI chats; the owner relies heavily on Matt Pocock's skills | Sessions know nothing about skills, project instruction files, sub-agents or structured questions, which those skills lean on | N |
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

The owner has confirmed that remote configuration of selected agents is wanted from both the web portal and the desktop app, and is comfortable with it as the main user. "Selected" is what the opt-in line gives. Once there are other people (J), only the owner role can change a device's settings.

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

### H. Not planned: running through Claude Code itself

The idea was an Anthropic-compatible endpoint (`/v1/messages`) so that Claude Code could use the pool's models. **The owner does not want to run through Claude Code**: Claude is already reachable through the harness, and the harness's own tooling is what needs the work. The ticket (#42) is closed as not planned.

What was learned in a short test on 2026-11-01, kept here so it is not repeated:

- LM Studio already answers the Anthropic Messages API for a loaded model, in the right format.
- Claude Code 2.1.302 refused to use a local model by name, with an `unrecognized_model` error before sending anything, whether the name was given with `--model`, through the model alias settings, or as a Claude-style alias. Published gateway guides say it should accept any name, so something else in that setup (likely the isolated, logged-out configuration used for the test) was the cause. It was not investigated further.

If this is wanted later, start from that test.

### J. The family

The harness has one shared key today. With more people it needs people.

- **Sign-in.** Preferred: through Tailscale's own identity. Behind `tailscale serve` the gateway is told who the person is, so there is no password and no key to hand out, and it only works on the tailnet. For the home network without Tailscale, local accounts with a password. The choice is recorded (§6).
- **Roles.** *Owner* (everything, including device settings and keys), *family* (chat and coding sessions on the devices and models the owner allows), and optionally *restricted* (chat with local models only, no commands, no Claude).
- **Per-person things:** conversation history (private by default, shareable), usage, a default model, and which devices and tools they may use. The Claude plan is the owner's, so spending it is a permission, and the usage meter shows who used what.
- **Safety for the others:** a coding session never gets more than the person's role, whatever the device allows.

### K. The desktop app

An app with the web interface in its own window and, built in, the node agent for that machine. That removes the hardest part of "work on the files of the device I am on": the app *is* the device, so it already knows its own name, can choose folders with the operating system's folder picker, can start at login, and can be configured from the portal like any other agent. The same interface also stays available as the web portal for any browser.

Electron or Tauri is a decision to record (§6). The agent is Node, which favours Electron; Tauri is smaller. Windows and macOS first, Linux after (the CLI covers Linux today, which is how the owner uses it there).

### L. Permission modes and approval cards

The confirmation flow becomes what Claude Code's desktop app taught people to expect:

- **Modes** per conversation: *ask before every change*, *accept file edits* (still ask for commands), *plan first* (read-only until the plan is approved), and *run without asking* (clearly marked, never the default, and only where the device and role allow it).
- **Approval cards** show what will happen: the diff for an edit, the full command with its folder, the file for a write. Buttons: allow, allow for this conversation, allow always in this project, decline with a reason that goes back to the model.
- **Rules** remembered per project (for example, always allow `pnpm test`), listed and removable in settings.
- Approvals reach the person wherever they are: a notification when the page is in the background.

### M. Multi-model modes

Ideas taken from PewDiePie's self-hosted "ChatOS" (as reported by news coverage; the original was not watched): several models answer the same question and the best answer wins, and many small models working at once. They suit a pool of models, and they are optional.

- **Compare:** send one message to two or three chosen models and show the answers side by side.
- **Council:** several models answer, then one model acts as judge (or the models vote) and the page shows the winner with the others one click away.
- **Swarm:** many small models on one task, results gathered. Later, and only if it proves useful.
- Each mode shows how long each model took and what it cost in tokens, so the person can see whether it was worth it.

### N. Skills and project instructions

The owner relies heavily on Matt Pocock's skills and wants them to work in the harness as they do in Claude Code. The format is the **Agent Skills** layout, which Claude Code, Codex, Gemini CLI and Cursor are reported to share (sources disagree on the full list of tools): a folder per skill with a `SKILL.md` that starts with front matter (`name`, `description`), plus any side files. Claude.ai's own Skills are the same folder, zipped.

**What the installed skills actually use** (37 skills in `~/.claude/skills`, read on 2026-11-01):

| Used by the skills | How many | What the harness needs |
|---|---|---|
| `name` and `description` front matter | all 37 | List them for the model to choose from |
| `disable-model-invocation: true` | 23 | The model must not start these on its own; only the person does, by typing `/name` |
| `argument-hint` | 4 | Show the hint in the `/` menu and pass what the person types as the skill's arguments |
| Side files beside `SKILL.md` (for example `tdd/mocking.md`) | most | Let the model read them, relative to the skill's folder |
| An `agents/openai.yaml` file (display name, short description) | most | Ignore it safely; it is metadata for Codex and can supply a nicer label |
| "Skill tool" (one skill loading another) | 23 mentions | A tool that loads a skill by name |
| Sub-agents | about 35 mentions | A tool that runs a task in a fresh, separate conversation and returns its result |
| Asking the user structured questions | 1 | A tool that shows options in the page and returns the answer |
| A to-do or plan tool | 1 | The plan tool in #29 |
| `gh` and shell commands | several | Already covered by the command tool and its approval |

**Behaviour**

- **Where skills come from.** On the device the session runs on: the person's own skills (`~/.claude/skills`, `~/.agents/skills`) and the project's (`.claude/skills`, `.agents/skills` inside the project root). The search folders are a device setting (B). The gateway can also hold a **library** that is available in every conversation, including chats with no device, and that can be imported and exported as a zip so skills move between the harness, Claude.ai and other tools.
- **Progressive loading.** Only names and descriptions go into the model's instructions. The full text loads when the model (or the person) calls the skill, so a long skill does not use up a small model's context until it is needed.
- **Running one.** Typing `/` in the composer lists skills with their hints; `/to-tickets some plan` loads that skill with the rest as its arguments. A skill marked `disable-model-invocation` is never started by the model.
- **Reading a skill's other files.** The session may read inside a skill's folder, read-only, even when the folder is outside the project root.
- **Project instructions.** `AGENTS.md` and `CLAUDE.md` in the project root (and the person's own, such as `~/.claude/CLAUDE.md`) are put in the model's instructions, with `@file` imports followed. This is how the repository's own `AGENTS.md` works with any model.
- **Honest limits for small local models.** Skills are written for large models. A 9B model may follow a short skill well and a long, multi-step one badly, and loading a long skill uses a large share of a small context window. The interface shows how much of the context a skill used (F), and the skills page notes which skills are long.
- **Sub-agents** are child conversations with their own context and a chosen subset of tools, run on any device and model in the pool, shown nested under their parent. This also lets a small main model hand a long task to a bigger one.

### O. Storage

The gateway keeps what it must remember (conversations, the usage ledger, device settings, and later the skills library) in **SQLite on its data volume**, which on TrueNAS is a folder on the storage pool, so it survives restarts and image updates. The owner has confirmed this is available. Today sessions are loose JSON files; they are imported into the database once and then retired.

- **Which SQLite.** Node's built-in `node:sqlite` (checked on Node 22.16: SQLite 3.49, write-ahead logging and strict tables work). It is marked experimental, so it prints a warning at start and its interface could change; the alternative, `better-sqlite3`, needs a native build in the image and on every developer machine. The decision is recorded in [ADR 0007](../adr/0007-sqlite-on-the-data-volume.md).
- **What it gives.** One file to back up (copy it while the gateway is stopped, or use SQLite's own backup), queries for the conversation list, search and the usage totals, and safe writes without the queueing the JSON files needed.
- **Events are append-only.** A conversation is a sequence of events that are only ever added, each with an increasing number. That is already how the interface follows a conversation (resume from event N).

**Future work: local first.** Because events are append-only and numbered, a client could keep its own copy of the conversations it has seen (in the browser, or in the desktop app, #49) and ask the gateway only for events after the last one it holds. That gives instant start-up, reading while offline, and drafts that survive anything. Writing while offline, and merging if two devices write to one conversation, is the harder half and is not planned. The shape of the tables should not rule it out: stable ids that clients can make, a per-conversation event number, and no deleting history in place.

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
A, D2 ---------------------------------> M multi-model modes (compare, council)
C -----------------------------------------> J users and sign-in
D1, B -------------------------------------> K desktop app
D1 ----------------------------------------> L permission modes and approvals
I documentation: structure first, then a page with every feature
#28 to #31 (panels, plan, tasks, images) land inside D's layout
```

On 2026-11-01 the tickets were consolidated from 27 open to 15, because a long list hides what to do next. The work is in two milestones: **Daily driver** (what it takes to use the harness every day at home) and **Later**.

| Daily driver | Ticket | Covers |
|---|---|---|
| A | #34 Model catalogue and on-demand loading | built (PR #57) |
| B | #35 Edit node settings from the web page | |
| C | #36 Conversations that survive refresh | stored in SQLite (section 4.O) |
| D | #37 Application shell | sidebar, header, thread, model picker, composer (was #37 and #38) |
| E | #39 Immediate progress feedback | |
| F | #40 Context and usage | per-model context, usage totals, Claude plan and local fallback (was #26, #27 and #40) |
| G | #41 Work on the files of the device you browse from | |
| side panel | #28 Session side panel | changed files, plan, background tasks, images (was #28 to #31) |
| I | #43 Documentation | structure, guides, reference and link check (was #43, #44 and #14) |
| N | #53 Skills | discovery, slash menu, sub-agents, asking questions (was #53 to #55) |
| Standards | done | strict lint (#46), TypeScript 7 (PR #47) |

| Later | Ticket |
|---|---|
| J | #48 Users and sign-in for the family |
| K | #49 The desktop app |
| L | #50 Permission modes and approval cards |
| M | #51 Multi-model modes |
| H | not planned (#42 closed) |

Closed as done: #1, #2, #7 and #15 (the gateway is deployed and in use).

The epic is #33.

The shortest route to the reported problem ("I could not use any model") is **A** with the device setting it needs. **C** and **E** are the biggest changes to how it feels. **D** is the largest piece and can start once C and A give it data to show.

## 6. Decisions that need recording

| Decision | Why it needs a record |
|---|---|
| Remote configuration of devices, and how a device opts in (§4 B) | It changes who decides what a device will run |
| A front-end build step: Vite, React, the React Compiler, and the code standards in §8 (§4 D) | It changes how the page is built, served, linted and tested |
| Chats as saved event streams, one conversation model (§4 C) | It changes what the gateway stores |
| How people sign in, and what each role may do (§4 J) | It changes who can use the devices, the tools and the Claude plan |
| The desktop app's technology: Electron or Tauri (§4 K) | It decides how the agent is bundled and how it is released |

## 8. Code standards

These apply to the new front-end package from its first commit and, through their own ticket, to the rest of the repository.

**Tools (checked against the npm registry on 2026-11-01).** TypeScript 7, with TypeScript 6 alongside it for ESLint (below); Vite 8 and Oxc; React 19, `@vitejs/plugin-react` 6, `babel-plugin-react-compiler` 1.0 (stable); ESLint 10 with typescript-eslint 8; `eslint-plugin-react-hooks` 7 (its recommended set includes the rules powered by the React Compiler, which replace the separate `eslint-plugin-react-compiler`); `eslint-plugin-react`; `eslint-plugin-jsx-a11y`; and Oxc's linter, `oxlint`, with its type-aware mode (`oxlint-tsgolint`). There is no Prettier.

**TypeScript 7 and 6 side by side.** Following the [TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/): TypeScript 7 is the native compiler (about 10x faster) and ships no programmatic API yet, so tools that import `typescript` (typescript-eslint among them) keep using 6. The announcement's pattern, already applied in the repository (PR #47):

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@^7.0.2",
    "typescript": "npm:@typescript/typescript6@^6.0.2"
  }
}
```

`tsc` is then TypeScript 7 (used for `pnpm typecheck` and the build's type check), `tsc6` is TypeScript 6, and anything that imports `typescript` gets the 6.0 API. Moving to 7 requires `tsconfig` changes the article lists: `baseUrl` is gone (use relative `paths`), `types` defaults to empty, and `rootDir` defaults to the config's folder.

**Oxc.** Vite 8 builds with Rolldown and Oxc, which is what makes the front-end build fast. For linting, `oxlint` runs first because it is fast and has a type-aware mode that works with TypeScript 7 (through `oxlint-tsgolint`). ESLint stays for what `oxlint` does not cover: the typescript-eslint strict rules that have no Oxc equivalent and the compiler rules of `eslint-plugin-react-hooks`. A rule is configured in one of the two tools, never both. The ticket (#46) measures what `oxlint` covers and writes the split down.

**React Compiler.** Enabled for every component. With Vite 8 and plugin-react 6 there are two ways to run it: a native build (`react({ compiler: true })`, which the plugin marks experimental) or the official Babel plugin through `@rolldown/plugin-babel` and its `reactCompilerPreset` helper. The Babel route is proposed because it is the stable compiler. The ticket confirms the choice with a build. Compiler diagnostics fail the build, so code the compiler cannot optimise is fixed rather than silently left slow.

**ESLint, flat config, strict.**

| Rule | Setting |
|---|---|
| Base | typescript-eslint `strictTypeChecked` and `stylisticTypeChecked`, with type information (`projectService`) |
| `any` | `@typescript-eslint/no-explicit-any` as an error, and the `no-unsafe-*` rules, so an `any` cannot arrive from elsewhere either |
| `var` | `no-var` and `prefer-const` as errors |
| Functions | arrow functions only: `func-style: expression`, `prefer-arrow-callback`, and a restriction on function declarations and function expressions. Exceptions that cannot be arrows: class methods, constructors, and generators (`function*`) |
| Braces | always. Arrow functions always have a block body, `() => { return x; }` and never `() => x` (`arrow-body-style: always`), and every `if`, `else`, `for` and `while` has braces (`curly: all`) |
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
- Who is in the family, and what should each role be allowed? (For example: may use chat and local models; may not run commands; may or may not spend the Claude plan.)
- Should family members sign in through Tailscale's identity (no password, but only on the tailnet), with accounts for the home network only, or both?
- Electron (the agent is already Node, simplest) or Tauri (smaller)?
- Are there other devices than the Mac, the desktop and the TrueNAS box that the "this device" detection must handle (a phone, for instance, has no agent)?
