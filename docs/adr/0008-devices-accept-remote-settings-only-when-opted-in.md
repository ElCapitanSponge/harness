---
status: accepted
---

# Devices accept remote settings only when started with REMOTE_CONFIG=1

The page can change a device's settings (project roots, allowed tools, model control, Claude, game processes) without editing its `.env`. Because project roots and allowed tools decide what the gateway can do on that machine (ADR 0003), a device only accepts a change if its owner started the agent with `REMOTE_CONFIG=1`. Without it the page shows the effective settings read-only.

The device is the source of truth. The gateway relays a change down the tunnel; the agent validates it, applies it live, saves it to a local settings file so it starts the same way when the gateway is down, and writes the change to its own audit log. A setting fixed by an environment variable always wins and is shown as locked, so an owner can pin the settings that matter and still allow the rest. We considered the gateway storing the wanted settings and pushing them on connect; that makes a compromised gateway able to widen a device's access after the owner closed it, and needs a second copy to keep in step.

Settings that need a new process (device name, gateway address, inference server address) are not remotely changeable.
