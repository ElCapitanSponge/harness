# harness

A small TypeScript harness that pools local LLMs (via [LM Studio](https://lmstudio.ai)) and Claude (via the official `claude` CLI) behind a single OpenAI-compatible endpoint.

Each device runs a **node agent** that reports which models it has loaded and whether it is busy (for example, a game is running). The agent dials out to the gateway over a WebSocket (`/tunnel`) and keeps it open, so a device is listed while it is connected and needs no inbound port for registration. A **gateway** keeps a registry of live nodes and routes each request to a suitable idle one. Requests for `claude` go to the Claude CLI instead.

```
            +-------------+        heartbeats         +-------------+
  CLI  -->  |   gateway   | <------------------------ | node agent  |  (one per device)
  apps      |  registry   |                           |  + LM Studio|
            |  router     | -- /v1/chat/completions ->|             |
            +------+------+                           +-------------+
                   |
                   +-- claude / claude:<alias> --> `claude -p` (your own login)
```

## Status

Early. Today the gateway and one node agent run on a single machine and can be reached from other tailnet devices with an API key. Planned: a container image for TrueNAS, and node agents on additional devices (Mac, Linux). See issue #1.

## Requirements

- Node 22+ and pnpm 10
- [LM Studio](https://lmstudio.ai) 0.4+ with its `lms` CLI, for local models
- The [Claude Code](https://claude.com/claude-code) CLI, logged in (`claude auth login`), for Claude models

## Setup

```bash
pnpm install
pnpm typecheck
pnpm test
```

## Running

Start the gateway and the node agent in separate terminals:

```bash
pnpm gateway
pnpm agent
```

Then use the CLI:

```bash
pnpm harness nodes                       # nodes reporting to the gateway
pnpm harness models                      # models across nodes
pnpm harness load qwen3.5-9b -c 32768    # load a model in local LM Studio
pnpm harness chat "write a haiku"        # model "auto": any loaded model on an idle node
pnpm harness chat -m claude:sonnet "hi"  # route to Claude
pnpm harness unload                      # free the GPU
```

Or call the gateway directly. It speaks the OpenAI chat completions format:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hello"}]}'
```

The response header `x-harness-node` says which node served the request.

## Working on files from any device (`harness code`)

`harness code` is a coding agent in the style of Claude Code. The model runs on the pooled nodes, but the **tools run on the machine you call from**, in the directory you call from, so it edits the files that are actually in front of you.

```bash
cd ~/some/project
harness code "the tests in utils.test.ts fail, find out why and fix it"   # one task
harness code                                                               # interactive
harness code -m qwen3.5-9b "add a README section"                          # pick a model
harness code -m claude:sonnet                                              # Claude Code, locally
```

Tools: `read_file`, `list_dir`, `grep`, `write_file`, `edit_file`, `run_command`. The model sees them as ordinary OpenAI tools, so any local model with tool calling works.

- **Confined to the working directory.** File tools reject paths outside it, including through symlinks.
- **Changes need your approval.** Reading is automatic. Writing, editing and running commands ask `[y/N/a]` (`a` = always allow that tool for the session). `-y` approves everything, so use it only in a throwaway directory or with a model you trust.
- **Declining ends the turn.** The model is told to stop and ask what you want instead.
- **`run_command` is not sandboxed.** It runs in the working directory but a command can touch anything your user can. Read what it asks to run.
- **Claude models** (`claude`, `claude:<alias>`) hand over to the real `claude` CLI on your machine, using that machine's own login, because Claude Code already has its own file tools. The gateway never runs Claude with tools for you.

`pnpm` runs scripts from the repo root, so wrap the CLI in a shell function that passes your directory through in `HARNESS_CWD`:

```bash
# ~/.zshrc or ~/.bashrc
harness() { HARNESS_CWD="$PWD" pnpm --silent --dir "$HOME/personal/harness" harness "$@"; }
```

```powershell
# $PROFILE
function harness { $env:HARNESS_CWD = (Get-Location).Path; pnpm --silent --dir C:\Users\andre\personal\harness harness @args; Remove-Item Env:HARNESS_CWD }
```

On a device other than the one running the gateway, clone this repo, run `pnpm install`, and create a `.env` in it with `GATEWAY_URL` (for example `http://100.106.71.39:8787`) and `HARNESS_API_KEY`. Local models must support tool calling; if one ignores the tools, try another.

Chat apps (LibreChat and friends) can use the same gateway for plain chat. The gateway lists Claude models in `/v1/models` and streams Claude replies, but chat apps have no tools on your files, so use `harness code` for file work.

## Model names

| Model | Goes to |
|---|---|
| a loaded model id, e.g. `qwen3.5-9b` | an idle node that has it loaded |
| `auto` | any loaded model on an idle node |
| `claude`, `claude:<alias>` (e.g. `claude:sonnet`) | the `claude` CLI, with no tools enabled |

If no idle node matches, the gateway returns `503`.

## Configuration

| Variable | Used by | Default |
|---|---|---|
| `PORT` | gateway | `8787` |
| `HOST` | gateway | `127.0.0.1`. Comma-separated listen addresses; `tailscale` means this machine's Tailscale IPv4 address. `0.0.0.0` and `::` are refused |
| `HARNESS_API_KEY` | gateway, node agent, CLI | unset. Required for the gateway to listen on anything but loopback; clients send it as `Authorization: Bearer` |
| `CLAUDE_BIN` | gateway | `claude` |
| `GATEWAY_URL` | node agent, CLI | `http://localhost:8787` |
| `INFERENCE_URL` | node agent | `http://localhost:1234` (LM Studio) |
| `NODE_ID` | node agent | machine hostname |
| `GAME_PROCESSES` | node agent | comma-separated executable names; a match marks the node busy |
| `LMS_BIN` | CLI | `~/.lmstudio/bin/lms` |

## Layout

| Package | Purpose |
|---|---|
| `packages/core` | Shared Zod schemas: chat request, model info, heartbeat |
| `packages/node-agent` | Reports loaded models and a busy flag to the gateway |
| `packages/gateway` | Node registry, router, OpenAI-compatible API, Claude backend |
| `packages/cli` | The `harness` command |

Routing policy lives in `packages/gateway/src/router.ts`, separate from transport, so tiering and fallback rules can change without touching the HTTP code.

## Notes on Claude usage

The Claude backend only shells out to the official `claude` CLI, so requests use your own login and plan limits. It does not extract or proxy credentials. Usage is shared with everything else on that account.

## Calling the gateway from another device (Tailscale)

Until the gateway has its own always-on home, you can run it on the desktop and call it from any device on your tailnet.

1. Copy `.env.example` to `.env` and set `HARNESS_API_KEY` (the example shows how to generate one). Keep `HOST=127.0.0.1,tailscale`.
2. Make sure Tailscale is signed in on the desktop. If it is down, the gateway logs a warning and still serves loopback.
3. Allow the port in through Windows Firewall, limited to tailnet addresses (run once, in an administrator PowerShell):

   ```powershell
   New-NetFirewallRule -DisplayName "harness gateway (Tailscale)" -Direction Inbound -Protocol TCP -LocalPort 8787 -RemoteAddress 100.64.0.0/10 -Action Allow
   ```

4. Start `pnpm gateway` and `pnpm agent`. The gateway logs the address it listens on.
5. From the other device, use the desktop's Tailscale address or MagicDNS name:

   ```bash
   export HARNESS_URL=http://<desktop-tailscale-name-or-ip>:8787
   export HARNESS_API_KEY=<the key from the desktop's .env>

   curl "$HARNESS_URL/nodes" -H "authorization: Bearer $HARNESS_API_KEY"

   curl "$HARNESS_URL/v1/chat/completions" \
     -H "authorization: Bearer $HARNESS_API_KEY" -H "content-type: application/json" \
     -d '{"model":"auto","messages":[{"role":"user","content":"hello"}]}'
   ```

   Any OpenAI-compatible client works too: set its base URL to `$HARNESS_URL/v1` and its API key to the harness key.

Traffic between tailnet devices is already encrypted by Tailscale (WireGuard), so plain `http://` is fine on the tailnet. Never forward the port to the public internet or enable Tailscale Funnel for it.

## Security

- The gateway refuses to listen on any non-loopback address unless `HARNESS_API_KEY` is set, and never accepts `0.0.0.0` or `::`.
- With a key set, every route requires `Authorization: Bearer <key>`, including node heartbeats and the `/tunnel` WebSocket.
- The key lives in `.env`, which is git-ignored. Do not commit it or paste it into chats.
- The Claude backend uses your own `claude` login, so anyone holding the harness key can spend your Claude plan. Treat the key accordingly.

## Contributing

Commits follow [Conventional Commits](https://www.conventionalcommits.org): `type(scope): summary`, for example `feat(gateway): add API key auth` or `fix(cli): handle empty prompt`. Common types are `feat`, `fix`, `docs`, `test`, `refactor`, `chore` and `ci`. `main` blocks force-pushes and deletion and requires linear history, so rebase or squash before merging.

## License

[MIT](LICENSE)
