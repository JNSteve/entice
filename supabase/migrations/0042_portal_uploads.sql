-- Clients can file their own compliance documents (e.g. third-party
-- clearances) into the property register, pending office review. Storage
-- under attachments bucket prefix 'portal-uploads/<link id>/'.
create table portal_uploads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  client_link_id uuid not null references client_links(id),
  kind text not null check (kind in (
    'asbestos_register','asbestos_mgmt_plan','hazmat_survey',
    'clearance_certificate','air_monitoring','contaminated_land','other')),
  title text not null,
  issue_date date not null,
  review_due date,
  notes text,
  path text not null,
  filename text not null,
  content_type text,
  size bigint,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  compliance_item_id uuid references property_compliance_items(id),
  created_at timestamptz not null default now()
);
create index portal_uploads_site_idx on portal_uploads (site_id, status);
create index portal_uploads_client_idx on portal_uploads (client_id, created_at desc);

alter table portal_uploads enable row level security;
-- Office reads/writes; anon goes through the definer RPCs only.
create policy portal_uploads_staff on portal_uploads
  for all to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));

-- Client submits an upload (metadata; the file itself goes through the
-- guarded /portal/[token]/document-upload route first).
create function portal_submit_upload(
  p_token text, p_site uuid, p_kind text, p_title text,
  p_issue_date date, p_review_due date, p_path text, p_filename text,
  p_content_type text default null, p_size bigint default null,
  p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_title text := left(trim(coalesce(p_title, '')), 200);
  v_prefix text;
  v_id uuid;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if not exists (select 1 from sites where id = p_site and client_id = l.client_id) then
    return null;
  end if;

  if v_title = '' or p_issue_date is null
     or p_kind not in ('asbestos_register','asbestos_mgmt_plan','hazmat_survey',
                       'clearance_certificate','air_monitoring','contaminated_land','other') then
    return jsonb_build_object('error', 'invalid');
  end if;

  v_prefix := 'portal-uploads/' || l.id::text || '/';
  if p_path not like v_prefix || '%' or position('..' in p_path) > 0 then
    return jsonb_build_object('error', 'invalid');
  end if;

  if (select count(*) from portal_uploads
       where client_link_id = l.id
         and created_at > now() - interval '24 hours') >= 10 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  insert into portal_uploads
    (client_id, site_id, client_link_id, kind, title, issue_date, review_due,
     notes, path, filename, content_type, size)
  values (l.client_id, p_site, l.id, p_kind, v_title, p_issue_date, p_review_due,
          nullif(left(trim(coalesce(p_notes,'')), 2000), ''), p_path, p_filename,
          p_content_type, p_size)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function portal_submit_upload(text, uuid, text, text, date, date, text, text, text, bigint, text) to anon, authenticated;

-- The client's own uploads for a site: pending/rejected shown with status
-- (approved ones appear as real compliance items instead).
create function portal_my_uploads(p_token text, p_site uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id, 'kind', u.kind, 'title', u.title, 'status', u.status,
      'issue_date', u.issue_date, 'review_due', u.review_due,
      'review_note', u.review_note, 'created_at', u.created_at
    ) order by u.created_at desc)
    from portal_uploads u
    where u.client_id = l.client_id and u.site_id = p_site
      and u.status in ('pending','rejected')
  ), '[]'::jsonb);
end $$;
grant execute on function portal_my_uploads(text, uuid) to anon, authenticated;
