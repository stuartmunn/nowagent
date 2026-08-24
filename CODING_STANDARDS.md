# Coding Standards

A running log of lessons learned from PR Agent feedback, so the same mistake isn't repeated across stories.

This file is **append-only**: don't delete or rewrite past entries, even if a later rule supersedes an earlier one — add a new entry noting the change instead. Check this file before writing code; add to it whenever PR Agent surfaces something new and generally applicable.

Format for each entry:

```
### YYYY-MM-DD — short title (Jira key, PR link)
**Flagged:** what PR Agent pointed out.
**Why:** the underlying reason it matters.
**Rule:** what to do differently going forward.
```

---

### 2026-08-23 — Falsy-default env parsing (NOW-8, [PR #2](https://github.com/stuartmunn/nowagent/pull/2))
**Flagged:** `Number(process.env.PORT) || 8791` silently overrides an intentionally-set `PORT=0` (or any other valid-but-falsy numeric env var) with the fallback, because `0 || x` evaluates to `x`.
**Why:** `||` fallback on a parsed numeric env var doesn't distinguish "unset" from "set to a falsy number" — easy to introduce a silent bug where an explicit config value is ignored.
**Rule:** When defaulting a numeric env var, check `process.env.X !== undefined && !Number.isNaN(parsed)` explicitly rather than relying on `||`.

### 2026-08-23 — Dockerfile lockfile reproducibility (NOW-8, [PR #2](https://github.com/stuartmunn/nowagent/pull/2))
**Flagged:** `npm install` without a committed `package-lock.json` gives non-deterministic dependency resolution across builds. `npm ci` + a committed lockfile is more reproducible.
**Why:** No real dependencies exist yet in NOW-8's skeleton, so there's no lockfile to commit and switching to `npm ci` now would break the build (missing file). Valid principle, not yet applicable.
**Rule:** The first story that adds a real npm dependency to `agent/package.json` must also commit `agent/package-lock.json` and switch the Dockerfile from `npm install` to `npm ci --omit=dev`. Don't let this slip once dependencies land.

### 2026-08-24 — Validate LLM tool-call output shape consistently, everywhere it's called (NOW-12, [PR #5](https://github.com/stuartmunn/nowagent/pull/5))
**Flagged:** the approval-narrative Claude calls validated their tool response shape before returning it; the codegen calls added in the same file (`generateScriptBody`, `generateClientScriptBody`) didn't, so an omitted `functionName` wouldn't throw — it would silently generate a function literally named `undefined` (`assertSafeIdentifier` doesn't catch it, since `String(undefined)` is itself a valid identifier).
**Why:** a tool schema's `required` list is a hint to the model, not a runtime guarantee. Adding validation to only *some* call sites in a file — even for a good reason at the time — leaves the others exposed and undercuts the stated rationale for adding it anywhere.
**Rule:** when a Claude tool-call response feeds untrusted output into generated code or a governance/approval surface, validate its shape immediately after the API call, at every call site that returns one — not just the one the current story happens to be touching. Extract the check into a shared helper so adding a new call site can't forget it.

### 2026-08-24 — "Immutable-ish" objects need an actual freeze, and it must be deep (NOW-12, [PR #5](https://github.com/stuartmunn/nowagent/pull/5))
**Flagged, in three escalating rounds:** (1) a state-machine module documented its returned objects as "immutable-ish by convention" but nothing enforced it — `session.state = 'approved'` worked fine, bypassing the state machine. (2) The first fix (`Object.freeze`) was shallow — `session.artifact.scriptBody` could still be mutated post-approval without touching `state`. (3) The fix for *that* (`{ ...context }` before freezing, so the caller's own input object wouldn't get frozen as a side effect) was itself only a shallow copy — a nested array field (`context.action`) still shared the caller's own reference, so deep-freezing `session.context` froze it too.
**Why:** each fix was correct as far as it went, but "immutable" is an all-or-nothing property one level at a time — a shallow guarantee reads as a full one until someone checks the next layer down.
**Rule:** when a data structure's integrity is the actual point (a governance/approval gate, not just a convenience object), freeze it deeply (recursively), not just at the top level — and when avoiding mutation of a caller-owned input, deep-clone it (`structuredClone` for plain structured data) rather than a shallow `{ ...spread }`, which only protects top-level fields.

### 2026-08-24 — Check the GitHub repo's actual default branch before trusting `gh pr create`'s base (NOW-12, [PR #5](https://github.com/stuartmunn/nowagent/pull/5), [PR #6](https://github.com/stuartmunn/nowagent/pull/6))
**Flagged:** two PRs in a row opened against `NOW-4-claude-md-engineering-practices` instead of `main` — not a `gh` bug, but because the repo's GitHub-side default branch setting was still pointed at that (already-merged) branch, left over from before it was renamed/switched. `gh pr create` uses the repo default when no `--base` is given, so both diffs silently included dozens of unrelated already-merged files, and PR Agent's reviews were correspondingly noisy/broad until this was caught and fixed.
**Why:** this is a one-time repo misconfiguration, easy to miss because each individual PR still "looked" plausible (it built, it had commits) — only the diff's file *count* gave it away.
**Rule:** if a PR's diff includes files the branch shouldn't have touched, check `gh repo view --json defaultBranchRef` before assuming the branch itself is wrong — and once fixed, prefer passing `--base main` explicitly on `gh pr create` for this repo as a second line of defense.
