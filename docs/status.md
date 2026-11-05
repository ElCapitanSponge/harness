---
title: What has been tested, and what has not
description: The parts of Torii that were written but not yet run on a real machine, so nobody is surprised, and the follow-ups that close each gap
sidebar:
  order: 8
---

# What has been tested, and what has not

Everything in the repository has automated tests that run in CI. Some things also need a real machine of a kind the project's author did not have to hand. Those are listed here, with the follow-up that closes each one. Nothing below blocks other work.

| Not yet run on a real machine | What is untested | Follow-up |
| --- | --- | --- |
| **macOS agent service** | The launchd agent (`deploy/macos/com.harness.agent.plist`, started through `deploy/run-agent.sh`): that it starts at login, restarts after a crash, and keeps `.env` private. See [Set up a macOS device](guides/macos.md). | [#105](https://github.com/ElCapitanSponge/harness/issues/105) |
| **Linux agent service** | The systemd user unit (`deploy/linux/harness-agent.service`): that it starts at login, restarts after a crash, and keeps `.env` private. See [Set up a Linux device](guides/linux.md). | [#105](https://github.com/ElCapitanSponge/harness/issues/105) |
| **The agent itself on macOS and Linux** | The agent's code is the same on every system and is tested on Linux in CI, but it has only been run for real on Windows. | [#105](https://github.com/ElCapitanSponge/harness/issues/105) |
| **Needs-you badge** | The count badge on the desktop app's icon (Dock, launcher, Windows taskbar dot) has tests for what it draws and says, but has not been seen on a real macOS or Linux desktop, or on Windows. | [#107](https://github.com/ElCapitanSponge/harness/issues/107) |
| **Browser notifications** | The bell that turns on notifications when the model needs an answer and the page is in the background has component tests, but has not been seen working in a real browser. | none yet |
| **Phone layout** | The touch sizes, wrapping and hover alternatives in [On a phone](reference/web-interface.md#on-a-phone-and-other-touchscreens) were set from the code, not measured or seen on a phone, and the keyboard behaviour depends on the browser (Chrome on Android resizes the page; Safari on iOS may not). Icon-only buttons still rely on a `title` that touch does not show. | none yet |
| **The agent browser on macOS and Linux** | It was run for real against Chrome on Windows. The macOS and Linux paths to Chrome, Edge and Chromium are tested only as code. | [#105](https://github.com/ElCapitanSponge/harness/issues/105) |
| **The desktop app on macOS, Ubuntu and Arch Linux** | CI builds it for each, but it has only been run for real on Windows: install, connect, the system pickers, start at login, the keyring on Linux. See [The desktop app](guides/desktop.md). | [#107](https://github.com/ElCapitanSponge/harness/issues/107) |

If you set one of these up and something needed changing, say so on the follow-up, and this page will be updated when the gap is closed.
