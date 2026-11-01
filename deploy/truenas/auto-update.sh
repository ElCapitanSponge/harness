#!/bin/sh
# Keeps the Torii gateway on TrueNAS running the newest published image.
#
# Run it from System > Advanced > Cron Jobs (user root, every 15 minutes). It pulls the image and, only if the image
# changed, redeploys the app, so there is no restart (and no downtime) when nothing is new. See docs/guides/updating.md.

IMAGE="${IMAGE:-ghcr.io/elcapitansponge/harness-gateway:latest}"
# The app's name as shown on the Apps page.
APP="${APP:-harness}"

before=$(docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null)

# A failed pull (offline, registry down, login expired) leaves the running gateway alone.
if ! docker pull -q "$IMAGE" >/dev/null 2>&1; then
  echo "torii-update: could not pull $IMAGE; leaving the gateway as it is"
  exit 0
fi

after=$(docker image inspect -f '{{.Id}}' "$IMAGE")

if [ "$before" = "$after" ]; then
  exit 0
fi

echo "torii-update: new image $after; redeploying $APP"
midclt call -job app.redeploy "$APP"
