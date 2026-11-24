# Issue tracker: GitHub for finished work, `.scratch/` for drafts

This repo has two tracker tiers, split by **quality**: GitHub Issues hold work
written well enough for anyone to read, and `.scratch/` (git-ignored,
machine-local, never pushed) holds the rough work that comes before it.

## Routing

| Tier | Where | What goes there |
| --- | --- | --- |
| No ticket | the commit message | a fix done within one session |
| Scratch | `.scratch/<feature-slug>/` | `/research` findings, prototypes, `/wayfinder` maps, notes and open questions that outlive a session |
| GitHub | GitHub Issues on `sigboe/wowdeck` | `/to-spec` specs, `/to-tickets` tickets, bug reports, everything `/triage` handles |

The `/to-*` skills are the boundary: what they produce goes to GitHub, and
everything before them stays in scratch. Running `/to-spec` is the owner's
act of publishing. Work moves up a tier, never down. When the tier is
unclear, write to `.scratch/` and offer to publish.

## When a skill says "publish to the issue tracker"

- `/to-spec`, `/to-tickets`, `/triage`, or the owner says "issue" or
  "GitHub": create a GitHub issue (see **GitHub**). A spec whose body names a
  GitHub Project takes its tickets as draft items instead (see
  **Project-backed specs**).
- `/wayfinder`, `/research`, or the owner says "scratch" or "draft": write a
  file under `.scratch/<feature-slug>/` (see **Scratch**).

## When a skill says "fetch the relevant ticket"

A `#n` or GitHub URL is a GitHub issue; a path is a scratch file; a ticket
title under a Project-backed spec is a draft item in that spec's Project.

## GitHub

Use the `gh` CLI; it infers the repo from `git remote -v`.

- **Create**: `gh issue create --title "..." --body "..."`, with a heredoc for multi-line bodies.
- **Read**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`, with `--label` and `--state` filters.
- **Sub-issue**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/sigboe/wowdeck/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`. Without sub-issues, put `Part of #<parent>` at the top of the child body.
- **Blocking**: `gh api --method POST repos/sigboe/wowdeck/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where the database id comes from `gh api repos/sigboe/wowdeck/issues/<n> --jq .id`. Fallback: a `Blocked by: #<n>, #<n>` line at the top of the body.
- **Comment**: `gh issue comment <number> --body "..."`
- **Labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`. A PR that implements a ticket says `Closes #<n>` in its body; PRs target `next`.
- **When a ticket closes**: as soon as `/implement` has committed it and the review pass is done, not at PR or merge time: commits say `Refs #<n>`, so nothing closes the ticket for you. Close it with a comment naming the commits and branch, what shipped (the tested seam included), and the `docs/regression-test-plan.md` row that covers it on device, adding that row in the same work when the change touches UI or device behaviour. When that was the parent spec's last open ticket, close the parent too, with a comment listing its tickets.
- **The one exception**: a bug fixed outside a ticket's `/implement` run (`/diagnosing-bugs`, a one-session fix of a reported issue) commits with `Closes #<n>`, and GitHub closes the issue when the commit reaches `next`. That is the only case where a commit carries `Closes`; everywhere else the agent closes the ticket itself.

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external
PRs as feature requests; `/triage` reads this flag.)_

## Project-backed specs

When the owner asks for a spec "as a project", its tickets wait as draft
items in a GitHub Project (Projects v2, owner `sigboe`) and become issues
one at a time, when work starts. Issues then holds the spec and the tickets
in progress or done. The `gh` token needs the `project` scope.

- **Project**: `gh project create --owner sigboe --title "<name>"`, then
  `gh project link <number> --owner sigboe --repo sigboe/wowdeck`, then a
  `Phase` field: `gh project field-create <number> --owner sigboe --name Phase
  --data-type SINGLE_SELECT --single-select-options "Phase 1,Phase 2"`.
  Status is the Project's built-in field.
- **Spec**: an ordinary spec issue (`/to-spec`, `ready-for-agent`), added with
  `gh project item-add <number> --owner sigboe --url <issue-url>`. Its body
  names the Project's URL.
- **Tickets** (`/to-tickets`): `gh project item-create <number> --owner sigboe
  --title "..." --body "..."`, each a full ticket body. The body opens with
  `Part of #<spec>` and a `Blocked by: <draft title>, <draft title>` line,
  since draft items have no dependencies. Set each item's Phase with
  `gh project item-edit`.
- **Frontier**: draft items whose blockers are all closed issues. Lowest
  Phase first, then Project order.
- **Picking one up** (`/implement`, before any work): convert the draft with
  the GraphQL mutation `convertProjectV2DraftIssueItemToIssue(input: {itemId,
  repositoryId})`. The item id comes from `gh project item-list <number>
  --owner sigboe --format json`, the repository id from `gh api
  repos/sigboe/wowdeck --jq .node_id`. Make the new issue a sub-issue of the
  spec, label it `ready-for-agent`, and rewrite its `Blocked by` line with
  issue numbers. From then on it is an ordinary ticket under **GitHub**:
  `Refs #<n>` in commits, closed by the agent, the spec closed with its last
  ticket.

## Scratch

- One feature per directory: `.scratch/<feature-slug>/`.
- Run logs and notes go in that directory, never in `/tmp`.
- `/research` writes `.scratch/<feature-slug>/research-<topic>.md`.
- A file that tracks state carries a `Status:` line near the top
  (`open`, `claimed`, `resolved`); comments append under a `## Comments`
  heading at the bottom.

### Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
