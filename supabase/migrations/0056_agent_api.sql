-- 0056: Agent API (remote Claude read/write access to the portal).
-- Backing tables + read-only SQL RPC for /api/agent and /api/agent/mcp:
--   * agent_keys  — bearer keys stored as SHA-256 hashes only; revocable.
--   * agent_audit — append-only log of every agent call (ISO traceability).
--   * agent_select(q) — service-role-only SECURITY DEFINER fn that runs an
--     arbitrary *read-only* SELECT (PostgREST has no raw-SQL surface). The
--     FROM-subquery wrap makes DDL/DML syntactically impossible and Postgres
--     rejects data-modifying CTEs anywhere but a statement's top level.
-- Design: docs/superpowers/specs/2026-08-29-agent-api-design.md

-- ── Keys ─────────────────────────────────────────────────────────────────
create table public.agent_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_hash text not null unique, -- sha256 hex of the bearer token
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);

alter table public.agent_keys enable row level security;
create policy agent_keys_admin_read on public.agent_keys
  for select to authenticated using (current_app_role() = 'admin');
-- Writes intentionally have no policies: service role only.

-- ── Audit ────────────────────────────────────────────────────────────────
create table public.agent_audit (
  id bigint generated always as identity primary key,
  key_id uuid references public.agent_keys(id) on delete set null,
  action text not null,
  target text,
  params jsonb,
  row_count integer,
  ok boolean not null default true,
  error text,
  ip text,
  user_agent text,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index agent_audit_created_idx on public.agent_audit (created_at desc);

alter table public.agent_audit enable row level security;
create policy agent_audit_admin_read on public.agent_audit
  for select to authenticated using (current_app_role() = 'admin');

-- Append-only, with the same GUC escape hatch pattern the storage protect
-- trigger uses, so a deliberate admin prune stays possible:
--   set local app.allow_agent_audit_prune = 'true';
create or replace function public.agent_audit_protect()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.allow_agent_audit_prune', true), '') = 'true' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'agent_audit is append-only';
end
$$;

create trigger agent_audit_protect
  before update or delete on public.agent_audit
  for each row execute function public.agent_audit_protect();

-- ── Read-only SQL for the agent 'sql' action ─────────────────────────────
create or replace function public.agent_select(q text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cleaned text;
  result jsonb;
begin
  cleaned := btrim(q);
  cleaned := regexp_replace(cleaned, ';\s*$', ''); -- one trailing ; is fine
  if cleaned = '' then
    raise exception 'agent_select: empty query';
  end if;
  if position(';' in cleaned) > 0 then
    raise exception 'agent_select: only a single statement is allowed';
  end if;
  -- NB: in Postgres regexes \y is the word boundary (\b is backspace!)
  if cleaned !~* '^\s*(select|with)\y' then
    raise exception 'agent_select: only SELECT queries are allowed';
  end if;

  -- Wrapped execution: the query must parse as a subquery, so INSERT/UPDATE/
  -- DELETE/DDL cannot appear, EXECUTE refuses multiple commands, and Postgres
  -- raises on data-modifying CTEs below top level. Fetch 1001 rows to detect
  -- truncation at the 1000-row cap.
  execute 'select coalesce(jsonb_agg(_row), ''[]''::jsonb) '
          || 'from (select * from (' || cleaned || ') _q limit 1001) _row'
    into result;

  if jsonb_array_length(result) > 1000 then
    select jsonb_build_object(
      'rows', jsonb_agg(e.value), 'truncated', true)
      into result
    from (
      select value from jsonb_array_elements(result) limit 1000
    ) e;
    return result;
  end if;
  return jsonb_build_object('rows', result, 'truncated', false);
end
$$;

revoke all on function public.agent_select(text) from public;
revoke all on function public.agent_select(text) from anon;
revoke all on function public.agent_select(text) from authenticated;
grant execute on function public.agent_select(text) to service_role;
