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

## Not built yet

The slash menu in the composer, the skills page, importing and exporting skills, the gateway's own skill library, a setting for the skill folders, sub-agents and the ask-the-person tool are the rest of [#53](https://github.com/ElCapitanSponge/harness/issues/53).
