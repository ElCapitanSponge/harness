---
title: Torii documentation
description: Where to start with Torii, the gateway that pools local models and Claude behind one endpoint, and where each topic lives
sidebar:
  order: 1
---

# Torii documentation

Torii pools the language models on your own devices, and Claude through your own login, behind one OpenAI-compatible endpoint and one web interface. The repository is still called `harness` and the packages `@harness/*`.

## Start here

- [Quickstart](getting-started/quickstart.md): run a gateway and an agent on one machine and send a first message.
- [Concepts](getting-started/concepts.md): the gateway, devices, the tunnel, tools and sessions, in a page.

## Guides

Set up:

- [TrueNAS](guides/truenas.md): run the gateway as an always-on app, from nothing to a connected device.
- [Tailscale](guides/tailscale.md): reach the gateway from every device and keep it off the public internet.
- Devices: [Windows](guides/windows.md), [macOS](guides/macos.md) and [Linux](guides/linux.md): install the agent, set it up and start it at login.
- [Updating the gateway](guides/updating.md): keep the TrueNAS app on the newest image.

Use:

- [Models, Auto mode and switching](guides/models.md)
- [Coding sessions](guides/coding-sessions.md)
- [Claude](guides/claude.md)
- [Devices and their settings](guides/devices.md)
- [Developer tools](guides/dev-tools.md)
- [The agent browser](guides/browser.md)
- [Skills and instruction files](guides/skills.md)
- [Importing and exporting conversations](guides/importing.md)
- [Usage, context and compaction](guides/usage.md)
- [Progress while a request is in flight](guides/progress.md)

## Reference

- [Configuration](reference/configuration.md): every setting, its default, and where it can be set.
- [Command line](reference/cli.md)
- [HTTP API](reference/http-api.md)
- [Tunnel protocol](reference/tunnel-protocol.md)
- [Web interface](reference/web-interface.md)

## Also

- [Security model](security.md)
- [Troubleshooting](troubleshooting.md)
- [Contributing](contributing.md): a feature is not done until its docs page is.
- [Decisions](adr/0001-claude-through-the-official-cli.md): the architecture decision records, in order.
- [Specifications](specs/web-experience-v2.md)
- [Glossary](../GLOSSARY.md): the project's words and what they mean.
