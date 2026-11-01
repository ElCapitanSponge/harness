---
title: Run the gateway on TrueNAS
description: Step by step from nothing to a gateway running as an app on TrueNAS and a first device connected to it
sidebar:
  order: 1
---

# Run the gateway on TrueNAS

The gateway is a container image, published to GitHub's container registry on every merge to `main` after the tests and an image smoke test pass: `ghcr.io/elcapitansponge/harness-gateway:latest`. TrueNAS runs it as a custom app. It needs no GPU and no Claude login; those live on your devices ([ADR 0004](../adr/0004-gateway-in-a-container-on-truenas-over-tailscale.md)).

## Before you start

- TrueNAS SCALE with Apps set up (a pool chosen for them).
- [Tailscale](tailscale.md) installed on the TrueNAS machine and signed in, so devices can reach it by a stable name.
- A secret key for the gateway. Make one on any machine with Node and keep it out of chat and repositories:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

- If the image is private, a GitHub token with only the `read:packages` scope, to log in with once (see [Updating the gateway](updating.md)).

## 1. Create the app

In **Apps**, choose **Discover Apps → Custom App** and fill in:

| Field | Value |
| --- | --- |
| Application name | `harness` (the update script assumes this name) |
| Image repository | `ghcr.io/elcapitansponge/harness-gateway` |
| Image tag | `latest` |
| Pull policy | **Always** |
| Environment variable | `HARNESS_API_KEY` = the key you made |
| Port | container port `8787`, published on node port `8787` |
| Storage | a host path or dataset mounted at `/data` (conversations and usage are kept there) |

Leave `HOST`, `PORT` and `HARNESS_ALLOW_ANY_INTERFACE` alone: the image sets them for a container. The gateway refuses to start on a network address without a key, so a missing `HARNESS_API_KEY` stops it with a message in the app's log.

Save, and wait for the app to show as running.

## 2. Check it

From any device on your tailnet (replace the name with your TrueNAS machine's):

```bash
curl http://truenas-scale:8787/nodes -H "authorization: Bearer <your key>"
```

An empty list `[]` is right: no device has connected yet. Opening `http://truenas-scale:8787` in a browser shows the sign-in page; paste the key to enter.

## 3. Connect the first device

On the machine with the models, follow the guide for its system: [Windows](windows.md), [macOS](macos.md) or [Linux](linux.md). Its `.env` needs two values:

```
GATEWAY_URL=http://truenas-scale:8787
HARNESS_API_KEY=<your key>
```

When the agent starts, the device appears under **Devices** in the web page within a few seconds, and `harness nodes` lists it.

## 4. Stay up to date

Set up the update job in [Updating the gateway](updating.md), or use **Stop** then **Start** on the app, which pulls the newest image because the pull policy is Always. Devices reconnect by themselves after the gateway restarts.

## If it does not work

See [Troubleshooting](../troubleshooting.md): the app log, an image that will not pull, and a device that connects but has no usable model.
