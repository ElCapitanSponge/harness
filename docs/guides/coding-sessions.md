---
title: Coding sessions
description: Work on files with a model, from the command line on this machine or from the web page on any device's folders
sidebar:
  order: 6
---

# Coding sessions

A coding session is a conversation with tools. The model runs on the pooled devices; the **tools run on the machine that owns the files**, so the model edits the files that are actually in front of you. See [Concepts](../getting-started/concepts.md) for how the parts fit.

## From the command line on this machine (`harness code`)

`harness code` is a coding agent in the style of Claude Code. Tools run in the directory you call it from.

```bash
cd ~/some/project
harness code "the tests in utils.test.ts fail, find out why and fix it"   # one task
harness code                                                               # interactive
harness code -m qwen3.5-9b "add a README section"                          # pick a model
harness code -m claude:sonnet                                              # Claude Code, locally
```

Tools: `read_file`, `list_dir`, `grep`, `write_file`, `edit_file`, `run_command`, plus the [developer tools](dev-tools.md). The model sees them as ordinary OpenAI tools, so any local model with tool calling works.

- **Confined to the working directory.** File tools reject paths outside it, including through symlinks.
- **Changes need your approval.** Reading is automatic. Writing, editing and running commands ask `[y/N/a]` (`a` = always allow that tool for the session). `-y` approves everything, so use it only in a throwaway directory or with a model you trust.
- **Declining ends the turn.** The model is told to stop and ask what you want instead ([ADR 0006](../adr/0006-a-declined-approval-ends-the-turn.md)).
- **`run_command` is not sandboxed.** It runs in the working directory but a command can touch anything your user can. Read what it asks to run.
- **Claude models** (`claude`, `claude:<alias>`) hand over to the real `claude` CLI on your machine, using that machine's own login, because Claude Code already has its own file tools. To use Claude on another device's folders from the page, see [Claude](claude.md).

### Print mode, for scripts

`-p` (`--print`) is `claude -p` for `harness code`: one turn that never waits on a person, with or without a terminal.

```bash
harness code -p "summarise the failing tests" > summary.txt
harness code -p --output-format json -y "fix the lint errors" | jq .outcome
```

- **It never asks.** Without `-y` a change that needs approval is declined and reported; with `-y` it runs. With no prompt on the command line the prompt is read from a pipe, and a terminal is an error.
- **stdout holds only the final reply.** Earlier replies, tool lines and errors go to stderr.
- **`--output-format json`** prints one line: `outcome`, `text`, `model`, and `error` (the message) when the outcome is `error`.
- **The exit code says how the turn ended.** 0 for `done`; 1 for `declined`, `stopped` (the step limit) and `error` (including a cancelled turn).
- It works with `-d` / `-r` and with `--continue` / `--resume`. For Claude models, `-p` and `--output-format` are passed to `claude` itself.

`pnpm` runs scripts from the repository root, so wrap the CLI in a shell function that passes your directory through in `HARNESS_CWD`:

```bash
# ~/.zshrc or ~/.bashrc
harness() { HARNESS_CWD="$PWD" pnpm --silent --dir "$HOME/personal/harness" harness "$@"; }
```

```powershell
# $PROFILE
function harness { $env:HARNESS_CWD = (Get-Location).Path; pnpm --silent --dir C:\Users\andre\personal\harness harness @args; Remove-Item Env:HARNESS_CWD }
```

On a device other than the one running the gateway, clone the repository, run `pnpm install`, and create a `.env` in it with `GATEWAY_URL` (for example `http://truenas-scale:8787`) and `HARNESS_API_KEY`. Local models must support tool calling; if one ignores the tools, try another.

## On another device's files

A device can let coding sessions work in folders you choose. The model loop runs on the gateway (and on whichever device has the model loaded), while the tools run on the device that owns the files.

Choose the folders and what may happen in them on the **Devices** page (or with environment variables on the device):

```bash
PROJECT_ROOTS=proj=/home/me/code/proj        # name=path, several separated by ":" (";" on Windows)
ALLOW_ON_DEVICE_TOOLS=read                   # off, read (the default) or change
READ_ONLY_ROOTS=docs                         # folders that can only be read, by name
```

Nothing is exposed unless project folders are set, and only the tools the two tool groups allow run, whatever the gateway asks for. See [Devices and their settings](devices.md). Then, from any device:

```bash
harness nodes                                         # the ROOTS column shows what each device exposes
harness code -d anakin -r proj "why does the build fail?"
harness code --continue "and the lint errors?"                 # back to the newest coding session
harness code --resume 3f2a9c1b                                  # back to one from `harness sessions`
harness tool anakin proj read_file '{"path":"package.json"}'   # run one tool, for debugging
```

In the web page, choose **Code** on the start screen, pick the device and folder, and describe the task. Changes ask on the page (`-y` for the command line approves everything for the session; an approval nobody answers counts as no after five minutes). A session can switch model between messages, including to Claude, and can use [skills](skills.md) with `/`.

## Permissions: modes and approvals

Next to the message box, **Changes** sets how this coding session treats changes. It starts on the first and can be changed at any time; the thread notes each change. The list says under each mode what it allows, so a phone sees it too, and marks the risky one with a badge.

| Mode | What happens |
| --- | --- |
| **Ask before every change** (default) | Every write, edit, command and other change waits for you. |
| **Accept file edits** | `write_file` and `edit_file` go ahead; commands, git changes, the web and everything else still ask. |
| **Plan first** | The model is offered only what reads. It investigates and sends its plan as a markdown document (the approach, the steps, the files, the risks) with the step list. You read it, **Edit** it if you like (your version goes back to the model as the approved plan), and approve it before the model can change anything. You choose what follows: **Approve, ask before each change** (the mode becomes "ask") or **Approve, accept file edits** (the mode becomes "edits"), and the tools for changes are offered from then on. **Request changes** declines it with a reason; the model is told why and revises the plan, still read-only. Every version is kept (see the plan document under Plan below). |
| **Run without asking** (marked as risky) | Nothing asks. It is never the default, asks you to confirm when you choose it, and can be turned off for the whole gateway with `HARNESS_ALLOW_BYPASS=0`. |

An approval card shows what will happen before it does: the diff of an edit, the whole command and the device and folder it runs in, or the start of a file about to be written. Your choices:

- **Allow**: this once.
- **Allow *tool* for this conversation**.
- **Allow *tool* always in this project**: remembered for that folder on that device, in every conversation, until you remove it on the **Permissions** page.
- **Decline**, with an optional reason that goes back to the model. A decline still ends the turn ([ADR 0006](../adr/0006-a-declined-approval-ends-the-turn.md)); the reason is in what the model sees next time.

Whatever the mode or a remembered rule says, **the device's own allow list has the last word**: a tool the device does not allow is never offered and never runs, and a read-only folder stays read-only. A sub-agent's approvals come to you through the conversation that started it, under the same mode. If the page is in the background when the model needs an answer (an approval or a question), the bell in the header turns on a notification, which the browser asks you to allow once.

## Projects in the sidebar

The sidebar groups conversations by project, as Claude Code does: one group for each folder on each device, headed by the folder's name and either **This device** or the name of the device it is on. Chats, which have no project, are gathered under **Chats** at the end. A sub-agent's conversation stays under the one that started it.

- Click a group's heading to collapse or expand it. Which groups are collapsed is kept on the gateway, so the browser and the [desktop app](desktop.md) agree and it survives a restart.
- **Pin to top** in a conversation's menu moves it to a **Pinned** group above the projects (where it still says which folder and device it belongs to); **Unpin** puts it back. The pin is stored with the conversation on the gateway, so it shows in every client and survives a restart. Pinned conversations are ordered by when they were last active.
- **Archive** in a conversation's menu puts it away: it leaves the projects, Chats and Pinned, and is listed in an **Archive** section at the bottom of the sidebar. That section stays closed until you open it, and the gateway remembers that too. Archiving unpins; **Unarchive** brings it back. Nothing is deleted, a new message does not bring it back, and an archived conversation that needs you still raises the badge and keeps its amber hand. **Delete** asks first and offers **Archive instead**. `harness sessions` leaves archived ones out unless you add `--all`, and `harness code --continue` skips them (`--resume` still finds one by its id).
- Each conversation shows what it is doing: a **spinner** while the model works, an **amber hand** while it is stopped for you (an approval or a question; the hover text says which), and a **dot** with a bold title when it holds messages you have not read. The conversation you are looking at is never marked unread by its own replies.
- How far you have read is kept on the gateway, so reading a conversation in the browser clears the dot in the desktop app too. Events that arrive while the page is hidden stay unread until you come back to it. Conversations saved before this existed count as read.
- **Anywhere in the interface** you are told when a conversation needs you: the tab title shows a count, `(2) Torii`, the tab icon carries an amber dot, and, once you have allowed notifications with the bell, a notification appears when another conversation starts to need you (the open one notifies for itself). Clicking it opens that conversation. The [desktop app](desktop.md) adds a badge on its icon.
- The **+** on a group's heading opens the start screen with that device and folder already chosen.
- "This device" comes from the same match as [New code session here](#new-code-session-here): the desktop app always knows its own device; a browser uses the gateway's match or your choice.

## New code session here

The sidebar has one **New conversation** button with an arrow beside it. The arrow's menu offers **New code session here**, which starts a coding session on the device the browser is on, with that device and the model picker already set. A browser cannot read files, so the device needs a node agent running ([Windows](windows.md), [macOS](macos.md), [Linux](linux.md)).

How the page knows which device it is on:

1. **By address.** Each agent's tunnel connects to the gateway from an address; `GET /whoami` compares it with the address your browser connects from. The page uses a match.
2. **By your choice.** If nothing matches, the sidebar asks "Which device is this?" once, and the page remembers the answer in the browser. Choose **None** if there is no agent on this device: the page then says so and links to the setup guide for the browser's operating system. **Not right?** lets you correct a wrong match.

The match depends on what the gateway sees. Over Tailscale to a gateway that sees real addresses it works. Behind the TrueNAS app's port publishing it cannot: **checked on the real app, every browser and every agent shows up as the container network's gateway** (`172.0.13.1` there), so an address match would be a coincidence of the NAT and would pick the agent for any browser, a phone's included. The gateway recognises that it is on such a network (an address inside one of its own `172.x` container interfaces) and reports no match, so the sidebar asks "Which device is this?" once and remembers the answer in the browser. Host networking for the container, or a reverse proxy you run with `HARNESS_TRUST_PROXY=1` (which makes the gateway use the address in `X-Forwarded-For`), would restore automatic matching. Never set `HARNESS_TRUST_PROXY` without a proxy: anyone could then claim to be any address (it only picks a default device, never grants access).

The start screen also lists your recent folders (the last five used, kept in the browser) as one-click choices.

## Built-in commands

Type `/` in the message box and the list shows a few commands, marked **command**, before the skills. They are chosen the same way (arrows, Enter or Tab, or a click), and run in the page instead of being sent to the model:

| Command | What it does |
|---|---|
| `/compact` | Summarises the older turns now, like the button on the context meter, and says how many messages and tokens it covered. |
| `/clear` | Opens a fresh conversation in the same project, on the same model. The old one stays in the sidebar. |
| `/model [name]` | Sets the model for the next message: the exact name, or any words that fit only one model. With no name it focuses the model box. |
| `/permissions [mode]` | Sets how changes are treated: `ask`, `edits`, `plan` or `bypass` (the same as the mode box; `bypass` can be refused by the gateway). With no mode it says the current one. |
| `/init` | Asks the model to read the project and draft an `AGENTS.md`, and to show you the draft and ask before writing it. |

A command that takes nothing more runs as soon as it is chosen; `/model` and `/permissions` complete the name so you can add the argument, and run on Enter once the name is whole. A command that does not apply says why instead of failing: `/permissions` and `/init` need a coding session, and `/compact` and `/clear` need a conversation that has started (on the start screen only `/model` works). A skill with the same name as a command is still reachable from the list; the command wins when you type it.

## Mentioning files with @

In a coding session, type `@` in the message box to search the project's files, as in Claude Code. The list is the project folder on its device, read through the same read-only route as the session panel, and it narrows as you type: `@read` offers `README.md`, `@src/` lists what is in `src`. Folders come first and are chosen to go inside (the word stays open); a file is chosen with **Enter** or **Tab** (or a click), moves with the arrow keys, and **Escape** closes the list.

Choosing a file puts `@path` in your message and adds the file's text below it in a code block, the same as **Add files as context**, so the model has it without asking. Text only, up to 200 KB; a binary or larger file is refused with a reason, and a long file is added shortened with a note. Names starting with a dot are listed only once you type a dot. Nothing outside the project folder is offered (`..` and absolute paths list nothing), and the list is not offered in a chat with no project. An `@` inside a word, such as an email address, is left alone, and a message that starts with `/` gets the skills list instead.

## Actions in the thread

The model's tool calls are folded, as its thinking is. Each run of tool activity between two messages becomes one **Actions** group with a one-line count, such as "Read 4 files, ran 2 commands, modified 1 file", and a count of any that failed. The group is open and shows a working mark while it runs, and folds when it ends. Click its heading to open or close it; that choice is kept while the page is open.

Inside, each call is one line. A command or a file read expands to what it returned (shortened at 4,000 characters; the model was given all of it). A change to a file is a **Modified** row with the file name, and expanding it shows the same diff as the session panel. An approval or a question ends the group and is shown outside it, so it is never hidden in a fold. Reopened and imported conversations are grouped the same way; calls stored before tool names were kept are counted as other actions and show no output.

## When a message was sent

Each message, yours and the model's, shows its time beside it, small and muted. Today's messages show the time only (`14:32`); an earlier day also shows the date, and the year when it is not this one. Hover over the time for the full date and time with the zone, or tab to it or tap it (it is a button) and the full date, time and zone replace the short form until you move on or tap again. The clock is 24-hour, whatever the browser's language. The time is when the gateway recorded the message, not when your browser received it, so every browser and a reload show the same value. It is stored as UTC and shown in your browser's time zone. A reply shows the time it finished.

A conversation saved before times were kept has none for its old messages, and shows no time there rather than a wrong one; new messages in it have one. An imported conversation keeps the time the source gave for each message when it has one (a Claude Code transcript, a ChatGPT export and a Claude.ai export do, for each message that carries one; a pasted transcript has none). A message waiting in the queue shows when it was queued; once it starts, its message in the thread shows when it started, and rewording a queued message keeps the time it was queued.

## Markdown in the message box

What you type is coloured as markdown while you write it: headings and list markers, **bold**, `code`, links, quotes, and fenced code blocks across their lines (a block you have not closed yet is styled to the end, as it will be read). It is a picture drawn behind the box: the box stays an ordinary text box, so the cursor, selection, undo, paste and input methods work as they always did, and what is sent is exactly the text you typed. Raw HTML or script in your text is shown as the characters you typed and is never turned into page elements.

The colouring cannot change the width of a letter, or it would drift from the box, so bold is a heavier stroke rather than a bold face, italics are underlined rather than slanted, and code keeps the same font with a shaded background. Use **Preview** for the finished look. Drafts, `@` mentions and `/` commands work as before. A screen reader reads the box's own text and skips the coloured copy, and in a high-contrast mode the colouring is switched off and the box shows its plain text.

## Sending while the model works

You can keep typing while a turn is running. Press Enter (or **Queue message**) and the message waits above the message box; **Stop** stays beside it. When the running turn ends cleanly the next message starts as a turn of its own, and several go one at a time, in the order you sent them. Up to 10 can wait; an eleventh is refused with a reason.

Each waiting message has **Send now**, a pencil to reword it, and a cross to take it back. The pencil opens the same editor as the message box: the markdown colouring, the formatting toolbar and shortcuts, Shift+Enter for a new line, and the preview. Enter saves, Escape keeps the message as it was, and a message left empty is not saved. Pictures on a queued message stay as they were queued. **Send now** stops the turn that is running, ends it cleanly, and sends that message next; the others stay queued behind it. The queue is kept by the gateway, so a reload, a second browser tab or the desktop app shows the same list.

If the last turn was declined, cancelled or failed, the queue is held, and the list says so in words. Nothing is sent for you after a turn that did not finish; the held messages go on after the next turn that does, or you can send one now or remove it. The queue is kept in memory, so it is lost if the gateway restarts.

## The session panel

In a coding session, the panel button in the header opens **This session** beside the conversation (a drawer over it on a phone). It shows:

- **Plan.** The model can keep a short plan with the `plan` tool, marking each step to do, in progress or done as it works. The plan shows live and is saved with the conversation. The tool needs no approval and touches nothing: the gateway keeps the plan and no device is asked. **Clear done** takes the finished steps off the list, and with none left the section goes away. That is a new plan event, so a reload shows the cleared plan, and the model is told that the person cleared them so it does not bring them back. It is refused while a turn is running.
- **Plan document.** In plan first mode the model also sends the plan as markdown (the `markdown` argument of the `plan` tool, up to 20,000 characters). It is stored on the gateway with the conversation, so it is there from any device and after a reload, and it is never written into the project folder. The panel shows it above the steps, rendered, and keeps it after the plan is approved; **Copy** and **Download .md** take it out. Each version is a stored `plan-document` event, written by the model or edited by you, and the arrows in the panel step back through them.
- **Running in the background.** Commands started with `run_command`'s `background` option (a dev server, a long build), with their state. The panel refreshes every few seconds while it is open. **Clear finished** forgets the tasks that have ended (exited or stopped) and never touches one that is running. A device on an older agent says so, instead of failing quietly.
- **Screenshots.** What the agent browser saw, newest first, with each page's address ([The agent browser](browser.md)).
- **Files.** Every file the session changed or created, newest first, with lines added and removed. Opening one shows its diff. When a file is written or edited, the device works out the diff and sends it beside the result; the model is only told the result (such as `wrote 120 characters to a.txt`), never the diff. A binary or very large file (over 5,000 lines, or a diff over 60,000 characters) is listed with a note instead of a diff.

Both are stored as events of the conversation, so reopening it shows the panel as it was.

Messages can carry images for models that can read them; see [Images](models.md#images).

## Sub-agents

The model can hand a self-contained task to a sub-agent with the `agent` tool: `task` (everything the sub-agent needs, since it cannot see the conversation), optionally a `model` (default: the one in use) and `tools` (names). The sub-agent is a conversation of its own on the same device and folder, with its own context. It runs the task and its final answer comes back to the model as the tool's result.

- **Never more permission than its parent.** It gets the tools asked for that its parent was offered, plus `plan` and `ask`, and never one the device does not allow or the folder's read-only state forbids.
- **Approvals reach you.** A sub-agent's approval requests and questions appear in the thread of the conversation that started it, and you answer them there, exactly as for the parent. Declining ends the sub-agent's turn like any decline.
- **Limits.** A conversation may start 8 sub-agents in all, and they nest 2 deep: a sub-agent may start one of its own, but that one may not start another. At the limit the model is told so and does the work itself. Each block in the thread says which sub-agent it is of the 8 and how deep.
- **Where they show.** In the thread a collapsed block shows the task, its state and its result, with a link to its conversation. In the sidebar the sub-agent's conversation is listed under its parent. Deleting the parent deletes them, and cancelling it cancels them.
- **Usage.** A sub-agent's model calls are counted in the usage ledger under its own conversation.

## Questions from the model

In a coding session the model has an `ask` tool for a decision only you can make. The page shows a card with the question, the likely answers as buttons and a box for your own words; the answer goes back to the model as the tool's result. It needs no approval and touches no device: the gateway asks you itself. If nobody is watching the conversation, you cancel, or ten minutes pass, the model is told that nobody answered and not to guess, so it stops and says what it needs to know. The question and the answer are stored with the conversation.

## Commands in the background

With tools on the device set to **Can change**, `run_command` takes `background: true`. It asks first, like any command, then starts the command and returns a task id at once instead of waiting. The model can read the latest output with `task_output` (`id`, `lines`) and stop the task, and everything it started, with `task_stop`. Tasks belong to the session that started them: another session cannot read or stop them, up to 8 run at once, the last 20 finished ones are kept, and the last 200,000 characters of output. They are stopped when the session is deleted and when the agent exits. They run in the device's shell and are not sandboxed, exactly like `run_command`.

## Loading models on another device

```bash
harness load qwen3.5-9b -c 32768 -d anakin     # load on a connected device
harness unload -d anakin                        # unload everything there
```

The device must have model control on (`ALLOW_MODEL_CONTROL=1` or the Devices page), and it refuses while a game from its game programs is running. Without `-d` the commands act on this machine's LM Studio.

## Other chat apps

Chat apps (LibreChat and friends) can use the same gateway for plain chat through `/v1/chat/completions`. The gateway lists Claude models in `/v1/models` and streams Claude replies, but chat apps have no tools on your files, so use a coding session for file work.
