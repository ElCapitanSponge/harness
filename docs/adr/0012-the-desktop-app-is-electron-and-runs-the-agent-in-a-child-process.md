---
title: The desktop app is Electron and runs the agent as a child process
description: The desktop app shows the gateway's own web interface in a window, runs this machine's agent for it, and gives sessions the operating system's folder picker, on Windows, macOS, Ubuntu and Arch Linux.
sidebar:
  order: 12
---

# The desktop app is Electron and runs the agent as a child process

A browser cannot read a machine's files, and a person who wants to work on the files of the machine in front of them should not need to run a terminal, edit a `.env` or work out which device they are. The desktop app is that machine's front door: it shows the same web interface as any browser (served by the gateway, so there is one interface to build and fix), and it runs the node agent for this machine, so the machine is a device with no setup and its folders are chosen with the operating system's folder picker.

**Electron, not Tauri.** The agent, the tools and the interface are all TypeScript on Node. Electron lets the app run the agent with the Node it already ships, share its code and tests, and be built by the same toolchain, on Windows, macOS, Ubuntu and Arch with one set of sources. Tauri would add Rust and would still need a Node sidecar for the agent. The cost is size (a Chromium per install) and memory; the interface window is what uses it, and the agent itself stays the single bundled process it already is (see [How much memory the agent uses](../guides/devices.md#how-much-memory-the-agent-uses)).

**The window shows the gateway's interface.** The app does not carry a copy of the web interface: it opens the gateway the person chose, so an update to the gateway updates the interface everywhere. The gateway address and key are asked for once, on a small page of the app's own, and remembered; the key is kept encrypted with the operating system's credential store (Electron's `safeStorage`) and put into the page's session as the browser sign-in does.

**The app is the device.** It runs the agent as a child process of its own (the bundled `agent.mjs`, with the app's Node), giving it the gateway address, the key, this machine's name and a settings file in the app's data folder, with remote configuration on, so everything else is set from the Devices page like any other agent. The window is told which device it is (`window.torii`), so "New code session here" needs no matching and no choice. Start, stop and the connection state are in the tray or menu bar; the agent stops when the app quits. The app can start at login (the login item on Windows and macOS, an autostart entry on Linux).

**Folders and notifications.** Adding a project folder opens the operating system's folder picker, and the choice is saved as a project root through the same settings the Devices page uses, so the device's own rules (read-only folders, tool levels) still apply. Approval requests reach the person as operating system notifications through the interface's notification support.

**What it trusts and does not.** The window loads only the gateway address the person chose, with Node integration off and context isolation on; the only things the page can ask of the app are the few calls in `window.torii` (the device name, the agent's state, start, stop and the folder picker). The key is never given to the page except as the sign-in it would have typed. The agent keeps every limit it has today: the folders it exposes and the tools it allows are the device's own settings.

**Packaging and updates.** electron-builder produces an installer for Windows, a disk image and archive for macOS, and an AppImage, a `.deb` (Ubuntu) and a `.tar.gz` for Linux, which Arch users run as the AppImage or unpack, in CI for each. Self-updating is not part of this first version: a new version is a new download, and the interface itself already updates with the gateway.
