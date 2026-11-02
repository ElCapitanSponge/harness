---
title: The agent browser is a throwaway headless browser that cannot reach the local network
description: A model that needs a real browser drives a headless Chromium in a temporary profile per conversation, off by default, limited to the public web, with every action asked and audited.
sidebar:
  order: 11
---

# The agent browser is a throwaway headless browser that cannot reach the local network

Some pages cannot be read without a real browser: they need JavaScript, a click, a form. A device can offer the model a headless Chromium (driven with `playwright-core`, using a Chrome, Edge or Chromium already on the machine; nothing is downloaded). Because the model chooses where it goes and what it clicks, the browser is built to be thrown away and to reach only the public web.

**What it isolates.** Each conversation gets its own browser context in a browser started with a temporary profile: no cookies, saved logins, history, extensions or files of the owner's own browser, and nothing carried from one conversation to another. Downloads, notifications, location, camera and microphone are refused, service workers are blocked, a second window is closed at once. When the conversation ends (deleted, or idle for 15 minutes), or the agent exits, the context is closed; when no conversation has one left, the browser process exits and its profile is deleted.

**What it may reach.** Only `http` and `https`. A request whose host is, or resolves to, a private, loopback, link-local or tailnet address is refused, as are `file:` and every other scheme, unless the owner allowed local addresses (the same switch `web_fetch` uses). An owner who wants it tighter can name the hosts it may visit and nothing else is reached. This is checked for every request the page makes, not only the first, including the ones that follow a redirect. The check cannot pin the address the browser then connects to, as `web_fetch` does, so a name that changes its answer between the check and the connection is a known gap; the browser's profile and the opt-in below are what bound the harm.

**How it starts and stops.** It is off on every device and turned on by the owner (the Browser switch on the Devices page, or `ALLOW_BROWSER=1`). Nothing is started until a conversation first opens a page.

**What the model can do, and what asks.** Open a page, read it as text or as an accessibility tree, click, type, take a screenshot, close. Opening, clicking and typing ask first, because a click can submit a form and an address can carry information out; reading and screenshots do not. Every call is in the device's audit log. Screenshots go to the person's side panel; the model is told only that one was taken.

We rejected driving the owner's own browser (it holds their sessions), and a shared long-lived profile (cookies would leak between conversations). The cost is that nothing signed in is reachable, which is the point.
