# nowagent

A Docker-hosted Claude SDK agent, paired with a browser plugin, that creates ServiceNow Business Rules, UI Policies, Client Scripts, and Script Includes via the [Fluent SDK](https://developer.servicenow.com/dev.do#!/reference/next-experience/latest/fluent). All changes are human-approval-gated before being applied to a ServiceNow instance — there is no direct-to-prod path.

## Status

🚧 Early build. Repo scaffolding is in place ([NOW-4](https://stuartmunn.atlassian.net/browse/NOW-4)) and the agent container shell runs and exposes a health check ([NOW-8](https://stuartmunn.atlassian.net/browse/NOW-8)). No business logic (now-sdk auth, codegen, approval flow, plugin API) yet — see the [NOW-1 epic](https://stuartmunn.atlassian.net/browse/NOW-1) for what's next.

## Architecture

- **Agent (Docker-hosted, `agent/`)** — a Node.js container. Today it's just an HTTP server exposing `GET /healthz`; it will grow to run Claude SDK codegen, emit Fluent SDK (`now-sdk`) definitions for Business Rules, UI Policies, Client Scripts, and Script Includes, and expose a plugin-facing REST API.
- **Browser plugin** (not yet built) — the human-facing surface for reviewing and approving generated artifacts before they're applied to an instance.
- **Approval gate** — every artifact requires explicit human sign-off before touching a ServiceNow instance. This is a hard architectural constraint, not a configurable option.

## Setup

```bash
git clone https://github.com/stuartmunn/nowagent.git
cd nowagent
cp now-sdk-credential.example secrets/now-sdk-credential
# edit secrets/now-sdk-credential with real values (this file is gitignored — never commit it)
docker compose up --build
curl http://localhost:8791/healthz
```

The agent container binds to the host's network interface (not loopback-only) on port `8791`. The now-sdk credential is supplied via a Docker Compose file-based secret, mounted read-only at `/run/secrets/now_sdk_credential` inside the container — never baked into the image, never in an env var, never committed. See [`CLAUDE.md`](CLAUDE.md) for the full secrets policy and [`now-sdk-credential.example`](now-sdk-credential.example) for the placeholder shape (auth details are still being finalized in NOW-9).

## Contributing / process

See [`CLAUDE.md`](CLAUDE.md) for the branching model, PR workflow (including PR Agent review loop), and Jira story hygiene. See [`CODING_STANDARDS.md`](CODING_STANDARDS.md) for accumulated lessons learned — check it before writing code.

## Project tracking

Jira project: [NOW — Fluent SDK Agent](https://stuartmunn.atlassian.net/browse/NOW)
