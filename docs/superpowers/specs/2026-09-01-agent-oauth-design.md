# Agent API OAuth — claude.ai custom connector support

**Date:** 2026-09-01 · **Owner decision:** build OAuth so Cowork + the mobile app can use the agent API.

## Problem

`/api/agent/mcp` authenticates with a static bearer key. That works in Claude Code
(user-scope `~/.claude.json`, verified connected) but **not** in Cowork or the
claude.ai mobile app: those surface *account connectors*, which authenticate with
OAuth and cannot send a static header. Empirically confirmed 2026-09-01 — a Cowork
session sees only claude.ai connectors plus the browser bridge, never `ecr-portal`.

One OAuth layer unlocks both surfaces.

## Solution

Implement the MCP-required OAuth 2.1 surface on the portal, reusing the existing
Supabase login for user identity and the existing `agent_keys`/`agent_audit`
plumbing for authorisation and traceability.

### Endpoints

| Path | Auth | Purpose |
| --- | --- | --- |
| `/.well-known/oauth-protected-resource` (+ `/api/agent/mcp` suffix form) | public | RFC 9728 — points at the auth server |
| `/.well-known/oauth-authorization-server` | public | RFC 8414 metadata |
| `/api/agent/oauth/register` | public | RFC 7591 dynamic client registration |
| `/api/agent/oauth/authorize` | portal session (admin) | consent screen + code issue |
| `/api/agent/oauth/token` | PKCE | code → access/refresh token, refresh rotation |

Public client + **PKCE S256 mandatory** (`token_endpoint_auth_method: none`).

### Data model (migration 0058)

- `agent_oauth_clients` — dynamically registered clients (`client_id`,
  `client_name`, `redirect_uris[]`, `disabled_at`).
- `agent_oauth_codes` — single-use authorisation codes stored **hashed**, bound to
  client + redirect_uri + `code_challenge`, 60 s TTL, `used_at` guard.
- `agent_keys` **extended** rather than duplicated: `kind` ('static'|'oauth'),
  `client_id`, `expires_at`, `refresh_hash`, `approved_by`. An OAuth access token
  is simply a short-lived key row, so `authenticateAgentKey` gains one expiry
  check and **the entire audit path (`agent_audit.key_id`) keeps working unchanged**.

Token lifetimes: access 1 h, refresh 30 d with rotation on use. Revoking a grant =
setting `revoked_at`, exactly like a static key.

### Consent flow

`/authorize` validates the client/redirect/PKCE, then requires a portal session
with role **admin** (only an admin may grant an agent access to company data).
It renders a plain server-rendered consent page naming the client and what it can
do, with Approve/Deny. Approve issues a code and 302s back to the client.

Two supporting changes to existing code, both minimal:

1. **`src/proxy.ts`** — add `.well-known/` to the matcher's exclusion list.
   Discovery must be reachable unauthenticated; today the proxy 307s it to
   `/login`, which would break connector setup exactly like the `.webmanifest`
   bug did (0303edb).
2. **`src/app/login/actions.ts`** — honour an optional `next` form field so a
   signed-out admin landing on `/authorize` returns there after login. Guarded to
   same-origin relative paths (must start with `/`, reject `//`) to avoid an open
   redirect.

### Security

Internet-facing authorisation server, so: PKCE S256 only (no `plain`), exact
`redirect_uri` match against the registered set, codes single-use + hashed + 60 s,
tokens hashed at rest (never stored plaintext), refresh rotation, admin-only
approval, and `resource`/audience recorded. Every authenticated call continues to
flow through the existing guardrails (read-only `sql`, mandatory filters,
bucket allowlist) and `agent_audit`.

`WWW-Authenticate` on 401 gains `resource_metadata=` so MCP clients can discover
the auth server per spec.

### Testing

Pure layer unit-tested (PKCE verification, redirect validation, discovery
document shape, expiry logic). Then live: register a client, run the full
authorize→code→token→refresh cycle with curl, confirm a token drives a real
`tools/call`, confirm expiry/replay/bad-PKCE/bad-redirect all rejected, and
finally add it as a real connector and use it from Cowork.

### Out of scope

Consent for non-admin roles, per-scope permissions (a grant is full agent access,
same as a static key), and a Settings UI for grants (SQL for now, offered later).
