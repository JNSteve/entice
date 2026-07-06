-- 0034_request_sync.sql
-- Portal work-request lifecycle polish (owner-reported gaps):
--
--   * portal_requests.scheduled_for / scheduled_note — the planned date and
--     note the office captures in the "Mark scheduled" dialog. Shown on the
--     client's portal timeline ("Scheduled — dd/MM/yyyy") and as a column on
--     the office register; editable while the request sits at 'scheduled'.
--
--   * sync_portal_requests_for_quote() — the auto-sync hook the office server
--     actions fire (via next/server after(), never blocking the parent):
--       quote converted to a job/project → linked requests move to 'scheduled'
--         (scheduled_for seeded from the work's earliest schedule assignment
--          when one exists — normally null for a fresh conversion);
--       job completed / project closed   → linked requests move to 'completed'.
--     Forward-only: the WHERE clauses mirror REQUEST_TRANSITIONS in
--     src/lib/portal-interactions.ts (change them together). Terminal or
--     manually advanced requests are simply skipped — manual override always
--     wins, nothing ever regresses. SECURITY DEFINER because supervisors may
--     complete jobs (jobs UPDATE allows them) while portal_requests UPDATE is
--     admin/office-only; the fn re-checks the caller is staff. The
--     portal_requests audit trigger (0029) records every auto move with the
--     acting user.

alter table portal_requests
  add column scheduled_for date,
  add column scheduled_note text
    check (scheduled_note is null or char_length(scheduled_note) <= 500);

------------------------------------------------------------------------------
-- 1. portal_my_requests — expose the scheduled date + note (still never
--    office handling notes or money)
------------------------------------------------------------------------------

create or replace function portal_my_requests(p_token text, p_site uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'number', r.number,
      'site_id', r.site_id,
      'site_name', s.name,
      'title', r.title,
      'description', r.description,
      'urgency', r.urgency,
      'status', r.status,
      'scheduled_for', r.scheduled_for,
      'scheduled_note', r.scheduled_note,
      'photo_count', coalesce(array_length(r.photo_paths, 1), 0),
      'created_at', r.created_at)
      order by r.created_at desc)
    from portal_requests r
    join sites s on s.id = r.site_id
    where r.client_id = l.client_id
      and (p_site is null or r.site_id = p_site)
  ), '[]'::jsonb);
end $$;

------------------------------------------------------------------------------
-- 2. sync_portal_requests_for_quote — downstream work drives the request on
------------------------------------------------------------------------------

-- p_event: 'work_scheduled' (quote converted to job/project) or
--          'work_completed' (job completed / project closed).
-- Returns a jsonb array of the requests actually moved
-- ([{id, number, status}]) so the caller can send the CP3 client emails —
-- '[]' when nothing was eligible (already ahead, declined, or no link).
create function sync_portal_requests_for_quote(p_quote uuid, p_event text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_target text;
  v_scheduled_for date;
  v_result jsonb;
begin
  -- Staff only — this is an internal hook, never a portal surface.
  if coalesce(current_app_role(), '') not in ('admin','office','supervisor') then
    return '[]'::jsonb;
  end if;
  if p_quote is null then return '[]'::jsonb; end if;

  v_target := case p_event
    when 'work_scheduled' then 'scheduled'
    when 'work_completed' then 'completed'
    else null end;
  if v_target is null then return '[]'::jsonb; end if;

  -- Seed the planned date from the converted work's earliest schedule
  -- assignment (usually none yet for a fresh conversion → stays null).
  if v_target = 'scheduled' then
    select min(a.date) into v_scheduled_for
    from quotes q
    join assignments a
      on (q.converted_to = 'job' and a.job_id = q.converted_id)
      or (q.converted_to = 'project' and a.project_id = q.converted_id)
    where q.id = p_quote;
  end if;

  -- Forward-only moves, mirroring REQUEST_TRANSITIONS
  -- (src/lib/portal-interactions.ts):
  --   → scheduled: from submitted | reviewed | quoted
  --   → completed: from quoted | scheduled
  -- Never fills a manually entered scheduled_for (coalesce keeps the manual
  -- value); never touches completed/declined/already-ahead requests.
  with moved as (
    update portal_requests r
    set status = v_target,
        scheduled_for = case
          when v_target = 'scheduled' then coalesce(r.scheduled_for, v_scheduled_for)
          else r.scheduled_for end
    where r.quote_id = p_quote
      and (
        (v_target = 'scheduled' and r.status in ('submitted','reviewed','quoted'))
        or (v_target = 'completed' and r.status in ('quoted','scheduled'))
      )
    returning r.id, r.number, r.status
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('id', id, 'number', number, 'status', status)),
    '[]'::jsonb)
  into v_result
  from moved;

  return v_result;
end $$;

revoke execute on function sync_portal_requests_for_quote(uuid, text) from anon, public;
grant execute on function sync_portal_requests_for_quote(uuid, text) to authenticated;
