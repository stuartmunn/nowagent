# nowagent

A Docker-hosted Claude SDK agent, paired with a browser plugin, that creates ServiceNow Business Rules, UI Policies, Client Scripts, and Script Includes via the [Fluent SDK](https://developer.servicenow.com/dev.do#!/reference/next-experience/latest/fluent). All changes are human-approval-gated before being applied to a ServiceNow instance — there is no direct-to-prod path.

## Status

🚧 Early build. Repo scaffolding ([NOW-4](https://stuartmunn.atlassian.net/browse/NOW-4)), the agent container shell ([NOW-8](https://stuartmunn.atlassian.net/browse/NOW-8)), both MVP codegen artifact types — Business Rules ([NOW-10](https://stuartmunn.atlassian.net/browse/NOW-10)) and Client Scripts ([NOW-11](https://stuartmunn.atlassian.net/browse/NOW-11)) — and the approval-statement generation + Approve/Revise/Reject state machine ([NOW-12](https://stuartmunn.atlassian.net/browse/NOW-12)) are done. Not yet built: now-sdk auth against a real instance (blocked on [NOW-3](https://stuartmunn.atlassian.net/browse/NOW-3) provisioning a dev PDI), deploy-on-approve, and the plugin-facing API — see the [NOW-1 epic](https://stuartmunn.atlassian.net/browse/NOW-1).

## Architecture

- **Agent (Docker-hosted, `agent/`)** — a Node.js container.
  - `GET /healthz` — proves the container is up.
  - `src/codegen/` — given structured context and a plain-English description, calls Claude (`@anthropic-ai/sdk`) to write the script, assembles a Fluent `.now.ts` definition, and validates it via `now-sdk build`. Generation only — nothing is deployed to an instance from this code path (deploy-on-approve is a separate, later story). Two artifact types share this pipeline and its structured summary shape (`artifactType`/`name`/`table`/`trigger`/`filterCondition`/`whatItDoes`) so downstream stories (the approval flow) don't need artifact-type-specific branching:
    - `generateBusinessRule.js` (NOW-10) — server-side, real `.ts` function, fully type-checked by `now-sdk build`.
    - `generateClientScript.js` (NOW-11) — browser-side. Note: its script body is embedded as a `script\`...\`` tagged template, which `now-sdk build` does **not** type- or syntax-check (verified hands-on) — only the surrounding definition's structure (table, a valid `type`, required fields) is validated.
    - `fluentWorkspace.js` — the shared single-slot scratch space + in-process lock both generators use, since `now-sdk build` type-checks the *entire* workspace at once (a stale or concurrent file from either artifact type could otherwise poison an unrelated build — see NOW-10/11's PR history).
  - `fluent-workspace/` — a real [ServiceNow SDK](https://servicenow.github.io/sdk/) (`@servicenow/sdk` / `now-sdk`) project. Generated `.now.ts` + server script files land in its `src/fluent/generated/` and `src/server/generated/` (gitignored — runtime output, not fixtures) and get validated with the workspace's own `now-sdk build`, which runs entirely offline (no ServiceNow instance needed for validation).
  - `src/approval/` (NOW-12) — turns a generated artifact into the fixed plain-English approval statement (see [`docs/approval-statement-template.md`](docs/approval-statement-template.md)) and runs the Approve / Revise / Reject state machine:
    - `generateApprovalStatement.js` — calls Claude a second time, over the *actual* generated script body, to produce the governance narrative (numbered logic steps, data touched, a privilege/security flag, and the Business-Rule-vs-Client-Script justification), then renders it into the fixed template. Two fields are deliberately rendered as explicit, honest limitations rather than fabricated facts: the "another active BR exists at this order" conflict check and "new vs. modifying existing" both require a live instance query this MVP doesn't have (blocked on NOW-9/NOW-3).
    - `approvalSession.js` — the state machine. `startApprovalSession()` generates an artifact + statement (state `pending`); `decide(session, 'approve'|'revise'|'reject')` transitions it. This is the one place that will gate NOW-13 (deploy-on-approve): only a session in state `approved` may ever be applied. `revise` regenerates from the consultant's plain-English feedback (folded into the description) and can loop indefinitely, accumulating history; `reject` discards the artifact/statement outright.
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

To run the agent's test suite (exercises both codegen pipelines and the approval-statement/state-machine pipeline against stubbed Claude clients, with real `now-sdk build` validation):

```bash
cd agent
npm install
(cd fluent-workspace && npm install)   # one-time, needed by now-sdk build
npm test
```

Test files run with `--test-concurrency=1` deliberately: Node's test runner spawns each test file as a separate process, and the codegen lock only serializes within one process — running files in parallel would have them race on the same on-disk `fluent-workspace` directory. See `fluentWorkspace.js` for why a single-process lock is correct for the real deployment (one agent process per container) but wouldn't be for a multi-process one.

## Contributing / process

See [`CLAUDE.md`](CLAUDE.md) for the branching model, PR workflow (including PR Agent review loop), and Jira story hygiene. See [`CODING_STANDARDS.md`](CODING_STANDARDS.md) for accumulated lessons learned — check it before writing code.

## Project tracking

Jira project: [NOW — Fluent SDK Agent](https://stuartmunn.atlassian.net/browse/NOW)
