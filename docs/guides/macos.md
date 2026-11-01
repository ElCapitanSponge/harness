---
title: Set up a macOS device
description: Install the node agent on a Mac, choose its settings, and start it at login with a launchd agent
sidebar:
  order: 4
---

# Set up a macOS device

A device appears in the pool while its node agent runs. This guide installs the agent, points it at the gateway and starts it at login.

The launchd file has been written but **not yet run on a Mac** (the MacBook Air check is still to do on [#14](https://github.com/ElCapitanSponge/harness/issues/14)). After setting it up, confirm the device appears, and tell us if a step needed changing.

## Install

1. Install Node 26 and pnpm 10 (for example with Homebrew) and Git. Install [LM Studio](https://lmstudio.ai) 0.4 or newer and run it once so its `lms` command is set up.
2. Clone and install:

   ```bash
   git clone https://github.com/ElCapitanSponge/harness.git ~/personal/harness
   cd ~/personal/harness
   pnpm install
   ```

## Settings

Create `.env` in the repository root with only the connection:

```
GATEWAY_URL=http://truenas-scale:8787
HARNESS_API_KEY=<the gateway's key>
REMOTE_CONFIG=1
```

`REMOTE_CONFIG=1` lets you manage the device from the **Devices** page; its settings are saved in `~/.harness/agent-settings.json`. The launcher tightens `.env` to owner-only (`chmod 600`) because it holds the key. All settings are in the [configuration reference](../reference/configuration.md).

## Start it

```bash
pnpm agent
```

## Start at login

```bash
sed -e "s#__HARNESS_DIR__#$HOME/personal/harness#g" -e "s#__HOME__#$HOME#g" \
  deploy/macos/com.harness.agent.plist > ~/Library/LaunchAgents/com.harness.agent.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.harness.agent.plist
tail -f ~/Library/Logs/harness-agent.log
```

The agent starts at login, restarts if it exits (after a ten second pause), and logs to `~/Library/Logs/harness-agent.log`. The file assumes the repository is at `~/personal/harness`; change the path in the `sed` command if it is elsewhere. Stop it with `launchctl bootout "gui/$(id -u)/com.harness.agent"`.

## Commands the model runs

With tools on this device set to **Can change**, the model can run commands in your login shell (zsh or bash). macOS ships the BSD versions of tools such as `sed` and `date`, and the model is told so; see [Devices and their settings](devices.md#the-shell).
