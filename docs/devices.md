# Devices and their settings

Each device decides what the gateway may do on it. The **Devices** button on the page shows every connected device's effective settings and, for a device that allows it, lets you change them without editing its `.env`.

## What can be changed

| Setting | Environment variable | What it does |
| --- | --- | --- |
| Project folders | `PROJECT_ROOTS` | The folders coding sessions may work in, as `name=path`. |
| Tools | `ALLOWED_TOOLS` | The tools coding sessions may run. Read-only by default; `write_file`, `edit_file` and `run_command` change files or run programs, and the web and developer tools (`web_fetch`, `gh_read`, `git_write` and the rest, see [dev-tools.md](dev-tools.md)) are off until turned on. |
| Model control | `ALLOW_MODEL_CONTROL` | Lets the gateway load and unload models in this device's LM Studio. |
| Claude | `CLAUDE_ENABLED` | Answers Claude requests with this device's logged-in `claude` CLI. |
| Idle unload | `IDLE_UNLOAD_MINUTES` | Unload a model nobody has used for this many minutes (default 20, 0 never), so the graphics card is free for whatever else the machine is doing. |
| Game programs | `GAME_PROCESSES` | Programs that mark the device busy so the GPU is left alone. |

The device name, gateway address and inference server address need a new process, so they are not changed from the page.

## Models that go away when unused

A device with model control on unloads a model after **20 minutes without use** (change it on the Devices page, or `IDLE_UNLOAD_MINUTES`; 0 turns it off). The agent does this by itself, so it works when the gateway is down and needs nobody to think about it.

- **Use** means a chat request for the model came through the agent, or the gateway loaded it. The clock restarts when a reply ends, and a model with a reply still being written is never unloaded, however long that takes.
- **Only models Torii used** are unloaded. A model you loaded in LM Studio for your own use, and never asked Torii about, is left alone.
- It works while you are playing a game too: unloading is what frees the card.
- The next message to an unloaded model loads it again first, and the status line shows the loading, as for any model that is not loaded. Each unload is written to the device's audit log.

## Who decides

A device accepts changes from the page only if it was started with `REMOTE_CONFIG=1` ([ADR 0008](adr/0008-devices-accept-remote-settings-only-when-opted-in.md)). Without it the page shows the settings read-only. The order of precedence is:

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
