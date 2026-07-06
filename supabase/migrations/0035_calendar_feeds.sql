-- 0035_calendar_feeds.sql
-- ICS calendar feeds — private token-signed endpoints so schedules land in
-- real calendars (Google/Outlook/Apple). Same trust model as portal links:
-- calendar apps cannot send auth cookies, so the token IS the credential and
-- every read goes through a SECURITY DEFINER fn that validates it internally.
--
--   * calendar_feed_tokens — one row per staff member. Regenerating replaces
--     the token in place (the old URL dies instantly); revoked_at supports an
--     explicit kill without issuing a new token. NO audit trigger on purpose:
--     the trigger would copy token values (credentials) into audit_log, which
--     supervisors can read. audit_whs also assumes an `id` column this table
--     doesn't have.
--   * regenerate_calendar_feed_token() — the ONLY write path (no
--     INSERT/UPDATE/DELETE policies). Tokens are always server-generated
--     crypto-random hex, never client-chosen.
--   * staff_calendar_feed(token) — the feed payload for
--     /api/calendar/staff/[token]: the person's schedule assignments from 14
--     days back to 90 days ahead (Brisbane calendar days), plus scheduled
--     portal work requests for admin/office people (they run that register;
--     one cheap indexed select). NO money columns anywhere.
--
-- The client-side feed (/api/calendar/portal/[token]) needs no new SQL — it
-- reuses portal_resolve_link + portal_calendar + portal_log_view from
-- 0026/0028.

create table calendar_feed_tokens (
  profile_id uuid primary key references profiles(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table calendar_feed_tokens enable row level security;

-- Owners see their own row (the UI shows the current URL); nobody else —
-- feed tokens are credentials, not org data.
create policy calendar_feed_tokens_select_self on calendar_feed_tokens
  for select to authenticated
  using (profile_id = auth.uid());
-- No INSERT/UPDATE/DELETE policies: writes only via the definer fn below.

------------------------------------------------------------------------------
-- 1. regenerate_calendar_feed_token — (re)issue the caller's token
------------------------------------------------------------------------------

-- Returns the fresh token (64 hex chars). Regenerating revokes the previous
-- URL by replacement. Null when there is no active profile for the caller.
create function regenerate_calendar_feed_token() returns text
language plpgsql security definer set search_path = public as $$
declare
  v_token text;
begin
  if auth.uid() is null then return null; end if;
  if not exists (select 1 from profiles where id = auth.uid() and active) then
    return null;
  end if;

  -- Two UUIDs' worth of randomness (256 bits), hex, no pgcrypto dependency.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into calendar_feed_tokens (profile_id, token)
  values (auth.uid(), v_token)
  on conflict (profile_id) do update
    set token = excluded.token, created_at = now(), revoked_at = null;

  return v_token;
end $$;

revoke execute on function regenerate_calendar_feed_token() from anon, public;
grant execute on function regenerate_calendar_feed_token() to authenticated;

------------------------------------------------------------------------------
-- 2. staff_calendar_feed — the per-person feed payload (anon-callable; the
--    token is validated inside, exactly like the portal RPCs)
------------------------------------------------------------------------------

-- Null for a bad/revoked token or inactive profile (route answers 404).
-- Otherwise {full_name, role, events:[{uid, date, number, title, note,
-- site_name, site_address}]} — date-only events (assignments carry no time
-- of day), Brisbane calendar window [today-14, today+90].
create function staff_calendar_feed(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_profile profiles;
  v_from date := (now() at time zone 'Australia/Brisbane')::date - 14;
  v_to   date := (now() at time zone 'Australia/Brisbane')::date + 90;
begin
  if p_token is null or char_length(p_token) < 32 then return null; end if;

  select p.* into v_profile
  from calendar_feed_tokens t
  join profiles p on p.id = t.profile_id and p.active
  where t.token = p_token
    and t.revoked_at is null;
  if v_profile.id is null then return null; end if;

  return jsonb_build_object(
    'full_name', v_profile.full_name,
    'role', v_profile.role,
    'events', coalesce((
      select jsonb_agg(ev order by ev->>'date', ev->>'uid')
      from (
        -- The person's own schedule assignments.
        select jsonb_build_object(
          'uid', 'assignment-' || a.id,
          'date', a.date,
          'number', coalesce(j.number, pr.number),
          'title', coalesce(j.title, pr.name),
          'note', a.note,
          'site_name', s.name,
          'site_address', nullif(trim(concat_ws(' ', s.address, s.suburb, s.state, s.postcode)), '')
        ) as ev
        from assignments a
        left join jobs j on j.id = a.job_id
        left join projects pr on pr.id = a.project_id
        left join sites s on s.id = coalesce(j.site_id, pr.site_id)
        where a.user_id = v_profile.id
          and a.date between v_from and v_to

        union all

        -- Scheduled portal work requests — office people only (they run the
        -- register; field/supervisor feeds stay strictly personal).
        select jsonb_build_object(
          'uid', 'request-' || r.id,
          'date', r.scheduled_for,
          'number', r.number,
          'title', r.title,
          'note', r.scheduled_note,
          'site_name', s2.name,
          'site_address', nullif(trim(concat_ws(' ', s2.address, s2.suburb, s2.state, s2.postcode)), '')
        )
        from portal_requests r
        join sites s2 on s2.id = r.site_id
        where v_profile.role in ('admin','office')
          and r.status = 'scheduled'
          and r.scheduled_for between v_from and v_to
      ) events(ev)
    ), '[]'::jsonb)
  );
end $$;

grant execute on function staff_calendar_feed(text) to anon, authenticated;
