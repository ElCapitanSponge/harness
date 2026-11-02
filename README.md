# Torii

A torii is the gate between the everyday world and a sacred one; this is the gate between your own devices and everything you want to ask. The repository is still called `harness`, and the packages are `@harness/*`.

A small TypeScript harness that pools local LLMs (via [LM Studio](https://lmstudio.ai)) and Claude (via the official `claude` CLI) behind a single OpenAI-compatible endpoint and a web interface.

Each device runs a **node agent** that reports which models it has loaded and whether it is busy (for example, a game is running). The agent dials out to the gateway over a WebSocket (`/tunnel`) and keeps it open, so a device needs no inbound port or firewall rule. A **gateway** keeps a registry of live devices and routes each request to a suitable idle one. Requests for `claude` go to the Claude CLI on a device that is logged in to it.

```
            +-------------+        tunnel (outbound)  +-------------+
  web page  |   gateway   | <------------------------ | node agent  |  (one per device)
  CLI       |  registry   |                           |  + LM Studio|
  apps      |  router     | -- chat, relayed -------->|             |
            +------+------+                           +-------------+
                   |
                   +-- claude / claude:<alias> --> `claude -p` (your own login)
```

## Status

Working, and in daily use. The gateway, node agents, CLI and web interface (chat, coding sessions on any connected device, Auto mode, skills, import and export) are built and tested, including end to end over a real tunnel. Not yet run in practice: node agents on a Mac or Linux machine; the [list of what is untested](docs/status.md) says what, and the [open issues](https://github.com/ElCapitanSponge/harness/issues) track it.

## Requirements

- Node 26 (the current LTS) and pnpm 10
- [LM Studio](https://lmstudio.ai) 0.4+ with its `lms` CLI, for local models
- The [Claude Code](https://claude.com/claude-code) CLI, logged in (`claude auth login`), for Claude models

## Try it

```bash
pnpm install
pnpm build:web
pnpm gateway     # in one terminal
pnpm agent       # in another
pnpm harness chat "write a haiku"
```

Then open `http://127.0.0.1:8787`. The [quickstart](docs/getting-started/quickstart.md) explains each step.

## Documentation

Everything is in [`docs/`](docs/index.md):

- **Start:** [quickstart](docs/getting-started/quickstart.md) and [concepts](docs/getting-started/concepts.md).
- **Set up:** [TrueNAS](docs/guides/truenas.md), [Tailscale](docs/guides/tailscale.md), and a device on [Windows](docs/guides/windows.md), [macOS](docs/guides/macos.md) or [Linux](docs/guides/linux.md), including starting the agent at login.
- **Use:** [models and Auto mode](docs/guides/models.md), [coding sessions](docs/guides/coding-sessions.md) (`harness code`, working on another device's files, loading models remotely), [Claude](docs/guides/claude.md), [devices and their settings](docs/guides/devices.md), [skills](docs/guides/skills.md), [import and export](docs/guides/importing.md).
- **Reference:** [configuration](docs/reference/configuration.md) (every setting and model name), [command line](docs/reference/cli.md), [HTTP API](docs/reference/http-api.md), [tunnel protocol](docs/reference/tunnel-protocol.md), [web interface](docs/reference/web-interface.md).
- [Security model](docs/security.md), [troubleshooting](docs/troubleshooting.md), [glossary](GLOSSARY.md), and the [decisions](docs/adr/0001-claude-through-the-official-cli.md) behind the design.

## Security

The gateway can run tools on every connected device, so read the [security model](docs/security.md) before exposing it. Short version: it refuses to listen beyond loopback without `HARNESS_API_KEY`, every route needs the key, and the limits that matter (project folders, allowed tools, read-only folders, the audit log) are enforced on the device.

## Contributing

Run `pnpm typecheck`, `pnpm lint` and `pnpm test` before pushing; see [contributing](docs/contributing.md) for the code standards, the repository layout and the documentation rule. Commits follow [Conventional Commits](https://www.conventionalcommits.org). `main` blocks force-pushes and deletion and requires linear history, so rebase or squash before merging.

## License

[MIT](LICENSE)
