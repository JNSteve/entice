-- 0068: daily field sign-offs.
--   * field_usage       — crew-logged materials / plant / subbie labour per day
--                         (NO money columns, so field staff may write it).
--   * field_day_notes   — the day's work summary per job/project.
--   * daily_signoffs    — the frozen daily snapshot (versioned) the PM reviews
--     + _lines            and releases to the client portal.
--   * daily_signoff_responses — the client's signature + line disputes.
--   * field_usage_options / field_catalogue_search — price-free pickers for
--     the field app (quote_lines and rate_items are MONEY tables field can't
--     read).
--   * portal_signoffs / portal_signoff / portal_signoff_respond /
--     portal_signoff_file — anon, token-validated (portal_live_link), same
--     security shape as 0029: NO anon table policies.
--
-- Spec: docs/superpowers/specs/2026-10-01-daily-signoffs-design.md

------------------------------------------------------------------------------
-- 1. field_usage
------------------------------------------------------------------------------
create table field_usage (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  date date not null,
  user_id uuid not null default auth.uid() references profiles(id),
  kind text not null check (kind in ('material','plant','subbie')),
  quote_line_id uuid references quote_lines(id) on delete set null,
  rate_item_id uuid references rate_items(id) on delete set null,
  plant_id uuid references plant(id) on delete set null,
  description text not null check (char_length(trim(description)) between 1 and 300),
  qty numeric(12,3) check (qty is null or qty >= 0),
  unit text check (unit is null or char_length(unit) <= 20),
  company text check (company is null or char_length(company) <= 200),
  headcount int check (headcount is null or headcount between 1 and 500),
  hours numeric(6,2) check (hours is null or (hours >= 0 and hours <= 24)),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint field_usage_one_parent check (num_nonnulls(job_id, project_id) = 1),
  constraint field_usage_qty_required check (kind = 'subbie' or qty is not null),
  constraint field_usage_subbie_fields check (
    kind <> 'subbie' or (headcount is not null and hours is not null))
);
create index field_usage_job_date_idx on field_usage (job_id, date) where job_id is not null;
create index field_usage_project_date_idx on field_usage (project_id, date) where project_id is not null;

create or replace function field_usage_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger field_usage_touch before update on field_usage
  for each row execute function field_usage_touch();

-- Brisbane "today" and "yesterday" — the window field staff may edit in.
create or replace function field_edit_window_ok(p_date date) returns boolean
language sql stable as $$
  select p_date between (now() at time zone 'Australia/Brisbane')::date - 1
                    and (now() at time zone 'Australia/Brisbane')::date
$$;

alter table field_usage enable row level security;
create policy field_usage_select_authenticated on field_usage
  for select to authenticated using (auth.uid() is not null);
create policy field_usage_insert on field_usage
  for insert to authenticated
  with check (
    current_app_role() in ('admin','office','supervisor')
    or (user_id = auth.uid() and field_edit_window_ok(date)));
create policy field_usage_update on field_usage
  for update to authenticated
  using (
    current_app_role() in ('admin','office','supervisor')
    or (user_id = auth.uid() and field_edit_window_ok(date)))
  with check (
    current_app_role() in ('admin','office','supervisor')
    or (user_id = auth.uid() and field_edit_window_ok(date)));
create policy field_usage_delete on field_usage
  for delete to authenticated
  using (
    current_app_role() in ('admin','office','supervisor')
    or (user_id = auth.uid() and field_edit_window_ok(date)));

------------------------------------------------------------------------------
-- 2. field_day_notes
------------------------------------------------------------------------------
create table field_day_notes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  date date not null,
  summary text not null default '' check (char_length(summary) <= 4000),
  updated_by uuid default auth.uid() references profiles(id),
  updated_at timestamptz not null default now(),
  constraint field_day_notes_one_parent check (num_nonnulls(job_id, project_id) = 1),
  -- NULLs are distinct, so each constraint only bites its own parent kind
  -- (and both work as PostgREST onConflict targets).
  constraint field_day_notes_job_date_key unique (job_id, date),
  constraint field_day_notes_project_date_key unique (project_id, date)
);

alter table field_day_notes enable row level security;
create policy field_day_notes_select_authenticated on field_day_notes
  for select to authenticated using (auth.uid() is not null);
-- The day's note is shared by the crew on that work (anyone on site may
-- improve it), but a field user always stamps the change as themselves.
create policy field_day_notes_insert on field_day_notes
  for insert to authenticated
  with check (
    current_app_role() in ('admin','office','supervisor')
    or (current_app_role() = 'field' and field_edit_window_ok(date)
        and updated_by = auth.uid()));
create policy field_day_notes_update on field_day_notes
  for update to authenticated
  using (
    current_app_role() in ('admin','office','supervisor')
    or (current_app_role() = 'field' and field_edit_window_ok(date)))
  with check (
    current_app_role() in ('admin','office','supervisor')
    or (current_app_role() = 'field' and field_edit_window_ok(date)
        and updated_by = auth.uid()));

------------------------------------------------------------------------------
-- 3. daily_signoffs + lines + responses
------------------------------------------------------------------------------
create table daily_signoffs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  date date not null,
  version int not null default 1 check (version >= 1),
  status text not null default 'draft'
    check (status in ('draft','released','signed','disputed','superseded')),
  summary text not null default '' check (char_length(summary) <= 4000),
  photo_ids uuid[] not null default '{}',
  built_at timestamptz not null default now(),
  built_by uuid references profiles(id),        -- null = overnight run
  released_at timestamptz,
  released_by uuid references profiles(id),
  source_hash text,
  supersedes_id uuid references daily_signoffs(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint daily_signoffs_one_parent check (num_nonnulls(job_id, project_id) = 1),
  constraint daily_signoffs_job_version_key unique (job_id, date, version),
  constraint daily_signoffs_project_version_key unique (project_id, date, version)
);
-- At most one live (draft / released / signed) version per work per day. A
-- disputed version may coexist with its revision draft until that releases;
-- revising a released (unanswered) sheet withdraws it first (-> superseded).
create unique index daily_signoffs_live_idx
  on daily_signoffs (coalesce(job_id, project_id), date)
  where status in ('draft','released','signed');
create index daily_signoffs_status_idx on daily_signoffs (status, date desc);

create table daily_signoff_lines (
  id uuid primary key default gen_random_uuid(),
  signoff_id uuid not null references daily_signoffs(id) on delete cascade,
  sort int not null default 0,
  section text not null check (section in ('labour','subbie','plant','material')),
  description text not null check (char_length(trim(description)) between 1 and 300),
  qty numeric(12,3) not null check (qty >= 0),
  unit text not null default '' check (char_length(unit) <= 20),
  detail text check (detail is null or char_length(detail) <= 300),
  scope_label text check (scope_label is null or char_length(scope_label) <= 500),
  flags text[] not null default '{}',
  source jsonb not null default '{}'::jsonb
);
create index daily_signoff_lines_signoff_idx on daily_signoff_lines (signoff_id, sort);

create table daily_signoff_responses (
  id uuid primary key default gen_random_uuid(),
  signoff_id uuid not null unique references daily_signoffs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  client_link_id uuid references client_links(id) on delete set null,
  signer_name text not null check (char_length(signer_name) between 1 and 120),
  signature_data text not null check (
    signature_data like 'data:image/png;base64,%'
    and char_length(signature_data) <= 140000),
  -- [{line_id, client_qty, reason}] — empty = signed without dispute.
  disputes jsonb not null default '[]'::jsonb check (jsonb_typeof(disputes) = 'array'),
  ip inet,
  signed_at timestamptz not null default now()
);

-- A sent sheet is a record. A draft is freely editable and can only move to
-- released. Once out of draft nothing but the status may change, and only
-- along these edges:
--   released -> signed | disputed   (a client response must exist and match)
--   released -> superseded          (PM withdrew it to revise)
--   disputed -> superseded          (its revision was released)
-- So no one (office included, via the API) can reopen, re-sign or alter a
-- record the client has seen. Lines are editable only while a draft.
create or replace function daily_signoffs_freeze() returns trigger
language plpgsql as $$
declare
  v_disputes jsonb;
begin
  if old.status = 'draft' then
    if new.status not in ('draft','released') then
      raise exception 'A draft sign-off can only be released';
    end if;
    return new;
  end if;

  if new.summary is distinct from old.summary
     or new.photo_ids is distinct from old.photo_ids
     or new.date is distinct from old.date
     or new.version is distinct from old.version
     or new.job_id is distinct from old.job_id
     or new.project_id is distinct from old.project_id
     or new.source_hash is distinct from old.source_hash
     or new.built_at is distinct from old.built_at
     or new.built_by is distinct from old.built_by
     or new.released_at is distinct from old.released_at
     or new.released_by is distinct from old.released_by
     or new.supersedes_id is distinct from old.supersedes_id then
    raise exception 'This sign-off has been released and can no longer be edited';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'released' and new.status in ('signed','disputed') then
      select disputes into v_disputes from daily_signoff_responses
       where signoff_id = old.id;
      if v_disputes is null
         or (new.status = 'signed') <> (jsonb_array_length(v_disputes) = 0) then
        raise exception 'A sign-off is signed or disputed only by the client response';
      end if;
    elsif not (old.status in ('released','disputed') and new.status = 'superseded') then
      raise exception 'A sign-off cannot move from % to %', old.status, new.status;
    end if;
  end if;
  return new;
end $$;
create trigger daily_signoffs_freeze before update on daily_signoffs
  for each row execute function daily_signoffs_freeze();

create or replace function daily_signoff_lines_draft_only() returns trigger
language plpgsql as $$
declare
  v_status text;
begin
  select status into v_status from daily_signoffs
   where id = coalesce(new.signoff_id, old.signoff_id);
  -- Parent already gone (cascade delete of a draft) → allow.
  if v_status is null then return coalesce(new, old); end if;
  if v_status <> 'draft' then
    raise exception 'This sign-off has been released and its lines can no longer be edited';
  end if;
  return coalesce(new, old);
end $$;
create trigger daily_signoff_lines_draft_only
  before insert or update or delete on daily_signoff_lines
  for each row execute function daily_signoff_lines_draft_only();

alter table daily_signoffs enable row level security;
alter table daily_signoff_lines enable row level security;
alter table daily_signoff_responses enable row level security;

create policy daily_signoffs_select_staff on daily_signoffs
  for select to authenticated
  using (current_app_role() in ('admin','office','supervisor'));
create policy daily_signoffs_insert_admin_office on daily_signoffs
  for insert to authenticated
  with check (current_app_role() in ('admin','office'));
create policy daily_signoffs_update_admin_office on daily_signoffs
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy daily_signoffs_delete_draft on daily_signoffs
  for delete to authenticated
  using (current_app_role() in ('admin','office') and status = 'draft');

create policy daily_signoff_lines_select_staff on daily_signoff_lines
  for select to authenticated
  using (current_app_role() in ('admin','office','supervisor'));
create policy daily_signoff_lines_write_admin_office on daily_signoff_lines
  for all to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));

-- Responses are written ONLY by portal_signoff_respond (definer).
create policy daily_signoff_responses_select_staff on daily_signoff_responses
  for select to authenticated
  using (current_app_role() in ('admin','office','supervisor'));

create trigger daily_signoffs_audit
  after insert or update or delete on public.daily_signoffs
  for each row execute function audit_whs();
create trigger daily_signoff_responses_audit
  after insert or update or delete on public.daily_signoff_responses
  for each row execute function audit_whs();

------------------------------------------------------------------------------
-- 4. Price-free pickers for the field app
------------------------------------------------------------------------------
-- The work's agreed scope (its quote's lines) + the active plant register.
create or replace function field_usage_options(p_job uuid, p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_quote uuid;
begin
  if current_app_role() is null then return null; end if;

  if p_job is not null then
    select quote_id into v_quote from jobs where id = p_job;
  elsif p_project is not null then
    select quote_id into v_quote from projects where id = p_project;
  end if;

  return jsonb_build_object(
    'scope', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', ql.id, 'description', left(ql.description, 300), 'unit', ql.unit,
          'section', qs.title)
        order by qs.position nulls first, ql.position, ql.id)
      from quote_lines ql
      left join quote_sections qs on qs.id = ql.section_id
      where v_quote is not null and ql.quote_id = v_quote
    ), '[]'::jsonb),
    'plant', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'rego', p.rego)
        order by p.name)
      from plant p where p.active
    ), '[]'::jsonb));
end $$;
revoke execute on function field_usage_options(uuid, uuid) from public, anon;
grant execute on function field_usage_options(uuid, uuid) to authenticated;

-- Price-list search (name / supplier / product code) — names and units only.
create or replace function field_catalogue_search(p_q text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := trim(coalesce(p_q, ''));
begin
  if current_app_role() is null or char_length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'unit', r.unit, 'kind', r.kind,
        'supplier', r.supplier))
    from (
      select * from rate_items r
      where r.active
        and r.kind in ('material','consumable','plant','other')
        and (r.name ilike '%' || v_q || '%'
          or coalesce(r.product_code, '') ilike '%' || v_q || '%'
          or coalesce(r.supplier, '') ilike '%' || v_q || '%')
      order by r.name
      limit 25
    ) r
  ), '[]'::jsonb);
end $$;
revoke execute on function field_catalogue_search(text) from public, anon;
grant execute on function field_catalogue_search(text) to authenticated;

------------------------------------------------------------------------------
-- 5. Portal RPCs
------------------------------------------------------------------------------
-- Released / answered sign-offs for the client (full-scope links only).
-- Optional filter to one work. Drafts never appear; superseded versions
-- drop off the list (their page still resolves, marked replaced).
create or replace function portal_signoffs(
  p_token text, p_kind text default null, p_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
begin
  l := portal_live_link(p_token);
  if l.id is null or coalesce(l.scope, 'full') <> 'full' then return null; end if;

  return coalesce((
    select jsonb_agg(x.item order by x.d desc, x.num)
    from (
      select jsonb_build_object(
          'id', s.id,
          'kind', case when s.job_id is not null then 'job' else 'project' end,
          'work_id', coalesce(s.job_id, s.project_id),
          'work_number', coalesce(j.number, p.number),
          'work_title', coalesce(j.title, p.name),
          'date', s.date, 'version', s.version, 'status', s.status,
          'released_on', to_char(s.released_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'),
          'line_count', (select count(*) from daily_signoff_lines dl where dl.signoff_id = s.id),
          'signer_name', r.signer_name,
          'signed_on', to_char(r.signed_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'),
          'dispute_count', coalesce(jsonb_array_length(r.disputes), 0)
        ) as item,
        s.date as d,
        coalesce(j.number, p.number) as num
      from daily_signoffs s
      left join jobs j on j.id = s.job_id
      left join projects p on p.id = s.project_id
      left join daily_signoff_responses r on r.signoff_id = s.id
      where s.status in ('released','signed','disputed')
        and coalesce(j.client_id, p.client_id) = l.client_id
        and not coalesce(j.archived, p.archived, false)
        and (p_kind is null
          or (p_kind = 'job' and s.job_id = p_id)
          or (p_kind = 'project' and s.project_id = p_id))
    ) x
  ), '[]'::jsonb);
end $$;

-- One sign-off: header, lines, client-visible photos, the response.
create or replace function portal_signoff(p_token text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
  s daily_signoffs;
  v_client uuid;
  v_number text;
  v_title text;
  v_site text;
  v_replaced uuid;
begin
  l := portal_live_link(p_token);
  if l.id is null or coalesce(l.scope, 'full') <> 'full' then return null; end if;

  select * into s from daily_signoffs where id = p_id and status <> 'draft';
  if s.id is null then return null; end if;

  if s.job_id is not null then
    select j.client_id, j.number, j.title, si.name into v_client, v_number, v_title, v_site
      from jobs j left join sites si on si.id = j.site_id
     where j.id = s.job_id and not j.archived;
  else
    select p.client_id, p.number, p.name, si.name into v_client, v_number, v_title, v_site
      from projects p left join sites si on si.id = p.site_id
     where p.id = s.project_id and not p.archived;
  end if;
  if v_client is distinct from l.client_id then return null; end if;

  -- Newest non-draft later version of the same day (follows v1, v2, v3...).
  if s.status = 'superseded' then
    select d.id into v_replaced from daily_signoffs d
     where coalesce(d.job_id, d.project_id) = coalesce(s.job_id, s.project_id)
       and d.date = s.date and d.version > s.version and d.status <> 'draft'
     order by d.version desc limit 1;
  end if;

  return jsonb_build_object(
    'id', s.id,
    'kind', case when s.job_id is not null then 'job' else 'project' end,
    'work_id', coalesce(s.job_id, s.project_id),
    'work_number', v_number, 'work_title', v_title, 'site_name', v_site,
    'date', s.date, 'version', s.version, 'status', s.status,
    'summary', s.summary,
    'released_on', to_char(s.released_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'),
    'replaced_by', v_replaced,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', dl.id, 'section', dl.section, 'description', dl.description,
          'qty', dl.qty, 'unit', dl.unit, 'detail', dl.detail,
          'scope_label', dl.scope_label)
        order by dl.sort, dl.id)
      from daily_signoff_lines dl where dl.signoff_id = s.id
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', a.id, 'filename', a.filename, 'kind', a.kind,
          'content_type', a.content_type, 'caption', a.caption,
          'size', a.size, 'created_at', a.created_at,
          'created_on', to_char(a.created_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'))
        order by a.created_at)
      from attachments a
      where a.id = any(s.photo_ids) and a.client_visible
    ), '[]'::jsonb),
    'response', (
      select jsonb_build_object(
          'signer_name', r.signer_name,
          'signed_on', to_char(r.signed_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'),
          'disputes', r.disputes)
      from daily_signoff_responses r where r.signoff_id = s.id));
end $$;

-- Sign (with optional line disputes). Returns:
--   null                        dead token / not the client's / not found
--   {'error':'invalid'}         bad signer / signature / dispute payload
--   {'error':'not_acceptable'}  not awaiting a response (already answered,
--                               superseded, …)
--   {'ok':true,'number':…,'status':'signed'|'disputed'}
create or replace function portal_signoff_respond(
  p_token text, p_id uuid, p_signer_name text, p_signature text,
  p_disputes jsonb default '[]'::jsonb, p_ip text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  s daily_signoffs;
  v_signer text := left(trim(coalesce(p_signer_name, '')), 120);
  v_disputes jsonb := coalesce(p_disputes, '[]'::jsonb);
  v_client uuid;
  v_number text;
  v_ip inet;
  v_status text;
  d jsonb;
  v_seen uuid[] := '{}';
  v_line uuid;
  v_qty numeric;
begin
  l := portal_live_link(p_token);
  if l.id is null or coalesce(l.scope, 'full') <> 'full' then return null; end if;

  -- Row lock: concurrent submits queue here and the loser sees the new status.
  select * into s from daily_signoffs where id = p_id for update;
  if s.id is null then return null; end if;

  if s.job_id is not null then
    select client_id, number into v_client, v_number from jobs
     where id = s.job_id and not archived;
  else
    select client_id, number into v_client, v_number from projects
     where id = s.project_id and not archived;
  end if;
  if v_client is distinct from l.client_id then return null; end if;

  if v_signer = ''
     or coalesce(p_signature, '') not like 'data:image/png;base64,%'
     or char_length(p_signature) > 140000
     or jsonb_typeof(v_disputes) <> 'array'
     or jsonb_array_length(v_disputes) > 500 then
    return jsonb_build_object('error', 'invalid');
  end if;

  -- Every dispute: a line of THIS sheet (once), a non-negative figure and a
  -- reason. Rebuilt into a clean array so nothing extra is stored.
  for d in select * from jsonb_array_elements(v_disputes) loop
    begin
      v_line := (d ->> 'line_id')::uuid;
      v_qty := (d ->> 'client_qty')::numeric;
    exception when others then
      return jsonb_build_object('error', 'invalid');
    end;
    if v_line is null or v_qty is null or v_qty < 0 or v_qty > 999999999
       or v_line = any(v_seen)
       or char_length(trim(coalesce(d ->> 'reason', ''))) not between 1 and 500
       or not exists (select 1 from daily_signoff_lines dl
                       where dl.id = v_line and dl.signoff_id = s.id) then
      return jsonb_build_object('error', 'invalid');
    end if;
    v_seen := v_seen || v_line;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
      'line_id', (e ->> 'line_id')::uuid,
      'client_qty', (e ->> 'client_qty')::numeric,
      'reason', trim(e ->> 'reason'))), '[]'::jsonb)
    into v_disputes
    from jsonb_array_elements(v_disputes) e;

  v_status := case when jsonb_array_length(v_disputes) = 0 then 'signed' else 'disputed' end;

  begin
    v_ip := nullif(trim(coalesce(p_ip, '')), '')::inet;
  exception when others then
    v_ip := null;
  end;

  -- Only a released sheet can be answered, once (row is locked above).
  if s.status <> 'released' then
    return jsonb_build_object('error', 'not_acceptable');
  end if;

  -- Response first: the freeze trigger only lets the status move to
  -- signed/disputed when a matching response exists.
  insert into daily_signoff_responses
    (signoff_id, client_id, client_link_id, signer_name, signature_data, disputes, ip)
  values (s.id, v_client, l.id, v_signer, p_signature, v_disputes, v_ip);

  update daily_signoffs set status = v_status where id = s.id;

  return jsonb_build_object('ok', true, 'number', v_number, 'status', v_status);
end $$;

-- PDF entitlement + download log (the portal route renders with the service
-- role only after this returns non-null).
create or replace function portal_signoff_file(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  s daily_signoffs;
  v_client uuid;
  v_number text;
  v_site uuid;
begin
  l := portal_live_link(p_token);
  if l.id is null or coalesce(l.scope, 'full') <> 'full' then return null; end if;

  select * into s from daily_signoffs where id = p_id and status <> 'draft';
  if s.id is null then return null; end if;

  if s.job_id is not null then
    select client_id, number, site_id into v_client, v_number, v_site from jobs
     where id = s.job_id and not archived;
  else
    select client_id, number, site_id into v_client, v_number, v_site from projects
     where id = s.project_id and not archived;
  end if;
  if v_client is distinct from l.client_id then return null; end if;

  insert into portal_views (client_link_id, site_id, path)
  values (l.id, v_site, left('download:signoff:' || p_id::text, 300));

  return jsonb_build_object('number', v_number);
end $$;

grant execute on function portal_signoffs(text, text, uuid) to anon, authenticated;
grant execute on function portal_signoff(text, uuid) to anon, authenticated;
grant execute on function portal_signoff_respond(text, uuid, text, text, jsonb, text) to anon, authenticated;
grant execute on function portal_signoff_file(text, uuid) to anon, authenticated;
