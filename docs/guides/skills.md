---
title: Skills and instruction files
description: How coding sessions find skills and AGENTS.md or CLAUDE.md, the slash menu and the Skills page
sidebar:
  order: 60
---

# Skills and instruction files

A coding session tells the model what the project and its owner have asked for, and which skills it can use. Skills use the Agent Skills layout (a folder with a `SKILL.md`, front matter with a `name` and a `description`, and any files it refers to), so the skills installed for Claude Code, including Matt Pocock's, work unchanged.

## What the model is told

At the start of every turn the gateway asks the device for its context (a tool the model itself is never offered) and puts it in the system prompt:

- **Instruction files.** The person's own `~/.claude/CLAUDE.md`, then the project root's `CLAUDE.md` and `AGENTS.md`. A line that is only `@some/file.md` is replaced by that file's text, so a `CLAUDE.md` that only says `@AGENTS.md` works, and the same file is never added twice. An import is followed only inside the project root (inside `~/.claude` for the person's own file), at most four levels deep, and not inside a fenced code block; one that cannot be read is left as written. Each file is shortened at 20,000 characters.
- **Skills.** Only each skill's name, argument hint and description, one line each. The full text is loaded when the model asks for it.

An older device that cannot answer leaves the session exactly as it was.

## Where skills are found

`~/.claude/skills` and `~/.agents/skills` on the device, then `.claude/skills` and `.agents/skills` in the project root. Folders added in the **Skill folders** setting of the Devices page (or `SKILL_FOLDERS`) are searched too, after those two and before the project's, and their skills count as yours. A project's skill replaces the person's of the same name. A folder with no `SKILL.md` is not a skill and is ignored. A `SKILL.md` that cannot be used (no front matter, no description, a name that is not letters, digits and hyphens, too large) is skipped with the reason, and the rest still load.

## The skill tool

`skill` takes a `name` and optional `arguments`, and returns the skill's instructions with the folder it lives in. `$ARGUMENTS` in the text is replaced by the arguments; if the skill has no place for them they are added at the end. With `file`, it reads a file from inside that skill's own folder instead, read-only, even though that folder is outside the project. Nothing else outside the project becomes readable: a path that leaves the skill's folder, by `..` or by a link, is refused.

A skill with `disable-model-invocation: true` is never listed for the model and the tool refuses to load it; it is for the person to start. The tool is a reading tool, needs no approval, and is offered only when the device allows its own tools and at least one skill may be used by the model.

## Running a skill yourself

In a coding conversation, typing `/` at the start of a message opens a menu of the skills in that folder, with each one's hint and description. It filters as you type (names that start with it first, then names and descriptions that contain it). Up and Down move, Enter or Tab completes the name, Escape closes it, and a click picks one. It lists every skill, including those only you may start.

Send `/name the rest` and the rest becomes the skill's arguments. The gateway loads the skill on the device, puts its instructions into the conversation after what you typed, and the thread shows the skill as a collapsed block (name and arguments, open it to read the text). If the skill cannot be loaded the message is not sent and the reason is shown. A chat with no device has no skills yet.

## The Skills page

**Skills** in the sidebar lists, for each device and project folder it exposes: the instruction files read (and how long), every skill with its description, hint, whether it is yours or the project's, whether only you start it, and its length; and any skills skipped, with the path and the reason. A device too old to answer is listed with a note. The same data is at `GET /skills` (`?device=&root=` narrows it).

## The gateway's library

The gateway keeps skills of its own, in a `skills` folder on its data volume (`HARNESS_DATA_DIR`), in the same layout as a device's. They are available in **every** conversation, including chats with no device, where a skill that needs files or commands says so when it is loaded ("this conversation has no device..."). In a coding session the device's skills come first and the library's fill in the names the device does not have.

On the **Skills** page, the **Library** section lists them with their file count and size and has:

- **Add a zip** or **Add a folder.** A zip may hold the skill at its top or in one folder; a folder is chosen with the browser's folder picker. The skill's name is the one in its `SKILL.md` front matter. If the library already has that name, the page asks whether to replace it.
- **Export** as a zip with the skill's folder at the top, the layout Claude.ai and other tools take, so skills move between Torii and them.
- **Remove.**

Everything that comes in is checked, on the page and again on the gateway: the name (letters, digits, hyphens, up to 64), the paths (nothing absolute, no `..`, no drive letters, nothing from `__MACOSX`), at most 100 files, 1 MB a file and 5 MB in all, and a zip's declared sizes are checked before anything is unpacked, so a zip that claims to hold gigabytes is refused. Nothing from a zip is ever run.

Type `/` in any conversation to see the device's skills and the library's together. A skill with `disable-model-invocation: true` is yours to start and is never offered to the model. The API is `GET/POST /library/skills`, `GET /library/skills/:name/export` and `DELETE /library/skills/:name` ([HTTP API](../reference/http-api.md)).

## What is left

Nothing from [#53](https://github.com/ElCapitanSponge/harness/issues/53) is left. Sub-agents and the ask tool are in [Coding sessions](coding-sessions.md).
