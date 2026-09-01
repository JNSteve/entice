# Agent API — driving the portal from Claude

Token-guarded read/write access to the live portal (database + storage) for the
owner's Claude sessions. Two surfaces, same capabilities and audit trail:

- **REST** — `POST https://entice-pink.vercel.app/api/agent` with a JSON body
  `{"action": …}`. `GET /api/agent` returns the full usage doc.
- **MCP** — `https://entice-pink.vercel.app/api/agent/mcp` (streamable HTTP).

Auth for both: `Authorization: Bearer <agent key>`. Keys are stored as SHA-256
hashes in `agent_keys`; every call lands in `agent_audit` (admin-visible,
append-only) on a best-effort basis — the action commits before its audit row,
so a rare backend failure in between is logged to the server console rather than
the table. Design: `docs/superpowers/specs/2026-08-29-agent-api-design.md`.

## Connect a Claude Code / Cowork session (MCP)

```bash
claude mcp add --transport http --scope user ecr-portal \
  https://entice-pink.vercel.app/api/agent/mcp \
  --header "Authorization: Bearer <agent key>"
```

`--scope user` makes it available in every project on that machine. The session
then has tools: `help`, `schema`, `sql`, `insert`, `update`, `delete`, `rpc`,
`storage_list`, `storage_sign`, `storage_upload`. Tell the agent to call
`help` first — it self-documents, including the house rules.

## Drive it from any session (REST)

Paste something like this into a fresh Cowork/claude.ai session:

> You can operate my company's ECR portal through its agent API.
> Base URL: `https://entice-pink.vercel.app/api/agent`, header
> `Authorization: Bearer <agent key>`. POST JSON `{"action": …}`.
> First call `{"action": "help"}` and follow its house rules.

Examples:

```bash
curl -s https://entice-pink.vercel.app/api/agent \
  -H "Authorization: Bearer $ECR_AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "sql", "query": "select name from clients order by created_at"}'
```

```bash
curl -s https://entice-pink.vercel.app/api/agent \
  -H "Authorization: Bearer $ECR_AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "update", "table": "maintenance_entries", "values": {"status": "resolved"}, "filters": [{"column": "id", "op": "eq", "value": "<uuid>"}]}'
```

## What it can and cannot do

Reads are unlimited (`sql` takes any single SELECT/WITH, 1000-row cap). The
`sql` path runs inside a **read-only transaction**, so it cannot write even by
calling a function that would — use `insert`/`update`/`delete`/`rpc` to write.
Writes are structured: `update`/`delete` require at least one filter, `delete`
also requires `confirm: true`, `agent_keys`/`agent_audit` are write-protected,
and there is **no DDL** — schema changes still go through migrations. Storage
actions are limited to the `attachments`, `branding` and `backups` buckets;
`storage_upload` caps at 3 MB decoded (Vercel's request-body limit — use
`storage_sign` for anything larger). Existing DB protections (append-only
audit_log, storage protect trigger, CHECK constraints) still apply.

## Keys

Mint (run in the Supabase SQL editor; keep the plaintext, store only its hash):

```sql
insert into agent_keys (name, key_hash)
values ('<who/what>', encode(sha256('<plaintext key>'::bytea), 'hex'));
```

Revoke / inspect:

```sql
update agent_keys set revoked_at = now() where name = '<who/what>';
select name, created_at, revoked_at, last_used_at from agent_keys;
```

Audit trail:

```sql
select created_at, action, target, row_count, ok, error
from agent_audit order by created_at desc limit 50;
```

`agent_audit` is append-only; a deliberate admin prune needs
`set local app.allow_agent_audit_prune = 'true';` in the same transaction.

**Revoke, don't delete.** A key that has audited calls cannot be deleted: the
`agent_audit.key_id` FK is `ON DELETE SET NULL`, and nulling it trips the
append-only trigger, so the delete fails with `agent_audit is append-only`.
That is deliberate — deleting a key would otherwise quietly rewrite its audit
history. Set `revoked_at` instead (and `disabled_at` on an OAuth client).

## Connecting Cowork / the mobile app (OAuth)

Claude Code uses the bearer key above. claude.ai **account connectors** (Cowork,
the mobile app) can't send a static header, so they authenticate with OAuth
instead — no key to paste. Add a custom connector pointing at:

```
https://entice-pink.vercel.app/api/agent/mcp
```

The client registers itself, then sends you to a consent screen. You must be
signed into the portal **as an admin** to approve — that is the same bar as
minting a key, because a grant hands the agent full read/write. Approving mints
a 1-hour access token (auto-refreshed) that appears in `agent_keys` as
`kind='oauth'`, so every call is audited exactly like a static-key call and the
grant is revocable the same way:

```sql
update agent_keys set revoked_at = now() where kind = 'oauth';
update agent_oauth_clients set disabled_at = now();
```
