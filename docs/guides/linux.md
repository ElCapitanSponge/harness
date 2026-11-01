---
title: Set up a Linux device
description: Install the node agent on Linux, choose its settings, and run it as a systemd user service
sidebar:
  order: 5
---

# Set up a Linux device

A device appears in the pool while its node agent runs. This guide installs the agent, points it at the gateway and runs it as a systemd user service that restarts after a crash.

The systemd unit has been written but **not yet run on a Linux machine** (see [#14](https://github.com/ElCapitanSponge/harness/issues/14)). After setting it up, confirm the device appears, and tell us if a step needed changing.

## Install

1. Install Node 26, pnpm 10 and Git. Install [LM Studio](https://lmstudio.ai) 0.4 or newer (or any server with an OpenAI-compatible API on `INFERENCE_URL`; the model-loading features need LM Studio's `lms`).
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

`REMOTE_CONFIG=1` lets you manage the device from the **Devices** page; its settings are saved in `~/.harness/agent-settings.json`. The launcher (`deploy/run-agent.sh`) tightens `.env` to owner-only because it holds the key. All settings are in the [configuration reference](../reference/configuration.md).

## Start it

```bash
pnpm agent
```

## Run as a service

```bash
mkdir -p ~/.config/systemd/user
cp deploy/linux/harness-agent.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now harness-agent
loginctl enable-linger "$USER"      # keep it running when you are not logged in
journalctl --user -u harness-agent -f
```

The unit restarts the agent five seconds after it exits. It assumes the repository is at `~/personal/harness`; edit `ExecStart` in the copied file if it is elsewhere. Restart after changing `.env`:

```bash
systemctl --user restart harness-agent
```

## Commands the model runs

With tools on this device set to **Can change**, the model can run commands in `bash` (or zsh if that is your login shell) with the usual GNU tools; see [Devices and their settings](devices.md#the-shell).
