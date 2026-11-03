---
title: Claude in Torii
description: How Claude answers through a logged-in device, what reaches it, effort levels and plan limits
sidebar:
  order: 30
---

# Claude in Torii

Claude answers through a device that is logged in to it: the gateway sends the request down that device's tunnel and the agent runs the official `claude` program with the owner's own login and plan. The harness never reads or forwards the login. Turn Claude on for a device on the Devices page (or `CLAUDE_ENABLED=1`).

## In chats and coding sessions

Claude is a choice in every kind of conversation, coding sessions included. The `claude` program cannot be handed Torii's tool definitions, so tools are done in the prompt: Claude is told which tools there are and the exact form of a request for one (`<tool_call>{"name": ..., "arguments": {...}}</tool_call>`), the history shows each earlier request and its result in that form, and the reply is read for requests, which become ordinary tool calls for the same loop local models use. Approvals, read-only folders and the allowed tools apply exactly as for any other model. A request for a tool that is not offered is not run, and the reply says so.

## What reaches Claude

Each call runs the program from an empty folder with its own system prompt replaced by Torii's, with no extra tool servers or skills from your own setup, and with its own built-in tools off. So a chat is not coloured by your personal Claude Code configuration or memory files, and a call carries about 1,300 input tokens of overhead where the default carries over 20,000.

A long system prompt (over 6,000 characters, which happens when many tools are offered) is not put on the command line, where the operating system would refuse it with `spawn ENAMETOOLONG`. It is written to a temporary file in that same folder, handed over with `--system-prompt-file`, and deleted when the call ends. A short one is passed inline.

## Effort

Models that can be told how hard to think show an **Effort** choice next to the model picker: Default, then low, medium, high, xhigh and max for Claude (the program's `--effort`), and low, medium and high for the gpt-oss models (sent as the reasoning effort). A model that cannot be told shows no control. The choice belongs to the conversation, applies from the next message, and moving to a model with fewer levels uses its nearest one. Choose Default to leave it to the model.

## Which models, and what they cost

`claude` uses your account's default; `claude:sonnet`, `claude:opus` and `claude:haiku` ask the program for that alias, which it resolves to the newest version of the family it has. At the time of writing that is Claude Sonnet 5.5 (`claude-sonnet-5-5`), Opus 5.5 (`claude-opus-5-5`) and Haiku 5.5 (`claude-haiku-5-5`), and the default is Sonnet 5.5.

### Which model actually answered

The gateway does not guess the model. It reads it from what the `claude` program reports for the call (its start message, the reply, or the usage it counted), and:

- The reply is labelled with that model, for example `claude-sonnet-5-5`, even when you chose plain `claude` and the program picked the model itself.
- The model picker shows it beside Claude once a reply has named it (**Claude (through bastila), using claude-sonnet-5-5**), and changes if the program starts using another.
- The [Usage](usage.md) ledger records that model, and the context meter uses the window the program reports for it. If the program reports none, the meter assumes 200,000 tokens, as before.
- If the program names no model, the reply says **Claude (model not reported)** and the picker names none. Nothing is invented.

A coding session takes several model calls for one request (each tool result is another call). So that those do not each pay for the whole conversation again, the gateway keeps the program's own conversation for each Torii conversation and sends only what is new at each step, through the program's `--resume`; its prompt cache then covers everything before. The conversation starts again, with the whole transcript, when the history changed (compaction, rewind, an edit), when the model or device differs, or after a gateway restart, so those steps cost more once. The program keeps the conversation files in its usual place under a folder named for Torii's own working folder, and Torii removes ones unused for three days.

## Where the login lives

The gateway does not run Claude itself. A device that is logged in to the official `claude` CLI answers Claude requests (turn Claude on for it on the Devices page, or start its agent with `CLAUDE_ENABLED=1`), so requests use that login and its plan limits. Claude models appear in `/v1/models` and the model picker only while such a device is connected, and a gateway in a container needs no login. The harness does not extract or proxy credentials ([ADR 0001](../adr/0001-claude-through-the-official-cli.md)). Usage is shared with everything else on that account.

## Limits

The plan's five-hour and weekly windows are shown in the sidebar and on the Usage page, and Claude is set aside, with the time it returns, if a request is refused for hitting a limit (see [usage.md](usage.md)).
