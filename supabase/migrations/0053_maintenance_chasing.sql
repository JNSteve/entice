-- 0053: maintenance chasing — follow-up due dates (portal calendar + aging),
-- and the quote link for "Quote this" on open entries.

alter table maintenance_entries add column follow_up_due date;
alter table maintenance_entries add column quote_id uuid references quotes(id) on delete set null;

------------------------------------------------------------------------------
-- portal_site_detail — 0051 definition + follow_up_due in the maintenance array
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
    'maintenance', case when l.scope = 'full' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'title', m.title,
        'description', m.description,
        'done_at', m.done_at,
        'status', m.status,
        'follow_up', m.follow_up,
        'follow_up_due', m.follow_up_due,
        'job_number', j.number, 'project_number', p.number,
        'attachments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'filename', a.filename, 'kind', a.kind,
            'content_type', a.content_type, 'caption', a.caption)
            order by a.created_at)
          from attachments a
          where a.parent_type = 'maintenance' and a.parent_id = m.id
        ), '[]'::jsonb))
        order by m.done_at desc, m.created_at desc)
      from maintenance_entries m
      left join jobs j on j.id = m.job_id
      left join projects p on p.id = m.project_id
      where m.site_id = s.id and m.client_visible
    ), '[]'::jsonb) else '[]'::jsonb end,
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
-- portal_calendar — 0028 definition + open-maintenance due dates
-- (full-scope links only, client_visible entries only)
------------------------------------------------------------------------------
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

      -- Open maintenance follow-ups (e.g. permanent repair due after a
      -- make-safe). Full-scope links only — register links never see these.
      select jsonb_build_object(
        'kind', 'maintenance',
        'date', m.follow_up_due,
        'site_id', s.id, 'site_name', s.name,
        'item_id', m.id, 'item_kind', m.kind, 'title', m.title) as ev
      from maintenance_entries m
      join sites s on s.id = m.site_id and s.client_id = l.client_id
      where l.scope = 'full'
        and m.status = 'open' and m.client_visible
        and m.follow_up_due between p_from and p_to

      union all

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
