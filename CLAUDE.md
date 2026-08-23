# CLAUDE.md

Guidance for Claude Code when working in this repository. Every story is worked the same way, safely — follow this file.

## Project summary

This repo is a Docker-hosted Claude SDK agent, paired with a browser plugin, that creates ServiceNow Business Rules, UI Policies, Client Scripts, and Script Includes via the Fluent SDK. All changes are human-approval-gated before being applied to a ServiceNow instance — there is no direct-to-prod path.

## Secrets — read this before touching anything

**No API keys, tokens, passwords, or `.env`/secret files are ever committed or pushed to GitHub, under any circumstance.** This is not a style preference — it is a hard rule with no exceptions.

- Credentials are supplied at runtime via Docker Compose file-based secrets, mounted to `/run/secrets/`. They are never baked into the image and never checked into the repo.
- `.gitignore` excludes `.env*`, `*secret*`, `/secrets/`, key/credential file patterns, etc. Do not remove or narrow those entries without a good reason.
- **If you are ever unsure whether something is a secret, do not commit it. Stop and ask first.** Treat ambiguous config values, sample tokens, connection strings, and instance URLs with embedded credentials all as secrets until proven otherwise.
- Before every commit, mentally diff what you're staging against this rule. Before every push, it's worth a second look — a secret in history is a secret leaked, even if a later commit removes it.

## Branching model

- One branch, one PR, per story.
- Branch name references the Jira key, e.g. `NOW-4-story-slug`.
- Don't mix multiple stories' work on one branch.

## PR workflow (PR Agent)

This repo has the PR Agent GitHub App installed. The loop for every PR:

1. Open the PR.
2. Wait a few minutes for PR Agent to post its automated review comment, then read it.
3. Action any valid suggestions: fix the code and push a follow-up commit. Use judgement to reject or skip suggestions that are wrong or don't apply — but always record why.
4. **Comment on the PR when actioning feedback.** Reply to PR Agent's comment (or post a new one) stating what was changed and why, for each suggestion actioned, and why for anything deliberately skipped. Never leave the thread with pushed commits and no explanation — the comment trail is how Stuart (or future-Claude) sees what was decided without re-diffing everything.
5. A second commit does **not** auto-retrigger PR Agent. Comment `/review` on the PR to force a fresh review after pushing further commits.
6. Repeat review → fix → comment → `/review` until PR Agent has no further valid observations.
7. Once clean, Claude Code may merge the PR itself — no separate human sign-off is required for merge. (The governance approval gate in `DESIGNPRINCIPLES.md` is about ServiceNow artifacts being applied to an instance, not about this repo's PRs.)

## Coding standards

Check [`CODING_STANDARDS.md`](CODING_STANDARDS.md) before writing code. It's a running, append-only log of lessons learned from PR Agent feedback — don't repeat a mistake that's already been recorded there. When PR Agent surfaces something new (and it's a valid, general lesson rather than a one-off), add an entry.

## README

Keep [`README.md`](README.md) current as part of every push, not just at project end — architecture overview, setup/run instructions, and current status should always reflect reality.

## Jira story hygiene

- Transition the story as work progresses, not just at the end:
  - **To Do → In Progress** when starting work on a story.
  - **→ Review** once its PR is opened.
  - **→ Complete** once the PR is merged.
- Comment on the Jira story at key milestones — PR opened (link it), PR Agent feedback actioned, merged — so status is visible without cross-referencing GitHub. A bare status flip with no comment is not enough for anything beyond the trivial To Do → In Progress step.
- If a story needs rework after being marked Complete, reopen it (back to In Progress) and comment why, rather than opening an undocumented new story for the same work.

## Quick checklist for any story

- [ ] Confirm dependencies noted in the story (don't assume — check, and flag back if something's missing).
- [ ] Jira: To Do → In Progress, branch created off the Jira key.
- [ ] Check `CODING_STANDARDS.md` before writing code.
- [ ] Commit with no secrets in the diff or history.
- [ ] Update `README.md` if the change affects setup, architecture, or status.
- [ ] Open PR; Jira → Review; comment on Jira linking the PR.
- [ ] Wait for PR Agent, action/skip feedback with recorded reasoning, comment on the PR, `/review` to re-trigger, repeat until clean.
- [ ] Merge PR.
- [ ] Jira → Complete, comment noting merge.
