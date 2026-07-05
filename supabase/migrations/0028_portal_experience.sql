-- 0028_portal_experience.sql
-- Client Portal CP2a — the client experience overhaul (roadmap
-- docs/superpowers/plans/2026-07-03-client-portal-roadmap.md §CP2a).
--
--   * portal_calendar(token, from, to) — NEW anon RPC feeding the portfolio
--     calendar: compliance review-due dates + works start/finish dates across
--     the client's sites. Same security shape as every CP1 portal RPC:
--     SECURITY DEFINER, token validated internally via portal_live_link(),
--     nothing beyond that client's data, no money columns, null for dead
--     tokens. The date range is clamped server-side (≤ 400 days) so the
--     endpoint cannot be used to bulk-export decades of data in one call.
--   * portal_resolve_link — extended with the company contact fields the
--     portal footer contact card renders (phone / email / address / abn).
--     All of these already appear on client-facing PDFs; nothing sensitive.
--   * portal_site_detail — extended with:
--       - projects.progress_pct: duration-weighted programme completion %
--         (null when the project has no programme) for the works progress bar;
--       - jobs.completed_on / project dates as Brisbane calendar dates where
--         they back the works timeline;
--       - attachments.size + created_on (Brisbane date) for the document
--         library rows and year grouping.
--     Still NO money fields anywhere in any portal payload.
--
-- Traffic-light/folder/calendar DERIVATION stays in TypeScript
-- (src/lib/portal.ts, src/lib/portal-experience.ts) so office and portal
-- agree and the logic is unit-tested.

------------------------------------------------------------------------------
-- 1. portal_resolve_link — add company contact fields for the footer card
------------------------------------------------------------------------------

create or replace function portal_resolve_link(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
  v_client_name text;
  s settings%rowtype;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  select name into v_client_name from clients where id = l.client_id;
  select * into s from settings where id = 1;

  return jsonb_build_object(
    'client_name', v_client_name,
    'label', l.label,
    'company_name', coalesce(s.company_name, 'Entice'),
    'logo_path', s.logo_path,
    'company_phone', s.phone,
    'company_email', s.email,
    'company_address', s.address,
    'company_abn', s.abn);
end $$;

------------------------------------------------------------------------------
-- 2. portal_site_detail — progress %, Brisbane dates, attachment size
------------------------------------------------------------------------------

create or replace function portal_site_detail(p_token text, p_site uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
  s sites%rowtype;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  select * into s from sites
   where id = p_site and client_id = l.client_id;
  if not found then return null; end if;

  return jsonb_build_object(
    'site', jsonb_build_object(
      'id', s.id, 'name', s.name, 'address', s.address,
      'suburb', s.suburb, 'state', s.state, 'postcode', s.postcode),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'kind', i.kind, 'title', i.title,
        'issue_date', i.issue_date, 'review_due', i.review_due,
        'notes', i.notes,
        'filename', coalesce(i.evidence_filename, d.filename),
        'has_file', (i.evidence_path is not null or d.file_path is not null))
        order by i.kind, i.issue_date desc)
      from property_compliance_items i
      left join documents d on d.id = i.document_id
      where i.site_id = s.id and i.status = 'active'
    ), '[]'::jsonb),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', j.id, 'number', j.number, 'title', j.title, 'status', j.status,
        'scheduled_start', j.scheduled_start, 'scheduled_end', j.scheduled_end,
        'completed_on', to_char(j.completed_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'),
        'attachments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'filename', a.filename, 'kind', a.kind,
            'content_type', a.content_type, 'caption', a.caption,
            'size', a.size,
            'created_at', a.created_at,
            'created_on', to_char(a.created_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'))
            order by a.created_at desc)
          from attachments a
          where a.parent_type = 'job' and a.parent_id = j.id and a.client_visible
        ), '[]'::jsonb))
        order by j.created_at desc)
      from jobs j
      where j.site_id = s.id and j.status not in ('quote','lost')
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'number', p.number, 'name', p.name, 'status', p.status,
        'start_date', p.start_date,
        'practical_completion_date', p.practical_completion_date,
        -- Duration-weighted programme completion (null = no programme):
        -- Σ(progress × task days) / Σ(task days), rounded to whole percent.
        'progress_pct', (
          select round(
            sum(t.progress_pct * (t.end_date - t.start_date + 1))
            / nullif(sum(t.end_date - t.start_date + 1), 0))
          from programme_tasks t
          where t.project_id = p.id
        ),
        'attachments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'filename', a.filename, 'kind', a.kind,
            'content_type', a.content_type, 'caption', a.caption,
            'size', a.size,
            'created_at', a.created_at,
            'created_on', to_char(a.created_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'))
            order by a.created_at desc)
          from attachments a
          where a.parent_type = 'project' and a.parent_id = p.id and a.client_visible
        ), '[]'::jsonb))
        order by p.created_at desc)
      from projects p
      where p.site_id = s.id
    ), '[]'::jsonb));
end $$;

------------------------------------------------------------------------------
-- 3. portal_calendar — compliance due dates + works dates for the client
------------------------------------------------------------------------------

-- Every calendar entry for the client's whole portfolio in [p_from, p_to]:
--   {kind:'compliance', date, site_id, site_name, item_id, item_kind, title}
--   {kind:'work', edge:'start'|'finish', date, site_id, site_name,
--    work_type:'job'|'project', number, title, status}
-- Null for dead tokens (indistinguishable from a bad token — no probing
-- surface); '[]' for a live token with nothing in range. Range is clamped to
-- 400 days and rejected when inverted. NO money columns.
create or replace function portal_calendar(p_token text, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if p_from is null or p_to is null
     or p_to < p_from
     or p_to - p_from > 400 then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(ev order by ev->>'date', ev->>'kind')
    from (
      -- Compliance review-due dates on active items.
      select jsonb_build_object(
        'kind', 'compliance',
        'date', i.review_due,
        'site_id', s.id, 'site_name', s.name,
        'item_id', i.id, 'item_kind', i.kind, 'title', i.title) as ev
      from property_compliance_items i
      join sites s on s.id = i.site_id and s.client_id = l.client_id
      where i.status = 'active'
        and i.review_due between p_from and p_to

      union all

      -- Job scheduled start/finish (real works only — never quotes).
      select jsonb_build_object(
        'kind', 'work', 'edge', e.edge, 'date', e.d,
        'site_id', s.id, 'site_name', s.name,
        'work_type', 'job', 'number', j.number, 'title', j.title,
        'status', j.status)
      from jobs j
      join sites s on s.id = j.site_id and s.client_id = l.client_id
      cross join lateral (values
        (j.scheduled_start, 'start'), (j.scheduled_end, 'finish')
      ) as e(d, edge)
      where j.status not in ('quote','lost')
        and e.d between p_from and p_to

      union all

      -- Project start / practical completion.
      select jsonb_build_object(
        'kind', 'work', 'edge', e.edge, 'date', e.d,
        'site_id', s.id, 'site_name', s.name,
        'work_type', 'project', 'number', p.number, 'title', p.name,
        'status', p.status)
      from projects p
      join sites s on s.id = p.site_id and s.client_id = l.client_id
      cross join lateral (values
        (p.start_date, 'start'), (p.practical_completion_date, 'finish')
      ) as e(d, edge)
      where e.d between p_from and p_to
    ) events
  ), '[]'::jsonb);
end $$;

grant execute on function portal_calendar(text, date, date) to anon, authenticated;
