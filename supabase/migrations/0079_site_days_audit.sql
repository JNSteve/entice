-- 0079: edit trail for the office "Site days" view.
--
-- timesheet_entries and field_usage were not audited. The office can now
-- correct both from /site-days, so every change records who made it, when,
-- whose entry it was, and the before and after.
--
-- A sibling of audit_whs() (0030), not audit_whs() itself, for two reasons:
--   * audit_whs() diffs every column. On timesheet_entries that would log
--     cost_rate (the hourly cost stamped at approval, 0066) into audit_log,
--     which supervisors can read. Money must not reach them.
--   * audit_whs() summarises INSERT / DELETE from title / name / status /
--     number / kind / label. A timesheet entry has none of those, so a
--     deleted entry would leave no record of what was deleted.
--
-- Every row carries detail.summary — the person, the job or project number,
-- the day and the Brisbane times — so the audit screen can say whose hours
-- changed without anyone running SQL. audit_log is append-only, so this has
-- to be right before the triggers are attached.
--
-- The triggers fire for the crew too: every check-in, check-out, switch and
-- materials line becomes an audit row.
--
-- Spec: docs/superpowers/specs/2026-11-20-field-job-first-design.md

-- Money and bookkeeping keys never reach the log. cost_rate is the only money
-- column on either table today; the pattern also catches one added later
-- (…_cost, cost_…, price, amount, sell, margin, markup, …_rate). It does not
-- match rate_item_id, which is a link to a price-list row, not a figure.
create or replace function audit_site_day_strip(p_row jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from jsonb_each(p_row)
  where key <> 'updated_at'
    and key !~ '(^|_)(cost|price|amount|sell|margin|markup)(_|$)|(^|_)rate$'
$$;

create or replace function audit_site_day() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_row jsonb;
  v_old jsonb;
  v_changed jsonb := '{}'::jsonb;
  v_detail jsonb;
  v_summary text;
  v_work text;
  v_person text;
  k text;
begin
  select full_name into v_actor_name from profiles where id = v_actor;
  v_actor_name := coalesce(v_actor_name, 'system');

  if tg_op = 'DELETE' then
    v_row := audit_site_day_strip(to_jsonb(old));
  else
    v_row := audit_site_day_strip(to_jsonb(new));
  end if;

  -- The job or project this row belongs to, by its number. When a job is
  -- deleted its rows cascade after the job is gone, so the number can be null.
  select number into v_work from jobs where id = nullif(v_row ->> 'job_id', '')::uuid;
  if v_work is null then
    select number into v_work from projects where id = nullif(v_row ->> 'project_id', '')::uuid;
  end if;
  v_work := coalesce(v_work, 'job removed');

  if tg_table_name = 'timesheet_entries' then
    select full_name into v_person from profiles where id = nullif(v_row ->> 'user_id', '')::uuid;
    v_summary := format(
      '%s · %s · %s · %s to %s',
      coalesce(v_person, 'Unknown person'),
      v_work,
      v_row ->> 'date',
      to_char((v_row ->> 'start_at')::timestamptz at time zone 'Australia/Brisbane', 'HH24:MI'),
      coalesce(
        to_char((v_row ->> 'end_at')::timestamptz at time zone 'Australia/Brisbane', 'HH24:MI'),
        'still checked in'));
  else
    v_summary := format(
      '%s · %s · %s: %s',
      v_work, v_row ->> 'date', v_row ->> 'kind', v_row ->> 'description');
  end if;

  if tg_op = 'UPDATE' then
    v_old := audit_site_day_strip(to_jsonb(old));
    for k in select jsonb_object_keys(v_row) loop
      if v_old -> k is distinct from v_row -> k then
        if k in ('start_at', 'end_at') then
          -- Brisbane wall-clock, not the stored UTC instant.
          v_changed := v_changed || jsonb_build_object(k, jsonb_build_object(
            'from', to_char((v_old ->> k)::timestamptz at time zone 'Australia/Brisbane', 'YYYY-MM-DD HH24:MI'),
            'to',   to_char((v_row ->> k)::timestamptz at time zone 'Australia/Brisbane', 'YYYY-MM-DD HH24:MI')));
        else
          v_changed := v_changed
            || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_row -> k));
        end if;
      end if;
    end loop;
    if v_changed = '{}'::jsonb then
      return null;  -- no effective change; skip the noise
    end if;
    v_detail := jsonb_build_object('summary', v_summary, 'changed', v_changed);
  else
    v_detail := jsonb_build_object('summary', v_summary, 'row', v_row);
  end if;

  insert into audit_log (actor_id, actor_name, entity_type, entity_id, project_id, action, detail)
  values (v_actor, v_actor_name, tg_table_name, (v_row ->> 'id')::uuid,
          nullif(v_row ->> 'project_id', '')::uuid, lower(tg_op), v_detail);
  return null;
end $$;

revoke execute on function audit_site_day() from anon, authenticated, public;
revoke execute on function audit_site_day_strip(jsonb) from anon, authenticated, public;

create trigger timesheet_entries_audit
  after insert or update or delete on timesheet_entries
  for each row execute function audit_site_day();

create trigger field_usage_audit
  after insert or update or delete on field_usage
  for each row execute function audit_site_day();
