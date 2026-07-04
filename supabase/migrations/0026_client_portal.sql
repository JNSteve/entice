-- 0026_client_portal.sql
-- Client Portal CP1 — the property compliance window (roadmap
-- docs/superpowers/plans/2026-07-03-client-portal-roadmap.md §4 CP1).
--
--   * property_compliance_items — per-site compliance register (asbestos
--     register, management plan, HAZMAT survey, clearances, air monitoring,
--     contaminated land). Expiry light DERIVED at read time (same 30-day
--     amber rule as vendors/competency; null review_due = never expires).
--     Supersede-on-replace like competency_records.
--   * client_links — one anonymous token link per client organisation,
--     cloned from the share_links pattern (crypto-random token, optional
--     expiry, revocable). No logins in CP1.
--   * portal_views — access log: every portal page load and file download,
--     inserted ONLY via the security-definer RPCs below (no anon INSERT
--     policy). Watermarking is deferred to CP2 — this log + the portal's
--     "Issued via" footer are the CP1 traceability controls.
--   * attachments.client_visible — NOTHING is client-visible by default;
--     office explicitly toggles individual job/project attachments.
--
-- Anonymous access follows /sign & /submit: SECURITY DEFINER RPCs granted to
-- anon that validate the token internally and return nothing for anything
-- outside that client's scope. Direct table access stays RLS-blocked.
--
-- Conventions follow 0010/0021: current_app_role() RLS, audit_whs() triggers.

------------------------------------------------------------------------------
-- 1. Tables
------------------------------------------------------------------------------

create table property_compliance_items (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  kind text not null check (kind in (
    'asbestos_register','asbestos_mgmt_plan','hazmat_survey',
    'clearance_certificate','air_monitoring','contaminated_land','other'
  )),
  title text not null,
  issue_date date not null,
  -- null = no review/expiry (clearances and air monitoring usually never expire)
  review_due date check (review_due is null or review_due >= issue_date),
  -- Inline evidence (competency_records pattern): browser uploads to the
  -- private 'attachments' bucket under property-compliance/ first, row after.
  evidence_path text check (
    evidence_path is null
    or (evidence_path like 'property-compliance/%' and position('..' in evidence_path) = 0)
  ),
  evidence_filename text,
  -- Optional link to the controlled document register instead of (or as well
  -- as) an uploaded file.
  document_id uuid references documents(id) on delete set null,
  notes text,
  status text not null default 'active' check (status in ('active','superseded')),
  superseded_by uuid references property_compliance_items(id) on delete set null
    check (superseded_by is null or superseded_by <> id),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index property_compliance_items_site_idx on property_compliance_items (site_id);
create index property_compliance_items_review_idx on property_compliance_items (review_due);
create index property_compliance_items_status_idx on property_compliance_items (status);
create index property_compliance_items_document_idx on property_compliance_items (document_id);

create table client_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  token text not null unique,
  label text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index client_links_client_idx on client_links (client_id);

create table portal_views (
  id uuid primary key default gen_random_uuid(),
  client_link_id uuid not null references client_links(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  path text not null,
  viewed_at timestamptz not null default now()
);
create index portal_views_link_idx on portal_views (client_link_id, viewed_at desc);

-- Curated sharing: nothing client-visible unless office explicitly toggles it.
alter table attachments
  add column client_visible boolean not null default false;

------------------------------------------------------------------------------
-- 2. RLS
------------------------------------------------------------------------------

alter table property_compliance_items enable row level security;
alter table client_links              enable row level security;
alter table portal_views              enable row level security;

-- property_compliance_items: admin/office manage; supervisor read-only;
-- field none; deletes admin only.
create policy property_compliance_select_staff on property_compliance_items
  for select to authenticated
  using (current_app_role() in ('admin','office','supervisor'));
create policy property_compliance_insert_admin_office on property_compliance_items
  for insert to authenticated
  with check (current_app_role() in ('admin','office'));
create policy property_compliance_update_admin_office on property_compliance_items
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy property_compliance_delete_admin on property_compliance_items
  for delete to authenticated
  using (current_app_role() = 'admin');

-- client_links: admin/office manage (issue/revoke); supervisor read-only.
create policy client_links_select_staff on client_links
  for select to authenticated
  using (current_app_role() in ('admin','office','supervisor'));
create policy client_links_insert_admin_office on client_links
  for insert to authenticated
  with check (current_app_role() in ('admin','office'));
create policy client_links_update_admin_office on client_links
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy client_links_delete_admin_office on client_links
  for delete to authenticated
  using (current_app_role() in ('admin','office'));

-- portal_views: admin/office SELECT only. No INSERT policy on purpose — rows
-- are written exclusively by the security-definer portal RPCs below.
create policy portal_views_select_admin_office on portal_views
  for select to authenticated
  using (current_app_role() in ('admin','office'));

------------------------------------------------------------------------------
-- 3. Audit triggers (audit_whs() from 0010 — immutable trail)
------------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['property_compliance_items','client_links'] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function audit_whs()',
      t || '_audit', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 4. Storage: property-compliance evidence read scope
--    (admin/office read everything already; supervisors get the new prefix;
--    field none. Insert stays bucket-wide authenticated per 0005 — only
--    admin/office have an upload UI path and row-insert rights anyway.)
------------------------------------------------------------------------------

drop policy if exists "attachments_select_scoped" on storage.objects;

create policy "attachments_select_scoped" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (
      current_app_role() in ('admin','office')
      or (storage.foldername(name))[1] in (
        'job','project','diary','incident','form_submission','ncr',
        'swms','whs-documents'
      )
      -- competency evidence: supervisors read all; field only objects
      -- referenced by a record belonging to their own worker row.
      or (
        (storage.foldername(name))[1] = 'competency'
        and (
          current_app_role() = 'supervisor'
          or exists (
            select 1
            from public.competency_records cr
            join public.workers w on w.id = cr.worker_id
            where cr.evidence_path = name and w.profile_id = auth.uid()
          )
        )
      )
      -- property compliance evidence: supervisors read-only (matches the
      -- table RLS); field has no access.
      or (
        (storage.foldername(name))[1] = 'property-compliance'
        and current_app_role() = 'supervisor'
      )
    )
  );

------------------------------------------------------------------------------
-- 5. Anonymous portal RPCs (security definer; callable by anon — the token
--    IS the credential, validated inside every function)
------------------------------------------------------------------------------

-- Shared validation: the live client_links row for a token, or null.
-- Rejects revoked, expired and archived-client links.
create or replace function portal_live_link(p_token text)
returns client_links
language sql stable security definer set search_path = public as $$
  select l.* from client_links l
  join clients c on c.id = l.client_id and not c.archived
  where l.token = p_token
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now());
$$;

-- Internal helper — never callable by clients.
revoke execute on function portal_live_link(text) from anon, authenticated, public;

-- Branding-safe link resolution for the portal shell. Null for dead links
-- (the page shows a friendly "link no longer active" state).
create or replace function portal_resolve_link(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
  v_client_name text;
  v_company text;
  v_logo text;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  select name into v_client_name from clients where id = l.client_id;
  select company_name, logo_path into v_company, v_logo from settings where id = 1;

  return jsonb_build_object(
    'client_name', v_client_name,
    'label', l.label,
    'company_name', coalesce(v_company, 'Entice'),
    'logo_path', v_logo);
end $$;

-- The client's properties: every site, with the active compliance items'
-- review dates (light derivation stays in ONE place — src/lib/compliance.ts /
-- src/lib/portal.ts — so client and office agree) and an open-works count.
create or replace function portal_sites(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
  v_sites jsonb;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  select coalesce(jsonb_agg(site_row order by site_row->>'name'), '[]'::jsonb)
    into v_sites
    from (
      select jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'address', s.address,
        'suburb', s.suburb,
        'state', s.state,
        'postcode', s.postcode,
        'review_dues', coalesce((
          select jsonb_agg(i.review_due)
          from property_compliance_items i
          where i.site_id = s.id and i.status = 'active'
        ), '[]'::jsonb),
        'open_works',
          (select count(*) from jobs j
            where j.site_id = s.id and j.status in ('scheduled','in_progress'))
          + (select count(*) from projects p
              where p.site_id = s.id and p.status <> 'closed')
      ) as site_row
      from sites s
      where s.client_id = l.client_id
    ) rows;

  return v_sites;
end $$;

-- One property: active compliance items + works (jobs/projects) on the site
-- with their client-visible attachments. NO money fields, ever. Returns null
-- when the token is dead or the site belongs to another client.
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
        'attachments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'filename', a.filename, 'kind', a.kind,
            'content_type', a.content_type, 'caption', a.caption,
            'created_at', a.created_at) order by a.created_at desc)
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
        'attachments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'filename', a.filename, 'kind', a.kind,
            'content_type', a.content_type, 'caption', a.caption,
            'created_at', a.created_at) order by a.created_at desc)
          from attachments a
          where a.parent_type = 'project' and a.parent_id = p.id and a.client_visible
        ), '[]'::jsonb))
        order by p.created_at desc)
      from projects p
      where p.site_id = s.id
    ), '[]'::jsonb));
end $$;

-- Access log: every portal page load. Silently ignores dead tokens (no data
-- leak, no error surface for probing). Site id outside the client's scope is
-- recorded as null rather than trusted.
create or replace function portal_log_view(p_token text, p_site uuid, p_path text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_site uuid := null;
begin
  l := portal_live_link(p_token);
  if l.id is null then return; end if;

  if p_site is not null then
    select id into v_site from sites where id = p_site and client_id = l.client_id;
  end if;

  insert into portal_views (client_link_id, site_id, path)
  values (l.id, v_site, left(coalesce(p_path, ''), 300));
end $$;

-- Resolves the storage path for a portal download AND logs it. Two kinds:
--   'item'       → a compliance item's evidence file (or its linked
--                   controlled document's file)
--   'attachment' → a client_visible job/project attachment on one of the
--                   client's sites
-- Signed-URL generation stays server-side in the /portal file route — this
-- function only proves the caller's token is entitled to the object.
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
           coalesce(j.site_id, p.site_id)
      into v_path, v_filename, v_site
      from attachments a
      left join jobs j on a.parent_type = 'job' and j.id = a.parent_id
      left join projects p on a.parent_type = 'project' and p.id = a.parent_id
      join sites s on s.id = coalesce(j.site_id, p.site_id) and s.client_id = l.client_id
     where a.id = p_id and a.client_visible;
  end if;

  if v_path is null then return null; end if;

  insert into portal_views (client_link_id, site_id, path)
  values (l.id, v_site, left('download:' || p_kind || ':' || p_id::text, 300));

  return jsonb_build_object('path', v_path, 'filename', v_filename);
end $$;

-- Grants: anon consumes these from the public portal pages; authenticated
-- kept for parity with get_shared_doc (harmless — token still required).
grant execute on function portal_resolve_link(text) to anon, authenticated;
grant execute on function portal_sites(text) to anon, authenticated;
grant execute on function portal_site_detail(text, uuid) to anon, authenticated;
grant execute on function portal_log_view(text, uuid, text) to anon, authenticated;
grant execute on function portal_file_path(text, text, uuid) to anon, authenticated;
