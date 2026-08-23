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
