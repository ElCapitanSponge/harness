---
title: Set up a Windows device
description: Install the node agent on Windows, choose its settings, and start it at logon with a scheduled task
sidebar:
  order: 3
---

# Set up a Windows device

A device appears in the pool while its node agent runs. This guide installs the agent, points it at the gateway and starts it at logon.

## Install

1. Install Node 26, pnpm 10 and Git. Install [LM Studio](https://lmstudio.ai) 0.4 or newer and run it once so its `lms` command is set up (`%USERPROFILE%\.lmstudio\bin\lms.exe`).
2. Clone and install:

   ```powershell
   git clone https://github.com/ElCapitanSponge/harness.git
   cd harness
   pnpm install
   ```

## Settings

Create `.env` in the repository root with only the connection:

```
GATEWAY_URL=http://truenas-scale:8787
HARNESS_API_KEY=<the gateway's key>
REMOTE_CONFIG=1
```

`REMOTE_CONFIG=1` lets you manage this device from the **Devices** page (project folders, which tools run, Claude, model control, idle unload). It is saved in `%USERPROFILE%\.harness\agent-settings.json`. Leave it out to keep the device configurable only from `.env`; every setting and its environment variable is in the [configuration reference](../reference/configuration.md). The **Devices → Add a device** page gives a ready-made command for this step.

Do not set the device's other settings in `.env` if you want to change them from the page: an environment variable locks the setting.

## Start it

Try it in a terminal first:

```powershell
pnpm agent
```

The device should appear on the Devices page and in `pnpm harness nodes`.

## Start at logon

Run once from a normal (not administrator) PowerShell in the repository root:

```powershell
powershell -File deploy\windows\install-agent-task.ps1
Start-ScheduledTask -TaskName "harness agent"
```

This registers a scheduled task that starts the agent at logon, restarts it if it stops, and logs to `%LOCALAPPDATA%\harness-agent.log`. Restart the task after changing `.env`. Remove it with:

```powershell
Unregister-ScheduledTask -TaskName "harness agent" -Confirm:$false
```

## Commands the model runs

With tools on this device set to **Can change**, the model can run commands. They use PowerShell 7 (`pwsh`) if it is installed, then Windows PowerShell 5.1, then `cmd.exe`; see [Devices and their settings](devices.md#the-shell).

## If the agent will not stay up

See [Troubleshooting](../troubleshooting.md). If a game is running and the device shows as busy, that is by design: add its program name to **Game programs** on the Devices page.
