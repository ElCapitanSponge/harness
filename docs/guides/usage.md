---
title: Usage, context and compaction
description: Where tokens go, the context meter, compacting a conversation, and the Usage page
sidebar:
  order: 40
---

# Context and usage

Every model call is written to a **ledger** in the gateway's database: when, which conversation, which device and model, the prompt and completion tokens, how long it took, and the model's context window. The ledger survives restarts and keeps a deleted conversation's calls, so totals do not shrink when a chat is tidied away.

## Where the numbers come from

The gateway asks the model server for its own counts (`stream_options.include_usage`). If a server reports none, the gateway estimates about four characters to a token and marks the number as an **estimate**: the page shows it with a `~`. Claude is always an estimate today, because the `claude` program reports no counts through the gateway, and its window is assumed to be 200k tokens.

## In the page

- **Context meter** in a conversation's header: tokens in the conversation after the latest call, against the model's window, with a bar that turns amber at 75 percent and red at 90. Click it for the per-model breakdown (calls, tokens in, tokens out).
- **Usage** page (`/manage/usage`): totals for today, 7 days and 30 days, a per-day chart coloured by model, and tables by model and by device. Days start at your browser's midnight.

## API

- `GET /sessions/:id/usage` returns the last call's counts and window and the totals per model for that conversation.
- `GET /usage?days=7&offset=600` returns totals, per-model and per-device tables and per-day rows. `days` counts days ending today (1 to 366); `offset` is your minutes ahead of UTC.

## Compaction

A long conversation is kept going by **compaction**: the older turns are replaced, in what is sent to the model, by a short summary the model writes. The system prompt and the two most recent turns stay exactly as they were, and a tool call always stays with its result. What you see in the conversation does not change; a line marks where it happened and how much it freed.

- **Automatic.** Before a message is sent, if the last call left the context at or past the threshold (default 80 percent), the conversation compacts first, and the status line says so. A tick on the meter's bar marks the threshold. Set `HARNESS_COMPACT_AT` on the gateway to change it (a percent from 1 to 99), or `0` to turn it off. If the summary cannot be written the message still goes ahead, and compaction is not tried again until another model call has been made.
- **Manual.** Open the context meter and press **Compact now**, or `POST /sessions/:id/compact`. It refuses while a reply is running, and says so when there is nothing older than the recent turns to summarise.
- After a compaction the meter shows the smaller size as an estimate until the next reply reports the exact one.

## The Claude plan

The `claude` program reports the plan with each reply: how much of the five-hour window and of the week is used, and when each resets. The sidebar and the Usage page show how much is left and a countdown. Nothing can be shown before the first Claude reply, and the page says so.

A window reading 100 percent does not mean Claude stopped: a plan with extra usage keeps working, and the page then says it is using extra usage. Claude is treated as **limited** only when a request is actually refused for a usage limit. Until it resets, the gateway lists no Claude models (`/v1/models`), greys them out in the picker with the time they return, answers Claude requests at once with `429` and a `Retry-After`, and new conversations default to a local model. Claude comes back by itself at the reset time. The limited state is held in memory, so after a gateway restart the first refusal brings it back.

`GET /claude/usage` returns what the gateway knows.
