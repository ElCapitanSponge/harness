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
| `/manage/permissions` | The tools remembered as always allowed in a project, removable. See [Coding sessions](../guides/coding-sessions.md#permissions-modes-and-approvals). |
| `/import` | Bring in a conversation. See [Importing and exporting](../guides/importing.md). |

The sidebar lists conversations grouped by project (see [Projects in the sidebar](../guides/coding-sessions.md#projects-in-the-sidebar)) and has one **New conversation** button, whose arrow menu starts a code session, the Claude plan meter, links to Devices, Skills, Import and Usage, the theme switch (light, dark, system) and sign out. A page that fails while drawing shows a card with **Reload** instead of a blank screen; a device running an older version can cause that until it is updated.

## In a conversation

- **Next message goes to** picks the model for the next message (Auto or any model on any device, or Claude) and the effort. The header badge shows the model, or `Auto: <model>` once Auto has chosen. The model, effort and **Changes** choices open a list where each option has a second line saying what it means (a model's state, an effort level, what a mode allows), or why it cannot be chosen, and a badge where one matters (**risky**); the button shows only the label. It works from the keyboard (Enter or the arrows to open, the arrows to move, Enter to choose, Escape to close). Plain lists (a device, a folder) stay the browser's own select, so a phone shows its system picker.
- Under each reply: which model and device wrote it, and with Auto the reason it was chosen.
- The **context meter** shows how full the model's window is, with **Compact now**. Automatic compaction is marked by a tick on the bar and a divider in the thread. See [Usage](../guides/usage.md).
- The status line shows the stage of a request (finding a device, loading a model, waiting, thinking, writing). See [Progress](../guides/progress.md).
- **Changes** next to the message box sets the permission mode (ask, accept edits, plan first, run without asking).
- A tool the model wants to use that changes things shows an approval card with what will happen (the diff, the whole command and folder, or the new file): **Allow**, allow for this conversation, allow always in this project, or **Decline** with an optional reason. Declining ends the turn.
- A failed turn shows the reason and **Retry**.
- The conversation menu has **Pin to top**, **Rename**, **Export as markdown**, **Archive** and **Delete**. Archived conversations are listed in an **Archive** section at the bottom of the sidebar (closed until opened), and the menu there offers **Unarchive**. **Delete** asks first and offers **Archive instead**.
- In a coding session the panel button opens the plan and the changed files with their diffs ([Coding sessions](../guides/coding-sessions.md#the-session-panel)).
- A skill you start shows as a collapsed block; its text opens on a click.

## The message box

The message box takes markdown, and colours it as you type (see [Markdown in the message box](../guides/coding-sessions.md#markdown-in-the-message-box)). It stays open while the model works: a message sent then is queued (see [Sending while the model works](../guides/coding-sessions.md#sending-while-the-model-works)).

| Key | Does |
| --- | --- |
| Enter | Send. |
| Shift+Enter | New line; carries a list on. |
| Ctrl or Cmd+Enter | Send, including from inside a code block. |
| Ctrl or Cmd+B | Bold. |
| Ctrl or Cmd+I | Italic. |
| Ctrl or Cmd+E | Inline code. |
| Ctrl or Cmd+K | Link. |
| Paste or drop an image | Attach it (up to 4). The paperclip does the same. See [Images](../guides/models.md#images). |
| `/` at the start (coding sessions) | Open the skill menu. Up and Down move, Enter or Tab completes the name, Escape closes it. |

Inside a fenced code block Enter adds a line instead of sending, so code can be pasted whole. The toolbar has the same formatting as buttons and a **Preview**. What you typed and did not send is kept per conversation, so a refresh does not lose it.

## On a phone and other touchscreens

The layout adapts to the width of the screen (the sidebar is a drawer below the `md` width) and to how the screen is used. Where the browser reports a touchscreen (`pointer: coarse`, so a phone or tablet but not a mouse), the page changes in these ways:

- **Targets are 44px.** Buttons, fields, menu items, list rows, the toggles that open a tool action and the sidebar links are at least 44px tall, and an icon button is 44px square. Switches, checkboxes and the button that removes an attached image keep their look but can be tapped within 44px around them.
- **Nothing waits for hover.** The copy buttons (on a message and on a code block) and the **+** beside a project are shown all the time.
- **Choices have taller rows.** The model, effort and **Changes** lists are easier to tap.
- **Nothing scrolls sideways.** The conversation header and the row of pickers wrap onto a second line, a long folder, device or model name breaks instead of widening the page, and the context panel is never wider than the screen.
- **The keyboard does not cover the message box.** In browsers that support it (Chrome on Android) the page shrinks when the on-screen keyboard opens.

With a mouse none of this changes.
