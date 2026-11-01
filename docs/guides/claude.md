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

## Effort

Models that can be told how hard to think show an **Effort** choice next to the model picker: Default, then low, medium, high, xhigh and max for Claude (the program's `--effort`), and low, medium and high for the gpt-oss models (sent as the reasoning effort). A model that cannot be told shows no control. The choice belongs to the conversation, applies from the next message, and moving to a model with fewer levels uses its nearest one. Choose Default to leave it to the model.

## Where the login lives

The gateway does not run Claude itself. A device that is logged in to the official `claude` CLI answers Claude requests (turn Claude on for it on the Devices page, or start its agent with `CLAUDE_ENABLED=1`), so requests use that login and its plan limits. Claude models appear in `/v1/models` and the model picker only while such a device is connected, and a gateway in a container needs no login. The harness does not extract or proxy credentials ([ADR 0001](../adr/0001-claude-through-the-official-cli.md)). Usage is shared with everything else on that account.

## Limits

The plan's five-hour and weekly windows are shown in the sidebar and on the Usage page, and Claude is set aside, with the time it returns, if a request is refused for hitting a limit (see [usage.md](usage.md)).
