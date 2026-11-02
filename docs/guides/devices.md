---
title: Devices and their settings
description: What each device lets the gateway do, how its settings are changed, the shell, and adding a device
sidebar:
  order: 20
---

# Devices and their settings

Each device decides what the gateway may do on it. The **Devices** button on the page shows every connected device's effective settings and, for a device that allows it, lets you change them without editing its `.env`.

## What can be changed

| Setting | Environment variable | What it does |
| --- | --- | --- |
| Project folders | `PROJECT_ROOTS` | The folders coding sessions may work in, as `name=path`. |
| Read-only folders | `READ_ONLY_ROOTS` | Names of project folders that can only be read. Nothing in them can be written, edited, deleted or committed, and commands do not run there. |
| Tools on this device | `ALLOW_ON_DEVICE_TOOLS` | `off`, `read` or `change` (default `read`). Tools that work on this machine's files and programs: reading and searching files, `git_read`, `jq`, `fzf_filter`. `change` adds `write_file`, `edit_file`, `git_write` and `run_command`, a full shell (see below), which always ask first. |
| Tools that reach out | `ALLOW_REMOTE_TOOLS` | `off`, `read` or `change` (default `off`). Tools that go beyond this machine: `web_fetch` and `gh_read`. `change` adds `gh_write`, which always asks first. |
| Model control | `ALLOW_MODEL_CONTROL` | Lets the gateway load and unload models in this device's LM Studio. |
| Claude | `CLAUDE_ENABLED` | Answers Claude requests with this device's logged-in `claude` CLI. |
| Idle unload | `IDLE_UNLOAD_MINUTES` | Unload a model nobody has used for this many minutes (default 20, 0 never), so the graphics card is free for whatever else the machine is doing. |
| Skill folders | `SKILL_FOLDERS` | More folders to look for skills in (full paths, which must exist), as well as `~/.claude/skills`, `~/.agents/skills` and the project's own. See [Skills](skills.md). |
| Limiting programs | `LIMITED_PROCESSES` | Programs (a call or meeting: `ms-teams.exe` and `Teams.exe` by default) while which the device keeps working but only with smaller models. See [Limited mode](#limited-mode-small-models-during-a-call). |
| Largest model while limited | `LIMITED_MAX_GB` | How large "small" is, in gigabytes (default 8). |
| Browser | `ALLOW_BROWSER` | Lets coding sessions use a throwaway headless browser on this device. Off by default. See [The agent browser](browser.md). |
| Browser hosts | `BROWSER_HOSTS` | If set, the only hosts (and their subdomains) the browser may visit. |
| Game programs | `GAME_PROCESSES` | Programs that mark the device busy so the GPU is left alone. |

The device name, gateway address and inference server address need a new process, so they are not changed from the page.

## How much memory the agent uses

`pnpm agent` is for development: pnpm and the TypeScript loader (tsx) stay running beside the agent and, together, use more memory than it does (measured on Windows with Node 22: about 88 MB for pnpm, 55 MB for the tsx launcher and 100 MB for the agent, 242 MB in all). For a device that is left running, bundle the agent and run it with plain `node`:

```bash
pnpm build:agent     # writes packages/node-agent/dist/agent.mjs
pnpm agent:run       # node --env-file-if-exists=.env packages/node-agent/dist/agent.mjs
```

That is one process of about 70 MB, 70 percent less, and it starts faster. The Windows scheduled task, the launchd agent and the systemd unit all start it this way, rebuilding the bundle each time they start, so after a `git pull` restarting the service is enough. The browser's Playwright is only loaded when a page is first opened, which keeps about 20 MB out of an agent that never uses it. V8 flags that save memory (`--optimize-for-size`, a smaller `--max-semi-space-size`) were tried and gain little once the wrappers are gone, so none is set. A newer Node changes little; the repository's Node 26 is where to go for other reasons.

## Limited mode: small models during a call

A game makes the device **busy**: nothing is sent to it. A call or meeting does not need all of it, so a program on the **limiting programs** list puts the device in **limited** mode instead. It stays in the pool, but only with models up to the size you set (8 GB by default); a model's size is read from LM Studio (`lms ls`).

- **Everything respects it.** Routing, Auto mode, loading on use and the model picker all see only the small models. In the picker a model that is too big is still listed, greyed out, with its size and the reason ("20 GB, too big while Teams is running"); a request for one by name gets the same explanation.
- **A big model Torii loaded is unloaded** (when model control is on) as soon as the limit starts, so the call has the graphics card. A model with a reply being written is not touched, and neither is one you loaded in LM Studio yourself.
- **It ends by itself.** When the program closes, the device shows all its models again; unloaded ones load on use as usual.
- **A model whose size is not known** is not limited, since there is nothing to compare.
- **A game still wins.** If a game and a call are both running, the device is busy.
- The list matches program names as the operating system reports them (`tasklist` on Windows, `ps` elsewhere), case-insensitively. Add `Zoom.exe`, `slack.exe` or whatever you use.

## Models that go away when unused

A device with model control on unloads a model after **20 minutes without use** (change it on the Devices page, or `IDLE_UNLOAD_MINUTES`; 0 turns it off). The agent does this by itself, so it works when the gateway is down and needs nobody to think about it.

- **Use** means a chat request for the model came through the agent, or the gateway loaded it. The clock restarts when a reply ends, and a model with a reply still being written is never unloaded, however long that takes.
- **Only models Torii used** are unloaded. A model you loaded in LM Studio for your own use, and never asked Torii about, is left alone.
- It works while you are playing a game too: unloading is what frees the card.
- The next message to an unloaded model loads it again first, and the status line shows the loading, as for any model that is not loaded. Each unload is written to the device's audit log.

## Who decides

A device accepts changes from the page only if it was started with `REMOTE_CONFIG=1` ([ADR 0008](../adr/0008-devices-accept-remote-settings-only-when-opted-in.md)). Without it the page shows the settings read-only. The order of precedence is:

1. an environment variable on the device (the setting shows as locked, and a change is refused);
2. the saved settings file (`SETTINGS_FILE`, default `~/.harness/agent-settings.json`);
3. the default.

A change applies at once, with no restart, is saved to the file so the device starts the same way when the gateway is down, and is written to the device's own audit log. The agent checks every value (known tools, folders that exist) and the page shows its reason if it refuses.

## Adding a device

Open **Devices → Add a device** and copy the command for the machine's operating system. It carries the gateway address and your key, and sets `REMOTE_CONFIG=1`; remove that to keep the device read-only. Run it from a clone of the repository after `pnpm install`.

## API

`GET /devices/:id/settings` returns the effective settings, where each came from, which are locked and whether the device accepts changes. `PUT /devices/:id/settings` takes a partial object and returns the new report, or the device's reason with status 422.

## From the command line

`harness settings <device>` shows the same report as the page; `harness settings <device> <key> <json>` changes one setting (for example `harness settings anakin claude true`) on a device started with `REMOTE_CONFIG=1`. `harness sessions` lists saved conversations.

## The shell

With tools on this device set to **Can change**, the model gets `run_command`: one tool that runs a command in the device's own shell, so it can do nearly anything else a session needs (build, test, install packages, move or delete files, git, curl, any installed program) without a separate option for each. It asks first every time, unless you choose "Always allow run_command" for the session.

- **Windows:** PowerShell 7 (`pwsh`) if it is installed, otherwise Windows PowerShell 5.1 (`powershell.exe`), otherwise `cmd.exe`. The model is told which, since 5.1 has no `&&` or `||`.
- **macOS and Linux:** your login shell if it is zsh or bash, otherwise bash, otherwise sh.
- The agent tells the gateway which shell it has, and the model's instructions name it and its syntax (PowerShell cmdlets and `;`, or `dir`, `findstr` and `&&` in cmd), so it writes commands that will run.
- Commands run in the project folder, with the exit code and output (both streams) returned, stopped after 120 seconds.
- A command gets the agent's environment **without anything that looks like a secret**: `HARNESS_*`, and any name containing KEY, TOKEN, SECRET, PASSWORD, CREDENTIAL or AUTH (except `SSH_AUTH_SOCK`). So a command cannot read the gateway key or a token the agent holds. A program that needs a login (`gh`) uses its own saved login.
- **A folder marked read-only never gets a shell**, because a command cannot be fenced in.

Read-only keeps only the specific reading tools (`read_file`, `list_dir`, `grep`, `git_read`, `jq`, `fzf_filter`), because a shell cannot be made read-only.
