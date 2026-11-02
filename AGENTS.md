# AGENTS.md

Instructions for coding agents working in this repo, whether Claude Code or a local model run through the harness.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for ElCapitanSponge/harness, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix), plus the `in-progress-agent` claim label. See `docs/agents/triage-labels.md`.

### Claiming issues

Several agents may be working at once. Before you start an issue, claim it so no other agent takes it, and release it when you stop. The full steps are in `docs/agents/claiming.md`; in short:

- Only take an issue that is open, has `ready-for-agent`, has no `in-progress-agent` label, and has no open blockers. Skip the rest.
- Claim: `gh issue edit <n> --add-label in-progress-agent`, then `gh issue comment <n> --body "Claimed on branch <branch> at <ISO time>"`. Read the comments again; if an earlier live claim from another agent exists, stand down and pick something else.
- Keep it alive by pushing to your branch (a draft PR is fine). A claim with no commits, PR activity or comments for six hours may be taken over; comment when you do.
- Release: a PR that says `Closes #<n>` removes the label when it is closed or merged. If you stop for any other reason, remove the label yourself and say why in a comment.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Keeping context

Project memory lives in git, not in chat:

- `GLOSSARY.md` holds the project's vocabulary. Use its terms in code, issues and commits; when a term is settled or changes, update it in the same change.
- `docs/adr/` holds decisions that are hard to reverse, surprising and a real trade-off. Add the next numbered file when one is made; mark an old one `superseded by ADR-NNNN` rather than rewriting history.
- GitHub Issues hold the plan. Issue #2 is the roadmap for the web UI and device tunnel; close or update tickets as work lands.
- Commits use Conventional Commits and reference the issue they advance (`Refs #N`).
- Run `pnpm typecheck`, `pnpm lint` and `pnpm test` before pushing. The standards (no `any`, no `var`, arrow functions only, braces always) are in `docs/contributing.md`.
