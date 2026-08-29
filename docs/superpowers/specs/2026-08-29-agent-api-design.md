# Agent API — remote Claude read/write access to the portal

**Date:** 2026-08-29 · **Owner decision:** full read/write incl. delete, ship straight to production.

## Problem

The owner drives work from Claude (Cowork desktop sessions, claude.ai, Claude Code). Those
sessions have no direct way to operate the portal's data: desktop sessions have no Supabase
MCP at all (migrations are hand-pasted into the dashboard), and the claude.ai Supabase
connector is SQL-only, session-bound and limited. The owner wants to tell any Claude agent
"change X in ECR" and have it happen against the live system.

## Solution

A token-guarded agent API **inside the portal app** (entice-pink.vercel.app), one shared
core exposed two ways:

- `POST /api/agent` — REST envelope `{action, ...params}`. Drivable with `curl` from any
  agent environment. `GET /api/agent` (authed) returns the same self-documentation as
  `{action: "help"}` so a context-free agent can discover usage on its own.
- `/api/agent/mcp` — stateless MCP streamable-HTTP endpoint (JSON-RPC: `initialize`,
  `tools/list`, `tools/call`, `ping`). Connects to Claude Code with
  `claude mcp add --transport http … --header "Authorization: Bearer <key>"`.

### Actions / tools

`help`, `schema` (all tables compact, or one table detailed), `sql` (arbitrary **read-only**
SELECT), `insert`, `update`, `delete`, `rpc`, `storage_list`, `storage_sign`,
`storage_upload`. Reads are deliberately unlimited (any SELECT incl. joins/aggregates);
writes are structured so a confused agent cannot do accidental mass damage.

### Security model

The bearer key is the perimeter — it legitimately holds full data-plane read/write (service
role, bypasses RLS). Guardrails exist to stop *mistakes*, not the key holder:

- Keys live in `agent_keys` as **SHA-256 hashes** only; revocable (`revoked_at`),
  `last_used_at` tracked; admin-only SELECT via RLS, writes service-role only.
- Every call (incl. failures) appends to `agent_audit` (action, target, params truncated,
  row count, ok/error, ip, UA, duration). Append-only trigger; prune escape hatch via
  `set local app.allow_agent_audit_prune = 'true'` (mirrors the storage protect pattern).
- `sql` runs through `agent_select(q)` (SECURITY DEFINER, service_role-only EXECUTE):
  single statement, must start `SELECT`/`WITH`, no semicolons, and is executed wrapped in
  `select … from (<q>) limit 1001` — DDL/DML become syntactically impossible and Postgres
  itself rejects data-modifying CTEs below top level. 1000-row cap with `truncated` flag.
  (A write-capable SECURITY DEFINER fn called *inside* a SELECT could still write — not a
  real risk expansion since `rpc` grants the same, audited.)
- `insert`/`update`/`delete` only touch `public` schema tables matching a strict name
  regex, minus a denylist (`agent_keys`, `agent_audit`). `update`/`delete` require ≥1
  filter; `delete` additionally requires `confirm: true`. No DDL anywhere — schema changes
  stay with migrations.
- Existing DB protections still apply (append-only audit_log triggers, storage protect
  trigger, CHECK constraints).

### Components

- `supabase/migrations/0056_agent_api.sql` — `agent_keys`, `agent_audit` (+ protect
  trigger), `agent_select(q)`. Applied via the Supabase connector with a matching
  `schema_migrations` row (version `0056`).
- `src/lib/agent-api.ts` — pure: envelope zod schemas, filter/table/SQL validation,
  key hashing, help text, MCP tool definitions. Unit-tested.
- `src/lib/agent-executor.ts` — server-only: executes a parsed envelope against
  `createAdminClient()` (supabase-js + `agent_select` RPC + storage API).
- `src/app/api/agent/route.ts` — REST: bearer auth (hash lookup), dispatch, audit.
  503 without `SUPABASE_SERVICE_ROLE_KEY` (mirrors `/api/cron/backup`; expected locally).
- `src/app/api/agent/mcp/route.ts` — MCP JSON-RPC over the same auth + executor.
- `docs/agent-api.md` — connection guide (curl, `claude mcp add`, key rotation/revoke).

`/api/*` is already excluded from the auth proxy; syd1 pinning is project-wide.

### Error handling

Auth failures 401 (never audited with params), validation 400 with a specific message,
executor errors 500 with the DB message passed through — all POST outcomes audited.
Storage uploads capped at 8 MB decoded (Vercel platform 413s above ~10 MB anyway).

### Testing

Vitest for the pure layer (SQL validator edge cases, filter/table validation, envelope
parsing, MCP tool ↔ envelope mapping). Live production verification after deploy: help,
schema, real read (MBBC), zz-prefixed insert→update→delete round trip (cleaned), storage
list/sign, negative probes (bad key, filterless update, DML sql, denylisted table), MCP
initialize/tools-list/tools-call — then confirm `agent_audit` rows exist for all of it.

### Out of scope (offered later)

Settings UI for keys/audit, OAuth wrapper for claude.ai custom connectors, rate limiting,
high-level business actions (create_quote etc.), storage delete.
