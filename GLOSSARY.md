# Harness

Pools local language models on the owner's devices, and Claude, behind one endpoint, and lets a coding session work on the files of whichever device the owner chooses.

## Language

**Harness**:
The whole system: the gateway, the node agents, the CLI and the web page.
_Avoid_: platform, framework

**Gateway**:
The single always-on service that every client talks to. It knows which devices are connected, routes each request, and serves the web page.
_Avoid_: server, hub, proxy

**Device**:
A machine the owner runs a node agent on. Each has a name on the owner's private network.
_Avoid_: machine, host, client

**Node agent**:
The small program on a device that connects out to the gateway, reports the device's state, and (later) runs tools on that device's files.
_Avoid_: daemon, worker, agent (alone, which also means the coding agent)

**Tunnel**:
The connection a node agent opens to the gateway and keeps open. A device is available only while its tunnel is open.
_Avoid_: socket, link, channel

**Pool**:
All the models reachable through the gateway right now: loaded models on connected devices, plus Claude.
_Avoid_: cluster, fleet

**Route**:
The decision of which device, or Claude, answers a request. A request goes whole to one destination.
_Avoid_: dispatch, balance, shard

**Busy**:
A device's declaration that it should not be given work, for example because the owner is gaming. Busy devices are skipped when routing.
_Avoid_: unavailable, offline

**Claude backend**:
The path that answers Claude requests by running the official `claude` program on a device where the owner is logged in.
_Avoid_: Claude API, Claude proxy

## Coding sessions

**Coding session**:
A conversation in which a model reads and changes files, one tool call at a time, with the owner approving changes.
_Avoid_: chat (which means conversation without file access), run

**Tool**:
An action a model can ask for during a coding session, such as reading a file, writing a file or running a command.
_Avoid_: function, plugin

**Project root**:
The folder on a device that a coding session may touch. Nothing outside it is reachable.
_Avoid_: workspace, sandbox, working directory

**Approval**:
The owner's yes or no to a tool that would change something. A no ends the turn.
_Avoid_: confirmation, permission

**Caller**:
The device or browser the owner is using to talk to the gateway, which may differ from the device whose files are being worked on.
_Avoid_: user machine

## Relationships

- A **Gateway** has many **Devices**; each connected **Device** has one open **Tunnel**.
- A **Route** picks one **Device** (or the **Claude backend**) per request, skipping **Busy** and disconnected **Devices**.
- A **Coding session** uses one **Project root** on one **Device**, which may not be the **Caller**.
