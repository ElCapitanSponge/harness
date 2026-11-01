---
title: Reach the gateway over Tailscale
description: Use Tailscale so every device can reach the gateway by name, with the port closed to everyone else
sidebar:
  order: 2
---

# Reach the gateway over Tailscale

Torii is meant to be reachable only on your own network and your tailnet. Traffic between tailnet devices is already encrypted by Tailscale (WireGuard), so plain `http://` is fine there. Never forward the port to the public internet or enable Tailscale Funnel for it; the [security model](../security.md) assumes that.

## The usual setup

Run the gateway on an always-on machine ([TrueNAS](truenas.md)) with Tailscale installed on it, and give each device the gateway's tailnet name in `GATEWAY_URL`, for example `http://truenas-scale:8787`. Tailscale's MagicDNS makes the name work from every device.

## Running the gateway on a desktop instead

Until the gateway has its own always-on home, you can run it on the desktop and call it from any device on your tailnet.

1. Copy `.env.example` to `.env` and set `HARNESS_API_KEY` (the example shows how to generate one). Keep `HOST=127.0.0.1,tailscale`: `tailscale` means this machine's Tailscale IPv4 address.
2. Make sure Tailscale is signed in on the desktop. If it is down, the gateway logs a warning and still serves loopback.
3. On Windows, allow the port in through the firewall, limited to tailnet addresses (once, in an administrator PowerShell):

   ```powershell
   New-NetFirewallRule -DisplayName "harness gateway (Tailscale)" -Direction Inbound -Protocol TCP -LocalPort 8787 -RemoteAddress 100.64.0.0/10 -Action Allow
   ```

4. Start `pnpm gateway` and `pnpm agent`. The gateway logs the address it listens on.
5. From the other device, use the desktop's Tailscale address or MagicDNS name:

   ```bash
   export HARNESS_URL=http://<desktop-tailscale-name-or-ip>:8787
   export HARNESS_API_KEY=<the key from the desktop's .env>

   curl "$HARNESS_URL/nodes" -H "authorization: Bearer $HARNESS_API_KEY"

   curl "$HARNESS_URL/v1/chat/completions" \
     -H "authorization: Bearer $HARNESS_API_KEY" -H "content-type: application/json" \
     -d '{"model":"auto","messages":[{"role":"user","content":"hello"}]}'
   ```

   Any OpenAI-compatible client works too: set its base URL to `$HARNESS_URL/v1` and its API key to the harness key.

## Locking it down

The gateway refuses to listen on any address other than loopback unless `HARNESS_API_KEY` is set, and refuses `0.0.0.0` or `::` unless `HARNESS_ALLOW_ANY_INTERFACE=1` (the container image sets that). A Tailscale ACL that lets only your own devices reach the gateway port is in the [security model](../security.md#tailscale-acl-example).
