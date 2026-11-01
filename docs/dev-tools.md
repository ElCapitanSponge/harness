# Web and developer tools for coding sessions

A device can let a coding session fetch web pages and use the developer programs a person reaches for. The tools come in two groups on the Devices page, each **Off, Read-only or Can change**: *tools on this device* (files, `git_read`, `git_write`, `jq`, `fzf_filter`) and *tools that reach out* (`web_fetch`, `gh_read`, `gh_write`). Reading on the device is on by default; reaching out is off until you choose it, and every call is written to the device's own audit log. A tool whose program is not installed on the device is marked "not installed", cannot be switched on, and is never offered to the model.

| Tool | What it does | Asks first? |
| --- | --- | --- |
| `web_fetch` | Fetches an http(s) page or API and returns its text (HTML is reduced to plain text). | Yes, every time |
| `gh_read` | Read-only GitHub CLI: `pr` view, list, status, diff, checks; `issue` view, list, status; `repo`, `run`, `release`, `workflow`, `label` list and view; `search`. | No |
| `gh_write` | GitHub CLI commands that change things: `pr` create, comment, merge, close, reopen, edit, review, ready; `issue` create, comment, close, reopen, edit; `label` create, edit. | Yes |
| `git_read` | `status`, `log`, `diff`, `show`, `blame`, `ls-files`, `ls-tree`, `rev-parse`, `describe`, `shortlog`, `grep`, `cat-file`, and only the listing forms of `branch`, `tag`, `remote` and `stash`. | No |
| `git_write` | `add`, `commit`, `checkout`, `switch`, `restore`, `branch`, `tag`, `stash`, `merge`, `push`, `pull`, `fetch`, `cherry-pick`, `revert`, `mv`, `rm`, `reset`, `rebase`. | Yes |
| `jq` | A jq filter over JSON given as text or as a file in the project folder. | No |
| `fzf_filter` | Fuzzy-filters lines of text (fzf's non-interactive `--filter` mode). | No |

## How they are kept safe

- **No shell.** The model supplies a list of arguments. They are checked against the table above and the program is started with that list, so `; rm -rf` or `$(...)` in an argument is just text.
- **Reading and changing are separate tools**, so a read needs no approval and a change always asks. "Always allow" applies to one tool, so allowing `gh_read` never allows `gh_write`.
- **Refused outright, even with approval:** forced and deleting pushes, `--no-verify`, `reset --hard`, interactive rebases, `gh --web`, `--editor` and `--body-file`, `git -c`, `-C`, `--git-dir`, and `--output`; and `gh api`, `gh auth`, `gh secret` and `gh repo delete`. These are left for the person to run themselves.
- **A clean environment.** A program gets a short list of variables (`PATH`, `HOME` and the like), and `gh` also its GitHub token. The agent's own variables, including the gateway key, never reach a program. A jq filter cannot read the environment, other files or modules.
- **Time and size limits:** 30 seconds per program, output shortened to 20,000 characters, files of at most 5 MB.
- **Inside the project folder.** A file named by `jq` or `fzf_filter` must be inside the project root, with symbolic links resolved.

## web_fetch

The address is chosen by the model, so it asks each time: an address can carry information out in its query string. It reaches only the public internet. Addresses on this machine, the local network, link-local (including cloud metadata) and the tailnet range are refused when the connection is made (so a name that changes its answer cannot get round the check), and again on every redirect, up to five. Pages that are not text are not shown. A page is cut at 200 KB.

To let a device fetch from its own network (for a service on the LAN, say), start its agent with `WEB_FETCH_ALLOW_LOCAL=1`. This is not changeable from the page.

## Needs

`gh` needs to be logged in on the device (`gh auth login`); the agent never sees the login, only the program does.
