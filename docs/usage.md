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

## Not yet

Automatic compaction when a context nears its limit, and the Claude plan's remaining time and weekly allowance, are still to come (see issue 40).
