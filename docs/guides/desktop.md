---
title: The desktop app
description: Install the Torii desktop app on Windows, macOS, Ubuntu or Arch Linux to use this machine's folders and files in coding sessions, without a terminal or a .env
sidebar:
  order: 7
---

# The desktop app

A browser cannot read a machine's files. The desktop app is the way to use the files of the machine in front of you: it shows the same interface as the browser (served by your gateway, so it is always the current one), and it **runs the node agent for this machine itself**. There is no terminal, no `.env` and no matching of devices: the machine is a device, it knows which one it is, and folders and files are chosen with the operating system's own pickers. The decisions behind it are in [ADR 0012](../adr/0012-the-desktop-app-is-electron-and-runs-the-agent-in-a-child-process.md). The web interface in a browser keeps working for anything else.

## Install

Builds for each system are produced by CI (the **desktop** workflow's artifacts). Nothing is signed or notarized yet, so each system warns once.

| System | File | Notes |
| --- | --- | --- |
| **Windows** | `Torii Setup *.exe` (installer) or the `.zip` | SmartScreen may say the publisher is unknown: choose **More info**, then **Run anyway**. |
| **macOS** | `Torii-*.dmg` (drag to Applications) or the `.zip` | Because it is not notarized, open it the first time with a right-click, **Open**, or allow it in System Settings, Privacy & Security. |
| **Ubuntu** | `torii_*.deb`: `sudo apt install ./torii_*.deb` | Or the AppImage (below). |
| **Arch Linux** | `Torii-*.AppImage` or the `.tar.gz` | The AppImage needs FUSE 2: `sudo pacman -S fuse2`. Or unpack the `.tar.gz` and run `torii`. |
| Any Linux | `Torii-*.AppImage` | `chmod +x Torii-*.AppImage`, then run it. On Ubuntu 22.04 and later it needs `sudo apt install libfuse2`. |

## First run

The app asks for three things, once:

1. **The gateway's address**, such as `http://truenas-scale:8787`.
2. **The key**, if the gateway has one.
3. **A name for this machine**, filled in from its host name.

It checks them (a wrong key or an unreachable address is said plainly, in a sentence) and then shows the gateway's interface, already signed in. The key is stored encrypted with the system's credential store (Windows, the macOS Keychain, or the Secret Service on Linux). On Linux without a keyring running (for example a bare Arch install with no GNOME Keyring or KWallet) there is nowhere safe to keep it, so the app does **not** remember the key and asks for it each time it starts.

## What it does

- **The device is known.** "New code session here" in the sidebar starts a session on this machine, with no address matching and no "which device is this?" question.
- **Folders.** On the **Devices** page, this machine's card has **Add a folder...**, which opens the operating system's folder picker. The choice is added to the project folders for you to save, and everything about it (read-only folders, tool levels) works as for any device.
- **Choose a folder to work in.** On the start screen, **Code** has **Choose a folder...** (desktop app only), which opens the system folder picker, as Claude Code does. The folder is added to this machine's project folders (the same setting as Devices, so read-only folders and tool levels still apply), the app waits until the agent lists it, and the session is set to start there. A folder that is already a project is reused, not added twice, and if the device does not list the folder within 15 seconds it is taken out again and the screen says so. A device whose folders are fixed by `PROJECT_ROOTS` in its environment cannot add folders from here. A browser cannot read a machine's files, so it keeps the list of project folders already set up on each device, plus your recent folders.
- **Files in a message.** The **Add files as context** button in the message box opens the system file picker (any file on this machine, not just a project folder) and puts each file's text into your message in a code block with its path. Text only, up to 200 KB a file. In a coding session the panel's **Files in** section also browses the project folder on its device and adds a file with one click.
- **The agent.** It starts with the app, restarts if it crashes (after 2, 5, 15 and 30 seconds, then it gives up and says so), and stops when you quit. Everything else about it is set on the Devices page, as for any agent: the settings are saved in the app's data folder, and remote configuration is on.
- **Tray or menu bar.** It shows whether the agent is connected, and offers Open, Open in the browser, Start or Stop the agent, Change gateway, **Start at login**, and Quit. Closing the window leaves the app in the tray with the agent running.
- **Start at login.** On Windows and macOS it is a login item; on Linux an autostart entry in `~/.config/autostart` (Ubuntu, Arch and any desktop that follows the freedesktop standard). It starts hidden in the tray.
- **Notifications.** When the model needs an approval or an answer and the window is in the background, you get an operating system notification (allow them with the bell in the header, as in a browser). This covers **every** conversation, not only the open one: you are told when any conversation starts to need you, and clicking the notification brings the window forward on it.
- **A badge for conversations that need you.** The count shows on the Dock icon (macOS), the launcher icon where the desktop supports badges (Linux), and as a dot over the taskbar icon (Windows); the tray's tooltip and menu say how many. It goes down as you answer.

## Where things are kept

The app's data folder (`%APPDATA%\Torii` on Windows, `~/Library/Application Support/Torii` on macOS, `~/.config/Torii` on Linux) holds `desktop.json` (the gateway, your machine's name, the key encrypted), `agent-settings.json` (the Devices page's settings for this machine) and `audit.log` (every tool call the gateway made here). Remove the folder to start again. It is separate from the `pnpm agent` setup: if you also run that agent on the same machine under another name, the machine shows up as two devices, so use one or the other.

## Build it yourself

```bash
pnpm install
node packages/desktop/node_modules/electron/install.js   # once: downloads Electron
pnpm --filter @harness/desktop start                     # build and run
pnpm --filter @harness/desktop dist                      # installers for this system, in packages/desktop/release
```

## Verified

The pieces that decide behaviour (the config and its encryption, the agent's lifecycle and restarts, the tray menu, the Linux autostart entry, the file reading, the gateway checks) have tests. The app was built and run for real on **Windows**, from source and as an installed layout: the connect page rejects a wrong key, the window shows the gateway's interface signed in, the page is told which device it is, and the agent starts from the packaged app and shows up on the gateway. **Not yet run: macOS, Ubuntu and Arch Linux** (CI builds them); see [what has not been tested](../status.md) and the follow-up [#107](https://github.com/ElCapitanSponge/harness/issues/107).
