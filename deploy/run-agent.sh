#!/bin/sh
# Starts the node agent for a service manager (launchd or systemd). Settings come from .env in the repo root.
set -eu

cd "$(dirname "$0")/.."

# Service managers start with a minimal PATH, so add the usual places node and pnpm live.
PATH="$HOME/.local/share/pnpm:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH

# .env holds the gateway key, so keep it private to this user.
if [ -f .env ]; then
  chmod 600 .env
fi

exec pnpm --silent agent
