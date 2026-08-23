# nowagent

A Docker-hosted Claude SDK agent, paired with a browser plugin, that creates ServiceNow Business Rules, UI Policies, Client Scripts, and Script Includes via the [Fluent SDK](https://developer.servicenow.com/dev.do#!/reference/next-experience/latest/fluent). All changes are human-approval-gated before being applied to a ServiceNow instance — there is no direct-to-prod path.

## Status

🚧 Early setup. Repo scaffolding and engineering practices are being established (see [NOW-4](https://stuartmunn.atlassian.net/browse/NOW-4)). No agent code yet.

## Architecture (planned)

- **Agent (Docker-hosted)** — runs on the Claude SDK, receives requests to generate ServiceNow customizations, and emits Fluent SDK definitions for Business Rules, UI Policies, Client Scripts, and Script Includes.
- **Browser plugin** — the human-facing surface for reviewing and approving generated artifacts before they're applied to an instance.
- **Approval gate** — every artifact requires explicit human sign-off before touching a ServiceNow instance. This is a hard architectural constraint, not a configurable option.

Further detail will be added here as components land.

## Setup

Not yet runnable — this section will be filled in as the Docker Compose setup and agent scaffolding are built.

Planned:

```bash
git clone https://github.com/stuartmunn/nowagent.git
cd nowagent
# docker compose up  (once the compose file exists)
```

Credentials will be supplied via Docker Compose file-based secrets (mounted to `/run/secrets/`), never via `.env` files committed to the repo. See [`CLAUDE.md`](CLAUDE.md) for the full secrets policy.

## Contributing / process

See [`CLAUDE.md`](CLAUDE.md) for the branching model, PR workflow (including PR Agent review loop), and Jira story hygiene. See [`CODING_STANDARDS.md`](CODING_STANDARDS.md) for accumulated lessons learned — check it before writing code.

## Project tracking

Jira project: [NOW — Fluent SDK Agent](https://stuartmunn.atlassian.net/browse/NOW)
