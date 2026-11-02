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
harness tool anakin proj read_file '{"path":"package.json"}'   # run one tool, for debugging
```

In the web page, choose **Code** on the start screen, pick the device and folder, and describe the task. Changes ask on the page (`-y` for the command line approves everything for the session; an approval nobody answers counts as no after five minutes). A session can switch model between messages, including to Claude, and can use [skills](skills.md) with `/`.

## The session panel

In a coding session, the panel button in the header opens **This session** beside the conversation (a drawer over it on a phone). It shows:

- **Plan.** The model can keep a short plan with the `plan` tool, marking each step to do, in progress or done as it works. The plan shows live and is saved with the conversation. The tool needs no approval and touches nothing: the gateway keeps the plan and no device is asked.
- **Running in the background.** Commands started with `run_command`'s `background` option (a dev server, a long build), with their state. The panel refreshes every few seconds while it is open.
- **Files.** Every file the session changed or created, newest first, with lines added and removed. Opening one shows its diff. When a file is written or edited, the device works out the diff and sends it beside the result; the model is only told the result (such as `wrote 120 characters to a.txt`), never the diff. A binary or very large file (over 5,000 lines, or a diff over 60,000 characters) is listed with a note instead of a diff.

Both are stored as events of the conversation, so reopening it shows the panel as it was.

Not built yet from the same plan: attaching images for models that can read them ([#28](https://github.com/ElCapitanSponge/harness/issues/28)).

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
