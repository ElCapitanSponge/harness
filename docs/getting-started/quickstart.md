---
title: Quickstart
description: Run a gateway and a node agent on one machine and send a first message from the web page and the command line
sidebar:
  order: 1
---

# Quickstart

This runs everything on one machine. To run the gateway on a server and connect other devices, follow [TrueNAS](../guides/truenas.md) and [Tailscale](../guides/tailscale.md) afterwards; the steps for a device are the same.

## You need

- Node 26 (the current LTS) and pnpm 10.
- [LM Studio](https://lmstudio.ai) 0.4 or newer with its `lms` command, for local models.
- Optional: the [Claude Code](https://claude.com/claude-code) CLI, logged in (`claude auth login`), to use Claude.

## Install and check

```bash
git clone https://github.com/ElCapitanSponge/harness.git
cd harness
pnpm install
pnpm typecheck
pnpm test
```

## Start the gateway and the agent

Load a model in LM Studio first. Then, in two terminals:

```bash
pnpm build:web     # once: builds the web page the gateway serves
pnpm gateway
pnpm agent
```

The gateway listens on `http://127.0.0.1:8787` and serves the web page there. The agent connects to it and reports the models LM Studio has loaded.

## Send a message

Open `http://127.0.0.1:8787`, leave the model on **Auto (Torii chooses)** and type a message. Or from the command line:

```bash
pnpm harness nodes                       # devices reporting to the gateway
pnpm harness models                      # models across devices
pnpm harness chat "write a haiku"        # model "auto"
pnpm harness chat -m claude:sonnet "hi"  # route to Claude (needs a device with Claude on)
```

The gateway also speaks the OpenAI chat completions format, so any OpenAI-compatible client works:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hello"}]}'
```

The response header `x-harness-node` says which device answered.

## Next

- Let a session work on files: [Coding sessions](../guides/coding-sessions.md).
- Turn Claude on: [Claude](../guides/claude.md).
- Add other devices: [Windows](../guides/windows.md), [macOS](../guides/macos.md), [Linux](../guides/linux.md).
- Something does not work: [Troubleshooting](../troubleshooting.md).
