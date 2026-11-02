# Claiming issues

Several agents (and people) may work on this repo at once. The `in-progress-agent` label, with a claim comment, stops two of them taking the same issue. Follow this before you start an issue and while you work on it.

## Which issue to take

An issue may be picked when it is open, has `ready-for-agent`, does not have `in-progress-agent`, and has no open blockers (see [issue-tracker.md](issue-tracker.md)). Skip anything else, even if it looks like the obvious next step.

## Claim it

1. Add the label: `gh issue edit <n> --add-label in-progress-agent`.
2. Comment with the branch you will use and the time: `gh issue comment <n> --body "Claimed on branch <branch> at <ISO time>"`.
3. Read the comments again. If another claim comment on the issue is earlier than yours and its branch has recent activity, it wins: delete your own claim comment (or reply that you are standing down), leave the label as it is, and pick something else. The earliest live claim holds the issue.

The label is shared by all agents using the same account, so the comment, not an assignee, says who holds it.

## Keep it

The claim is alive while its branch gets commits or its PR gets activity. Push early (a draft PR is fine) so that activity shows. If the plan changes, say so in a comment.

## Release it

- Merging or closing a PR that says `Closes #<n>`, or closing the issue, removes the label automatically (the `release-claim` workflow).
- If you stop for any other reason, remove the label yourself (`gh issue edit <n> --remove-label in-progress-agent`) and comment why, so the issue goes back to the queue.

## Take over a stale claim

A claim may be taken over when there has been no commit on its branch, no PR activity and no comment for six hours. Check the branch (`gh api repos/{owner}/{repo}/commits?sha=<branch>`) before assuming it is dead. Comment "Taking over from <branch>", keep the label, and start from the old branch if it has useful work.
