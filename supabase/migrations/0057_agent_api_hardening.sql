-- 0057: Agent API hardening (code-review follow-ups to 0056).
--   1. agent_select is now read-only at EXECUTION level, not just syntactically.
--      A SELECT that calls a VOLATILE/SECURITY DEFINER function which writes now
--      fails ("cannot execute INSERT in a read-only transaction") — closing the
--      "writes are impossible on the sql path" gap and its audit-evasion channel.
--      Collision-proof wrapper aliases (__agent_q/__agent_src) also fix the case
--      where a user query projects a column literally named _q or _row.
--   2. bootstrap_first_admin revoked from service_role — the agent API uses the
--      service role, and though the fn is inert while any profile exists, this
--      removes the theoretical reach if the profiles table were ever emptied.
-- Design: docs/superpowers/specs/2026-08-29-agent-api-design.md

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
  cleaned := regexp_replace(cleaned, ';\s*$', '');
  if cleaned = '' then
    raise exception 'agent_select: empty query';
  end if;
  if position(';' in cleaned) > 0 then
    raise exception 'agent_select: only a single statement is allowed';
  end if;
  -- NB: in Postgres regexes \y is the word boundary (\b is backspace).
  if cleaned !~* '^\s*(select|with)\y' then
    raise exception 'agent_select: only SELECT queries are allowed';
  end if;

  -- Execution-level read-only guard: even a SELECT that calls a VOLATILE or
  -- SECURITY DEFINER function which tries to write fails here. Transaction-
  -- scoped (local), and this fn is the only statement in its PostgREST tx, so
  -- it never affects the separate last_used_at / audit writes.
  perform set_config('transaction_read_only', 'on', true);

  -- Wrap so DDL/DML statements can't appear and data-modifying CTEs are
  -- rejected below top level. Collision-proof aliases avoid binding to a
  -- user column named _q/_row. Fetch 1001 rows to detect truncation.
  execute 'select coalesce(jsonb_agg(__agent_src), ''[]''::jsonb) '
          || 'from (select * from (' || cleaned || ') __agent_q limit 1001) __agent_src'
    into result;

  if jsonb_array_length(result) > 1000 then
    select jsonb_build_object('rows', jsonb_agg(e.value), 'truncated', true)
      into result
    from (select value from jsonb_array_elements(result) limit 1000) e;
    return result;
  end if;
  return jsonb_build_object('rows', result, 'truncated', false);
end
$$;

revoke all on function public.agent_select(text) from public;
revoke all on function public.agent_select(text) from anon;
revoke all on function public.agent_select(text) from authenticated;
grant execute on function public.agent_select(text) to service_role;

revoke execute on function public.bootstrap_first_admin(text, text, text) from service_role;
