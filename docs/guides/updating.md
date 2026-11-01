---
title: Keeping the gateway up to date on TrueNAS
description: Pull policy and a cron job that redeploys the gateway when a new image is published
sidebar:
  order: 80
---

# Keeping the gateway up to date on TrueNAS

Every merge to `main` publishes `ghcr.io/elcapitansponge/harness-gateway:latest` after the tests and the image smoke test pass. TrueNAS does not watch the registry, so something has to pull it. Two parts make that automatic.

## 1. Pull policy

In the app's Edit form (or `pull_policy: always` in its YAML), set the pull policy to **Always**. A redeploy then pulls the newest image instead of reusing the one it has.

## 2. A cron job that redeploys when the image changes

[`deploy/truenas/auto-update.sh`](../../deploy/truenas/auto-update.sh) pulls the image and redeploys the app only if the image is new, so nothing restarts when there is nothing to update.

1. Copy the script onto the TrueNAS box, for example to `/mnt/<pool>/harness/auto-update.sh`, and make it executable (`chmod +x`).
2. Open **System > Advanced > Cron Jobs > Add**. Set the command to the script's path, the user to `root`, and the schedule to every 15 minutes (`*/15 * * * *`). Tick **Hide Standard Output** off so the log shows when it redeploys.
3. If your app is not called `harness` on the Apps page, put its name in `APP=` at the top of the script, or add `APP=<name>` before the path in the command.
4. Run the job once from the Cron Jobs list (**Run Now**) and check the output. A pull failure prints `could not pull` and leaves the gateway running.

If the pull says `unauthorized`, the image is private and root on TrueNAS needs a login: `sudo docker login ghcr.io` with a GitHub token that has only the `read:packages` scope. Keep that token on the NAS and out of chat and the repository.

If `midclt call -job app.redeploy` is not found on your TrueNAS version, redeploy from the UI once and tell us the version; the command name changed between releases.

## What happens to the agents

A redeploy drops the tunnel for a few seconds. Each node agent reconnects by itself (it retries from one second up to thirty), so devices reappear without any action.

## Being sure what is running

The new page shows no version yet. From a device, `curl -s http://truenas-scale:8787/ | grep -o '/assets/index-[^"]*'` prints the hashed bundle name, which changes with every build.
