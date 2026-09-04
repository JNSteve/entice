-- 0062: client portal works-first upgrade.
--   * jobs/projects.client_shared — the per-work "Share with client" switch
--     (office action flips the work's attachments' client_visible with it).
--   * quotes backfill: sent/accepted quotes are on the portal by default
--     (setQuoteStatus now publishes on send).
--   * portal_approvals: office-decided items (no portal_acceptances row)
--     appear as decided with source='office'.
--   * portal_approval_file: decided items keep their PDF.
--   * portal_site_detail / portal_file_path: project DIARY photos ride the
--     project's visibility; siteless works can download their files.
--   * portal_works / portal_work_detail: the Works list and work page.

alter table jobs     add column client_shared boolean not null default false;
alter table projects add column client_shared boolean not null default false;

update quotes set portal_published = true
 where status in ('sent','accepted') and not portal_published;

------------------------------------------------------------------------------
-- portal_approvals — 0029 definition + office-decided items
------------------------------------------------------------------------------
create or replace function portal_approvals(p_token text, p_site uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
  v_pending jsonb;
  v_decided jsonb;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  with quote_items as (
    select 'quote' as kind, q.id, q.number, q.title,
           s.name as context, q.site_id,
           (select round(coalesce(sum(round(ql.qty * ql.unit_sell, 2)), 0)
                   * (1 + q.gst_rate / 100), 2)
              from quote_lines ql where ql.quote_id = q.id) as amount,
           true as gst_inclusive,
           to_char(coalesce(q.sent_at, q.created_at) at time zone 'Australia/Brisbane',
                   'YYYY-MM-DD') as item_date,
           q.status, 'sent' as signable_status,
           q.decided_at
    from quotes q
    left join sites s on s.id = q.site_id
    where q.client_id = l.client_id
      and q.portal_published
      and (p_site is null or q.site_id = p_site)
  ),
  variation_items as (
    select 'variation' as kind, v.id,
           'VO-' || v.number::text as number, v.title,
           p.number || ' — ' || p.name as context, p.site_id,
           v.sell_amount as amount,
           false as gst_inclusive,
           to_char(coalesce(v.submitted_at, v.created_at) at time zone 'Australia/Brisbane',
                   'YYYY-MM-DD') as item_date,
           v.status, 'submitted' as signable_status,
           v.decided_at
    from variations v
    join projects p on p.id = v.project_id
    where p.client_id = l.client_id
      and v.portal_published
      and (p_site is null or p.site_id = p_site)
  ),
  items as (
    select * from quote_items union all select * from variation_items
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object(
        'kind', i.kind, 'id', i.id, 'number', i.number, 'title', i.title,
        'context', i.context, 'site_id', i.site_id, 'amount', i.amount,
        'gst_inclusive', i.gst_inclusive, 'date', i.item_date)
        order by i.item_date desc, i.number)
      from items i
      where i.status = i.signable_status
        and not exists (select 1 from portal_acceptances a
                         where a.kind = i.kind and a.target_id = i.id)
    ), '[]'::jsonb),
    coalesce((select jsonb_agg(d order by d->>'signed_on' desc nulls last, d->>'number')
      from (
        -- Signed through the portal
        select jsonb_build_object(
          'kind', i.kind, 'id', i.id, 'number', i.number, 'title', i.title,
          'context', i.context, 'site_id', i.site_id, 'amount', i.amount,
          'gst_inclusive', i.gst_inclusive, 'date', i.item_date,
          'action', a.action, 'signer_name', a.signer_name,
          'signed_on', to_char(a.signed_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'),
          'source', 'portal') as d
        from items i
        join lateral (
          select * from portal_acceptances a
          where a.kind = i.kind and a.target_id = i.id
          order by a.action = 'accepted' desc, a.signed_at desc
          limit 1
        ) a on true
        union all
        -- Decided in the office (accepted/lost, approved/rejected) with no
        -- portal signature — still the client's record.
        select jsonb_build_object(
          'kind', i.kind, 'id', i.id, 'number', i.number, 'title', i.title,
          'context', i.context, 'site_id', i.site_id, 'amount', i.amount,
          'gst_inclusive', i.gst_inclusive, 'date', i.item_date,
          'action', case when i.status in ('accepted','approved') then 'accepted' else 'declined' end,
          'signer_name', null,
          'signed_on', to_char(i.decided_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'),
          'source', 'office')
        from items i
        where i.status in ('accepted','lost','approved','rejected')
          and not exists (select 1 from portal_acceptances a
                           where a.kind = i.kind and a.target_id = i.id)
      ) x
    ), '[]'::jsonb)
  into v_pending, v_decided;

  return jsonb_build_object('pending', v_pending, 'decided', v_decided);
end $$;

------------------------------------------------------------------------------
-- portal_approval_file — decided items keep their PDF
------------------------------------------------------------------------------
create or replace function portal_approval_file(p_token text, p_kind text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_number text;
  v_site uuid;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if p_kind = 'quote' then
    select q.number, q.site_id into v_number, v_site
      from quotes q
     where q.id = p_id and q.client_id = l.client_id
       and q.portal_published and q.status in ('sent','accepted','lost');
  elsif p_kind = 'variation' then
    select 'VO-' || v.number::text, p.site_id into v_number, v_site
      from variations v
      join projects p on p.id = v.project_id
     where v.id = p_id and p.client_id = l.client_id
       and v.portal_published and v.status in ('submitted','approved','rejected');
  end if;

  if v_number is null then return null; end if;

  insert into portal_views (client_link_id, site_id, path)
  values (l.id, v_site, left('download:approval:' || p_kind || ':' || p_id::text, 300));

  return jsonb_build_object('number', v_number);
end $$;

------------------------------------------------------------------------------
-- portal_site_detail — 0053 definition + diary photos on projects; archived
-- jobs/projects are now excluded (they were never meant to show).
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
      where j.site_id = s.id and j.status not in ('quote','lost') and not j.archived
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'number', p.number, 'name', p.name, 'status', p.status,
        'start_date', p.start_date,
        'practical_completion_date', p.practical_completion_date,
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
          where a.client_visible
            and ((a.parent_type = 'project' and a.parent_id = p.id)
              or (a.parent_type = 'diary' and a.parent_id in
                    (select d.id from diaries d where d.project_id = p.id)))
        ), '[]'::jsonb))
        order by p.created_at desc)
      from projects p
      where p.site_id = s.id and not p.archived
    ), '[]'::jsonb));
end $$;

------------------------------------------------------------------------------
-- portal_file_path — 0051 definition (job/project/maintenance) + diary
-- parents + siteless works. Work attachments are entitled through the WORK's
-- client (works may have no site); maintenance evidence keeps riding the
-- entry's client_visible on full-scope links, entitled through its site.
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
           coalesce(j.site_id, p.site_id, dp.site_id, m.site_id)
      into v_path, v_filename, v_site
      from attachments a
      left join jobs j on a.parent_type = 'job' and j.id = a.parent_id
      left join projects p on a.parent_type = 'project' and p.id = a.parent_id
      left join diaries d on a.parent_type = 'diary' and d.id = a.parent_id
      left join projects dp on dp.id = d.project_id
      left join maintenance_entries m on a.parent_type = 'maintenance' and m.id = a.parent_id
      left join sites ms on ms.id = m.site_id
     where a.id = p_id
       and (
         (a.parent_type in ('job','project','diary') and a.client_visible
           and coalesce(j.client_id, p.client_id, dp.client_id) = l.client_id)
         or (a.parent_type = 'maintenance' and m.client_visible and l.scope = 'full'
           and ms.client_id = l.client_id)
       );
  end if;

  if v_path is null then return null; end if;

  insert into portal_views (client_link_id, site_id, path)
  values (l.id, v_site, left('download:' || p_kind || ':' || p_id::text, 300));

  return jsonb_build_object('path', v_path, 'filename', v_filename);
end $$;

------------------------------------------------------------------------------
-- portal_works — every job/project for the client (full-scope links only),
-- with counts of what is client-visible. NO money.
------------------------------------------------------------------------------
create function portal_works(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
begin
  l := portal_live_link(p_token);
  if l.id is null or coalesce(l.scope, 'full') <> 'full' then return null; end if;

  return coalesce((
    select jsonb_agg(w - 'sort_date' order by w->>'sort_date' desc nulls last, w->>'number')
    from (
      select jsonb_build_object(
        'kind', 'job', 'id', j.id, 'number', j.number, 'title', j.title,
        'status', j.status,
        'site_id', j.site_id, 'site_name', s.name,
        'from', j.scheduled_start, 'to', j.scheduled_end,
        'completed_on', to_char(j.completed_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'),
        'progress_pct', null,
        'photo_count', (select count(*) from attachments a
                         where a.parent_type = 'job' and a.parent_id = j.id
                           and a.client_visible and a.kind = 'photo'),
        'doc_count', (select count(*) from attachments a
                       where a.parent_type = 'job' and a.parent_id = j.id
                         and a.client_visible and a.kind in ('document','pdf')
                         and coalesce(a.caption, '') <> 'Handover pack'),
        'has_handover', exists (select 1 from attachments a
                                 where a.parent_type = 'job' and a.parent_id = j.id
                                   and a.client_visible and a.kind <> 'photo'
                                   and a.caption = 'Handover pack'),
        'quote_id', q.id, 'quote_number', q.number,
        'sort_date', coalesce(j.scheduled_start::text,
                              to_char(j.created_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'))
      ) as w
      from jobs j
      left join sites s on s.id = j.site_id
      left join quotes q on q.id = j.quote_id and q.portal_published
      where j.client_id = l.client_id
        and j.status not in ('quote','lost') and not j.archived

      union all

      select jsonb_build_object(
        'kind', 'project', 'id', p.id, 'number', p.number, 'title', p.name,
        'status', p.status,
        'site_id', p.site_id, 'site_name', s.name,
        'from', p.start_date, 'to', p.practical_completion_date,
        'completed_on', p.practical_completion_date,
        'progress_pct', (
          select round(
            sum(t.progress_pct * (t.end_date - t.start_date + 1))
            / nullif(sum(t.end_date - t.start_date + 1), 0))
          from programme_tasks t where t.project_id = p.id),
        'photo_count', (select count(*) from attachments a
                         where a.client_visible and a.kind = 'photo'
                           and ((a.parent_type = 'project' and a.parent_id = p.id)
                             or (a.parent_type = 'diary' and a.parent_id in
                                   (select d.id from diaries d where d.project_id = p.id)))),
        'doc_count', (select count(*) from attachments a
                       where a.parent_type = 'project' and a.parent_id = p.id
                         and a.client_visible and a.kind in ('document','pdf')
                         and coalesce(a.caption, '') <> 'Handover pack'),
        'has_handover', exists (select 1 from attachments a
                                 where a.parent_type = 'project' and a.parent_id = p.id
                                   and a.client_visible and a.kind <> 'photo'
                                   and a.caption = 'Handover pack'),
        'quote_id', q.id, 'quote_number', q.number,
        'sort_date', coalesce(p.start_date::text,
                              to_char(p.created_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'))
      ) as w
      from projects p
      left join sites s on s.id = p.site_id
      left join quotes q on q.id = p.quote_id and q.portal_published
      where p.client_id = l.client_id and not p.archived
    ) x
  ), '[]'::jsonb);
end $$;

------------------------------------------------------------------------------
-- portal_work_detail — one work page. Null unless the work is the client's
-- (and the link is full-scope).
------------------------------------------------------------------------------
create function portal_work_detail(p_token text, p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
  v jsonb;
begin
  l := portal_live_link(p_token);
  if l.id is null or coalesce(l.scope, 'full') <> 'full' then return null; end if;

  if p_kind = 'job' then
    select jsonb_build_object(
      'kind', 'job', 'id', j.id, 'number', j.number, 'title', j.title,
      'status', j.status, 'description', j.description,
      'site_id', j.site_id, 'site_name', s.name,
      'site_address', nullif(concat_ws(', ', s.address, s.suburb, s.state, s.postcode), ''),
      'from', j.scheduled_start, 'to', j.scheduled_end,
      'completed_on', to_char(j.completed_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'),
      'progress_pct', null,
      'quote', case when q.id is null then null else jsonb_build_object(
        'id', q.id, 'number', q.number, 'status', q.status,
        'decided', (select a.action from portal_acceptances a
                     where a.kind = 'quote' and a.target_id = q.id
                     order by a.action = 'accepted' desc, a.signed_at desc limit 1)) end,
      'attachments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id, 'filename', a.filename, 'kind', a.kind,
          'content_type', a.content_type, 'caption', a.caption,
          'size', a.size, 'created_at', a.created_at,
          'created_on', to_char(a.created_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'))
          order by a.created_at desc)
        from attachments a
        where a.parent_type = 'job' and a.parent_id = j.id and a.client_visible
      ), '[]'::jsonb))
    into v
    from jobs j
    left join sites s on s.id = j.site_id
    left join quotes q on q.id = j.quote_id and q.portal_published
    where j.id = p_id and j.client_id = l.client_id
      and j.status not in ('quote','lost') and not j.archived;
  elsif p_kind = 'project' then
    select jsonb_build_object(
      'kind', 'project', 'id', p.id, 'number', p.number, 'title', p.name,
      'status', p.status, 'description', p.description,
      'site_id', p.site_id, 'site_name', s.name,
      'site_address', nullif(concat_ws(', ', s.address, s.suburb, s.state, s.postcode), ''),
      'from', p.start_date, 'to', p.practical_completion_date,
      'completed_on', p.practical_completion_date,
      'progress_pct', (
        select round(
          sum(t.progress_pct * (t.end_date - t.start_date + 1))
          / nullif(sum(t.end_date - t.start_date + 1), 0))
        from programme_tasks t where t.project_id = p.id),
      'quote', case when q.id is null then null else jsonb_build_object(
        'id', q.id, 'number', q.number, 'status', q.status,
        'decided', (select a.action from portal_acceptances a
                     where a.kind = 'quote' and a.target_id = q.id
                     order by a.action = 'accepted' desc, a.signed_at desc limit 1)) end,
      'attachments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id, 'filename', a.filename, 'kind', a.kind,
          'content_type', a.content_type, 'caption', a.caption,
          'size', a.size, 'created_at', a.created_at,
          'created_on', to_char(a.created_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'))
          order by a.created_at desc)
        from attachments a
        where a.client_visible
          and ((a.parent_type = 'project' and a.parent_id = p.id)
            or (a.parent_type = 'diary' and a.parent_id in
                  (select d.id from diaries d where d.project_id = p.id)))
      ), '[]'::jsonb))
    into v
    from projects p
    left join sites s on s.id = p.site_id
    left join quotes q on q.id = p.quote_id and q.portal_published
    where p.id = p_id and p.client_id = l.client_id and not p.archived;
  end if;

  return v;
end $$;

grant execute on function portal_works(text) to anon, authenticated;
grant execute on function portal_work_detail(text, text, uuid) to anon, authenticated;
