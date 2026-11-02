---
title: The agent browser
description: A throwaway headless browser a coding session can drive to read and use pages that need a real browser, what it isolates, what it may reach, and how to turn it on
sidebar:
  order: 55
---

# The agent browser

Some pages cannot be read with a plain fetch: they need JavaScript, a click or a form. A device can offer the model a real, headless browser for those. It is built to be thrown away and to reach only the public web; the reasoning is in [ADR 0011](../adr/0011-the-agent-browser-is-a-throwaway-headless-browser-that-cannot-reach-the-local-network.md).

## Turning it on

It is **off on every device**. On the Devices page switch on **Browser** for a device (or start its agent with `ALLOW_BROWSER=1`). The device needs a Chrome, Edge or Chromium; Torii looks in the usual places and downloads nothing. If yours is somewhere else, set `BROWSER_PATH` to it. You can also name the only hosts it may visit (**Browser hosts**, or `BROWSER_HOSTS`); left empty, any public site is allowed.

Nothing is started until a conversation first opens a page.

## What the model can do

| Tool | Does | Asks first |
| --- | --- | --- |
| `browser_open` | Open an `http` or `https` address and read the page | yes |
| `browser_read` | Read the page again, as text or as an accessibility tree (to find what to click) | no |
| `browser_click` | Click something named by its visible text or a CSS selector | yes |
| `browser_type` | Type into a field named by its label, placeholder or selector, and optionally press Enter | yes |
| `browser_screenshot` | Take a screenshot | no |
| `browser_close` | Close the browser for this conversation | no |

Opening, clicking and typing ask because a click can submit a form and an address can carry information out; "Always allow" is available as for any tool. Every call is in the device's audit log, and the thread shows each action. A screenshot goes to the **Screenshots** section of the session panel for you to see; the model is told only that one was taken, so it reads the page with `browser_read` to know what is there.

## What it isolates

- **A temporary profile.** The browser starts with a profile that is deleted when it closes, and each conversation has its own context: no cookies, saved logins, history, extensions or files from your own browser, and nothing carried between conversations.
- **No extras.** Downloads, location, notifications, camera and microphone are refused, service workers are blocked, and a second window a site opens is closed at once.
- **It ends.** A conversation's browser is closed when the conversation is deleted, when it has been idle for 15 minutes, or when the agent exits. The browser process itself exits when no conversation has one open.

## What it may reach

Only `http` and `https`. Every request the page makes, not just the address the model opened, is checked: a host that is or resolves to a private, loopback, link-local or tailnet address is refused, as is `localhost`, `*.local` and every other scheme (`file:`, `chrome:`, `data:`, `ftp:`). The model is told when it is refused, and the refusal is in the audit log. `WEB_FETCH_ALLOW_LOCAL=1` on the device allows local addresses for the browser as for `web_fetch`; files stay refused either way.

**One known gap.** `web_fetch` pins the address it connects to, so a name that changes its answer between the check and the connection gains nothing. A browser connects by itself, so the same trick could get one request past the check. What bounds it is that the profile is empty and thrown away, that the browser is off unless you turn it on, and that you can limit it to named hosts.

## Verified

The checks (schemes, private addresses, named hosts, per-request guarding, cleanup of contexts and the browser) are tested with a stand-in for the browser. The real thing was run against Chrome on Windows: open, read as text and as a tree, screenshot, refusal of a local address and a file address, and the temporary profile gone after closing. macOS and Linux paths follow the same code but have not been run on those systems.
