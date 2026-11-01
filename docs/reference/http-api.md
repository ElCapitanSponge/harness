---
title: HTTP API reference
description: Every route the gateway serves, what it takes and returns, and how it is authenticated
sidebar:
  order: 3
---

# HTTP API reference

With `HARNESS_API_KEY` set, every route except the web page itself needs `Authorization: Bearer <key>`. Bodies are JSON. Errors have the shape `{ "error": { "message": "..." } }`.

## OpenAI-compatible

| Route | What it does |
| --- | --- |
| `GET /v1/models` | The models loaded on connected devices, and Claude's while a Claude device is connected. |
| `POST /v1/chat/completions` | A chat completion, streamed or not. The response header `x-harness-node` names the device. `503` if no idle device has the model. |

## Devices and models

| Route | What it does |
| --- | --- |
| `GET /nodes` | Connected devices with their models, busy state, project folders, tools and shell. |
| `GET /catalogue` | Everything that can be chosen, for the interface: each model on each device with what choosing it would do, and Claude. |
| `POST /devices/:nodeId/tools` | Run one read-only tool on a device: `{ root, name, args }`. Tools that change things are refused here. |
| `POST /devices/:nodeId/models/load` | Load a model: `{ model, contextLength? }`. The device must allow model control. |
| `POST /devices/:nodeId/models/unload` | Unload one model, or all if `model` is omitted. |
| `GET /devices/:nodeId/settings` | The device's effective settings, where each came from, which are locked, and whether it accepts changes. |
| `PUT /devices/:nodeId/settings` | Change settings: a partial object. Returns the new report, or the device's reason with status `422`. |
| `GET /skills` | The skills and instruction files each device finds in each folder; `?device=&root=` narrows it. See [Skills](../guides/skills.md). |

## Conversations

| Route | What it does |
| --- | --- |
| `GET /sessions` | Saved conversations, newest first. |
| `POST /sessions` | Start one: `{ model, device?, root?, autoApprove? }`. A chat has neither device nor root; a coding session needs both. |
| `PATCH /sessions/:id` | Rename: `{ title }`. |
| `DELETE /sessions/:id` | Delete it, including from disk. |
| `POST /sessions/:id/messages` | Send a message: `{ text, model?, effort?, skill? }`. `model` can be `auto`; `effort` is `default`, `low`, `medium`, `high`, `xhigh` or `max`; `skill` is `{ name, arguments? }` for a skill the person started. Returns `202`; follow the events. `409` if a turn is running. |
| `GET /sessions/:id/events?from=N` | Server-sent events from event number `N`: stored events, then live ones. The stored kinds are `user`, `text`, `thinking`, `tool`, `approval`, `compacted`, `skill`, `imported`, `done`, `cancelled` and `error`; live ones (`stage`, `thinking-delta`, `text-delta`) are never stored. |
| `POST /sessions/:id/approvals/:approvalId` | Answer an approval: `{ approve, always? }`. |
| `POST /sessions/:id/cancel` | Stop the running turn. |
| `POST /sessions/:id/compact` | Summarise the older turns now. |
| `GET /sessions/:id/usage` | The context meter and what each model has used in this conversation. |
| `GET /sessions/:id/export` | The conversation as markdown. |
| `POST /import/parse` | Split pasted text or a file's content into conversations: `{ name?, content }`. Saves nothing. |
| `POST /sessions/import` | Save a conversation from another tool: `{ title?, source?, model?, turns: [{ role, text }] }`. Nothing is sent to a model. |

## Usage and Claude

| Route | What it does |
| --- | --- |
| `GET /usage?days=N&offset=M` | Tokens used per day and per model; `offset` is the caller's minutes ahead of UTC, so days are the caller's local days. |
| `GET /claude/usage` | Claude's plan windows and whether it can be used now. |

## Web page

`GET /` and the web interface's own addresses (`/c/:id`, `/manage/:section`, `/import`) serve the page, and `/assets/:name` its files.

The tunnel devices connect to is described in the [tunnel protocol](tunnel-protocol.md).
