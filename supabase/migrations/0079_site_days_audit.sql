-- 0079: edit trail for the office "Site days" view.
--
-- timesheet_entries and field_usage were not audited. The office can now
-- correct both from /site-days, so every change records who, when, and the
-- before and after.
--
-- A sibling of audit_whs() (0030), not audit_whs() itself, for two reasons:
--   * audit_whs() diffs every column. On timesheet_entries that would log
--     cost_rate (the hourly cost stamped at approval, 0066) into audit_log,
--     which supervisors can read. Money must not reach them.
--   * audit_whs() summarises INSERT / DELETE from title / name / status /
--     number / kind / label. A timesheet entry has none of those, so a
--     deleted entry would leave no record of what was deleted.
--
-- Spec: docs/superpowers/specs/2026-11-20-field-job-first-design.md

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
  k text;
begin
  select full_name into v_actor_name from profiles where id = v_actor;
  v_actor_name := coalesce(v_actor_name, 'system');

  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;
  -- Never carry the cost rate or bookkeeping timestamps into the log.
  v_row := v_row - 'cost_rate' - 'updated_at';

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - 'cost_rate' - 'updated_at';
    for k in select jsonb_object_keys(v_row) loop
      if v_old -> k is distinct from v_row -> k then
        v_changed := v_changed
          || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_row -> k));
      end if;
    end loop;
    if v_changed = '{}'::jsonb then
      return null;  -- no effective change; skip the noise
    end if;
    v_detail := jsonb_build_object('changed', v_changed);
  else
    if tg_table_name = 'timesheet_entries' then
      v_summary := format(
        '%s %s to %s',
        v_row ->> 'date',
        to_char((v_row ->> 'start_at')::timestamptz at time zone 'Australia/Brisbane', 'HH24:MI'),
        coalesce(
          to_char((v_row ->> 'end_at')::timestamptz at time zone 'Australia/Brisbane', 'HH24:MI'),
          'still checked in'));
    else
      v_summary := format(
        '%s %s: %s',
        v_row ->> 'date', v_row ->> 'kind', v_row ->> 'description');
    end if;
    v_detail := jsonb_build_object('summary', v_summary, 'row', v_row);
  end if;

  insert into audit_log (actor_id, actor_name, entity_type, entity_id, project_id, action, detail)
  values (v_actor, v_actor_name, tg_table_name, (v_row ->> 'id')::uuid,
          nullif(v_row ->> 'project_id', '')::uuid, lower(tg_op), v_detail);
  return null;
end $$;

revoke execute on function audit_site_day() from anon, authenticated, public;

create trigger timesheet_entries_audit
  after insert or update or delete on timesheet_entries
  for each row execute function audit_site_day();

create trigger field_usage_audit
  after insert or update or delete on field_usage
  for each row execute function audit_site_day();
