-- 0051: property maintenance log.
-- Field crew and office record make-safes / repairs / maintenance per site
-- with photo evidence (attachments parent_type 'maintenance'); entries carry
-- option-2 semantics (status 'open' = temporary fix in place, needs follow-up,
-- until resolved), an admin flag, and optional links to the job/project that
-- did the work. Clients see client_visible entries on full-scope portal links.

create table maintenance_entries (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  kind text not null check (kind in ('make_safe','repair','maintenance','inspection')),
  title text not null,
  description text,
  done_at date not null default current_date,
  -- 'open' = temporary measure in place (e.g. make-safe) awaiting permanent fix.
  status text not null default 'resolved' check (status in ('open','resolved')),
  follow_up text,
  flagged boolean not null default false,
  flag_note text,
  job_id uuid references jobs(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  client_visible boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index maintenance_entries_site_done_idx on maintenance_entries (site_id, done_at desc);
create index maintenance_entries_job_idx on maintenance_entries (job_id) where job_id is not null;
create index maintenance_entries_project_idx on maintenance_entries (project_id) where project_id is not null;

alter table maintenance_entries enable row level security;

-- All staff read; all staff insert (crews log from the field); only
-- admin/office edit, flag, resolve or delete.
create policy maintenance_select_staff on maintenance_entries for select to authenticated
  using (current_app_role() in ('admin','office','supervisor','field'));
create policy maintenance_insert_staff on maintenance_entries for insert to authenticated
  with check (current_app_role() in ('admin','office','supervisor','field'));
create policy maintenance_update_office on maintenance_entries for update to authenticated
  using (current_app_role() in ('admin','office'));
create policy maintenance_delete_office on maintenance_entries for delete to authenticated
  using (current_app_role() in ('admin','office'));

------------------------------------------------------------------------------
-- portal_site_detail — 0028 definition + 'maintenance' array (full scope only)
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
-- portal_file_path — 0026 definition + maintenance-evidence entitlement.
-- Maintenance evidence rides the ENTRY's client_visible (crew uploads default
-- attachments.client_visible=false; requiring the per-photo flag would hide
-- every photo until office toggled each one). Full-scope links only.
------------------------------------------------------------------------------
create or replace function portal_file_path(p_token text, p_kind text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_path text;
  v_filename text;
  v_site uuid;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if p_kind = 'item' then
    select coalesce(i.evidence_path, d.file_path),
           coalesce(i.evidence_filename, d.filename, i.title),
           i.site_id
      into v_path, v_filename, v_site
      from property_compliance_items i
      join sites s on s.id = i.site_id and s.client_id = l.client_id
      left join documents d on d.id = i.document_id
     where i.id = p_id and i.status = 'active';
  elsif p_kind = 'attachment' then
    select a.path, a.filename,
           coalesce(j.site_id, p.site_id, m.site_id)
      into v_path, v_filename, v_site
      from attachments a
      left join jobs j on a.parent_type = 'job' and j.id = a.parent_id
      left join projects p on a.parent_type = 'project' and p.id = a.parent_id
      left join maintenance_entries m on a.parent_type = 'maintenance' and m.id = a.parent_id
      join sites s on s.id = coalesce(j.site_id, p.site_id, m.site_id) and s.client_id = l.client_id
     where a.id = p_id
       and (
         (a.parent_type in ('job','project') and a.client_visible)
         or (a.parent_type = 'maintenance' and m.client_visible and l.scope = 'full')
       );
  end if;

  if v_path is null then return null; end if;

  insert into portal_views (client_link_id, site_id, path)
  values (l.id, v_site, left('download:' || p_kind || ':' || p_id::text, 300));

  return jsonb_build_object('path', v_path, 'filename', v_filename);
end $$;
