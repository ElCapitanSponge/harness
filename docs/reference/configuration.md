---
title: Configuration reference
description: Every setting of the gateway, the node agent and the command line, with its default and where it can be set
sidebar:
  order: 1
---

# Configuration reference

Settings are read from the environment. For the gateway that means its container or shell; for an agent and the CLI it also means a `.env` file in the repository root (copy `.env.example`). A device's own settings can additionally be saved in its settings file and changed from the **Devices** page; the order of precedence is environment variable, then settings file, then default ([Devices and their settings](../guides/devices.md#who-decides)).

## Gateway

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8787` | Port to listen on. |
| `HOST` | `127.0.0.1` | Comma-separated listen addresses. `tailscale` means this machine's Tailscale IPv4 address. `0.0.0.0` and `::` are refused unless `HARNESS_ALLOW_ANY_INTERFACE=1`. |
| `HARNESS_API_KEY` | unset | Shared secret. Required to listen on anything but loopback. Clients send `Authorization: Bearer <key>`; every route needs it, including the `/tunnel` WebSocket. |
| `HARNESS_ALLOW_ANY_INTERFACE` | unset | `1` allows `0.0.0.0` and `::` (the container image sets it). |
| `HARNESS_DATA_DIR` | `~/.harness/gateway` | Where the SQLite database (conversations, events, usage) is kept. `/data` in the container, so mount a volume there. |
| `HARNESS_TRUST_PROXY` | unset | `1` believes `X-Forwarded-For`, for a reverse proxy you run, so the browser's real address is seen (used to find "this device"). |
| `WEB_DIST` | the built `packages/web/dist` | The folder of the built web page to serve. |
| (data volume) | | The library of skills is kept in a `skills` folder inside `HARNESS_DATA_DIR`. |
| `HARNESS_ALLOW_BYPASS` | on | `0` refuses the "run without asking" mode for every conversation ([Coding sessions](../guides/coding-sessions.md#permissions-modes-and-approvals)). |
| `HARNESS_KEEP_LOADED` | unset | `1` keeps a device's other models loaded when one is loaded (by default they are unloaded first, because two rarely fit in one graphics card). |
| `HARNESS_DEFAULT_CONTEXT` | `32768` | Context window, in tokens, given to a model the gateway loads without being told one. |
| `HARNESS_COMPACT_AT` | `80` | Compact a conversation when its context is this percent full before a message. `0` turns it off. See [Usage](../guides/usage.md). |
| `HARNESS_AUTO_PREFER` | unset | Auto mode: model names, best first, comma-separated. A name matches any model id containing it; `claude` ranks Claude. |
| `HARNESS_AUTO_AVOID` | unset | Auto mode: models never to choose. |
| `HARNESS_AUTO_KEEP_FREE` | unset | Auto mode: device names that are never chosen. See [Models](../guides/models.md#auto). |

## Node agent

Settings marked "page" can be changed from the Devices page on a device started with `REMOTE_CONFIG=1`; an environment variable locks the setting there.

| Variable | Default | Page | What it does |
| --- | --- | --- | --- |
| `GATEWAY_URL` | `http://localhost:8787` | no | Where to dial. |
| `HARNESS_API_KEY` | unset | no | The gateway's key. |
| `NODE_ID` | the machine's host name | no | The device's name. Must be unique: two devices with the same id keep replacing each other's connection. |
| `INFERENCE_URL` | `http://localhost:1234` | no | The local model server (LM Studio). |
| `REMOTE_CONFIG` | unset | no | `1` lets the page change this device's settings ([ADR 0008](../adr/0008-devices-accept-remote-settings-only-when-opted-in.md)). |
| `SETTINGS_FILE` | `~/.harness/agent-settings.json` | no | Where settings changed from the page are saved. |
| `AUDIT_LOG` | `~/.harness/audit.log` | no | Every tool call the gateway makes on this device, one JSON line each. |
| `PROJECT_ROOTS` | unset (nothing exposed) | yes | `name=path` entries for folders coding sessions may use, separated by `:` (`;` on Windows). |
| `READ_ONLY_ROOTS` | unset | yes | Names of project folders that can only be read. |
| `ALLOW_ON_DEVICE_TOOLS` | `read` | yes | `off`, `read` or `change`. Tools that work on this device's files and programs. |
| `ALLOW_REMOTE_TOOLS` | `off` | yes | `off`, `read` or `change`. Tools that reach out: the web and GitHub. |
| `ALLOWED_TOOLS` | unset | no | The older single list of tool names; when set it decides exactly which tools run. |
| `ALLOW_MODEL_CONTROL` | unset | yes | `1` lets the gateway load and unload models in this device's LM Studio. |
| `CLAUDE_ENABLED` | unset | yes | `1` answers Claude requests with this device's logged-in `claude` CLI. |
| `CLAUDE_BIN` | `claude` | no | The Claude program to run. |
| `LIMITED_PROCESSES` | `ms-teams.exe, Teams.exe` | yes | Comma-separated program names that limit the device to smaller models while they run ([Devices](../guides/devices.md#limited-mode-small-models-during-a-call)). |
| `LIMITED_MAX_GB` | `8` | yes | Largest model, in gigabytes, used while limited (1 to 512). |
| `ALLOW_BROWSER` | unset | yes | `1` lets coding sessions use the agent browser on this device ([The agent browser](../guides/browser.md)). |
| `BROWSER_HOSTS` | unset | yes | Comma-separated hosts the browser may visit (and their subdomains); empty means any public site. |
| `BROWSER_PATH` | the usual Chrome, Edge or Chromium | no | The browser program to drive. |
| `GAME_PROCESSES` | unset | yes | Comma-separated executable names; a match marks the device busy. |
| `IDLE_UNLOAD_MINUTES` | `20` | yes | Unload a model Torii used after this long idle. `0` never. |
| `SKILL_FOLDERS` | unset | yes | Comma-separated full paths of folders of skills to look in as well as the usual ones ([Skills](../guides/skills.md)). |
| `WEB_FETCH_ALLOW_LOCAL` | unset | no | `1` lets `web_fetch` reach local-network addresses ([Developer tools](../guides/dev-tools.md)). |

## Command line

| Variable | Default | What it does |
| --- | --- | --- |
| `GATEWAY_URL` | `http://127.0.0.1:8787` | The gateway to talk to. |
| `HARNESS_API_KEY` | unset | The key. |
| `HARNESS_CWD` | the current directory | Where `harness code` works; set by a shell wrapper because `pnpm` runs from the repository root ([Coding sessions](../guides/coding-sessions.md)). |
| `LMS_BIN` | `~/.lmstudio/bin/lms` | The LM Studio command. |
| `CLAUDE_BIN` | `claude` | The Claude program, for `harness code -m claude`. |

## Model names

| Model | Goes to |
| --- | --- |
| a loaded model id, e.g. `qwen3.5-9b` | an idle device that has it (loaded first if it is available but not loaded) |
| `auto` | on `/v1/chat/completions` and `harness chat`: any loaded model on an idle device. In a web conversation or coding session it is [Auto mode](../guides/models.md#auto), which chooses by rules and says why |
| `claude`, `claude:<alias>` (e.g. `claude:sonnet`) | a connected device logged in to Claude with Claude turned on; the `claude` CLI answers |

If no idle device matches, the gateway returns `503`.
