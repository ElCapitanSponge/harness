---
title: Concepts
description: The parts of Torii and how they fit together, in one page, with links to the glossary and the decisions behind them
sidebar:
  order: 2
---

# Concepts

```
            +-------------+        tunnel (outbound)  +-------------+
  web page  |   gateway   | <------------------------ | node agent  |  (one per device)
  CLI       |  registry   |                           |  + LM Studio|
  apps      |  router     | -- chat, tools, relayed ->|             |
            +------+------+                           +-------------+
                   |
                   +-- Claude --> `claude -p` on a device that is logged in
```

**Gateway.** The always-on service every client talks to. It knows which devices are connected, routes each request, keeps conversations (in SQLite on its data volume), runs the model-and-tools loop for coding sessions, and serves the web page. See [ADR 0004](../adr/0004-gateway-in-a-container-on-truenas-over-tailscale.md).

**Device and node agent.** Each machine with models or files runs a node agent. It **dials out** to the gateway and holds a WebSocket open (the **tunnel**), so a device needs no inbound port or firewall rule, and it is listed exactly while connected. It reports what is loaded in LM Studio and whether it is busy (for example a game is running), and it answers requests relayed down the tunnel. See [ADR 0002](../adr/0002-devices-connect-out-to-the-gateway.md) and the [tunnel protocol](../reference/tunnel-protocol.md).

**Models.** A request names a model (or `auto`) and the gateway sends the whole request to a suitable idle device that has it. A model that is available but not loaded is loaded first. A conversation can change model on every message. See [Models, Auto mode and switching](../guides/models.md) and [ADR 0005](../adr/0005-routing-is-whole-request-not-model-splitting.md).

**Auto.** Torii can choose the model for each message by fixed rules and say why. See [ADR 0010](../adr/0010-auto-mode-chooses-by-rules-and-explains-itself.md).

**Claude.** Claude answers through the official `claude` program on a device where you are logged in, with your own plan; the gateway never touches the login. See [Claude](../guides/claude.md) and [ADR 0001](../adr/0001-claude-through-the-official-cli.md).

**Coding session.** A conversation tied to a folder on a device. The model loop runs on the gateway; the **tools** (read, search, edit, commands, git) run on the device that owns the files, only inside folders the device chose to expose, and only the tools its settings allow. Changes ask first. See [Coding sessions](../guides/coding-sessions.md), [Devices and their settings](../guides/devices.md) and [ADR 0003](../adr/0003-tools-run-on-the-device-the-gateway-runs-the-loop.md).

**Skills.** Folders of instructions (the Agent Skills layout) that a session finds on the device, plus the project's `AGENTS.md` and `CLAUDE.md`. See [Skills](../guides/skills.md).

**Security.** The gateway can run tools on every connected device, so every limit that matters is enforced on the device. See the [security model](../security.md).

The project's words and what they mean are in the [glossary](../../GLOSSARY.md).
