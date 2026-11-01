# Skills and instruction files

A coding session tells the model what the project and its owner have asked for, and which skills it can use. Skills use the Agent Skills layout (a folder with a `SKILL.md`, front matter with a `name` and a `description`, and any files it refers to), so the skills installed for Claude Code, including Matt Pocock's, work unchanged.

## What the model is told

At the start of every turn the gateway asks the device for its context (a tool the model itself is never offered) and puts it in the system prompt:

- **Instruction files.** The person's own `~/.claude/CLAUDE.md`, then the project root's `CLAUDE.md` and `AGENTS.md`. A line that is only `@some/file.md` is replaced by that file's text, so a `CLAUDE.md` that only says `@AGENTS.md` works, and the same file is never added twice. An import is followed only inside the project root (inside `~/.claude` for the person's own file), at most four levels deep, and not inside a fenced code block; one that cannot be read is left as written. Each file is shortened at 20,000 characters.
- **Skills.** Only each skill's name, argument hint and description, one line each. The full text is loaded when the model asks for it.

An older device that cannot answer leaves the session exactly as it was.

## Where skills are found

`~/.claude/skills` and `~/.agents/skills` on the device, then `.claude/skills` and `.agents/skills` in the project root. A project's skill replaces the person's of the same name. A folder with no `SKILL.md` is not a skill and is ignored. A `SKILL.md` that cannot be used (no front matter, no description, a name that is not letters, digits and hyphens, too large) is skipped with the reason, and the rest still load.

## The skill tool

`skill` takes a `name` and optional `arguments`, and returns the skill's instructions with the folder it lives in. `$ARGUMENTS` in the text is replaced by the arguments; if the skill has no place for them they are added at the end. With `file`, it reads a file from inside that skill's own folder instead, read-only, even though that folder is outside the project. Nothing else outside the project becomes readable: a path that leaves the skill's folder, by `..` or by a link, is refused.

A skill with `disable-model-invocation: true` is never listed for the model and the tool refuses to load it; it is for the person to start. The tool is a reading tool, needs no approval, and is offered only when the device allows its own tools and at least one skill may be used by the model.

## Running a skill yourself

In a coding conversation, typing `/` at the start of a message opens a menu of the skills in that folder, with each one's hint and description. It filters as you type (names that start with it first, then names and descriptions that contain it). Up and Down move, Enter or Tab completes the name, Escape closes it, and a click picks one. It lists every skill, including those only you may start.

Send `/name the rest` and the rest becomes the skill's arguments. The gateway loads the skill on the device, puts its instructions into the conversation after what you typed, and the thread shows the skill as a collapsed block (name and arguments, open it to read the text). If the skill cannot be loaded the message is not sent and the reason is shown. A chat with no device has no skills yet.

## The Skills page

**Skills** in the sidebar lists, for each device and project folder it exposes: the instruction files read (and how long), every skill with its description, hint, whether it is yours or the project's, whether only you start it, and its length; and any skills skipped, with the path and the reason. A device too old to answer is listed with a note. The same data is at `GET /skills` (`?device=&root=` narrows it).

## Not built yet

Importing and exporting skills and the gateway's own skill library (so chats with no device have skills), a setting for the skill folders, sub-agents and the ask-the-person tool are the rest of [#53](https://github.com/ElCapitanSponge/harness/issues/53).
