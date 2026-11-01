---
title: Auto mode chooses the model by plain rules, and says why
description: Auto is a choice in the model picker.
status: accepted
sidebar:
  order: 10
---

# Auto mode chooses the model by plain rules, and says why

Auto is a choice in the model picker. With it, nobody picks a device or a model: before each turn Torii chooses one model on one device (or Claude), loads it if it is not loaded, and the reply says which model answered and why. The choice is made by rules over what is known, written as a pure function of the conversation and the pool, so it can be tested and its reasons read. We considered asking a small model to route each turn, which is unpredictable, costs a model call before every message and can load the wrong model for reasons nobody can inspect; it stays an optional later step on top of the rules.

**What it looks at.** The size of the conversation against each model's window (a model that would not hold it plus room for a reply is never chosen); whether the turn is a coding session, which needs tools and so a model with a window of at least 8,000 tokens, larger ones first; which devices are connected and not busy, and which models are loaded (loaded beats load-on-use); Claude's state (never while it is limited); and the owner's preferences (`HARNESS_AUTO_PREFER`, `HARNESS_AUTO_AVOID`, `HARNESS_AUTO_KEEP_FREE`, set on the gateway).

**Order of the rules.** The model that answered last stays if it still fits and is ready, so a conversation does not move around for no reason. Otherwise the best local candidate, ranked by the owner's preference order, then loaded before not loaded, then (for a chat) the smaller window, because a short question does not need the largest model. Claude is chosen when no local model fits or is ready, when the owner puts it first, or when the conversation is already close to the best local window (above three quarters of it), and only while its limits allow. If nothing can be chosen, the turn stops at once with the reasons, not with a timeout.

**What it may load or unload.** Only what the existing loader does for any model: load the chosen model on its device, unload that device's others first to make room, one load at a time per device. It never loads on a device that is busy, that is on the keep-free list, or that does not allow the gateway to control its models; it never unloads anything itself. Models are unloaded when idle by the agent (ADR 0008's idle unload).

**How it is overridden.** Picking any model in the picker takes Auto off for the next message; picking Auto again puts it back. The window used for an unloaded model is the default the loader loads it with (32,768 tokens, or the model's own maximum if smaller). Model size is not known to the gateway, so the window is the only size signal; the owner's preference list is how to say "this one first".
