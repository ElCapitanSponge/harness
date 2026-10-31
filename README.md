# harness

A small TypeScript harness that pools local LLMs (via [LM Studio](https://lmstudio.ai)) and Claude (via the official `claude` CLI) behind a single OpenAI-compatible endpoint.

Each device runs a **node agent** that reports which models it has loaded and whether it is busy (for example, a game is running). A **gateway** keeps a registry of live nodes and routes each request to a suitable idle one. Requests for `claude` go to the Claude CLI instead.

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

Early. Today it runs on a single machine, with the gateway bound to localhost. Planned: gateway auth, a Tailscale bind address, and nodes on additional devices (Mac, Linux, TrueNAS).

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
| `PORT`, `HOST` | gateway | `8787`, `127.0.0.1` |
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

## Security

The gateway has no authentication yet. Keep it bound to `127.0.0.1` until auth and a Tailscale-only bind address are added, and do not expose the port publicly.

## Contributing

Commits follow [Conventional Commits](https://www.conventionalcommits.org): `type(scope): summary`, for example `feat(gateway): add API key auth` or `fix(cli): handle empty prompt`. Common types are `feat`, `fix`, `docs`, `test`, `refactor`, `chore` and `ci`. `main` blocks force-pushes and deletion and requires linear history, so rebase or squash before merging.

## License

[MIT](LICENSE)
