-- 0058: OAuth for the agent API (claude.ai custom connector support).
-- Static bearer keys work in Claude Code but Cowork / the mobile app only speak
-- OAuth (account connectors), so the MCP endpoint needs an OAuth 2.1 surface.
-- Design: docs/superpowers/specs/2026-09-01-agent-oauth-design.md
--
-- Note the deliberate reuse: an OAuth access token is just an agent_keys row with
-- kind='oauth' and an expiry, so revocation and the agent_audit.key_id trail keep
-- working with no changes to either.

create table public.agent_oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  client_name text,
  redirect_uris text[] not null,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

create table public.agent_oauth_codes (
  code_hash text primary key,          -- sha256 of the authorization code
  client_id text not null references public.agent_oauth_clients(client_id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,        -- PKCE S256 only
  scope text,
  resource text,
  approved_by uuid references public.profiles(id),
  expires_at timestamptz not null,
  used_at timestamptz,                 -- single-use guard
  created_at timestamptz not null default now()
);

create index agent_oauth_codes_expiry_idx on public.agent_oauth_codes (expires_at);

alter table public.agent_keys
  add column kind text not null default 'static',
  add column client_id text references public.agent_oauth_clients(client_id) on delete cascade,
  add column expires_at timestamptz,
  add column refresh_hash text unique,
  add column approved_by uuid references public.profiles(id);

alter table public.agent_keys
  add constraint agent_keys_kind_check check (kind in ('static','oauth'));

create index agent_keys_refresh_idx on public.agent_keys (refresh_hash) where refresh_hash is not null;

alter table public.agent_oauth_clients enable row level security;
alter table public.agent_oauth_codes enable row level security;
create policy agent_oauth_clients_admin_read on public.agent_oauth_clients
  for select to authenticated using (current_app_role() = 'admin');
-- agent_oauth_codes intentionally has NO policies — codes are secrets, service role only.
