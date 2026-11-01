---
title: Troubleshooting
description: Problems met so far, what causes each, and how to fix it
sidebar:
  order: 7
---

# Troubleshooting

## A device is connected but no model can be used

Open **Devices**. The device is listed while its tunnel is open, but a request needs more than that:

- **It shows busy.** A program from its game list is running. Wait, or change **Game programs**.
- **Its models are not loaded and model control is off.** A model that is only available can be loaded by the gateway only if the device allows it. Turn on **Model control** on the Devices page (or `ALLOW_MODEL_CONTROL=1`), or load the model in LM Studio yourself.
- **LM Studio is not running.** The agent logs `inference server unreachable`. Start LM Studio's server; `INFERENCE_URL` must point at it.
- **Auto says nothing can be chosen.** Its message says why: no device connected, every device busy, a window too small for a coding session (under 8,000 tokens), or the conversation too long for any model. Pick a model yourself, or compact the conversation. See [Models](guides/models.md#auto).

## The Devices page or another page shows an error card

The device is running an older version than the gateway and reported fewer fields. Update and restart its agent (`git pull`, `pnpm install`, restart the task or service) and reload the page.

## A device does not appear

- Check the agent's log. `gateway rejected the API key` means `HARNESS_API_KEY` on the device differs from the gateway's. `gateway unreachable` means `GATEWAY_URL` is wrong or the gateway is down.
- Two devices with the same `NODE_ID` replace each other. Give each a unique name.
- Over Tailscale: both machines must be signed in, and an ACL must allow the device to reach the gateway's port ([Tailscale](guides/tailscale.md)).

## The TrueNAS app

- **The app will not start.** Open its log. `HARNESS_API_KEY` is missing: the gateway refuses a network address without a key.
- **The image will not pull (`unauthorized`).** The image is private; log in on the NAS with a token that has only `read:packages` ([Updating](guides/updating.md)).
- **The Update button is greyed out.** A custom app has no catalogue update. Use **Stop** then **Start** with the pull policy on Always, or the cron job in [Updating](guides/updating.md).
- **Which version is running?** `curl -s http://truenas-scale:8787/ | grep -o '/assets/index-[^"]*'` prints the page's hashed bundle name, which changes with every build.

## Claude

- **Claude is not in the model list.** A connected device must be logged in (`claude auth login`) and have Claude turned on. See [Claude](guides/claude.md).
- **Claude is greyed out with a time.** The plan's window is used up; it returns at that time ([Usage](guides/usage.md)).

## A coding session

- **No tools are offered.** The device exposes no project folder, or its tool groups are off. Check **Devices** ([Devices and their settings](guides/devices.md)).
- **A write or command is refused.** The folder is read-only, or tools on that device are set to Read only.
- **The model ignores the tools.** Some local models cannot call tools. Try another.
- **A command fails under PowerShell with `&&`.** Windows PowerShell 5.1 has no `&&` or `||`; install PowerShell 7 or chain with `;`.
- **The turn stopped with a message about the context.** The conversation is bigger than the model's window; the message gives the sizes. Compact it, or switch to a model with a larger window.

## The page

- **The page is wider than the screen or scrolls sideways.** Reload; an older build had this. If it persists after an update, report it.
- **An old page after an update.** Hard-reload (the gateway serves the new page on the next request).

## Importing

- **"That JSON is not a ChatGPT or Claude.ai export."** The file is JSON of another shape. Export again from the site, or paste the text.
- **A transcript came back as one message.** Its speakers were not recognised. Use **Split at blank lines** and assign each part, or add `## User` and `## Assistant` headings and try again ([Importing](guides/importing.md)).
