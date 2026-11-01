---
title: Command line reference
description: Every harness command with its options, and the environment it reads
sidebar:
  order: 2
---

# Command line reference

Run from the repository root as `pnpm harness <command>`, or with the `harness` wrapper from [Coding sessions](../guides/coding-sessions.md). The gateway address and key come from `GATEWAY_URL` and `HARNESS_API_KEY` (see [Configuration](configuration.md#command-line)).

| Command | What it does |
| --- | --- |
| `harness nodes` | List devices reporting to the gateway, with their project folders. |
| `harness models` | List models across devices. |
| `harness sessions` | List saved conversations (chats and coding sessions). |
| `harness export <id>` | Print a saved conversation as markdown; redirect it to a file. See [Importing and exporting](../guides/importing.md). |
| `harness import <file> [-n number \| --all] [-m model]` | Bring in a Claude Code `.jsonl`, a ChatGPT or Claude.ai export, or a markdown or text transcript. With several conversations in the file, `-n` picks one by number (they are listed if you omit it) and `--all` takes them all. |
| `harness settings <device> [key json]` | Show a device's settings, or change one, for example `settings anakin claude true`. The device must run with `REMOTE_CONFIG=1`. |
| `harness chat [-m model] [prompt...]` | One-shot chat, or interactive with no prompt. |
| `harness code [-m model] [-y] [-d device [-r root]] [prompt...]` | Work on the files in the current directory (read, edit, run commands); with `-d` and `-r`, on a device's folder. Claude models launch Claude Code locally. See [Coding sessions](../guides/coding-sessions.md). |
| `harness tool <device> <root> <tool> [json-args]` | Run one tool on a connected device, for debugging. |
| `harness load <model> [-c tokens] [-d device]` | Load a model in LM Studio, here or on a connected device. |
| `harness unload [model] [-d device]` | Unload one model, or all if omitted. |
| `harness help` | Print the usage. |

## Options

| Option | Meaning |
| --- | --- |
| `-m`, `--model` | The model: a loaded model id, `auto`, `claude`, or `claude:<alias>` such as `claude:sonnet`. Default `auto`. |
| `-d`, `--device` | The device to act on. |
| `-r`, `--root` | The project folder name on that device. |
| `-y`, `--yes` | Approve every change without asking (`harness code`). Use only in a throwaway directory or with a model you trust. |
| `-c`, `--context` | Context length in tokens when loading a model. |
| `-n`, `--number` | Which conversation to import from a file with several. |
| `--all` | Import every conversation in the file. |
| `-h`, `--help` | Print the usage. |
