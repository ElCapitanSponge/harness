---
title: Web interface reference
description: Every page of the web interface, what its controls do, and the keyboard shortcuts in the message box
sidebar:
  order: 5
---

# Web interface reference

The gateway serves the page at its own address. With a key set, the first screen asks for it; it is kept in the browser.

## Pages

| Address | Page |
| --- | --- |
| `/` | Start a conversation: **Chat** or **Code**, the model (**Auto** by default), the effort for models that take one, and for Code the device and folder. |
| `/c/:id` | A conversation. |
| `/manage/devices` | Devices and their settings. See [Devices and their settings](../guides/devices.md). |
| `/manage/skills` | Skills found on each device. See [Skills](../guides/skills.md). |
| `/manage/usage` | Tokens used per day and per model. See [Usage](../guides/usage.md). |
| `/import` | Bring in a conversation. See [Importing and exporting](../guides/importing.md). |

The sidebar lists conversations and has **New conversation**, the Claude plan meter, links to Devices, Skills, Import and Usage, the theme switch (light, dark, system) and sign out. A page that fails while drawing shows a card with **Reload** instead of a blank screen; a device running an older version can cause that until it is updated.

## In a conversation

- **Next message goes to** picks the model for the next message (Auto or any model on any device, or Claude) and the effort. The header badge shows the model, or `Auto: <model>` once Auto has chosen.
- Under each reply: which model and device wrote it, and with Auto the reason it was chosen.
- The **context meter** shows how full the model's window is, with **Compact now**. Automatic compaction is marked by a tick on the bar and a divider in the thread. See [Usage](../guides/usage.md).
- The status line shows the stage of a request (finding a device, loading a model, waiting, thinking, writing). See [Progress](../guides/progress.md).
- A tool the model wants to use that changes things shows an approval card: **Allow**, **Always allow <tool>** or **Decline**. Declining ends the turn.
- A failed turn shows the reason and **Retry**.
- The conversation menu has **Rename**, **Export as markdown** and **Delete**.
- A skill you start shows as a collapsed block; its text opens on a click.

## The message box

The message box takes markdown.

| Key | Does |
| --- | --- |
| Enter | Send. |
| Shift+Enter | New line; carries a list on. |
| Ctrl or Cmd+Enter | Send, including from inside a code block. |
| Ctrl or Cmd+B | Bold. |
| Ctrl or Cmd+I | Italic. |
| Ctrl or Cmd+E | Inline code. |
| Ctrl or Cmd+K | Link. |
| `/` at the start (coding sessions) | Open the skill menu. Up and Down move, Enter or Tab completes the name, Escape closes it. |

Inside a fenced code block Enter adds a line instead of sending, so code can be pasted whole. The toolbar has the same formatting as buttons and a **Preview**. What you typed and did not send is kept per conversation, so a refresh does not lose it.
