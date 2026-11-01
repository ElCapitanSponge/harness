# Torii

Pools local language models on the owner's devices, and Claude, behind one endpoint, and lets a coding session work on the files of whichever device the owner chooses.

## Language

**Torii** (the harness):
The name of the whole system. The repository and packages are still called harness. The system is: the gateway, the node agents, the CLI and the web page.
_Avoid_: platform, framework

**Auto**:
The model choice where Torii, not the person, picks the model for each message by fixed rules, and shows the reason with the reply. See ADR 0010.
_Avoid_: smart routing, router

**Skill**:
A folder with a SKILL.md (a name, a description and instructions) in the Agent Skills layout. The model sees its name and description and loads the rest with the skill tool. See docs/skills.md.
_Avoid_: plugin, macro

**Instruction file**:
A project's AGENTS.md or CLAUDE.md, or the person's own CLAUDE.md, added to the model's instructions in a coding session.

**Gateway**:
The single always-on service that every client talks to. It knows which devices are connected, routes each request, and serves the web page.
_Avoid_: server, hub, proxy

**Device**:
A machine the owner runs a node agent on. Each has a name on the owner's private network.
_Avoid_: machine, host, client

**Node agent**:
The small program on a device that connects out to the gateway, reports the device's state, and does what the gateway asks of that device: answer chat with its local models, run tools on its files, answer Claude, and load or unload models.
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
The path that answers Claude requests by running the official `claude` program on a device where the owner is logged in and has switched Claude on. Claude is available only while such a device is connected.
_Avoid_: Claude API, Claude proxy

**Model control**:
The gateway loading or unloading a model on a device's own model server. Each device decides whether to allow it, and refuses while busy.
_Avoid_: remote management, orchestration

**Device settings**:
What a device lets the gateway do: its project roots, allowed tools, model control, Claude and game programs. The device keeps them in a local file, an environment variable on the device overrides and locks one, and the page can change the rest only if the device was started with `REMOTE_CONFIG=1`.
_Avoid_: remote config (as a noun), profile

## Coding sessions

**Coding session**:
A conversation in which a model reads and changes files, one tool call at a time, with the owner approving changes. It is saved, and can be reopened later.
_Avoid_: chat (which means conversation without file access), run

**Turn**:
One message from the owner and everything the model does in answer, until it replies without asking for another tool, is declined, is cancelled or hits the step limit.
_Avoid_: request, step

**Tool**:
An action a model can ask for during a coding session, such as reading a file, writing a file or running a command.
_Avoid_: function, plugin

**Project root**:
The folder on a device that a coding session may touch. Nothing outside it is reachable.
_Avoid_: workspace, sandbox, working directory

**Stage**:
Where a request is before the first word arrives: finding a device, freeing memory, loading a model, waiting for it, then thinking and writing. Sent live to the page and the CLI, never stored.
_Avoid_: status, phase

**Ledger**:
The record of every model call the gateway makes: the conversation, device and model, the tokens in and out, the time taken and the model's context window. It feeds the context meter and the usage page.
_Avoid_: log, metrics

**Switching**:
Choosing a different model for the next message of a conversation, on any device or Claude. The history goes with it, and each reply is labelled with the model and device that wrote it.
_Avoid_: handoff, failover

**Effort**:
How hard a model is asked to think, where it can be told: low, medium, high, and for Claude xhigh and max. Chosen for a conversation next to the model, and ignored by a model that cannot be told.

**Compaction**:
Replacing a conversation's older turns, in what is sent to the model, with a short summary the model writes, so the conversation can go on. The system prompt and the latest turns are kept, and what the person sees does not change.
_Avoid_: truncation, trimming

**Context meter**:
How many tokens a conversation holds against the window of the model that last answered. A number marked ~ is an estimate.

**Read-only folder**:
A project root marked so that nothing in it can be written, edited, deleted or committed by a session, and no command runs there. The agent enforces it, and the model is not offered the tools that could.
_Avoid_: locked folder, protected folder

**Developer tool**:
A tool that runs a program on a device for a coding session: fetching a web page, or `gh`, `git`, `jq` or `fzf`. Each is off until the device's owner turns it on, reading and changing are separate tools, and changing always asks first.
_Avoid_: plugin, command

**Approval**:
The owner's yes or no to a tool that would change something. A no ends the turn, and no answer counts as no.
_Avoid_: confirmation, permission

**Allow list**:
The tools a device agrees to run. It is the device's own setting, so the gateway cannot widen it. Reading is allowed by default; changing files and running commands are not.
_Avoid_: permissions, whitelist

**Audit log**:
The device's own record of every tool call the gateway made on it, including refused ones, without file contents.
_Avoid_: history, trace

**Caller**:
The device or browser the owner is using to talk to the gateway, which may differ from the device whose files are being worked on.
_Avoid_: user machine

## Relationships

- A **Gateway** has many **Devices**; each connected **Device** has one open **Tunnel**.
- A **Route** picks one **Device** (or the **Claude backend**) per request, skipping **Busy** and disconnected **Devices**.
- A **Coding session** uses one **Project root** on one **Device**, which may not be the **Caller**.
- A **Device** decides its **Project roots**, its **Allow list** and whether it allows **Model control**; the **Gateway** can only ask.
- A **Coding session** whose **Device** is away can be read but not continued.
