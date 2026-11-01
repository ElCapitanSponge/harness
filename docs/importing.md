# Importing and exporting conversations

Bring a chat from another tool into Torii and carry on with any model, or take a Torii conversation out as markdown. Importing never sends anything to a model: the turns become stored events and history exactly as they are, the conversation opens with a note saying where it came from, and the next message you send goes to whichever model you pick (see [switching-models.md](switching-models.md)). Before that message the usual check against the model's context window applies, so a very long import is compacted or refused with a reason, as any long conversation is.

## Import page

**Import** in the sidebar. Paste a transcript, or choose a file, then **Find the messages**. The page shows how it was split and the format it recognised. You can change who wrote any message, merge a message into the one before, or remove one, and for a file with several conversations tick the ones to bring in. **Import conversation** saves what is shown.

A text that cannot be split into turns is not an error: it comes back as one message from you, and **Split at blank lines** divides it so each part can be assigned by hand.

## Formats

Pasted text (also `.md` and `.txt` files):

| Layout | Looks like |
| --- | --- |
| headings | `## User` / `## Assistant` (also `Human`, `You`, `Claude`, `ChatGPT`, `AI`) |
| said | `You said:` / `ChatGPT said:` / `Claude said:` lines, as copied from the chat sites |
| labels | `User: ...` / `Assistant: ...`, with the text on the same line |
| Claude Code `/export` | `> ` before your prompts and a bullet before each reply part; neighbouring parts are one reply |

A line that starts a turn inside a fenced code block is ignored, so code and markdown survive. The layout that finds the most turns wins; one lone message is not taken as evidence of a layout.

Files:

- **Claude Code** `.jsonl` from `~/.claude/projects`. Tool calls and their results stay inside the reply they belong to as short collapsed text (results shortened at 2,000 characters); they are not replayed.
- **ChatGPT** `conversations.json`. The branch you were reading (from the current node back to the start) is kept; hidden and system messages are left out. Each conversation can be picked.
- **Claude.ai** export JSON. Each conversation can be picked.

Limits: 5,000 messages per conversation, 200,000 characters per message.

## Export

**Export as markdown** in a conversation's menu downloads it; from the command line `harness export <id>` prints it. Each message gets a `## You` or `## Assistant` heading (the model that wrote it is kept in a comment), so the file imports back in.

## Command line

```
harness import <file> [-n number | --all] [-m model]
harness export <id>
```

With several conversations in the file and neither `-n` nor `--all`, `import` lists them with numbers.

## Through the API

`POST /import/parse` takes `{ name, content }` and returns the conversations found, saving nothing. `POST /sessions/import` takes `{ title, source, turns: [{ role, text }], model? }` and saves one. `GET /sessions/:id/export` returns the markdown.
