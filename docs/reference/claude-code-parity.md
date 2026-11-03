---
title: Claude Code parity
description: What Torii already does that Claude Code desktop and the CLI do, and what it still lacks, so a move between them is not a surprise
sidebar:
  order: 6
---

# Claude Code parity

Torii is meant to replace Claude Code desktop and the Claude Code command line in daily use. This page is the checklist of what matches and what does not yet. It is kept in step with the tracking issue [#112](https://github.com/ElCapitanSponge/harness/issues/112); a gap gets its own ticket, with blockers, when it is picked up.

## Matches

| Claude Code | In Torii |
|---|---|
| Permission modes (ask, accept edits, plan, bypass) and approval cards that show what will happen | [Permissions: modes and approvals](../guides/coding-sessions.md#permissions-modes-and-approvals) |
| Plan mode with an approval step | Same section |
| Sub-agents | [Sub-agents](../guides/coding-sessions.md#sub-agents) |
| Skills and the slash menu | [Skills](../guides/skills.md) |
| Built-in commands (`/compact`, `/clear`, `/model`, `/permissions`, `/init`) | [Built-in commands](../guides/coding-sessions.md#built-in-commands) |
| `@` file mentions | [Mentioning files with @](../guides/coding-sessions.md#mentioning-files-with-) |
| Questions the model asks you | [Questions from the model](../guides/coding-sessions.md#questions-from-the-model) |
| Images in a message | [Coding sessions](../guides/coding-sessions.md) |
| Commands that run in the background | [Commands in the background](../guides/coding-sessions.md#commands-in-the-background) |
| Changed files with diffs | [The session panel](../guides/coding-sessions.md#the-session-panel) |
| Tool calls folded into a collapsible group with a summary line | [Actions in the thread](../guides/coding-sessions.md#actions-in-the-thread) |
| Queuing a message while the model works, with send now | [Sending while the model works](../guides/coding-sessions.md#sending-while-the-model-works) |
| Picking a folder to work in | [Desktop app](../guides/desktop.md) (system folder picker) |
| Sessions grouped by project, pinned sessions, working / needs-you / unread marks | [Projects in the sidebar](../guides/coding-sessions.md#projects-in-the-sidebar) |
| Told when a session needs you, with a badge on the app's icon | Same section, and the [desktop app](../guides/desktop.md) |
| Importing and exporting conversations | [Importing](../guides/importing.md) |
| A desktop app that runs the agent | [Desktop app](../guides/desktop.md) |
| Compaction with a context meter | [Coding sessions](../guides/coding-sessions.md) |

## Still missing

An item with a number has its ticket; each of the others gets one, with its blockers, before work on it starts.

- [ ] **Rewind to a checkpoint.** Undo a session's file changes and conversation back to an earlier turn.
- [ ] **MCP servers.** Tools from Model Context Protocol servers, configured per device or project.
- [ ] **Hooks.** Commands that run before or after a tool call or at the end of a turn.
- [ ] **A git worktree for each session.** Sessions that work on the same project without touching each other's files.
- [x] **Resume and continue on the command line.** `harness code --resume` and `--continue` for the sessions the gateway keeps (#126).
- [x] **A print mode on the command line.** `harness code -p` for scripts: it never asks, can print JSON with `--output-format json`, and exits non-zero unless the turn ended with a reply (`claude -p`, #145).
- [ ] **A status line.** A line of the person's own choosing under the message box (#144, waiting on the owner's answers).
- [ ] **Output styles.** Changing how the model words its replies.
- [ ] **Editing a project's memory from the page.** Viewing and editing `AGENTS.md` and `CLAUDE.md` without leaving the conversation (`/init` writes one, but there is no editor; #146).

## Differences on purpose

- Torii runs the model and the tools on different machines, so a session names a **device** and a **project folder** on it; there is no "current directory".
- Local models come from LM Studio through a node agent, and Claude is driven through the official `claude` command on a logged-in device (see [ADR 0001](../adr/0001-claude-through-the-official-cli.md)). It does not use a Claude API key.
