-- 0010_whs.sql
-- WHS & traceability spine: forms engine (templates / submissions / sign-ons),
-- incident register + corrective actions, public share links (external sign-on
-- and subbie SWMS submission), and the append-only audit_log fed by triggers.
--
-- Conventions follow 0003_rls.sql (current_app_role()) and 0002_functions.sql
-- (security definer + search_path public).
--
-- Locked decisions implemented here:
--   * External (no-login) signatures stored as PNG data URLs in the DB
--     (capped ~100KB binary = 140000 chars). Internal signatures keep the
--     storage-path approach.
--   * swms_signatures relaxed for external signers: user_id nullable,
--     + company / signature_data / external columns.
--   * share_links kind 'signon' targets a swms_instance OR a specific
--     form_submission (a toolbox talk / induction record) — NOT a template.
--   * audit_log is append-only: no UPDATE/DELETE policy for anyone and the
--     privileges are revoked outright from anon/authenticated.

------------------------------------------------------------------------------
-- 1. Tables
------------------------------------------------------------------------------

create table form_templates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('prestart','take5','toolbox','induction','incident','custom')),
  name text not null,
  description text,
  schema jsonb not null default '[]',   -- [{key,label,type,options,required}]
  version int not null default 1,
  active boolean not null default true,
  requires_signon boolean not null default false,
  created_at timestamptz not null default now()
);

create table form_submissions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references form_templates(id),
  template_version int not null default 1,
  kind text not null check (kind in ('prestart','take5','toolbox','induction','incident','custom')),
  project_id uuid references projects(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  plant_id uuid references plant(id),
  data jsonb not null default '{}',
  submitted_by uuid not null references profiles(id),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index form_submissions_template_idx on form_submissions (template_id);
create index form_submissions_project_idx on form_submissions (project_id);
create index form_submissions_job_idx on form_submissions (job_id);
create index form_submissions_plant_idx on form_submissions (plant_id);
create index form_submissions_submitted_by_idx on form_submissions (submitted_by);

create table form_signons (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references form_submissions(id) on delete cascade,
  profile_id uuid references profiles(id),
  name text not null,
  company text,
  signature_path text,                  -- storage path (internal signers)
  signature_data text check (signature_data is null or length(signature_data) <= 140000),
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index form_signons_submission_idx on form_signons (submission_id);
create index form_signons_profile_idx on form_signons (profile_id);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,          -- INC-0001 via next_number('incident')
  project_id uuid references projects(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  type text not null check (type in ('injury','near_miss','property','environmental')),
  severity int not null check (severity between 1 and 5),
  occurred_at timestamptz not null,
  location text,
  description text not null,
  immediate_action text,
  reported_by uuid not null references profiles(id),
  status text not null default 'open' check (status in ('open','investigating','closed')),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index incidents_project_idx on incidents (project_id);
create index incidents_job_idx on incidents (job_id);
create index incidents_reported_by_idx on incidents (reported_by);
create index incidents_status_idx on incidents (status);

create table corrective_actions (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents(id) on delete cascade,
  description text not null,
  assigned_to uuid references profiles(id),
  due_date date,
  status text not null default 'open' check (status in ('open','done')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index corrective_actions_incident_idx on corrective_actions (incident_id);
create index corrective_actions_assigned_idx on corrective_actions (assigned_to);

create table share_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  kind text not null check (kind in ('signon','subbie_swms')),
  swms_instance_id uuid references swms_instances(id) on delete cascade,
  form_submission_id uuid references form_submissions(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  label text,
  expires_at timestamptz,
  active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  check (
    (kind = 'signon' and (swms_instance_id is not null or form_submission_id is not null))
    or (kind = 'subbie_swms' and project_id is not null)
  )
);
create index share_links_swms_idx on share_links (swms_instance_id);
create index share_links_submission_idx on share_links (form_submission_id);
create index share_links_project_idx on share_links (project_id);
create index share_links_created_by_idx on share_links (created_by);

create table subbie_swms (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  vendor_id uuid references vendors(id),
  company_name text not null,
  contact_name text not null,
  email text,
  title text not null,
  file_path text not null,              -- attachments bucket, public-submissions/ prefix
  status text not null default 'submitted' check (status in ('submitted','under_review','accepted','rejected')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now()
);
create index subbie_swms_project_idx on subbie_swms (project_id);
create index subbie_swms_vendor_idx on subbie_swms (vendor_id);
create index subbie_swms_reviewed_by_idx on subbie_swms (reviewed_by);
create index subbie_swms_status_idx on subbie_swms (status);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor_id uuid,                        -- auth.uid(); null for external/system
  actor_name text not null default 'system',
  entity_type text not null,
  entity_id uuid not null,
  project_id uuid,
  action text not null,                 -- insert | update | delete | external_*
  detail jsonb not null default '{}'
);
create index audit_log_entity_idx on audit_log (entity_type, entity_id);
create index audit_log_project_idx on audit_log (project_id);
create index audit_log_at_idx on audit_log (at desc);

------------------------------------------------------------------------------
-- 2. swms_signatures: allow external (no-login) signers
------------------------------------------------------------------------------
-- unique (swms_instance_id, user_id, version) is unaffected: NULL user_id rows
-- are treated as distinct, so any number of external signatures may coexist.

alter table swms_signatures
  alter column user_id drop not null,
  alter column signature_path drop not null,
  add column company text,
  add column signature_data text check (signature_data is null or length(signature_data) <= 140000),
  add column external boolean not null default false,
  add constraint swms_signatures_sig_present
    check (signature_path is not null or signature_data is not null),
  add constraint swms_signatures_internal_requires_user
    check (external or user_id is not null);

------------------------------------------------------------------------------
-- 3. RLS
------------------------------------------------------------------------------

alter table form_templates     enable row level security;
alter table form_submissions   enable row level security;
alter table form_signons       enable row level security;
alter table incidents          enable row level security;
alter table corrective_actions enable row level security;
alter table share_links        enable row level security;
alter table subbie_swms        enable row level security;
alter table audit_log          enable row level security;

-- form_templates: readable by all; managed by admin (template builder is admin-only)
create policy form_templates_select_authenticated on form_templates
  for select to authenticated using (auth.uid() is not null);
create policy form_templates_insert_admin on form_templates
  for insert to authenticated with check (current_app_role() = 'admin');
create policy form_templates_update_admin on form_templates
  for update to authenticated
  using (current_app_role() = 'admin') with check (current_app_role() = 'admin');
create policy form_templates_delete_admin on form_templates
  for delete to authenticated using (current_app_role() = 'admin');

-- form_submissions: immutable records — insert own (or staff on behalf), no update
create policy form_submissions_select_authenticated on form_submissions
  for select to authenticated using (auth.uid() is not null);
create policy form_submissions_insert_own_or_staff on form_submissions
  for insert to authenticated
  with check (submitted_by = auth.uid() or current_app_role() in ('admin','office','supervisor'));
create policy form_submissions_delete_admin on form_submissions
  for delete to authenticated using (current_app_role() = 'admin');

-- form_signons: own sign-on, or staff recording someone without a login; no update
create policy form_signons_select_authenticated on form_signons
  for select to authenticated using (auth.uid() is not null);
create policy form_signons_insert_own_or_staff on form_signons
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    or (profile_id is null and current_app_role() in ('admin','office','supervisor'))
  );
create policy form_signons_delete_admin on form_signons
  for delete to authenticated using (current_app_role() = 'admin');

-- incidents: anyone can report; staff manage workflow; delete admin only
create policy incidents_select_authenticated on incidents
  for select to authenticated using (auth.uid() is not null);
create policy incidents_insert_authenticated on incidents
  for insert to authenticated with check (auth.uid() is not null);
create policy incidents_update_staff on incidents
  for update to authenticated
  using (current_app_role() in ('admin','office','supervisor'))
  with check (current_app_role() in ('admin','office','supervisor'));
create policy incidents_delete_admin on incidents
  for delete to authenticated using (current_app_role() = 'admin');

-- corrective_actions: same shape as incidents
create policy corrective_actions_select_authenticated on corrective_actions
  for select to authenticated using (auth.uid() is not null);
create policy corrective_actions_insert_authenticated on corrective_actions
  for insert to authenticated with check (auth.uid() is not null);
create policy corrective_actions_update_staff on corrective_actions
  for update to authenticated
  using (current_app_role() in ('admin','office','supervisor'))
  with check (current_app_role() in ('admin','office','supervisor'));
create policy corrective_actions_delete_admin on corrective_actions
  for delete to authenticated using (current_app_role() = 'admin');

-- share_links: staff manage; delete admin/office
create policy share_links_select_staff on share_links
  for select to authenticated using (current_app_role() in ('admin','office','supervisor'));
create policy share_links_insert_staff on share_links
  for insert to authenticated with check (current_app_role() in ('admin','office','supervisor'));
create policy share_links_update_staff on share_links
  for update to authenticated
  using (current_app_role() in ('admin','office','supervisor'))
  with check (current_app_role() in ('admin','office','supervisor'));
create policy share_links_delete_admin_office on share_links
  for delete to authenticated using (current_app_role() in ('admin','office'));

-- subbie_swms: staff read, admin/office review; rows created ONLY via
-- submit_subbie_swms() (security definer) — no insert policy on purpose.
create policy subbie_swms_select_staff on subbie_swms
  for select to authenticated using (current_app_role() in ('admin','office','supervisor'));
create policy subbie_swms_update_admin_office on subbie_swms
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy subbie_swms_delete_admin on subbie_swms
  for delete to authenticated using (current_app_role() = 'admin');

-- audit_log: append-only. Writes happen exclusively in definer context
-- (triggers + RPCs run as table owner). Clients: staff SELECT, nothing else.
create policy audit_log_select_staff on audit_log
  for select to authenticated using (current_app_role() in ('admin','office','supervisor'));
revoke insert, update, delete on audit_log from anon, authenticated;

------------------------------------------------------------------------------
-- 4. Audit trigger
------------------------------------------------------------------------------

create or replace function audit_whs() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_row jsonb;
  v_old jsonb;
  v_changed jsonb := '{}'::jsonb;
  v_detail jsonb;
  v_entity uuid;
  k text;
begin
  select full_name into v_actor_name from profiles where id = v_actor;
  v_actor_name := coalesce(v_actor_name, 'system');

  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
    v_entity := old.id;
  else
    v_row := to_jsonb(new);
    v_entity := new.id;
  end if;

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    for k in select jsonb_object_keys(v_row) loop
      if v_old -> k is distinct from v_row -> k then
        if k = 'signature_data' then
          -- never store signature payloads in the log
          v_changed := v_changed || jsonb_build_object(k, '[signature changed]');
        elsif k in ('schema','hazards','data','body') then
          -- large jsonb/text payloads: marker only
          v_changed := v_changed || jsonb_build_object(k, '[' || k || ' changed]');
        else
          v_changed := v_changed || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_row -> k));
        end if;
      end if;
    end loop;
    if v_changed = '{}'::jsonb then
      return null;  -- no effective change; skip the noise
    end if;
    v_detail := jsonb_build_object('changed', v_changed);
  else
    -- INSERT / DELETE: summary of identifying fields when present
    v_detail := jsonb_strip_nulls(jsonb_build_object(
      'title',  v_row ->> 'title',
      'name',   v_row ->> 'name',
      'status', v_row ->> 'status',
      'number', v_row ->> 'number',
      'kind',   v_row ->> 'kind',
      'label',  v_row ->> 'label'));
  end if;

  insert into audit_log (actor_id, actor_name, entity_type, entity_id, project_id, action, detail)
  values (v_actor, v_actor_name, tg_table_name, v_entity,
          nullif(v_row ->> 'project_id', '')::uuid, lower(tg_op), v_detail);
  return null;
end $$;

revoke execute on function audit_whs() from anon, authenticated, public;

do $$
declare t text;
begin
  foreach t in array array[
    'swms_instances','swms_signatures','hold_points','form_templates',
    'form_submissions','form_signons','incidents','corrective_actions',
    'subbie_swms','share_links'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function audit_whs()',
      t || '_audit', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 5. Public share RPCs (security definer; callable by anon)
------------------------------------------------------------------------------

-- Read-through for /sign/[token] and /submit/[token].
-- Returns null for unknown/inactive/expired tokens (public page shows a
-- friendly "link expired" state without error plumbing).
create or replace function get_shared_doc(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l share_links%rowtype;
  v_doc jsonb;
  v_project_name text;
begin
  select * into l from share_links
   where token = p_token and active
     and (expires_at is null or expires_at > now());
  if not found then
    return null;
  end if;

  if l.kind = 'signon' and l.swms_instance_id is not null then
    select jsonb_build_object(
             'type','swms',
             'title', s.title, 'body', s.body,
             'hazards', s.hazards, 'version', s.version),
           p.name
      into v_doc, v_project_name
      from swms_instances s
      left join projects p on p.id = s.project_id
     where s.id = l.swms_instance_id;
  elsif l.kind = 'signon' then
    select jsonb_build_object(
             'type','form',
             'name', t.name, 'kind', fs.kind,
             'schema', t.schema, 'version', fs.template_version,
             'requires_signon', t.requires_signon,
             'data', fs.data, 'submitted_at', fs.submitted_at),
           p.name
      into v_doc, v_project_name
      from form_submissions fs
      join form_templates t on t.id = fs.template_id
      left join projects p on p.id = fs.project_id
     where fs.id = l.form_submission_id;
  else -- subbie_swms
    select p.name into v_project_name from projects p where p.id = l.project_id;
    v_doc := jsonb_build_object('type','subbie_swms');
  end if;

  if v_doc is null then
    return null;
  end if;

  return jsonb_build_object(
    'kind', l.kind, 'label', l.label,
    'project_name', v_project_name, 'doc', v_doc);
end $$;

-- External sign-on against a signon link: SWMS instance target writes an
-- external swms_signatures row; form submission target writes a form_signons
-- row. Both also get an explicit audit row naming the external actor.
create or replace function submit_shared_signon(
  p_token text, p_name text, p_company text, p_signature_data text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  l share_links%rowtype;
  v_id uuid;
  v_version int;
  v_project uuid;
  v_company text := nullif(btrim(coalesce(p_company,'')), '');
begin
  select * into l from share_links
   where token = p_token and kind = 'signon' and active
     and (expires_at is null or expires_at > now());
  if not found then
    raise exception 'invalid or expired link';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'name is required';
  end if;
  if p_signature_data is null
     or p_signature_data not like 'data:image/png;base64,%'
     or length(p_signature_data) > 140000 then
    raise exception 'invalid signature';
  end if;

  if l.swms_instance_id is not null then
    select version, project_id into v_version, v_project
      from swms_instances where id = l.swms_instance_id;
    insert into swms_signatures
      (swms_instance_id, user_id, name, company, signature_data, external, version)
    values
      (l.swms_instance_id, null, btrim(p_name), v_company, p_signature_data, true, v_version)
    returning id into v_id;
    insert into audit_log (actor_id, actor_name, entity_type, entity_id, project_id, action, detail)
    values (null, 'External — ' || btrim(p_name), 'swms_signatures', v_id, v_project,
            'external_signon',
            jsonb_strip_nulls(jsonb_build_object('company', v_company, 'link_id', l.id, 'label', l.label)));
  else
    select project_id into v_project
      from form_submissions where id = l.form_submission_id;
    insert into form_signons (submission_id, profile_id, name, company, signature_data)
    values (l.form_submission_id, null, btrim(p_name), v_company, p_signature_data)
    returning id into v_id;
    insert into audit_log (actor_id, actor_name, entity_type, entity_id, project_id, action, detail)
    values (null, 'External — ' || btrim(p_name), 'form_signons', v_id, v_project,
            'external_signon',
            jsonb_strip_nulls(jsonb_build_object('company', v_company, 'link_id', l.id, 'label', l.label)));
  end if;

  return v_id;
end $$;

-- Subbie SWMS submission against a subbie_swms link. File must already be
-- uploaded by the anon client under attachments/public-submissions/.
create or replace function submit_subbie_swms(
  p_token text, p_company text, p_contact text, p_email text, p_title text, p_file_path text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  l share_links%rowtype;
  v_id uuid;
begin
  select * into l from share_links
   where token = p_token and kind = 'subbie_swms' and active
     and (expires_at is null or expires_at > now());
  if not found then
    raise exception 'invalid or expired link';
  end if;

  if p_company is null or btrim(p_company) = '' then raise exception 'company is required'; end if;
  if p_contact is null or btrim(p_contact) = '' then raise exception 'contact name is required'; end if;
  if p_title   is null or btrim(p_title)   = '' then raise exception 'title is required'; end if;
  if p_file_path is null
     or p_file_path not like 'public-submissions/%'
     or p_file_path like '%..%' then
    raise exception 'invalid file path';
  end if;

  insert into subbie_swms (project_id, company_name, contact_name, email, title, file_path)
  values (l.project_id, btrim(p_company), btrim(p_contact),
          nullif(btrim(coalesce(p_email,'')), ''), btrim(p_title), p_file_path)
  returning id into v_id;

  insert into audit_log (actor_id, actor_name, entity_type, entity_id, project_id, action, detail)
  values (null, 'External — ' || btrim(p_contact) || ' (' || btrim(p_company) || ')',
          'subbie_swms', v_id, l.project_id, 'external_submission',
          jsonb_strip_nulls(jsonb_build_object('title', btrim(p_title), 'link_id', l.id, 'label', l.label)));

  return v_id;
end $$;

grant execute on function get_shared_doc(text) to anon, authenticated;
grant execute on function submit_shared_signon(text, text, text, text) to anon, authenticated;
grant execute on function submit_subbie_swms(text, text, text, text, text, text) to anon, authenticated;

------------------------------------------------------------------------------
-- 6. Storage: anon may upload (only) into attachments/public-submissions/
------------------------------------------------------------------------------

create policy "attachments_insert_anon_public_submissions" on storage.objects
  for insert to anon
  with check (bucket_id = 'attachments' and name like 'public-submissions/%');

------------------------------------------------------------------------------
-- 7. Sequences: incident numbering (INC-0001 via next_number('incident'))
------------------------------------------------------------------------------

insert into sequences (key, next_value) values ('incident', 1)
on conflict (key) do nothing;

------------------------------------------------------------------------------
-- 8. System form templates (seeded here — they are defaults, not demo data)
------------------------------------------------------------------------------

insert into form_templates (id, kind, name, description, schema, version, active, requires_signon) values
  ('fa000000-0000-4000-a000-000000000001', 'prestart', 'Plant & Equipment Pre-Start',
   'Daily plant pre-start inspection. Complete before first use each shift; tag out and report any defects.',
   '[
     {"key":"fluids","label":"Fluid levels (engine oil, coolant, hydraulic)","type":"select","options":["OK","Defect","N/A"],"required":true},
     {"key":"brakes","label":"Brakes & park brake","type":"select","options":["OK","Defect","N/A"],"required":true},
     {"key":"lights","label":"Lights, beacons & reversing alarm","type":"select","options":["OK","Defect","N/A"],"required":true},
     {"key":"rops","label":"ROPS / FOPS & seatbelt","type":"select","options":["OK","Defect","N/A"],"required":true},
     {"key":"attachments_secure","label":"Attachments & quick hitch secure","type":"select","options":["OK","Defect","N/A"],"required":true},
     {"key":"leaks","label":"No visible leaks (fuel, oil, hydraulic)","type":"select","options":["OK","Defect","N/A"],"required":true},
     {"key":"hour_meter","label":"Hour meter reading","type":"number","required":true},
     {"key":"defects","label":"Defects / damage noted","type":"textarea","required":false},
     {"key":"safe_to_operate","label":"Plant is safe to operate","type":"checkbox","required":true}
   ]'::jsonb, 1, true, false),
  ('fa000000-0000-4000-a000-000000000002', 'take5', 'Take 5 — Personal Risk Assessment',
   'Personal pre-task risk assessment. Stop, look, assess, control — then proceed safely.',
   '[
     {"key":"stop_think","label":"Stop & think through the task","type":"checkbox","required":true},
     {"key":"look_hazards","label":"Look for hazards","type":"checkbox","required":true},
     {"key":"assess_risk","label":"Assess the risk","type":"checkbox","required":true},
     {"key":"control_hazards","label":"Control the hazards","type":"checkbox","required":true},
     {"key":"proceed_safely","label":"Proceed safely","type":"checkbox","required":true},
     {"key":"hazards_identified","label":"Hazards identified","type":"textarea","required":false},
     {"key":"controls","label":"Controls put in place","type":"textarea","required":false},
     {"key":"ppe_checked","label":"Required PPE checked & worn","type":"checkbox","required":true}
   ]'::jsonb, 1, true, false),
  ('fa000000-0000-4000-a000-000000000003', 'toolbox', 'Toolbox Talk',
   'Record of a toolbox talk held with the crew. Capture topic and discussion, then collect sign-ons.',
   '[
     {"key":"topic","label":"Topic","type":"text","required":true},
     {"key":"discussion","label":"Discussion points","type":"textarea","required":true},
     {"key":"matters_raised","label":"Matters raised by crew","type":"textarea","required":false},
     {"key":"conducted_by","label":"Conducted by","type":"text","required":true}
   ]'::jsonb, 1, true, true),
  ('fa000000-0000-4000-a000-000000000004', 'induction', 'Site Induction',
   'Site-specific induction acknowledgement for workers and visitors. Collect sign-on after the walkthrough.',
   '[
     {"key":"visitor_type","label":"Attending as","type":"select","options":["Worker","Visitor"],"required":true},
     {"key":"ack_amenities","label":"Site amenities & parking explained","type":"checkbox","required":true},
     {"key":"ack_emergency","label":"Emergency assembly point identified","type":"checkbox","required":true},
     {"key":"ack_first_aid","label":"First aid kit & first aiders identified","type":"checkbox","required":true},
     {"key":"ack_exclusion","label":"Exclusion zones & site rules explained","type":"checkbox","required":true},
     {"key":"ack_ppe","label":"Mandatory PPE requirements understood","type":"checkbox","required":true},
     {"key":"emergency_contact","label":"Emergency contact (name & phone)","type":"text","required":true}
   ]'::jsonb, 1, true, true),
  ('fa000000-0000-4000-a000-000000000005', 'incident', 'Incident Report',
   'System: writes to incident register. Field entry form for injuries, near misses, property and environmental incidents.',
   '[
     {"key":"type","label":"Incident type","type":"select","options":["injury","near_miss","property","environmental"],"required":true},
     {"key":"severity","label":"Severity (1 low — 5 critical)","type":"rating","required":true},
     {"key":"occurred_date","label":"Date occurred","type":"date","required":true},
     {"key":"occurred_time","label":"Time occurred","type":"time","required":true},
     {"key":"location","label":"Location","type":"text","required":true},
     {"key":"description","label":"What happened","type":"textarea","required":true},
     {"key":"immediate_action","label":"Immediate action taken","type":"textarea","required":false},
     {"key":"photos","label":"Photos","type":"photo","required":false}
   ]'::jsonb, 1, true, false)
on conflict (id) do nothing;
