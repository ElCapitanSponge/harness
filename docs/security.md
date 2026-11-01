# Security model

The harness lets one service (the gateway) read files and run commands on every connected device. That is the point, and it is also the main risk. This page says what is protected, what is not, and how to tighten it.

## What you are trusting

- **The gateway.** It decides which tool calls to send. A compromised gateway can ask any connected device to run any tool that device allows, in any project root it exposes.
- **The API key.** Anyone holding it can use the gateway, including starting coding sessions and answering approvals.
- **Your tailnet.** The gateway listens only on loopback, the LAN and Tailscale addresses you choose, and refuses to start on a network address without a key. Anyone who can reach that port and has the key is you.
- **The model.** A model can be wrong, or be steered by text it reads (a README, a web page, a file it was asked to summarise). Treat its tool calls as untrusted requests.

## What limits the damage

Each limit is enforced on the **device**, not by the gateway, so a compromised gateway cannot lift it.

| Control | Where | What it does |
|---|---|---|
| `PROJECT_ROOTS` | device | Nothing is exposed unless set. Only the named folders are reachable. Paths outside them, including through symlinks and `..`, are refused. |
| `ALLOWED_TOOLS` | device | Only the listed tools run. The default is read-only (`read_file`, `list_dir`, `grep`). `write_file`, `edit_file` and `run_command` must be added on purpose. |
| Audit log | device | Every tool call the gateway makes, including refused ones, is appended to `AUDIT_LOG` (default `~/.harness/audit.log`) as one JSON line: time, session, root, tool, a description, outcome. File contents are never logged. |
| `ALLOW_MODEL_CONTROL` | device | Off by default. When on, the gateway can load and unload models in this device's LM Studio, but never while the device is busy, and model ids are checked before they reach the `lms` program. |
| Approvals | gateway | Writes, edits and commands wait for a yes from whoever drives the session. No answer in five minutes is a no, and cancelling is a no. A decline ends the turn. |
| Outbound tunnels | network | Devices connect out to the gateway, so they have no listening port for this and LM Studio stays on localhost. |
| Tailscale ACLs | network | See below. Limits who can reach the gateway at all. |

## What is not protected

- **`run_command` is not sandboxed.** If a device allows it, an approved command can do anything that device's user can. Read what it asks to run. Leave it off on devices you do not want that on.
- **Approvals are answered through the gateway.** If the gateway is compromised, the attacker can answer them. Keep `run_command` and the write tools off on devices where that matters, since the device-side allow list is the control they cannot bypass.
- **`grep` runs in the agent's own process.** A model-written regular expression that backtracks badly can keep the agent busy for a long time, during which the device stops heartbeating and drops off the pool until it finishes. It cannot read outside the project root, but it can be slow. Restarting the agent clears it.
- **The audit log is local and plain text.** Someone with a shell on the device can edit it. It records what the gateway asked for; it does not stop anything.
- **Nothing here defends against a compromised device.** A device that is taken over can read what is sent to it (prompts, file contents the model asked for).

## Recommended setup

1. Keep the API key out of repositories and chat. It lives in each device's `.env` and the gateway's environment.
2. Leave `ALLOWED_TOOLS` at its default on every device, and add the write tools only where you want sessions to change files.
3. Expose small project folders in `PROJECT_ROOTS`, not a home directory.
4. Check `~/.harness/audit.log` after sessions you did not watch.
5. Add the Tailscale ACL below so only your own devices can reach the gateway.

## Tailscale ACL example

Tag the gateway machine `tag:harness-gateway` and each device `tag:harness-device` (in the admin console, or with `tailscale up --advertise-tags`). Then, in the tailnet policy file:

```json
{
  "tagOwners": {
    "tag:harness-gateway": ["autogroup:admin"],
    "tag:harness-device": ["autogroup:admin"]
  },
  "acls": [
    // You can reach the gateway from any of your own devices.
    { "action": "accept", "src": ["autogroup:member"], "dst": ["tag:harness-gateway:8787"] },
    // Devices running a node agent can reach the gateway, and nothing else.
    { "action": "accept", "src": ["tag:harness-device"], "dst": ["tag:harness-gateway:8787"] }
  ]
}
```

Two things follow from this. Devices cannot reach each other, so a taken-over device cannot probe another one. And because devices connect out to the gateway, no rule needs to allow traffic *to* a device on a model or tool port. Adapt the first rule if other people share your tailnet: `autogroup:member` means everyone in it.

A tagged device is no longer owned by a user in Tailscale's model, so check that your own login still reaches it for SSH or anything else you use. The ACL above does not grant that.
