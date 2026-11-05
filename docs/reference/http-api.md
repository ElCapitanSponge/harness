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
| `GET /whoami` | The address the caller connects from and the connected agents that connect from the same address: `{ address, devices, likelyBehindPortPublishing }`. See [Coding sessions](../guides/coding-sessions.md#new-code-session-here). |
| `GET /nodes` | Connected devices with their models, busy state, project folders, tools and shell. |
| `GET /catalogue` | Everything that can be chosen, for the interface: each model on each device with what choosing it would do, and Claude. |
| `POST /devices/:nodeId/tools` | Run one read-only tool on a device: `{ root, name, args }`. Tools that change things are refused here. |
| `POST /devices/:nodeId/models/load` | Load a model: `{ model, contextLength? }`. The device must allow model control. |
| `POST /devices/:nodeId/models/unload` | Unload one model, or all if `model` is omitted. |
| `GET /devices/:nodeId/settings` | The device's effective settings, where each came from, which are locked, and whether it accepts changes. |
| `PUT /devices/:nodeId/settings` | Change settings: a partial object. Returns the new report, or the device's reason with status `422`. |
| `GET /skills` | The skills and instruction files each device finds in each folder; `?device=&root=` narrows it. See [Skills](../guides/skills.md). |

## Permissions

| Route | What it does |
| --- | --- |
| `GET /sidebar/collapsed` | The project groups collapsed in the sidebar, as `{ device, root }`. |
| `PUT /sidebar/collapsed` | Collapse or expand one: `{ device, root, collapsed }`. |
| `GET /rules` | The tools remembered as always allowed in a folder on a device. |
| `DELETE /rules/:id` | Remove one. |

## Skill library

| Route | What it does |
| --- | --- |
| `GET /library/skills` | The gateway's own skills, with `files` and `bytes`. |
| `POST /library/skills` | Add one: `{ zip }` (base64) or `{ files: [{ path, data }] }` (base64), and `overwrite?`. `409` if the name is taken, `422` with the reason if it is refused. |
| `GET /library/skills/:name/export` | The skill as a zip. |
| `DELETE /library/skills/:name` | Remove it. |

## Conversations

| Route | What it does |
| --- | --- |
| `GET /sessions` | Saved conversations, newest first. A sub-agent's conversation has a `parent`. |
| `POST /sessions` | Start one: `{ model, device?, root?, mode?, autoApprove? }` (`autoApprove` is the older name for mode `bypass`). A chat has neither device nor root; a coding session needs both. |
| `PUT /sessions/:id/read` | Say how far the person has read: `{ events }`, a count that only moves forward. Conversations report `read` beside `events`, and `waiting` (`approval` or `question`) while stopped for an answer. |
| `PATCH /sessions/:id` | Rename, pin and/or archive: `{ title?, pinned?, archived? }` (at least one). A pinned conversation reports `pinned: true` and an archived one `archived: true`; archiving also unpins. Archived conversations stay in `GET /sessions`. |
| `DELETE /sessions/:id` | Delete it, including from disk. |
| `POST /sessions/:id/messages` | Send a message: `{ text, model?, effort?, skill?, images? }`; `images` is up to 4 of `{ mediaType, data }` (PNG, JPEG, GIF or WebP, base64, up to 5 MB each). `model` can be `auto`; `effort` is `default`, `low`, `medium`, `high`, `xhigh` or `max`; `skill` is `{ name, arguments? }` for a skill the person started. Returns `202`; follow the events. `409` if a turn is running. |
| `GET /sessions/:id/events?from=N` | Server-sent events from event number `N`: stored events, then live ones. The stored kinds are `user` (with its `images`), `notice`, `text`, `thinking`, `tool`, `change` (a file a write or edit changed, with its diff), `plan`, `plan-document` (a version of the plan as markdown, with its `version`, its `markdown` and `by`: `model` or `person`), `approval`, `screenshot` (from the agent browser), `question` and `question-resolved`, `subagent` (a sub-agent the model started, with its conversation id, state and result), `compacting` (a compaction began, with `manual` and, for an automatic one, how full the context was as `percent`), `compacted` (it finished, with the counts), `compaction-failed` (with the `reason`), `skill`, `imported`, `done`, `cancelled` and `error`; live ones (`stage`, `thinking-delta`, `text-delta`) are never stored. Every stored event carries `at`, the time in milliseconds since the epoch (UTC) at which the gateway recorded it (for an imported conversation, the time its source gave); events stored before that was recorded have none. The `queued` messages a session lists carry `id`, `text`, `images` and `at`, the time each was queued. |
| `PUT /sessions/:id/mode` | Set the permission mode: `{ mode }`, one of `ask`, `edits`, `plan`, `bypass`. `403` for `bypass` when the gateway has it turned off. |
| `POST /sessions/:id/approvals/:approvalId` | Answer an approval: `{ approve, always?, reason?, plan?, next? }`; `always` is `true` (this conversation) or `"project"` (remember for the folder). For a plan, `plan` is the document as the person edited it (up to 20,000 characters, stored as a new version and sent to the model as the approved plan) and `next` is `ask` (the default) or `edits`, the mode the conversation takes once the plan is approved. |
| `POST /sessions/:id/questions/:questionId` | Answer a question the model asked: `{ answer }`. `404` if it was already answered or timed out. |
| `POST /sessions/:id/cancel` | Stop the running turn. |
| `POST /sessions/:id/compact` | Summarise the older turns now. |
| `GET /sessions/:id/tasks` | The commands the session has running in the background, as its device reports them; empty for a chat or an unreachable device. |
| `DELETE /sessions/:id/tasks/finished` | Forget the session's background tasks that have ended, on its device; running ones stay. Answers `{ cleared }`: `0` for a chat or an unreachable device, `404` for an unknown session, `501` when the device's agent is too old to have the tool. |
| `DELETE /sessions/:id/plan/done` | Take the steps that are done off the session's plan: a new `plan` event, and the model is told. Answers `{ cleared }`; `409` while a turn is running, `404` for an unknown session. |
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
