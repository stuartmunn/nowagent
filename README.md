# nowagent

A Docker-hosted Claude SDK agent, paired with a browser plugin, that creates ServiceNow Business Rules, UI Policies, Client Scripts, and Script Includes via the [Fluent SDK](https://developer.servicenow.com/dev.do#!/reference/next-experience/latest/fluent). All changes are human-approval-gated before being applied to a ServiceNow instance — there is no direct-to-prod path.

## Status

🚧 Early build. Repo scaffolding ([NOW-4](https://stuartmunn.atlassian.net/browse/NOW-4)), the agent container shell ([NOW-8](https://stuartmunn.atlassian.net/browse/NOW-8)), and Business Rule generation ([NOW-10](https://stuartmunn.atlassian.net/browse/NOW-10)) are done. Not yet built: now-sdk auth against a real instance (blocked on [NOW-3](https://stuartmunn.atlassian.net/browse/NOW-3) provisioning a dev PDI), Client Script generation, the approval flow, deploy-on-approve, and the plugin-facing API — see the [NOW-1 epic](https://stuartmunn.atlassian.net/browse/NOW-1).

## Architecture

- **Agent (Docker-hosted, `agent/`)** — a Node.js container.
  - `GET /healthz` — proves the container is up.
  - `src/codegen/` — given structured context (table, trigger timing/action, plain-English description), calls Claude (`@anthropic-ai/sdk`) to write a Business Rule script body, assembles a Fluent `.now.ts` definition, and validates it via `now-sdk build`. Generation only — nothing is deployed to an instance from this code path (see NOW-10; deploy-on-approve is a separate, later story).
  - `fluent-workspace/` — a real [ServiceNow SDK](https://servicenow.github.io/sdk/) (`@servicenow/sdk` / `now-sdk`) project. Generated `.now.ts` + server script files land in its `src/fluent/generated/` and `src/server/generated/` (gitignored — runtime output, not fixtures) and get validated with the workspace's own `now-sdk build`, which type-checks against Fluent's real types and runs entirely offline (no ServiceNow instance needed for validation).
- **Browser plugin** (not yet built) — the human-facing surface for reviewing and approving generated artifacts before they're applied to an instance.
- **Approval gate** — every artifact requires explicit human sign-off before touching a ServiceNow instance. This is a hard architectural constraint, not a configurable option.

## Setup

```bash
git clone https://github.com/stuartmunn/nowagent.git
cd nowagent
mkdir -p secrets
cp now-sdk-credential.example secrets/now-sdk-credential      # edit with real values
cp anthropic-api-key.example secrets/anthropic-api-key        # replace with a real key, key only
docker compose up --build
curl http://localhost:8791/healthz
```

The agent container binds to the host's network interface (not loopback-only) on port `8791`. Both credentials are supplied via Docker Compose file-based secrets, mounted read-only at `/run/secrets/` inside the container — never baked into the image, never in an env var, never committed. See [`CLAUDE.md`](CLAUDE.md) for the full secrets policy, and [`now-sdk-credential.example`](now-sdk-credential.example) / [`anthropic-api-key.example`](anthropic-api-key.example) for their placeholder shapes (now-sdk auth details are still being finalized in NOW-9).

To run the agent's test suite (exercises the Business Rule codegen pipeline against a stubbed Claude client, with real `now-sdk build` validation):

```bash
cd agent
npm install
(cd fluent-workspace && npm install)   # one-time, needed by now-sdk build
npm test
```

## Contributing / process

See [`CLAUDE.md`](CLAUDE.md) for the branching model, PR workflow (including PR Agent review loop), and Jira story hygiene. See [`CODING_STANDARDS.md`](CODING_STANDARDS.md) for accumulated lessons learned — check it before writing code.

## Project tracking

Jira project: [NOW — Fluent SDK Agent](https://stuartmunn.atlassian.net/browse/NOW)
