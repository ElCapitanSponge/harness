---
title: Tunnel protocol reference
description: The WebSocket a device opens to the gateway, the heartbeat it sends and the requests the gateway relays down it
sidebar:
  order: 4
---

# Tunnel protocol reference

A device **dials out** to the gateway and keeps one WebSocket open ([ADR 0002](../adr/0002-devices-connect-out-to-the-gateway.md)). The gateway never connects to a device. The schemas are in `packages/core/src/index.ts` (`TunnelMessage`, `RelayRequest`, `Heartbeat`) and are checked on both ends; a message that does not match is ignored.

## Connecting

- URL: the gateway address with `http` changed to `ws` (`https` to `wss`) and the path `/tunnel`.
- Authentication: the same `Authorization: Bearer <key>` header as every other route. A wrong key is refused with `401` and the agent says so in its log.
- Reconnecting: if the connection drops, or the gateway is restarted, the agent retries with a growing delay from one second up to thirty, so a gateway update needs no action on the devices.
- A second connection with the same `NODE_ID` replaces the first.

Every message is one JSON object in a text frame, with a `type`.

## Device to gateway

| `type` | Fields | Meaning |
| --- | --- | --- |
| `heartbeat` | `heartbeat` | The device's state, sent when the tunnel opens and then at an interval. A device is listed while its tunnel is open. |
| `head` | `id`, `status`, `contentType?` | The start of the reply to a relayed chat `request`. |
| `chunk` | `id`, `data` | A piece of that reply's body. |
| `end` | `id` | The reply is complete. |
| `fail` | `id`, `message` | The request failed. |
| `tool-result` | `id`, `ok`, `output`, `change?` | The single reply to a `tool`, `claude`, `model` or `settings` request. After a browser screenshot, `image` carries the picture and the page's address for the side panel, never for the model. After a write or edit, `change` carries the file's path, whether it was created, lines added and removed and the diff, for the person's side panel; it is never given to the model. |

### The heartbeat

| Field | Meaning |
| --- | --- |
| `nodeId`, `kind` | The device's name and `local` (an agent). |
| `busy`, `busyReason?` | True while a program from the game list is running, so the device is left alone. |
| `limit?` | `{ reason, maxBytes }` while a program from the limited list is running: the device still works, with models up to that size. |
| `models` | Each model's `id`, whether it is `loaded`, its `contextLength` and its `sizeBytes` when known. |
| `roots` | Names of the project folders it lets coding sessions use. |
| `allowedTools` | The tools it will run there. |
| `readOnlyRoots` | The folders that can only be read. |
| `claude` | True if it will answer Claude requests. |
| `modelControl` | True if the gateway may load and unload models. |
| `remoteConfig` | True if it accepts settings changes from the gateway. |
| `platform`, `shell` | Its operating system and the shell commands run in, so the model is told the right syntax. |

## Gateway to device

| `type` | Fields | Meaning |
| --- | --- | --- |
| `request` | `id`, `body` | A chat completions request (`body` is its raw JSON) for the local model server. The device streams the answer back as `head`, `chunk` and `end`. |
| `cancel` | `id` | Stop that request. |
| `claude` | `id`, `body` | A chat request to answer with the local `claude` program. |
| `model` | `id`, `op`, `model?`, `contextLength?` | Load or unload a model (`op` is `load` or `unload`). Refused unless model control is on. |
| `settings` | `id`, `op`, `settings?` | Read (`get`) or change (`set`, with a partial settings object) the device's settings. Refused unless `REMOTE_CONFIG=1`. |
| `tool` | `id`, `root`, `name`, `args`, `session?` | Run one tool in a project folder. The device checks the folder, the tool and the folder's read-only state itself, whatever the gateway asks, and writes the call to its audit log. |

Besides the tools a model is offered, the gateway asks a device for seven it does not offer to models: `project_context` (the project's instruction files and skills, at the start of a turn), `start_skill` (the text of a skill the person started), `tasks_list` (the session's background commands, for the side panel), `tasks_stop_all` (when a session is deleted), `tasks_clear_finished` (when the person clears the finished tasks), `read_instruction` (an instruction file's text and version, for the Project memory section) and `write_instruction` (saves one, if it is still at the version given). A device allows them wherever it allows any of its own tools, except `write_instruction`, which needs a device that lets its own tools change things and is refused in a read-only folder. See [Skills](../guides/skills.md).
