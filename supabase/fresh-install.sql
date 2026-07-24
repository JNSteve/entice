-- ============================================================================
-- FRESH INSTALL — full platform schema + seeds (migrations 0001..0053 combined)
-- Generated 2026-07-15 for standing up a new instance (G Site Solutions).
-- Run this whole file ONCE in the SQL editor of a brand-new Supabase project,
-- then run the separate bootstrap_first_admin() call to create the first login.
-- ============================================================================

-- ─── 0001_schema.sql ─────────────────────────────────────────────────────
-- ENUM-ish checks kept as text + CHECK for flexibility
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin','office','supervisor','field')),
  phone text, hourly_cost numeric(10,2), active boolean not null default true,
  created_at timestamptz not null default now()
);

create table settings (
  id int primary key default 1 check (id = 1),
  company_name text not null default 'Entice',
  abn text, address text, phone text, email text, logo_path text,
  gst_rate numeric(5,2) not null default 10,
  invoice_footer text, claim_footer text,
  updated_at timestamptz not null default now()
);
insert into settings (id) values (1);

create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'other' check (type in ('builder','strata','council','government','facility_manager','insurer','private','other')),
  abn text, payment_terms_days int not null default 30,
  notes text, archived boolean not null default false,
  created_at timestamptz not null default now()
);
create table contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null, role text, email text, phone text
);
create table sites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null, address text, suburb text, state text, postcode text, notes text
);

create table cost_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null,
  category text not null default 'other' check (category in ('labour','plant','materials','subcontract','other')),
  active boolean not null default true
);
create table rate_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('labour','plant','material','subbie','other')),
  name text not null, unit text not null default 'ea',
  cost numeric(12,2) not null default 0,
  default_markup_pct numeric(6,2) not null default 20,
  active boolean not null default true
);
create table plant (
  id uuid primary key default gen_random_uuid(),
  name text not null, type text, rego text,
  ownership text not null default 'owned' check (ownership in ('owned','hired')),
  hourly_rate numeric(10,2), active boolean not null default true
);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  client_id uuid not null references clients(id),
  site_id uuid references sites(id), contact_id uuid references contacts(id),
  title text not null, description text,
  status text not null default 'draft' check (status in ('draft','sent','accepted','lost')),
  gst_rate numeric(5,2) not null default 10,
  valid_days int not null default 30,
  sent_at timestamptz, decided_at timestamptz, lost_reason text,
  converted_to text check (converted_to in ('job','project')), converted_id uuid,
  notes text, created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create table quote_sections (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  position int not null default 0, title text not null
);
create table quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  section_id uuid references quote_sections(id) on delete set null,
  position int not null default 0,
  description text not null, qty numeric(12,3) not null default 1, unit text not null default 'ea',
  unit_cost numeric(12,2) not null default 0, markup_pct numeric(6,2) not null default 0,
  unit_sell numeric(12,2) not null default 0,
  rate_item_id uuid references rate_items(id)
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  client_id uuid not null references clients(id),
  site_id uuid references sites(id),
  quote_id uuid references quotes(id),
  title text not null, description text,
  status text not null default 'quote' check (status in ('quote','scheduled','in_progress','completed','invoiced','paid','lost')),
  scheduled_start date, scheduled_end date, completed_at timestamptz,
  supervisor_id uuid references profiles(id),
  created_at timestamptz not null default now()
);
create table job_checklist_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  position int not null default 0, text text not null,
  done boolean not null default false, done_by uuid references profiles(id), done_at timestamptz
);
create table work_logs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  date date not null default current_date, notes text not null,
  created_by uuid references profiles(id), created_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  client_id uuid not null references clients(id),
  site_id uuid references sites(id),
  quote_id uuid references quotes(id),
  name text not null, description text,
  status text not null default 'active' check (status in ('active','practical_completion','defects_liability','closed')),
  contract_type text, contract_sum numeric(14,2) not null default 0,
  retention_pct numeric(5,2) not null default 10,
  retention_cap_pct numeric(5,2) not null default 5,
  pc_release_fraction numeric(4,2) not null default 0.5,
  dlp_months int not null default 12,
  ld_rate numeric(12,2), client_ref text, superintendent text,
  start_date date, claim_day int not null default 25 check (claim_day between 1 and 31),
  practical_completion_date date,
  supervisor_id uuid references profiles(id),
  created_at timestamptz not null default now()
);
create table budget_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  cost_code_id uuid not null references cost_codes(id),
  description text not null, budget_amount numeric(14,2) not null default 0,
  position int not null default 0
);
create table costs (
  id uuid primary key default gen_random_uuid(),
  parent_type text not null check (parent_type in ('job','project')),
  parent_id uuid not null,
  cost_code_id uuid references cost_codes(id),
  date date not null default current_date,
  description text not null, amount numeric(14,2) not null,
  source text not null default 'manual' check (source in ('manual','docket')),
  created_by uuid references profiles(id), created_at timestamptz not null default now()
);

create table vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null, abn text, trades text[] not null default '{}',
  contact_name text, email text, phone text,
  payment_terms_days int not null default 30, notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create table vendor_compliance_docs (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id) on delete cascade,
  kind text not null check (kind in ('public_liability','workers_comp','licence','other')),
  reference text, expiry_date date not null
);

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  project_id uuid references projects(id), job_id uuid references jobs(id),
  vendor_id uuid not null references vendors(id),
  status text not null default 'draft' check (status in ('draft','issued','closed','cancelled')),
  issue_date date, notes text,
  created_at timestamptz not null default now(),
  check (project_id is not null or job_id is not null)
);
create table po_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  position int not null default 0,
  description text not null, cost_code_id uuid references cost_codes(id),
  qty numeric(12,3) not null default 1, unit text not null default 'ea',
  unit_cost numeric(12,2) not null default 0
);

create table variations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  number int not null,
  title text not null, description text,
  status text not null default 'notified' check (status in ('notified','priced','submitted','approved','rejected')),
  cost_estimate numeric(14,2) not null default 0,
  sell_amount numeric(14,2) not null default 0,
  client_ref text, time_bar_date date,
  submitted_at timestamptz, decided_at timestamptz, notes text,
  created_at timestamptz not null default now(),
  unique (project_id, number)
);

create table claims (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  number int not null,
  status text not null default 'draft' check (status in ('draft','submitted','certified','paid')),
  reference_date date not null,
  gst_rate numeric(5,2) not null default 10,
  -- snapshot totals, set on submission
  gross_this_claim numeric(14,2), retention_this_claim numeric(14,2),
  subtotal numeric(14,2), gst numeric(14,2), total_inc_gst numeric(14,2),
  total_claimed_to_date numeric(14,2),
  submitted_at timestamptz,
  certified_amount numeric(14,2), certified_at timestamptz, schedule_received_at date,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, number)
);
create table claim_lines (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references claims(id) on delete cascade,
  source_type text not null check (source_type in ('budget_line','variation')),
  source_id uuid not null,
  description text not null,
  line_value numeric(14,2) not null,
  pct_complete numeric(6,2) not null default 0,
  previous_claimed numeric(14,2) not null default 0,
  claimed_to_date numeric(14,2) not null default 0,
  this_claim numeric(14,2) not null default 0
);
create table retention_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  claim_id uuid references claims(id) on delete set null,
  kind text not null check (kind in ('withheld','release_pc','release_final')),
  amount numeric(14,2) not null, date date not null default current_date, notes text
);

create table packages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null, budget_amount numeric(14,2) not null default 0,
  cost_code_id uuid references cost_codes(id),
  owner_id uuid references profiles(id), let_by_date date,
  status text not null default 'planned' check (status in ('planned','rfq_out','quotes_in','recommended','awarded')),
  notes text, created_at timestamptz not null default now()
);
create table package_rfqs (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  vendor_id uuid not null references vendors(id),
  status text not null default 'invited' check (status in ('invited','quoted','declined')),
  invited_at timestamptz not null default now(), email_snapshot text,
  unique (package_id, vendor_id)
);
create table package_quotes (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  vendor_id uuid not null references vendors(id),
  amount numeric(14,2) not null,
  inclusions text, exclusions text, notes text,
  recommended boolean not null default false,
  received_at date not null default current_date,
  unique (package_id, vendor_id)
);
create table commitments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null default 'subcontract' check (kind in ('subcontract')),
  vendor_id uuid not null references vendors(id),
  package_id uuid references packages(id),
  cost_code_id uuid references cost_codes(id),
  description text not null, amount numeric(14,2) not null,
  status text not null default 'active' check (status in ('active','closed')),
  date date not null default current_date
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  job_id uuid references jobs(id),
  client_id uuid not null references clients(id),
  status text not null default 'draft' check (status in ('draft','sent','paid','void')),
  issue_date date not null default current_date, due_date date,
  gst_rate numeric(5,2) not null default 10,
  sent_at timestamptz, paid_at timestamptz,
  created_at timestamptz not null default now()
);
create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  position int not null default 0,
  description text not null, qty numeric(12,3) not null default 1,
  unit text not null default 'ea', unit_sell numeric(12,2) not null default 0
);
create table payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) on delete cascade,
  claim_id uuid references claims(id) on delete cascade,
  date date not null default current_date, amount numeric(14,2) not null,
  method text, reference text,
  check (invoice_id is not null or claim_id is not null)
);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  date date not null, user_id uuid not null references profiles(id),
  job_id uuid references jobs(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  note text, created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  check (job_id is not null or project_id is not null)
);
create table timesheet_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  assignment_id uuid references assignments(id) on delete set null,
  job_id uuid references jobs(id), project_id uuid references projects(id),
  date date not null default current_date,
  start_at timestamptz not null, end_at timestamptz,
  approved boolean not null default false, approved_by uuid references profiles(id)
);

create table diaries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  date date not null default current_date,
  weather text, work_performed text, delays text, instructions text, visitors text,
  created_by uuid references profiles(id), created_at timestamptz not null default now(),
  unique (project_id, date)
);
create table diary_labour (
  id uuid primary key default gen_random_uuid(),
  diary_id uuid not null references diaries(id) on delete cascade,
  user_id uuid references profiles(id), name text not null, trade text,
  headcount int not null default 1, hours numeric(5,2) not null default 0
);
create table diary_plant (
  id uuid primary key default gen_random_uuid(),
  diary_id uuid not null references diaries(id) on delete cascade,
  plant_id uuid references plant(id), name text not null,
  status text not null default 'working' check (status in ('working','idle','down')),
  hours numeric(5,2) not null default 0
);

create table swms_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null, body text,
  hazards jsonb not null default '[]',   -- [{task, hazards, risk, controls, residual_risk}]
  version int not null default 1, active boolean not null default true,
  created_at timestamptz not null default now()
);
create table swms_instances (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references swms_templates(id),
  project_id uuid references projects(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  title text not null, body text, hazards jsonb not null default '[]',
  version int not null default 1,
  status text not null default 'active' check (status in ('active','superseded')),
  created_at timestamptz not null default now(),
  check (project_id is not null or job_id is not null)
);
create table swms_signatures (
  id uuid primary key default gen_random_uuid(),
  swms_instance_id uuid not null references swms_instances(id) on delete cascade,
  user_id uuid not null references profiles(id),
  name text not null, signature_path text not null,  -- storage path of PNG
  version int not null, signed_at timestamptz not null default now(),
  unique (swms_instance_id, user_id, version)
);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  parent_type text not null check (parent_type in ('job','project','quote','invoice','claim','po','vendor','diary','variation','package')),
  parent_id uuid not null,
  bucket text not null default 'attachments', path text not null,
  filename text not null, content_type text, size int,
  kind text not null default 'document' check (kind in ('photo','docket','document','pdf')),
  caption text, meta jsonb not null default '{}',
  created_by uuid references profiles(id), created_at timestamptz not null default now()
);
create index attachments_parent_idx on attachments (parent_type, parent_id);

create table sequences (key text primary key, next_value int not null default 1);
insert into sequences (key, next_value) values
  ('quote',1),('job',1),('project',1),('po',1),('invoice',1);

-- ─── 0002_functions.sql ──────────────────────────────────────────────────
create or replace function next_number(seq_key text) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  update sequences set next_value = next_value + 1 where key = seq_key
  returning next_value - 1 into v;
  if v is null then
    insert into sequences (key, next_value) values (seq_key, 2) returning 1 into v;
  end if;
  return v;
end $$;

create or replace function current_app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

-- Admin-only user provisioning without service-role key.
-- Inserts directly into auth schema (documented Supabase pattern for seeding/self-hosting).
create extension if not exists pgcrypto;

create or replace function admin_create_user(p_email text, p_password text, p_full_name text, p_role text)
returns uuid
language plpgsql security definer set search_path = public, auth, extensions as $$
declare new_id uuid := gen_random_uuid();
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'only admins can create users';
  end if;
  if p_role not in ('admin','office','supervisor','field') then
    raise exception 'invalid role %', p_role;
  end if;
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current
  ) values (
    '00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated',
    lower(p_email), extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', '', ''
  );
  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), new_id, new_id::text,
    jsonb_build_object('sub', new_id::text, 'email', lower(p_email), 'email_verified', true),
    'email', now(), now(), now()
  );
  insert into public.profiles (id, full_name, role) values (new_id, p_full_name, p_role);
  return new_id;
end $$;

-- Bootstrap variant used exactly once when no users exist at all (cannot pass the admin check).
create or replace function bootstrap_first_admin(p_email text, p_password text, p_full_name text)
returns uuid
language plpgsql security definer set search_path = public, auth, extensions as $$
declare new_id uuid;
begin
  if exists (select 1 from public.profiles) then
    raise exception 'bootstrap only allowed when no users exist';
  end if;
  -- temporarily mimic admin path: duplicate the inserts (cannot call admin_create_user due to role check)
  new_id := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current
  ) values (
    '00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated',
    lower(p_email), extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', '', ''
  );
  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), new_id, new_id::text,
    jsonb_build_object('sub', new_id::text, 'email', lower(p_email), 'email_verified', true),
    'email', now(), now(), now()
  );
  insert into public.profiles (id, full_name, role) values (new_id, p_full_name, 'admin');
  return new_id;
end $$;

revoke execute on function bootstrap_first_admin(text, text, text) from anon, authenticated, public;
revoke execute on function admin_create_user(text, text, text, text) from anon, public;

-- ─── 0003_rls.sql ────────────────────────────────────────────────────────
-- 0003_rls.sql
-- Row Level Security for every public table.
-- Roles come from public.profiles.role via current_app_role() (security definer, see 0002):
--   admin | office | supervisor | field
--
-- Access matrix summary:
--   MONEY tables  -> all operations restricted to admin/office.
--   OP tables     -> SELECT for any authenticated user; writes vary per table (below).
--   sequences     -> RLS enabled, zero policies (only reachable via security-definer next_number()).

------------------------------------------------------------------------------
-- 1. Enable RLS on all 42 public tables
------------------------------------------------------------------------------
alter table quotes                 enable row level security;
alter table quote_sections         enable row level security;
alter table quote_lines            enable row level security;
alter table rate_items             enable row level security;
alter table budget_lines           enable row level security;
alter table costs                  enable row level security;
alter table purchase_orders        enable row level security;
alter table po_lines               enable row level security;
alter table variations             enable row level security;
alter table claims                 enable row level security;
alter table claim_lines            enable row level security;
alter table retention_entries      enable row level security;
alter table invoices               enable row level security;
alter table invoice_lines          enable row level security;
alter table payments               enable row level security;
alter table commitments            enable row level security;
alter table packages               enable row level security;
alter table package_rfqs           enable row level security;
alter table package_quotes         enable row level security;
alter table clients                enable row level security;
alter table contacts               enable row level security;
alter table sites                  enable row level security;
alter table cost_codes             enable row level security;
alter table plant                  enable row level security;
alter table settings               enable row level security;
alter table profiles               enable row level security;
alter table jobs                   enable row level security;
alter table projects               enable row level security;
alter table assignments            enable row level security;
alter table diaries                enable row level security;
alter table diary_labour           enable row level security;
alter table diary_plant            enable row level security;
alter table swms_templates         enable row level security;
alter table swms_instances         enable row level security;
alter table swms_signatures        enable row level security;
alter table attachments            enable row level security;
alter table job_checklist_items    enable row level security;
alter table work_logs              enable row level security;
alter table timesheet_entries      enable row level security;
alter table vendors                enable row level security;
alter table vendor_compliance_docs enable row level security;
alter table sequences              enable row level security;

------------------------------------------------------------------------------
-- 2. MONEY tables: a single FOR ALL policy, admin/office only
------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'quotes','quote_sections','quote_lines','rate_items','budget_lines','costs',
    'purchase_orders','po_lines','variations','claims','claim_lines',
    'retention_entries','invoices','invoice_lines','payments','commitments',
    'packages','package_rfqs','package_quotes'
  ] loop
    execute format($f$
      create policy %I on public.%I
        for all to authenticated
        using (current_app_role() in ('admin','office'))
        with check (current_app_role() in ('admin','office'))
    $f$, t || '_admin_office_all', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 3. OP tables: SELECT for any authenticated user
--    (sequences deliberately excluded: no select policy => deny all)
------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'clients','contacts','sites','cost_codes','plant','settings','profiles',
    'jobs','projects','assignments','diaries','diary_labour','diary_plant',
    'swms_templates','swms_instances','swms_signatures','attachments',
    'job_checklist_items','work_logs','timesheet_entries',
    'vendors','vendor_compliance_docs'
  ] loop
    execute format($f$
      create policy %I on public.%I
        for select to authenticated
        using (auth.uid() is not null)
    $f$, t || '_select_authenticated', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 4. Reference/master-data tables: writes restricted to admin/office
--    clients, contacts, sites, cost_codes, plant, vendors,
--    vendor_compliance_docs, swms_templates
------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'clients','contacts','sites','cost_codes','plant',
    'vendors','vendor_compliance_docs','swms_templates'
  ] loop
    execute format($f$
      create policy %I on public.%I
        for insert to authenticated
        with check (current_app_role() in ('admin','office'))
    $f$, t || '_insert_admin_office', t);
    execute format($f$
      create policy %I on public.%I
        for update to authenticated
        using (current_app_role() in ('admin','office'))
        with check (current_app_role() in ('admin','office'))
    $f$, t || '_update_admin_office', t);
    execute format($f$
      create policy %I on public.%I
        for delete to authenticated
        using (current_app_role() in ('admin','office'))
    $f$, t || '_delete_admin_office', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 5. settings: update only admin (no insert/delete policies -> denied)
------------------------------------------------------------------------------
create policy settings_update_admin on settings
  for update to authenticated
  using (current_app_role() = 'admin')
  with check (current_app_role() = 'admin');

------------------------------------------------------------------------------
-- 6. profiles: update self-or-admin; insert admin only (real creation goes
--    through admin_create_user rpc); no delete policy -> denied
------------------------------------------------------------------------------
create policy profiles_insert_admin on profiles
  for insert to authenticated
  with check (current_app_role() = 'admin');

create policy profiles_update_self_or_admin on profiles
  for update to authenticated
  using (id = auth.uid() or current_app_role() = 'admin')
  with check (id = auth.uid() or current_app_role() = 'admin');

------------------------------------------------------------------------------
-- 7. jobs & projects: insert admin/office; update admin/office/supervisor
--    (supervisor may update status/details); delete admin/office
------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['jobs','projects'] loop
    execute format($f$
      create policy %I on public.%I
        for insert to authenticated
        with check (current_app_role() in ('admin','office'))
    $f$, t || '_insert_admin_office', t);
    execute format($f$
      create policy %I on public.%I
        for update to authenticated
        using (current_app_role() in ('admin','office','supervisor'))
        with check (current_app_role() in ('admin','office','supervisor'))
    $f$, t || '_update_staff', t);
    execute format($f$
      create policy %I on public.%I
        for delete to authenticated
        using (current_app_role() in ('admin','office'))
    $f$, t || '_delete_admin_office', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 8. job_checklist_items: insert/delete admin/office/supervisor;
--    update any authenticated user (field workers tick items)
------------------------------------------------------------------------------
create policy job_checklist_items_insert_staff on job_checklist_items
  for insert to authenticated
  with check (current_app_role() in ('admin','office','supervisor'));

create policy job_checklist_items_update_authenticated on job_checklist_items
  for update to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy job_checklist_items_delete_staff on job_checklist_items
  for delete to authenticated
  using (current_app_role() in ('admin','office','supervisor'));

------------------------------------------------------------------------------
-- 9. work_logs: insert admin/office/supervisor;
--    update/delete admin/office or own (created_by)
------------------------------------------------------------------------------
create policy work_logs_insert_staff on work_logs
  for insert to authenticated
  with check (current_app_role() in ('admin','office','supervisor'));

create policy work_logs_update_admin_office_or_own on work_logs
  for update to authenticated
  using (current_app_role() in ('admin','office') or created_by = auth.uid())
  with check (current_app_role() in ('admin','office') or created_by = auth.uid());

create policy work_logs_delete_admin_office_or_own on work_logs
  for delete to authenticated
  using (current_app_role() in ('admin','office') or created_by = auth.uid());

------------------------------------------------------------------------------
-- 10. assignments: insert/update/delete admin/office/supervisor
------------------------------------------------------------------------------
create policy assignments_insert_staff on assignments
  for insert to authenticated
  with check (current_app_role() in ('admin','office','supervisor'));

create policy assignments_update_staff on assignments
  for update to authenticated
  using (current_app_role() in ('admin','office','supervisor'))
  with check (current_app_role() in ('admin','office','supervisor'));

create policy assignments_delete_staff on assignments
  for delete to authenticated
  using (current_app_role() in ('admin','office','supervisor'));

------------------------------------------------------------------------------
-- 11. timesheet_entries: workers manage their own open entries;
--     admin/office/supervisor manage all
------------------------------------------------------------------------------
create policy timesheet_entries_insert_own_or_staff on timesheet_entries
  for insert to authenticated
  with check (user_id = auth.uid() or current_app_role() in ('admin','office','supervisor'));

-- USING gates which rows may be targeted (own row only while still open);
-- WITH CHECK allows the worker to set end_at (clock out) on that row.
create policy timesheet_entries_update_own_open_or_staff on timesheet_entries
  for update to authenticated
  using ((user_id = auth.uid() and end_at is null) or current_app_role() in ('admin','office','supervisor'))
  with check (user_id = auth.uid() or current_app_role() in ('admin','office','supervisor'));

create policy timesheet_entries_delete_staff on timesheet_entries
  for delete to authenticated
  using (current_app_role() in ('admin','office','supervisor'));

------------------------------------------------------------------------------
-- 12. diaries: insert any authenticated; update own or staff; delete admin/office
------------------------------------------------------------------------------
create policy diaries_insert_authenticated on diaries
  for insert to authenticated
  with check (auth.uid() is not null);

create policy diaries_update_own_or_staff on diaries
  for update to authenticated
  using (created_by = auth.uid() or current_app_role() in ('admin','office','supervisor'))
  with check (created_by = auth.uid() or current_app_role() in ('admin','office','supervisor'));

create policy diaries_delete_admin_office on diaries
  for delete to authenticated
  using (current_app_role() in ('admin','office'));

------------------------------------------------------------------------------
-- 13. diary_labour & diary_plant: insert any authenticated;
--     update/delete by staff or the owner of the parent diary
------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['diary_labour','diary_plant'] loop
    execute format($f$
      create policy %I on public.%I
        for insert to authenticated
        with check (auth.uid() is not null)
    $f$, t || '_insert_authenticated', t);
    execute format($f$
      create policy %I on public.%I
        for update to authenticated
        using (current_app_role() in ('admin','office','supervisor')
               or exists (select 1 from diaries d where d.id = diary_id and d.created_by = auth.uid()))
        with check (current_app_role() in ('admin','office','supervisor')
               or exists (select 1 from diaries d where d.id = diary_id and d.created_by = auth.uid()))
    $f$, t || '_update_staff_or_diary_owner', t);
    execute format($f$
      create policy %I on public.%I
        for delete to authenticated
        using (current_app_role() in ('admin','office','supervisor')
               or exists (select 1 from diaries d where d.id = diary_id and d.created_by = auth.uid()))
    $f$, t || '_delete_staff_or_diary_owner', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 14. swms_instances: insert/update admin/office/supervisor; delete admin/office
------------------------------------------------------------------------------
create policy swms_instances_insert_staff on swms_instances
  for insert to authenticated
  with check (current_app_role() in ('admin','office','supervisor'));

create policy swms_instances_update_staff on swms_instances
  for update to authenticated
  using (current_app_role() in ('admin','office','supervisor'))
  with check (current_app_role() in ('admin','office','supervisor'));

create policy swms_instances_delete_admin_office on swms_instances
  for delete to authenticated
  using (current_app_role() in ('admin','office'));

------------------------------------------------------------------------------
-- 15. swms_signatures: insert own signature only; no update; delete admin/office
------------------------------------------------------------------------------
create policy swms_signatures_insert_own on swms_signatures
  for insert to authenticated
  with check (user_id = auth.uid());

create policy swms_signatures_delete_admin_office on swms_signatures
  for delete to authenticated
  using (current_app_role() in ('admin','office'));

------------------------------------------------------------------------------
-- 16. attachments: insert own; update admin/office; delete admin/office or own
------------------------------------------------------------------------------
create policy attachments_insert_own on attachments
  for insert to authenticated
  with check (created_by = auth.uid());

create policy attachments_update_admin_office on attachments
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));

create policy attachments_delete_admin_office_or_own on attachments
  for delete to authenticated
  using (current_app_role() in ('admin','office') or created_by = auth.uid());

------------------------------------------------------------------------------
-- 17. sequences: RLS enabled, zero policies. All client access denied;
--     numbering happens exclusively through next_number() (security definer).
------------------------------------------------------------------------------

-- ─── 0004_profile_guard.sql ──────────────────────────────────────────────
-- Guard against profile self-promotion: the profiles UPDATE policy allows
-- id = auth.uid(), which would otherwise let any user change their own
-- role/active/hourly_cost. Trigger blocks those column changes for non-admins.

create or replace function enforce_profile_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role
      or new.active is distinct from old.active
      or new.hourly_cost is distinct from old.hourly_cost)
     and coalesce(current_app_role(), '') <> 'admin' then
    raise exception 'only admins can change role, active or hourly_cost';
  end if;
  return new;
end $$;

drop trigger if exists profile_guard on profiles;
create trigger profile_guard before update on profiles
  for each row execute function enforce_profile_guard();

-- ─── 0005_storage.sql ────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('attachments','attachments',false), ('branding','branding',true)
on conflict (id) do nothing;

-- attachments: any authenticated user may upload and read; only admin/office may delete
create policy "attachments_insert_authenticated" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments');
create policy "attachments_select_authenticated" on storage.objects for select to authenticated
  using (bucket_id = 'attachments');
create policy "attachments_delete_staff" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and current_app_role() in ('admin','office'));

-- branding: public read (bucket is public anyway for direct URLs); admin write
create policy "branding_select_all" on storage.objects for select
  using (bucket_id = 'branding');
create policy "branding_write_admin" on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and current_app_role() = 'admin');
create policy "branding_update_admin" on storage.objects for update to authenticated
  using (bucket_id = 'branding' and current_app_role() = 'admin');
create policy "branding_delete_admin" on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and current_app_role() = 'admin');

-- ─── 0006_checklists_costcodes.sql ───────────────────────────────────────
create table checklist_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  items text[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table checklist_templates enable row level security;
create policy checklist_templates_read on checklist_templates for select to authenticated using (auth.uid() is not null);
create policy checklist_templates_write on checklist_templates for all to authenticated
  using (current_app_role() in ('admin','office')) with check (current_app_role() in ('admin','office'));

insert into cost_codes (code, name, category) values
 ('10','Labour','labour'), ('20','Plant & Equipment','plant'), ('30','Materials','materials'),
 ('40','Subcontractors','subcontract'), ('50','Site Establishment','other'), ('60','Traffic Control','subcontract'),
 ('70','Waste & Tipping','other'), ('80','Environmental','other'), ('90','Preliminaries','other'), ('99','Other','other')
on conflict (code) do nothing;

-- ─── 0007_security_hardening.sql ─────────────────────────────────────────
-- Advisor-driven hardening:
-- 1. Trigger function should never be RPC-callable
revoke execute on function enforce_profile_guard() from anon, authenticated, public;
-- 2. Anonymous users have no business with these
revoke execute on function current_app_role() from anon;
revoke execute on function next_number(text) from anon;
-- 3. Public bucket doesn't need a listing policy (object URLs work without it)
drop policy if exists "branding_select_all" on storage.objects;

-- ─── 0008_programme.sql ──────────────────────────────────────────────────
-- 0008_programme.sql
-- Programme (Gantt) tasks per project.
--
-- OP table: readable by any authenticated user; insert/update allowed for
-- admin/office/supervisor (supervisors maintain the programme on site);
-- delete restricted to admin/office.

create table programme_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  phase text,
  start_date date not null,
  end_date date not null,
  progress_pct numeric(5,2) not null default 0 check (progress_pct between 0 and 100),
  position int not null default 0,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

alter table programme_tasks enable row level security;

create policy programme_read on programme_tasks
  for select to authenticated
  using (auth.uid() is not null);

create policy programme_write on programme_tasks
  for insert to authenticated
  with check (current_app_role() in ('admin','office','supervisor'));

create policy programme_update on programme_tasks
  for update to authenticated
  using (current_app_role() in ('admin','office','supervisor'));

create policy programme_delete on programme_tasks
  for delete to authenticated
  using (current_app_role() in ('admin','office'));

-- ─── 0009_programme_extras.sql ───────────────────────────────────────────
-- 0009_programme_extras.sql
-- Programme extras: baseline snapshot columns, finish-to-start dependency
-- links and inspection hold points.
--
-- programme_links / hold_points are OP tables: readable by any authenticated
-- user; write for admin/office/supervisor; delete admin/office (links may be
-- removed by supervisors too — they maintain the programme on site).

alter table programme_tasks
  add column baseline_start date,
  add column baseline_end date;

create table programme_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  predecessor_id uuid not null references programme_tasks(id) on delete cascade,
  successor_id uuid not null references programme_tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (predecessor_id, successor_id),
  check (predecessor_id <> successor_id)
);
alter table programme_links enable row level security;
create policy programme_links_read on programme_links for select to authenticated using (auth.uid() is not null);
create policy programme_links_write on programme_links for insert to authenticated with check (current_app_role() in ('admin','office','supervisor'));
create policy programme_links_delete on programme_links for delete to authenticated using (current_app_role() in ('admin','office','supervisor'));

create table hold_points (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  task_id uuid not null references programme_tasks(id) on delete cascade,
  title text not null,
  required_by text not null default 'Superintendent',
  date date not null,
  status text not null default 'pending' check (status in ('pending','notified','released')),
  notified_at timestamptz,
  released_at timestamptz, released_by text, release_ref text,
  notes text,
  created_at timestamptz not null default now()
);
alter table hold_points enable row level security;
create policy hold_points_read on hold_points for select to authenticated using (auth.uid() is not null);
create policy hold_points_write on hold_points for insert to authenticated with check (current_app_role() in ('admin','office','supervisor'));
create policy hold_points_update on hold_points for update to authenticated using (current_app_role() in ('admin','office','supervisor'));
create policy hold_points_delete on hold_points for delete to authenticated using (current_app_role() in ('admin','office'));

-- ─── 0010_whs.sql ────────────────────────────────────────────────────────
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

-- ─── 0011_attachment_parents.sql ─────────────────────────────────────────
-- 0011_attachment_parents.sql
-- Extend attachments.parent_type to cover WHS parents: incidents and
-- (immutable) form submissions get their photos via the attachments table
-- rather than inside the jsonb data payload.

alter table attachments drop constraint attachments_parent_type_check;
alter table attachments add constraint attachments_parent_type_check
  check (parent_type in (
    'job','project','quote','invoice','claim','po','vendor','diary',
    'variation','package','incident','form_submission'
  ));

-- ─── 0012_whs_documents.sql ──────────────────────────────────────────────
-- 0012_whs_documents.sql
-- WHS document library: controlled safety documents (policies, procedures,
-- management plans, SDS, registers, blank forms) with simple version control
-- (supersedes chain), review-due tracking, and the standard WHS audit trail.
--
-- Files live in the private attachments bucket under whs-documents/ and are
-- served via short-lived signed URLs. Conventions follow 0010_whs.sql:
-- current_app_role() for RLS, audit_whs() row trigger ({table}_audit).

create table whs_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'other' check (category in ('policy','procedure','plan','sds','register','form','other')),
  doc_number text,
  version text not null default 'Rev A',
  status text not null default 'current' check (status in ('current','superseded','archived')),
  supersedes_id uuid references whs_documents(id),
  file_path text not null,
  filename text not null,
  content_type text, size int,
  review_due date,
  notes text,
  uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index whs_documents_supersedes_idx on whs_documents (supersedes_id);
create index whs_documents_status_idx on whs_documents (status);
create index whs_documents_uploaded_by_idx on whs_documents (uploaded_by);

alter table whs_documents enable row level security;
create policy whs_documents_read on whs_documents for select to authenticated using (auth.uid() is not null);
create policy whs_documents_write on whs_documents for insert to authenticated with check (current_app_role() in ('admin','office'));
create policy whs_documents_update on whs_documents for update to authenticated using (current_app_role() in ('admin','office'));
create policy whs_documents_delete on whs_documents for delete to authenticated using (current_app_role() = 'admin');

create trigger whs_documents_audit after insert or update or delete on whs_documents
  for each row execute function audit_whs();

-- ─── 0013_documents.sql ──────────────────────────────────────────────────
-- 0013_documents.sql
-- Generalise the WHS-only document library into a COMPANY-WIDE controlled
-- document register (ISO 9001 §7.5): rename whs_documents → documents, broaden
-- its category/system taxonomy, add a formal approval lifecycle
-- (draft → in_review → approved → issued → superseded/archived) with reviewer/
-- approver capture, and a read-acknowledgement register on issued documents.
--
-- Existing rows are preserved (and their attachments): the rename keeps every
-- whs_documents row, status 'current' migrates to 'issued', system defaults to
-- 'ohs'. file_path/filename become nullable so a draft may exist before its
-- file is uploaded (the app guards issuing without a file).
--
-- Conventions follow 0010_whs.sql / 0012_whs_documents.sql:
-- current_app_role() for RLS, audit_whs() row trigger ({table}_audit).

------------------------------------------------------------------------------
-- 1. Rename the table (preserves rows + attachments) and its indexes
------------------------------------------------------------------------------

-- Guarded so a re-run (after the rename already happened) is a no-op.
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = 'whs_documents')
     and not exists (select 1 from information_schema.tables
                      where table_schema = 'public' and table_name = 'documents') then
    alter table whs_documents rename to documents;
  end if;
end $$;

-- Rename indexes for clarity (no-ops if a prior run already renamed them).
alter index if exists whs_documents_supersedes_idx  rename to documents_supersedes_idx;
alter index if exists whs_documents_status_idx       rename to documents_status_idx;
alter index if exists whs_documents_uploaded_by_idx  rename to documents_uploaded_by_idx;

-- A table rename does NOT rename its constraints. PostgREST resource embedding
-- targets a constraint by name (profiles!documents_uploaded_by_fkey), so rename
-- the carried-over FK + self-FK constraints to the documents_* convention.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'whs_documents_uploaded_by_fkey') then
    alter table documents rename constraint whs_documents_uploaded_by_fkey to documents_uploaded_by_fkey;
  end if;
  if exists (select 1 from pg_constraint where conname = 'whs_documents_supersedes_id_fkey') then
    alter table documents rename constraint whs_documents_supersedes_id_fkey to documents_supersedes_id_fkey;
  end if;
end $$;

------------------------------------------------------------------------------
-- 2. Broaden the taxonomy: category + new ISO management system dimension
------------------------------------------------------------------------------

-- Category: add work_instruction, plan-family stays, add external. The check
-- constraint name is auto-generated on the original table; drop by discovery.
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'documents'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%category%';
  if c is not null then
    execute format('alter table documents drop constraint %I', c);
  end if;
end $$;

alter table documents
  add constraint documents_category_check
  check (category in (
    'policy','procedure','work_instruction','form',
    'register','plan','sds','external','other'
  ));

-- System: which ISO management system the document belongs to. Existing WHS
-- documents are occupational health & safety.
alter table documents
  add column if not exists system text not null default 'ohs'
    check (system in ('qms','ems','ohs','integrated'));

------------------------------------------------------------------------------
-- 3. Approval lifecycle
------------------------------------------------------------------------------

-- Drop the legacy status check FIRST (it only allows current/superseded/archived),
-- THEN migrate the vocabulary, THEN install the new constraint — otherwise the
-- 'current'→'issued' update violates the still-active legacy constraint.
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'documents'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%status%';
  if c is not null then
    execute format('alter table documents drop constraint %I', c);
  end if;
end $$;

update documents set status = 'issued' where status = 'current';

alter table documents alter column status set default 'draft';
alter table documents
  add constraint documents_status_check
  check (status in ('draft','in_review','approved','issued','superseded','archived'));

-- Lifecycle actor/timestamp capture.
alter table documents
  add column if not exists reviewed_by  uuid references profiles(id),
  add column if not exists reviewed_at  timestamptz,
  add column if not exists approved_by  uuid references profiles(id),
  add column if not exists approved_at  timestamptz,
  add column if not exists issued_at    timestamptz;

-- Migrated 'issued' rows were already in force: stamp issued_at from created_at.
update documents set issued_at = created_at where status = 'issued' and issued_at is null;

------------------------------------------------------------------------------
-- 4. A draft may have no file yet — relax the NOT NULLs (app guards issue)
------------------------------------------------------------------------------

alter table documents alter column file_path drop not null;
alter table documents alter column filename  drop not null;

------------------------------------------------------------------------------
-- 5. RLS — recreate policies on the renamed table (rename carries them, but be
--    idempotent: drop + recreate so a re-run lands in a known state).
------------------------------------------------------------------------------

alter table documents enable row level security;

drop policy if exists whs_documents_read   on documents;
drop policy if exists whs_documents_write  on documents;
drop policy if exists whs_documents_update on documents;
drop policy if exists whs_documents_delete on documents;
drop policy if exists documents_read   on documents;
drop policy if exists documents_write  on documents;
drop policy if exists documents_update on documents;
drop policy if exists documents_delete on documents;

create policy documents_read on documents
  for select to authenticated using (auth.uid() is not null);
create policy documents_write on documents
  for insert to authenticated with check (current_app_role() in ('admin','office'));
create policy documents_update on documents
  for update to authenticated using (current_app_role() in ('admin','office'));
create policy documents_delete on documents
  for delete to authenticated using (current_app_role() = 'admin');

------------------------------------------------------------------------------
-- 6. Audit trigger — rename onto the new table name
------------------------------------------------------------------------------

drop trigger if exists whs_documents_audit on documents;
drop trigger if exists documents_audit     on documents;
create trigger documents_audit after insert or update or delete on documents
  for each row execute function audit_whs();

------------------------------------------------------------------------------
-- 7. Read-acknowledgement register (ISO 9001 §7.5.3 controlled distribution)
------------------------------------------------------------------------------
-- One row per (document, user, version): a user acknowledges they have read the
-- current issued version. A new version resets everyone's outstanding state.

create table if not exists document_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  version int not null,
  user_id uuid references profiles(id),
  name text not null,
  acknowledged_at timestamptz not null default now(),
  unique (document_id, user_id, version)
);
create index if not exists document_acknowledgements_document_idx
  on document_acknowledgements (document_id);
create index if not exists document_acknowledgements_user_idx
  on document_acknowledgements (user_id);

alter table document_acknowledgements enable row level security;

drop policy if exists document_acknowledgements_read   on document_acknowledgements;
drop policy if exists document_acknowledgements_insert on document_acknowledgements;
drop policy if exists document_acknowledgements_delete on document_acknowledgements;

create policy document_acknowledgements_read on document_acknowledgements
  for select to authenticated using (auth.uid() is not null);
-- A user may only record their OWN acknowledgement (no update — immutable).
create policy document_acknowledgements_insert on document_acknowledgements
  for insert to authenticated with check (user_id = auth.uid());
create policy document_acknowledgements_delete on document_acknowledgements
  for delete to authenticated using (current_app_role() = 'admin');

drop trigger if exists document_acknowledgements_audit on document_acknowledgements;
create trigger document_acknowledgements_audit
  after insert or update or delete on document_acknowledgements
  for each row execute function audit_whs();

-- ─── 0014_ncr_capa.sql ───────────────────────────────────────────────────
-- 0014_ncr_capa.sql
-- Company-wide Nonconformance (NCR) + Corrective/Preventive Action (CAPA)
-- register — ISO 9001/14001 §10.2. The spine an auditor opens to evidence
-- corrective action. Any nonconformity (quality, environmental, customer
-- complaint, audit finding, supplier, safety) becomes a numbered NCR driven
-- open → investigating → actions → verified → closed, with a MANDATORY
-- verification-of-effectiveness gate before close.
--
-- New tables — these deliberately do NOT extend incidents. A safety NCR may
-- link back to its incident via incident_id.
--
-- Conventions follow 0010_whs.sql: current_app_role() RLS, audit_whs() AFTER
-- triggers, next_number('ncr') sequence, append-only audit_log.
--
-- FIELD crews can RAISE an NCR (report-only insert); office/supervisor manage
-- and close (the close gate is enforced in the server action, not RLS).

------------------------------------------------------------------------------
-- 1. Tables
------------------------------------------------------------------------------

create table ncrs (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,          -- NCR-0001 via next_number('ncr')
  source text not null check (source in (
    'quality','environmental','customer_complaint','audit_finding',
    'supplier','safety','other'
  )),
  category text,
  severity int not null check (severity between 1 and 5),
  title text not null,
  description text not null,
  immediate_action text,                -- containment
  root_cause text,
  status text not null default 'open' check (status in (
    'open','investigating','actions','verified','closed'
  )),
  project_id uuid references projects(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  vendor_id uuid references vendors(id) on delete set null,
  incident_id uuid references incidents(id) on delete set null,
  raised_by uuid references profiles(id),
  occurred_on date,
  verification_notes text,
  verified_by uuid references profiles(id),
  verified_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index ncrs_status_idx on ncrs (status);
create index ncrs_source_idx on ncrs (source);
create index ncrs_project_idx on ncrs (project_id);
create index ncrs_job_idx on ncrs (job_id);
create index ncrs_vendor_idx on ncrs (vendor_id);
create index ncrs_incident_idx on ncrs (incident_id);
create index ncrs_raised_by_idx on ncrs (raised_by);

create table capa_actions (
  id uuid primary key default gen_random_uuid(),
  ncr_id uuid not null references ncrs(id) on delete cascade,
  kind text not null default 'corrective' check (kind in ('corrective','preventive')),
  description text not null,
  assigned_to uuid references profiles(id),
  due_date date,
  status text not null default 'open' check (status in ('open','done')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index capa_actions_ncr_idx on capa_actions (ncr_id);
create index capa_actions_assigned_idx on capa_actions (assigned_to);

------------------------------------------------------------------------------
-- 2. Attachments: NCRs get their own parent_type ('ncr')
------------------------------------------------------------------------------

alter table attachments drop constraint attachments_parent_type_check;
alter table attachments add constraint attachments_parent_type_check
  check (parent_type in (
    'job','project','quote','invoice','claim','po','vendor','diary',
    'variation','package','incident','form_submission','ncr'
  ));

------------------------------------------------------------------------------
-- 3. RLS (operational + FIELD CAN RAISE)
------------------------------------------------------------------------------

alter table ncrs         enable row level security;
alter table capa_actions enable row level security;

-- ncrs: anyone authenticated reads; field+ can RAISE (insert); staff manage
-- (update); admin deletes.
create policy ncrs_select_authenticated on ncrs
  for select to authenticated using (auth.uid() is not null);
create policy ncrs_insert_raise on ncrs
  for insert to authenticated
  with check (current_app_role() in ('admin','office','supervisor','field'));
create policy ncrs_update_staff on ncrs
  for update to authenticated
  using (current_app_role() in ('admin','office','supervisor'))
  with check (current_app_role() in ('admin','office','supervisor'));
create policy ncrs_delete_admin on ncrs
  for delete to authenticated using (current_app_role() = 'admin');

-- capa_actions: staff-only management (field never touches CAPA).
create policy capa_actions_select_authenticated on capa_actions
  for select to authenticated using (auth.uid() is not null);
create policy capa_actions_insert_staff on capa_actions
  for insert to authenticated
  with check (current_app_role() in ('admin','office','supervisor'));
create policy capa_actions_update_staff on capa_actions
  for update to authenticated
  using (current_app_role() in ('admin','office','supervisor'))
  with check (current_app_role() in ('admin','office','supervisor'));
create policy capa_actions_delete_admin on capa_actions
  for delete to authenticated using (current_app_role() = 'admin');

------------------------------------------------------------------------------
-- 4. Audit triggers (reuse audit_whs() from 0010_whs.sql)
------------------------------------------------------------------------------

create trigger ncrs_audit
  after insert or update or delete on public.ncrs
  for each row execute function audit_whs();

create trigger capa_actions_audit
  after insert or update or delete on public.capa_actions
  for each row execute function audit_whs();

------------------------------------------------------------------------------
-- 5. Sequence: NCR numbering (NCR-0001 via next_number('ncr'))
------------------------------------------------------------------------------

insert into sequences (key, next_value) values ('ncr', 1)
on conflict (key) do nothing;

-- ─── 0015_storage_fixes.sql ──────────────────────────────────────────────
-- 0015: storage fixes from the upload-pipeline audit.

-- 1) Owner-delete policy on the attachments bucket, scoped to the
--    {parentType}/{parentId}/ attachment paths.
--
--    The compensating cleanup after a failed attachments-row insert (and
--    deleteAttachment's storage remove) runs with the uploader's JWT. The
--    existing delete policy only covers admin/office, and Supabase Storage
--    reports RLS-filtered deletes as success-with-an-empty-list, so a field
--    user's remove() was a silent no-op — every failed upload+retry orphaned
--    an object, and an owner-deleted attachment row left its object behind.
--    This also aligns storage with the attachments-table delete policy,
--    which already allows created_by = auth.uid().
--
--    Deliberately NOT covered: swms/ (signature PNGs must survive the
--    signer), documents/ and whs-documents/ (controlled register, office
--    manages), public-submissions/ (SWMS register files).
create policy "attachments_delete_own" on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and owner_id = auth.uid()::text
    and (storage.foldername(name))[1] in (
      'job','project','quote','invoice','claim','po','vendor','diary',
      'variation','package','incident','form_submission','ncr'
    )
  );

-- 2) Backfill attachments.size where a server-side flow (subbie-SWMS accept)
--    inserted NULL — the UI renders the size and the accept flow now records
--    it for new rows.
update public.attachments a
set size = (o.metadata->>'size')::int
from storage.objects o
where a.size is null
  and o.bucket_id = a.bucket
  and o.name = a.path
  and (o.metadata->>'size') is not null;

-- ─── 0016_diary_audit.sql ────────────────────────────────────────────────
-- 0016_diary_audit.sql
-- Site diaries are contemporaneous ISO/legal records: every create AND edit must
-- be attributable and traceable. The diaries / diary_labour / diary_plant tables
-- carried no audit trigger, so saveProjectDiary/saveDiary could overwrite text
-- with no trace. This attaches the existing audit_whs() AFTER INSERT/UPDATE/DELETE
-- trigger (from 0010_whs.sql) to all three tables — same pattern as every other
-- audited table — writing who/when/what into the append-only audit_log.
--
-- No table columns or save-action behaviour change; the trigger is the fix.

create trigger diaries_audit
  after insert or update or delete on public.diaries
  for each row execute function audit_whs();

create trigger diary_labour_audit
  after insert or update or delete on public.diary_labour
  for each row execute function audit_whs();

create trigger diary_plant_audit
  after insert or update or delete on public.diary_plant
  for each row execute function audit_whs();

-- ─── 0017_claim_pct_precision.sql ────────────────────────────────────────
-- 0017_claim_pct_precision.sql
-- Widen claim_lines.pct_complete from numeric(6,2) to numeric(9,6).
--
-- pct_complete is the source of truth for a line's claimed-to-date figure
-- (claimed_to_date = round2(line_value * pct_complete / 100)). At 2 decimal
-- places a dollar amount entered on a large line round-trips to a different
-- dollar amount — e.g. on a $2,000,000 line, $1,499,900 → 75.00% → $1,500,000.
-- Six decimal places let the stored percentage reproduce the entered dollars:
-- $1,499,900 → 74.995000% → round2($1,499,900.00) exactly.
--
-- numeric(9,6): 3 integer digits (max value 100.000000) + 6 fractional digits.
-- This only widens the type — every existing 2dp value fits, so no data loss.
alter table claim_lines
  alter column pct_complete type numeric(9, 6);

-- ─── 0018_form_submission_schema.sql ─────────────────────────────────────
------------------------------------------------------------------------------
-- 0018  Form submission schema snapshots + robust document acknowledgements
------------------------------------------------------------------------------

------------------------------------------------------------------------------
-- 1. Snapshot the template schema onto each form submission (FIX I2)
------------------------------------------------------------------------------
-- Historical submissions stored only `template_version`, no schema copy, so
-- editing a template (which overwrites form_templates.schema in place) made
-- old records render against the wrong field set. Capture the schema at submit
-- time. Existing rows are backfilled best-effort from the template's CURRENT
-- schema — we cannot recover the true historical schema, but this freezes
-- today's state and stops future drift.

alter table form_submissions
  add column if not exists schema_snapshot jsonb;

update form_submissions s
   set schema_snapshot = t.schema
  from form_templates t
 where t.id = s.template_id
   and s.schema_snapshot is null;

------------------------------------------------------------------------------
-- 2. Make document acknowledgement matching robust (FIX I6 + SEC2)
------------------------------------------------------------------------------
-- Acks were matched by a recomputed chain ordinal (document_id, user_id,
-- version). Deleting a superseded predecessor shifted every successor's ordinal
-- and orphaned ack rows; the ordinal was also client-supplied (spoofable).
--
-- Each issued version is already its own documents row with its own id, and
-- document_acknowledgements.document_id points at that exact row — so the row
-- identity alone is a stable, un-spoofable key. Match acks by document_id only.
-- `version` becomes an informational (nullable) column, derived server-side.

-- One ack per user per issued document ROW (document_id pins the version).
alter table document_acknowledgements
  drop constraint if exists document_acknowledgements_document_id_user_id_version_key;

alter table document_acknowledgements
  alter column version drop not null;

-- Guard against duplicate acks now that version no longer participates in the key.
create unique index if not exists document_acknowledgements_document_user_key
  on document_acknowledgements (document_id, user_id);

-- ─── 0019_attachment_read_scope.sql ──────────────────────────────────────
-- 0019: tighten attachment read scope (SEC1).
--
-- Both the attachments TABLE select and the 'attachments' storage-bucket
-- select were blanket any-authenticated. Money parents (quote/invoice/claim/
-- po) are never written by field flows today, but scope reads defensively:
--
--   * admin/office        → everything (unchanged)
--   * supervisor/field    → only the operational parent set
--                           (job, project, diary, incident, form_submission,
--                            ncr); vendor/variation/package/quote/invoice/
--                            claim/po rows become office-only.
--
-- Storage mirrors the same split by top-level folder. Field additionally
-- needs 'swms' (signature PNGs rendered into ops PDFs under the requester's
-- JWT) and 'whs-documents' (issued safety documents listed on /field/safety).
-- Insert/delete policies are deliberately untouched (see 0005/0015).

------------------------------------------------------------------------------
-- 1. attachments table: replace the blanket select policy
------------------------------------------------------------------------------

drop policy if exists attachments_select_authenticated on public.attachments;

create policy attachments_select_scoped on public.attachments
  for select to authenticated
  using (
    current_app_role() in ('admin','office')
    or parent_type in (
      'job','project','diary','incident','form_submission','ncr'
    )
  );

------------------------------------------------------------------------------
-- 2. storage 'attachments' bucket: replace the blanket select policy
------------------------------------------------------------------------------

drop policy if exists "attachments_select_authenticated" on storage.objects;

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
    )
  );

-- ─── 0020_internal_audit.sql ─────────────────────────────────────────────
-- 0020_internal_audit.sql
-- Internal Audit Programme — ISO 9001/14001/45001 §9.2. Plan a year of audits
-- (the programme), conduct each against an ISO-aligned checklist (reusing the
-- forms engine: checklist = form_templates row with kind 'audit', conduct =
-- immutable form_submissions row with schema snapshot), record classified
-- findings, escalate nonconformances to the NCR/CAPA register, and track
-- findings to closure.
--
-- Conventions follow 0014_ncr_capa.sql: current_app_role() RLS, audit_whs()
-- AFTER triggers, next_number('audit') sequence, append-only audit_log.
--
-- Locked decisions implemented here:
--   * NCR linkage lives on audit_findings.ncr_id (real FK — both tables now
--     exist, so the Phase-1 "nullable-no-FK on ncrs" plan is superseded by a
--     single canonical FK on the finding; no mirror column on ncrs, so there
--     is exactly one source of truth for the major-NC close gate).
--   * RLS: admin/office full CRUD; supervisor SELECT everything and may
--     UPDATE audits (and record findings) where they are the named auditor;
--     field has NO access to any audit table (SELECT included).
--   * Close gates (major_nc needs a CLOSED linked NCR; an audit cannot close
--     with open findings; complete requires a conducted checklist) are
--     enforced in the server actions — same pattern as the NCR close gate.
--   * form_submissions has no UPDATE policy for anyone, so a conducted
--     checklist is immutable by construction; completing the audit stops any
--     re-conduct (the action only allows planned/in_progress).

------------------------------------------------------------------------------
-- 1. Forms engine: allow 'audit' checklist templates + submissions
------------------------------------------------------------------------------

alter table form_templates drop constraint form_templates_kind_check;
alter table form_templates add constraint form_templates_kind_check
  check (kind in ('prestart','take5','toolbox','induction','incident','custom','audit'));

alter table form_submissions drop constraint form_submissions_kind_check;
alter table form_submissions add constraint form_submissions_kind_check
  check (kind in ('prestart','take5','toolbox','induction','incident','custom','audit'));

------------------------------------------------------------------------------
-- 2. Tables
------------------------------------------------------------------------------

create table audit_programmes (
  id uuid primary key default gen_random_uuid(),
  year text not null,                   -- e.g. 'FY2026-27'
  title text not null,
  status text not null default 'draft' check (status in ('draft','active','closed')),
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index audit_programmes_status_idx on audit_programmes (status);

-- The auditable-process list (what gets audited).
create table audit_areas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table audits (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,          -- AUD-0001 via next_number('audit')
  programme_id uuid not null references audit_programmes(id),
  area_id uuid not null references audit_areas(id),
  -- Standards covered — any subset of the three certified standards.
  standards text[] not null default '{}'
    check (standards <@ array['9001','14001','45001']::text[]),
  auditor_id uuid references profiles(id),
  auditee text,                         -- person/function being audited
  planned_date date,
  conducted_date date,
  status text not null default 'planned'
    check (status in ('planned','in_progress','complete','closed')),
  checklist_template_id uuid references form_templates(id),
  checklist_submission_id uuid references form_submissions(id),
  summary text,                         -- close-out summary for the report
  created_by uuid references profiles(id),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index audits_programme_idx on audits (programme_id);
create index audits_area_idx on audits (area_id);
create index audits_status_idx on audits (status);
create index audits_auditor_idx on audits (auditor_id);
create index audits_checklist_submission_idx on audits (checklist_submission_id);

create table audit_findings (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits(id) on delete cascade,
  classification text not null check (classification in (
    'observation','minor_nc','major_nc','opportunity'
  )),
  description text not null,
  clause_ref text,                      -- e.g. '9001 8.5.1'
  status text not null default 'open' check (status in ('open','closed')),
  -- Escalation link: a major_nc CANNOT be closed until this NCR exists and is
  -- itself closed (NCR close already carries the verification-of-effectiveness
  -- gate). Enforced in the server action.
  ncr_id uuid references ncrs(id) on delete set null,
  raised_by uuid references profiles(id),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index audit_findings_audit_idx on audit_findings (audit_id);
create index audit_findings_status_idx on audit_findings (status);
create index audit_findings_ncr_idx on audit_findings (ncr_id);

------------------------------------------------------------------------------
-- 3. RLS (staff read; admin/office manage; supervisor conducts own audits;
--    field NO access)
------------------------------------------------------------------------------

alter table audit_programmes enable row level security;
alter table audit_areas      enable row level security;
alter table audits           enable row level security;
alter table audit_findings   enable row level security;

-- audit_programmes
create policy audit_programmes_select_staff on audit_programmes
  for select to authenticated
  using (current_app_role() in ('admin','office','supervisor'));
create policy audit_programmes_insert_admin_office on audit_programmes
  for insert to authenticated
  with check (current_app_role() in ('admin','office'));
create policy audit_programmes_update_admin_office on audit_programmes
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy audit_programmes_delete_admin on audit_programmes
  for delete to authenticated using (current_app_role() = 'admin');

-- audit_areas
create policy audit_areas_select_staff on audit_areas
  for select to authenticated
  using (current_app_role() in ('admin','office','supervisor'));
create policy audit_areas_insert_admin_office on audit_areas
  for insert to authenticated
  with check (current_app_role() in ('admin','office'));
create policy audit_areas_update_admin_office on audit_areas
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy audit_areas_delete_admin on audit_areas
  for delete to authenticated using (current_app_role() = 'admin');

-- audits: supervisors may update ONLY audits where they are the auditor.
create policy audits_select_staff on audits
  for select to authenticated
  using (current_app_role() in ('admin','office','supervisor'));
create policy audits_insert_admin_office on audits
  for insert to authenticated
  with check (current_app_role() in ('admin','office'));
create policy audits_update_staff_or_auditor on audits
  for update to authenticated
  using (
    current_app_role() in ('admin','office')
    or (current_app_role() = 'supervisor' and auditor_id = auth.uid())
  )
  with check (
    current_app_role() in ('admin','office')
    or (current_app_role() = 'supervisor' and auditor_id = auth.uid())
  );
create policy audits_delete_admin on audits
  for delete to authenticated using (current_app_role() = 'admin');

-- audit_findings: supervisors may record/update findings only on audits they
-- are the named auditor for.
create policy audit_findings_select_staff on audit_findings
  for select to authenticated
  using (current_app_role() in ('admin','office','supervisor'));
create policy audit_findings_insert_staff_or_auditor on audit_findings
  for insert to authenticated
  with check (
    current_app_role() in ('admin','office')
    or (current_app_role() = 'supervisor' and exists (
      select 1 from audits a where a.id = audit_id and a.auditor_id = auth.uid()
    ))
  );
create policy audit_findings_update_staff_or_auditor on audit_findings
  for update to authenticated
  using (
    current_app_role() in ('admin','office')
    or (current_app_role() = 'supervisor' and exists (
      select 1 from audits a where a.id = audit_id and a.auditor_id = auth.uid()
    ))
  )
  with check (
    current_app_role() in ('admin','office')
    or (current_app_role() = 'supervisor' and exists (
      select 1 from audits a where a.id = audit_id and a.auditor_id = auth.uid()
    ))
  );
create policy audit_findings_delete_admin on audit_findings
  for delete to authenticated using (current_app_role() = 'admin');

------------------------------------------------------------------------------
-- 4. Audit triggers (reuse audit_whs() from 0010_whs.sql — immutable trail)
------------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'audit_programmes','audit_areas','audits','audit_findings'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function audit_whs()',
      t || '_audit', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 5. Sequence: audit numbering (AUD-0001 via next_number('audit'))
------------------------------------------------------------------------------

-- Starts at 3 — the two seeded audits below consume AUD-0001 / AUD-0002.
insert into sequences (key, next_value) values ('audit', 3)
on conflict (key) do nothing;

------------------------------------------------------------------------------
-- 6. Seed — ISO starter content (idempotent, stable UUIDs, Rev A flagged)
------------------------------------------------------------------------------

-- 6.1 Auditable process areas for a civil/remediation contractor.
insert into audit_areas (id, name, description) values
  ('aa000000-0000-4000-a000-000000000001', 'Quoting & Estimating',
   'Tender review, estimating, quote approval and handover to delivery (9001 8.2).'),
  ('aa000000-0000-4000-a000-000000000002', 'Project Delivery',
   'Project planning, programme, claims, variations and client communication (9001 8.1/8.5).'),
  ('aa000000-0000-4000-a000-000000000003', 'Procurement & Subcontractors',
   'Purchasing, subcontractor engagement, SWMS review and vendor compliance (9001 8.4).'),
  ('aa000000-0000-4000-a000-000000000004', 'Site Operations & Plant',
   'Site execution, plant pre-starts, inspections and daily records (9001 8.5, 45001 8.1).'),
  ('aa000000-0000-4000-a000-000000000005', 'WHS Management',
   'Hazard identification, SWMS, incident reporting, corrective actions and consultation (45001).'),
  ('aa000000-0000-4000-a000-000000000006', 'Environmental Controls',
   'Erosion & sediment control, waste/spoil tracking, dust/noise/water controls (14001 8.1).'),
  ('aa000000-0000-4000-a000-000000000007', 'Document & Records Control',
   'Controlled documents, versioning, distribution/acknowledgement and records retention (7.5).'),
  ('aa000000-0000-4000-a000-000000000008', 'Management & Improvement',
   'Objectives, management review, NCR/CAPA trends and continual improvement (9.3, 10).')
on conflict do nothing;

-- 6.2 ISO-aligned checklist templates (kind 'audit'). Rev A — review before
-- adoption. Each check item is a select with a common conformance scale.
insert into form_templates (id, kind, name, description, schema, version, active, requires_signon) values
  ('ad000000-0000-4000-a000-000000000001', 'audit', 'ISO 9001 QMS Internal Audit',
   'Quality management system audit checklist aligned to ISO 9001:2015 clauses. Rev A — review before adoption.',
   '[
     {"key":"context_4_1","label":"4.1/4.2 Context & interested parties determined and kept under review","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"leadership_5","label":"5.1/5.2 Quality policy issued, communicated and understood","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"risk_6_1","label":"6.1 Risks & opportunities identified with actions planned","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"objectives_6_2","label":"6.2 Quality objectives set, measured and tracked","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"competence_7_2","label":"7.2 Competence records current for the roles sampled","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"doc_control_7_5","label":"7.5 Documented information controlled — current versions in use","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"customer_8_2","label":"8.2 Customer requirements determined and reviewed (quotes/contracts)","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"suppliers_8_4","label":"8.4 External providers evaluated; purchased items verified","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"production_8_5","label":"8.5 Production/service provision controlled with records (ITP/inspections)","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"nonconforming_8_7","label":"8.7 Nonconforming outputs identified, segregated and dispositioned","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"monitoring_9_1","label":"9.1 Performance monitored — KPIs and customer feedback reviewed","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"improvement_10_2","label":"10.2 NCRs raised, root-caused, actioned and verified effective","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"evidence","label":"Objective evidence reviewed (records, samples, personnel interviewed)","type":"textarea","required":false},
     {"key":"auditor_notes","label":"Auditor notes","type":"textarea","required":false}
   ]'::jsonb, 1, true, false),
  ('ad000000-0000-4000-a000-000000000002', 'audit', 'ISO 14001 Environmental Internal Audit',
   'Environmental management system audit checklist aligned to ISO 14001:2015 clauses. Rev A — review before adoption.',
   '[
     {"key":"aspects_6_1_2","label":"6.1.2 Environmental aspects & impacts identified; significant aspects controlled","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"obligations_6_1_3","label":"6.1.3 Compliance obligations (EPA, POEO, permits) identified and current","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"objectives_6_2","label":"6.2 Environmental objectives set with programmes to achieve them","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"competence_7_2","label":"7.2/7.3 Environmental competence & awareness demonstrated on site","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"op_control_8_1","label":"8.1 Operational controls — ESC devices, dust/noise/water controls in place and maintained","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"waste_8_1","label":"8.1 Waste/spoil classified, tracked and receipted to licensed facilities","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"emergency_8_2","label":"8.2 Emergency preparedness — spill kits, response plan, drills","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"monitoring_9_1_1","label":"9.1.1 Environmental monitoring performed and records retained","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"compliance_eval_9_1_2","label":"9.1.2 Compliance evaluated against obligations at planned intervals","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"nc_10_2","label":"10.2 Environmental nonconformities and incidents actioned to verified close","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"evidence","label":"Objective evidence reviewed (records, samples, personnel interviewed)","type":"textarea","required":false},
     {"key":"auditor_notes","label":"Auditor notes","type":"textarea","required":false}
   ]'::jsonb, 1, true, false),
  ('ad000000-0000-4000-a000-000000000003', 'audit', 'ISO 45001 OHS Internal Audit',
   'Occupational health & safety management system audit checklist aligned to ISO 45001:2018 clauses. Rev A — review before adoption.',
   '[
     {"key":"consultation_5_4","label":"5.4 Consultation & participation — toolbox talks, worker input recorded","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"hazards_6_1_2","label":"6.1.2 Hazard identification current — SWMS in place for high-risk work","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"legal_6_1_3","label":"6.1.3 WHS legal requirements (Act/Reg/Codes) identified and applied","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"competence_7_2","label":"7.2 Licences, tickets and VOCs current for workers sampled","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"op_control_8_1","label":"8.1 Operational controls — plant pre-starts, exclusion zones, PPE","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"contractors_8_1_4","label":"8.1.4 Contractor SWMS reviewed and accepted before work commenced","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"emergency_8_2","label":"8.2 Emergency plan, assembly point, first aid resources in place","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"incidents_10_2","label":"10.2 Incidents reported, investigated and corrective actions verified","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"monitoring_9_1","label":"9.1 Site inspections & sign-ons performed and recorded","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"evidence","label":"Objective evidence reviewed (records, samples, personnel interviewed)","type":"textarea","required":false},
     {"key":"auditor_notes","label":"Auditor notes","type":"textarea","required":false}
   ]'::jsonb, 1, true, false),
  ('ad000000-0000-4000-a000-000000000004', 'audit', 'Integrated Site Audit',
   'Combined QHSE site audit covering 9001/14001/45001 field controls. Rev A — review before adoption.',
   '[
     {"key":"induction_signon","label":"All persons on site inducted and signed on (45001 7.2/8.1)","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"swms_current","label":"SWMS current, site-specific and signed by the crew (45001 8.1)","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"prestarts","label":"Plant pre-starts completed each shift; defects tagged out (45001 8.1)","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"housekeeping","label":"Housekeeping, access/egress and exclusion zones maintained (45001 8.1)","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"env_controls","label":"Erosion/sediment and dust controls installed and maintained (14001 8.1)","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"waste_dockets","label":"Waste/spoil loads docketed to licensed facilities (14001 8.1)","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"quality_records","label":"Work inspected to spec — inspection/test records available (9001 8.5/8.6)","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"materials","label":"Materials conforming, identified and stored correctly (9001 8.5.4)","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"docs_on_site","label":"Current issued documents/drawings in use on site (7.5)","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"emergency","label":"Emergency plan displayed; first aid and spill kits stocked (45001/14001 8.2)","type":"select","options":["Conforming","Minor NC","Major NC","Observation","N/A"],"required":true},
     {"key":"evidence","label":"Objective evidence reviewed (records, samples, personnel interviewed)","type":"textarea","required":false},
     {"key":"auditor_notes","label":"Auditor notes","type":"textarea","required":false}
   ]'::jsonb, 1, true, false)
on conflict do nothing;

-- 6.3 Active FY2026-27 programme with two planned audits.
insert into audit_programmes (id, year, title, status, notes) values
  ('a9000000-0000-4000-a000-000000000001', 'FY2026-27',
   'FY2026-27 Internal Audit Programme', 'active',
   'Rev A — review before adoption. One audit per key process across the year; integrated site audits each half.')
on conflict do nothing;

insert into audits
  (id, number, programme_id, area_id, standards, auditee, planned_date, status, checklist_template_id)
values
  ('a0000000-0000-4000-a000-000000000001', 'AUD-0001',
   'a9000000-0000-4000-a000-000000000001', 'aa000000-0000-4000-a000-000000000001',
   array['9001']::text[], 'Estimating team', '2026-08-14', 'planned',
   'ad000000-0000-4000-a000-000000000001'),
  ('a0000000-0000-4000-a000-000000000002', 'AUD-0002',
   'a9000000-0000-4000-a000-000000000001', 'aa000000-0000-4000-a000-000000000004',
   array['9001','14001','45001']::text[], 'Site supervisor', '2026-10-16', 'planned',
   'ad000000-0000-4000-a000-000000000004')
on conflict do nothing;

-- ─── 0021_training_competency.sql ────────────────────────────────────────
-- 0021_training_competency.sql
-- Training & Competency Register — ISO 9001 7.2/7.1.2, 14001 7.2, 45001 7.2/
-- 7.3/8.1. A per-person register of licences, tickets, VOCs, inductions and
-- courses with issuer/dates/evidence. Records drive a derived expiry traffic
-- light (current / expiring ≤30d / expired — computed at read time in
-- Australia/Brisbane, no cron, no stored status column), a workers × required-
-- types competency matrix, and a role→required-competency map that the
-- schedule's assignment flow warns from (non-blocking).
--
-- Conventions follow 0020_internal_audit.sql: current_app_role() RLS,
-- audit_whs() AFTER triggers, next_number('competency') sequence, append-only
-- audit_log.
--
-- Locked decisions implemented here:
--   * Privacy: field workers see ONLY their own records (worker.profile_id =
--     auth.uid()), like form_signons' self-or-staff shape. Admin/office full;
--     supervisor SELECT all + INSERT records; no field writes; deletes admin.
--   * Worker identity: one workers row per profile (backfilled here for ALL
--     existing profiles with the profile's active flag mirrored, so history
--     survives deactivation) + a trigger so future profile inserts/renames/
--     de-activations keep the worker in sync. Subbie individuals are workers
--     with profile_id NULL and a company name.
--   * De-dup: the latest non-superseded record per (worker, type) drives the
--     light. Recording a new one supersedes the previous via the
--     supersede_competency_records() RPC below (SECURITY DEFINER with an
--     internal role check, so supervisors — who have INSERT but not UPDATE —
--     can still trigger the automatic supersede from the server action).
--   * Requirements are ROLE-level only (task-level is out of scope).
--   * Evidence: inline evidence_path on the record (private 'attachments'
--     bucket, 'competency/' key prefix, signed URLs). The storage SELECT
--     policy is extended so supervisors read all competency evidence and
--     field users read only objects referenced by their own records.

------------------------------------------------------------------------------
-- 1. Tables
------------------------------------------------------------------------------

-- A person whose competencies we track: links to a staff profile OR stands
-- alone as a subcontractor individual (company set, profile_id null).
create table workers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references profiles(id) on delete set null,
  name text not null,
  company text,                          -- null = direct employee
  role text not null default 'field'
    check (role in ('admin','office','supervisor','field')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index workers_active_idx on workers (active);

create table competency_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null check (category in
    ('licence','ticket','voc','induction','course','medical')),
  -- Default validity used to prefill expiry when recording; null = no expiry.
  validity_months int check (validity_months is null or validity_months > 0),
  is_system boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table competency_records (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,           -- CMP-0001 via next_number('competency')
  worker_id uuid not null references workers(id) on delete cascade,
  competency_type_id uuid not null references competency_types(id),
  issuer text,                           -- RTO / issuing authority
  reference_no text,                     -- licence/card/certificate number
  issue_date date not null,
  expiry_date date check (expiry_date is null or expiry_date >= issue_date),
  -- Inline evidence (documents-register pattern): browser uploads to the
  -- private 'attachments' bucket under competency/ first, row records after.
  evidence_path text check (
    evidence_path is null
    or (evidence_path like 'competency/%' and position('..' in evidence_path) = 0)
  ),
  evidence_filename text,
  -- Set automatically when a newer record of the same (worker, type) lands.
  -- The latest NON-superseded record per (worker, type) drives the light.
  superseded_by uuid references competency_records(id) on delete set null
    check (superseded_by is null or superseded_by <> id),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index competency_records_worker_idx on competency_records (worker_id);
create index competency_records_type_idx on competency_records (competency_type_id);
create index competency_records_superseded_idx on competency_records (superseded_by);
create index competency_records_expiry_idx on competency_records (expiry_date);

-- Role → required competency map (role-level only; task-level out of scope).
create table role_competency_requirements (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('admin','office','supervisor','field')),
  competency_type_id uuid not null references competency_types(id) on delete cascade,
  is_mandatory boolean not null default true,
  created_at timestamptz not null default now(),
  unique (role, competency_type_id)
);

------------------------------------------------------------------------------
-- 2. RLS
------------------------------------------------------------------------------

alter table workers                      enable row level security;
alter table competency_types             enable row level security;
alter table competency_records           enable row level security;
alter table role_competency_requirements enable row level security;

-- workers: staff see all; field sees only their own row. Admin/office manage.
create policy workers_select_staff_or_self on workers
  for select to authenticated
  using (
    current_app_role() in ('admin','office','supervisor')
    or profile_id = auth.uid()
  );
create policy workers_insert_admin_office on workers
  for insert to authenticated
  with check (current_app_role() in ('admin','office'));
create policy workers_update_admin_office on workers
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy workers_delete_admin on workers
  for delete to authenticated using (current_app_role() = 'admin');

-- competency_types: readable by anyone signed in (field needs the type names
-- for their own tickets); managed by admin/office.
create policy competency_types_select_authenticated on competency_types
  for select to authenticated using (auth.uid() is not null);
create policy competency_types_insert_admin_office on competency_types
  for insert to authenticated
  with check (current_app_role() in ('admin','office'));
create policy competency_types_update_admin_office on competency_types
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy competency_types_delete_admin on competency_types
  for delete to authenticated using (current_app_role() = 'admin');

-- competency_records: PRIVACY — field sees own only (self-or-staff, like
-- form_signons). Supervisor may record new tickets; updates are admin/office
-- (the automatic supersede runs through the RPC below); deletes admin.
create policy competency_records_select_staff_or_own on competency_records
  for select to authenticated
  using (
    current_app_role() in ('admin','office','supervisor')
    or exists (
      select 1 from workers w
      where w.id = worker_id and w.profile_id = auth.uid()
    )
  );
create policy competency_records_insert_staff on competency_records
  for insert to authenticated
  with check (current_app_role() in ('admin','office','supervisor'));
create policy competency_records_update_admin_office on competency_records
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy competency_records_delete_admin on competency_records
  for delete to authenticated using (current_app_role() = 'admin');

-- role_competency_requirements: staff read; admin/office manage; delete admin
-- (Settings is admin-gated anyway).
create policy role_requirements_select_staff on role_competency_requirements
  for select to authenticated
  using (current_app_role() in ('admin','office','supervisor'));
create policy role_requirements_insert_admin_office on role_competency_requirements
  for insert to authenticated
  with check (current_app_role() in ('admin','office'));
create policy role_requirements_update_admin_office on role_competency_requirements
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy role_requirements_delete_admin on role_competency_requirements
  for delete to authenticated using (current_app_role() = 'admin');

------------------------------------------------------------------------------
-- 3. Audit triggers (reuse audit_whs() from 0010_whs.sql — immutable trail)
------------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'workers','competency_types','competency_records','role_competency_requirements'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function audit_whs()',
      t || '_audit', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 4. Automatic supersede RPC (SECURITY DEFINER — supervisors have INSERT but
--    not UPDATE, so the server action calls this after inserting the newer
--    record; the flip is still audited via the competency_records trigger)
------------------------------------------------------------------------------

create or replace function supersede_competency_records(
  p_worker uuid, p_type uuid, p_new uuid
) returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if current_app_role() not in ('admin','office','supervisor') then
    raise exception 'Not allowed';
  end if;
  -- The replacement must exist and match the (worker, type) pair.
  if not exists (
    select 1 from competency_records
    where id = p_new and worker_id = p_worker and competency_type_id = p_type
  ) then
    raise exception 'Replacement record mismatch';
  end if;
  update competency_records
     set superseded_by = p_new
   where worker_id = p_worker
     and competency_type_id = p_type
     and id <> p_new
     and superseded_by is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function supersede_competency_records(uuid, uuid, uuid)
  from anon, public;

------------------------------------------------------------------------------
-- 5. Worker sync from profiles: backfill + trigger (roadmap: trigger+backfill)
------------------------------------------------------------------------------

-- Backfill a worker per existing profile (active flag mirrored so the matrix
-- shows current staff while historical records keep a valid worker).
insert into workers (profile_id, name, role, active)
select id, full_name, role, active from profiles
on conflict (profile_id) do nothing;

create or replace function sync_worker_from_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into workers (profile_id, name, role, active)
    values (new.id, new.full_name, new.role, new.active)
    on conflict (profile_id) do nothing;
  else
    -- Keep name/active in sync; role is NOT synced (the register may hold a
    -- deliberate trade/role override for matrix requirements).
    update workers set name = new.full_name, active = new.active
    where profile_id = new.id;
    if not found then
      insert into workers (profile_id, name, role, active)
      values (new.id, new.full_name, new.role, new.active)
      on conflict (profile_id) do nothing;
    end if;
  end if;
  return new;
end $$;

revoke execute on function sync_worker_from_profile() from anon, authenticated, public;

create trigger profiles_sync_worker
  after insert or update of full_name, active on profiles
  for each row execute function sync_worker_from_profile();

------------------------------------------------------------------------------
-- 6. Storage: competency evidence read scope
--    (insert stays bucket-wide authenticated per 0005 — office/supervisor
--    upload; field has no UI path and no record-insert rights anyway)
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
    )
  );

------------------------------------------------------------------------------
-- 7. Sequence: competency numbering (CMP-0001 via next_number('competency'))
------------------------------------------------------------------------------

insert into sequences (key, next_value) values ('competency', 1)
on conflict (key) do nothing;

------------------------------------------------------------------------------
-- 8. Seed — AU/ISO starter competency types (idempotent, stable UUIDs,
--    is_system, Rev A — review validity periods before adoption)
------------------------------------------------------------------------------

insert into competency_types (id, name, category, validity_months, is_system) values
  ('c0000000-0000-4000-a000-000000000001', 'White Card (General Construction Induction)', 'induction', null, true),
  ('c0000000-0000-4000-a000-000000000002', 'Site Induction (company)',                    'induction', 12,   true),
  ('c0000000-0000-4000-a000-000000000003', 'Working at Heights',                          'ticket',    24,   true),
  ('c0000000-0000-4000-a000-000000000004', 'Confined Space Entry',                        'ticket',    24,   true),
  ('c0000000-0000-4000-a000-000000000005', 'EWP <11m (Yellow Card)',                      'ticket',    60,   true),
  ('c0000000-0000-4000-a000-000000000006', 'Traffic Control',                             'ticket',    36,   true),
  ('c0000000-0000-4000-a000-000000000007', 'Traffic Management Implementation',           'ticket',    36,   true),
  ('c0000000-0000-4000-a000-000000000008', 'Asbestos Awareness',                          'course',    24,   true),
  ('c0000000-0000-4000-a000-000000000009', 'Asbestos Removal — Class A',                  'licence',   36,   true),
  ('c0000000-0000-4000-a000-00000000000a', 'Asbestos Removal — Class B',                  'licence',   36,   true),
  ('c0000000-0000-4000-a000-00000000000b', 'First Aid (HLTAID011)',                       'course',    36,   true),
  ('c0000000-0000-4000-a000-00000000000c', 'CPR (HLTAID009)',                             'course',    12,   true),
  ('c0000000-0000-4000-a000-00000000000d', 'HRWL — Dogging (DG)',                         'licence',   60,   true),
  ('c0000000-0000-4000-a000-00000000000e', 'HRWL — Rigging Basic (RB)',                   'licence',   60,   true),
  ('c0000000-0000-4000-a000-00000000000f', 'HRWL — Scaffolding Basic (SB)',               'licence',   60,   true),
  ('c0000000-0000-4000-a000-000000000010', 'HRWL — Forklift (LF)',                        'licence',   60,   true),
  ('c0000000-0000-4000-a000-000000000011', 'Driver Licence — Class C',                    'licence',   60,   true),
  ('c0000000-0000-4000-a000-000000000012', 'Driver Licence — MR/HR',                      'licence',   60,   true),
  ('c0000000-0000-4000-a000-000000000013', 'Plant VOC — Excavator',                       'voc',       24,   true)
on conflict do nothing;

-- Baseline role requirements: everyone needs the company site induction;
-- field additionally the White Card; supervisors additionally First Aid.
insert into role_competency_requirements (id, role, competency_type_id, is_mandatory) values
  ('cf000000-0000-4000-a000-000000000001', 'field',      'c0000000-0000-4000-a000-000000000001', true), -- White Card
  ('cf000000-0000-4000-a000-000000000002', 'field',      'c0000000-0000-4000-a000-000000000002', true), -- Site Induction
  ('cf000000-0000-4000-a000-000000000003', 'supervisor', 'c0000000-0000-4000-a000-000000000001', true), -- White Card
  ('cf000000-0000-4000-a000-000000000004', 'supervisor', 'c0000000-0000-4000-a000-000000000002', true), -- Site Induction
  ('cf000000-0000-4000-a000-000000000005', 'supervisor', 'c0000000-0000-4000-a000-00000000000b', true), -- First Aid
  ('cf000000-0000-4000-a000-000000000006', 'office',     'c0000000-0000-4000-a000-000000000002', true), -- Site Induction
  ('cf000000-0000-4000-a000-000000000007', 'admin',      'c0000000-0000-4000-a000-000000000002', true), -- Site Induction
  ('cf000000-0000-4000-a000-000000000008', 'field',      'c0000000-0000-4000-a000-00000000000b', false) -- First Aid (desirable)
on conflict do nothing;

-- ─── 0022_risk_register.sql ──────────────────────────────────────────────
-- 0022_risk_register.sql
-- Risk & Opportunity Register — ISO 9001 6.1 + 4.1/4.2, 14001 6.1.1–6.1.4,
-- 45001 6.1.1–6.1.4. A management-system AND project-level register of risks
-- and opportunities: each item carries context/source + ISO domain, is rated
-- through a FIXED standard 5×5 likelihood×consequence matrix into inherent and
-- residual ratings, lists existing controls + treatment actions, and carries
-- owner/review-date/lifecycle. Company-scoped (project_id null) or
-- project-scoped ("Risk" tab on projects). Distinct from SWMS task-level
-- hazard analysis.
--
-- Conventions follow 0021_training_competency.sql / 0020_internal_audit.sql:
-- current_app_role() RLS, audit_whs() AFTER triggers, next_number('risk')
-- sequence, append-only audit_log.
--
-- Locked decisions implemented here:
--   * FIXED standard 5×5 matrix, enforced in the database: risk_rating(score)
--     is a single IMMUTABLE SQL function (1-4 Low, 5-9 Medium, 10-16 High,
--     17-25 Extreme) and scores/ratings are GENERATED columns. NOT
--     admin-configurable — historic ratings can never silently change. The
--     same bands are mirrored in ONE TypeScript const (src/lib/risk.ts) with
--     a vitest asserting the two stay in agreement.
--   * RLS: admin/office full CRUD; supervisor SELECT everything + INSERT
--     risk_items (raise risks) + UPDATE risk_treatments assigned to them
--     (mark their own treatment done); field NO access; deletes admin-only.
--   * Close gates (an item cannot close with open treatments; a RISK cannot
--     close without residual likelihood/consequence recorded — evidence the
--     treatment worked; opportunities are exempt from residual scoring) are
--     enforced in the server actions — same pattern as the NCR close gate.
--   * Treatments are standalone in v1 — promotion to CAPA (a
--     corrective_action_id / system-parent link) is a deliberate later
--     enhancement, noted in the roadmap §4.5.

------------------------------------------------------------------------------
-- 1. Rating function — the single source of truth for the 5×5 bands
------------------------------------------------------------------------------

-- IMMUTABLE + STRICT (null score → null rating, so unscored residuals stay
-- null). Generated columns below depend on this; altering the bands would
-- rewrite history, which is exactly what this design forbids.
create function risk_rating(score int) returns text
language sql immutable strict as $$
  select case
    when score between 1  and 4  then 'Low'
    when score between 5  and 9  then 'Medium'
    when score between 10 and 16 then 'High'
    when score between 17 and 25 then 'Extreme'
  end
$$;

revoke execute on function risk_rating(int) from anon, public;

------------------------------------------------------------------------------
-- 2. Tables
------------------------------------------------------------------------------

create table risk_items (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,           -- RO-0001 via next_number('risk')
  kind text not null default 'risk' check (kind in ('risk','opportunity')),
  title text not null,
  context text,                          -- description / context of the item
  source text not null default 'other' check (source in (
    'context_analysis','interested_party','legal','incident','audit',
    'process','project','other'
  )),
  iso_domain text not null check (iso_domain in (
    'quality','environmental','ohs','multi'
  )),
  -- Scope: company-wide (null) or project-scoped. set null preserves the ISO
  -- record if a project row is ever removed.
  project_id uuid references projects(id) on delete set null,
  category text,                         -- from the seeded const list (TS)
  existing_controls text,
  -- Inherent rating (before treatment) — always scored.
  likelihood smallint not null check (likelihood between 1 and 5),
  consequence smallint not null check (consequence between 1 and 5),
  inherent_score smallint generated always as (likelihood * consequence) stored,
  inherent_rating text generated always as
    (risk_rating(likelihood * consequence)) stored,
  -- Residual rating (after treatment) — scored both-or-neither; required
  -- before a RISK may close (gate in the server action).
  residual_likelihood smallint
    check (residual_likelihood between 1 and 5),
  residual_consequence smallint
    check (residual_consequence between 1 and 5),
  residual_score smallint generated always as
    (residual_likelihood * residual_consequence) stored,
  residual_rating text generated always as
    (risk_rating(residual_likelihood * residual_consequence)) stored,
  check ((residual_likelihood is null) = (residual_consequence is null)),
  owner_id uuid references profiles(id),
  review_date date,
  status text not null default 'open' check (status in (
    'open','treating','accepted','closed'
  )),
  created_by uuid references profiles(id),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index risk_items_project_idx on risk_items (project_id);
create index risk_items_status_idx on risk_items (status);
create index risk_items_kind_idx on risk_items (kind);
create index risk_items_review_idx on risk_items (review_date);

create table risk_treatments (
  id uuid primary key default gen_random_uuid(),
  risk_item_id uuid not null references risk_items(id) on delete cascade,
  description text not null,
  assigned_to uuid references profiles(id),
  due_date date,
  status text not null default 'open' check (status in ('open','done')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index risk_treatments_item_idx on risk_treatments (risk_item_id);
create index risk_treatments_status_idx on risk_treatments (status);
create index risk_treatments_assigned_idx on risk_treatments (assigned_to);

------------------------------------------------------------------------------
-- 3. RLS (staff read; admin/office manage; supervisor raises risks and
--    completes treatments assigned to them; field NO access)
------------------------------------------------------------------------------

alter table risk_items      enable row level security;
alter table risk_treatments enable row level security;

-- risk_items
create policy risk_items_select_staff on risk_items
  for select to authenticated
  using (current_app_role() in ('admin','office','supervisor'));
create policy risk_items_insert_staff on risk_items
  for insert to authenticated
  with check (current_app_role() in ('admin','office','supervisor'));
create policy risk_items_update_admin_office on risk_items
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy risk_items_delete_admin on risk_items
  for delete to authenticated using (current_app_role() = 'admin');

-- risk_treatments: supervisors may update ONLY treatments assigned to them
-- (mark done / add completion notes via the server action).
create policy risk_treatments_select_staff on risk_treatments
  for select to authenticated
  using (current_app_role() in ('admin','office','supervisor'));
create policy risk_treatments_insert_admin_office on risk_treatments
  for insert to authenticated
  with check (current_app_role() in ('admin','office'));
create policy risk_treatments_update_staff_or_assignee on risk_treatments
  for update to authenticated
  using (
    current_app_role() in ('admin','office')
    or (current_app_role() = 'supervisor' and assigned_to = auth.uid())
  )
  with check (
    current_app_role() in ('admin','office')
    or (current_app_role() = 'supervisor' and assigned_to = auth.uid())
  );
create policy risk_treatments_delete_admin on risk_treatments
  for delete to authenticated using (current_app_role() = 'admin');

------------------------------------------------------------------------------
-- 4. Audit triggers (reuse audit_whs() from 0010_whs.sql — immutable trail)
------------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['risk_items','risk_treatments'] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function audit_whs()',
      t || '_audit', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 5. Sequence: risk numbering (RO-0001 via next_number('risk'))
------------------------------------------------------------------------------

-- Starts at 12 — the eleven seeded items below consume RO-0001…RO-0011.
insert into sequences (key, next_value) values ('risk', 12)
on conflict (key) do nothing;

------------------------------------------------------------------------------
-- 6. Seed — starter company-wide R&O set across all three standards
--    (idempotent, stable UUIDs, Rev A — review before adoption)
------------------------------------------------------------------------------

insert into risk_items
  (id, number, kind, title, context, source, iso_domain, category,
   existing_controls, likelihood, consequence,
   residual_likelihood, residual_consequence, review_date, status)
values
  ('ea000000-0000-4000-a000-000000000001', 'RO-0001', 'risk',
   'Key-person dependency in estimating and client relationships',
   'Estimating knowledge, pricing history and key client relationships are concentrated in one person; extended absence or departure would stall tendering and delivery. Rev A — review before adoption.',
   'context_analysis', 'quality', 'Strategic',
   'Quoting and claims run through Entice (shared record, not personal spreadsheets); documented quote approval flow; delegations for approvals.',
   4, 4, 3, 3, '2027-01-08', 'treating'),

  ('ea000000-0000-4000-a000-000000000002', 'RO-0002', 'risk',
   'Subcontractor defective work discovered after handover',
   'Defective subcontracted work (structural, drainage, compaction) found post-handover leads to rework at own cost, client claims and reputation damage. Rev A — review before adoption.',
   'process', 'quality', 'Subcontractor',
   'Vendor compliance register with insurance/licence expiry tracking; SWMS review before mobilisation; supervisor inspections recorded in site diaries.',
   3, 4, 2, 4, '2027-01-08', 'treating'),

  ('ea000000-0000-4000-a000-000000000003', 'RO-0003', 'risk',
   'Sediment or contaminant spill to waterway during earthworks',
   'Erosion/sediment control failure or plant fuel spill on water-adjacent sites reaches a waterway — regulatory notice, clean-up costs, prosecution exposure. Rev A — review before adoption.',
   'legal', 'environmental', 'Environmental',
   'ESCP installed before bulk earthworks; weekly ESCP inspections; spill kits on all plant; refuelling exclusion distance from drains/waterways.',
   3, 5, 2, 4, '2027-01-08', 'treating'),

  ('ea000000-0000-4000-a000-000000000004', 'RO-0004', 'risk',
   'EPA licence / permit condition non-compliance',
   'Breach of licence or permit conditions (waste classification and tracking, operating hours, dust) on remediation projects — penalties, stop-work, loss of licence standing. Rev A — review before adoption.',
   'legal', 'environmental', 'Compliance',
   'Waste dockets retained per load; permit conditions briefed at project start-up toolbox; site supervisor holds current permit copies.',
   2, 5, 1, 5, '2027-01-08', 'treating'),

  ('ea000000-0000-4000-a000-000000000005', 'RO-0005', 'risk',
   'Excavation or trench collapse with workers in the excavation',
   'Ground collapse in unsupported or poorly benched excavations with workers present — fatality potential; highest-consequence site hazard for civil works. Rev A — review before adoption.',
   'process', 'ohs', 'Safety',
   'SWMS mandatory for excavation >1.5m; benching/battering/shoring per geotech advice; competent-person inspection each shift and after rain; exclusion zones and spoil setback.',
   4, 5, 2, 5, '2027-01-08', 'treating'),

  ('ea000000-0000-4000-a000-000000000006', 'RO-0006', 'risk',
   'Plant–pedestrian interaction in live work areas',
   'Ground workers struck by operating plant (excavators, rollers, trucks) in shared work zones — serious injury or fatality potential. Rev A — review before adoption.',
   'incident', 'ohs', 'Safety',
   'Exclusion zones and dedicated walkways; spotters for reversing plant; hi-vis mandatory; reversing cameras and alarms on fleet; positive comms rule (eye contact / two-way) before approach.',
   4, 4, 2, 4, '2027-01-08', 'treating'),

  ('ea000000-0000-4000-a000-000000000007', 'RO-0007', 'risk',
   'Worker fatigue during extended-hours programmes',
   'Fatigue during wet-weather catch-up and claims-driven extended hours degrades decision-making and increases incident likelihood. Rev A — review before adoption.',
   'process', 'ohs', 'People',
   'Rostering limits consecutive extended shifts; site hours visible in daily diaries; supervisors monitor and stand down affected workers.',
   3, 3, 2, 3, '2027-07-02', 'accepted'),

  ('ea000000-0000-4000-a000-000000000008', 'RO-0008', 'risk',
   'Silica and asbestos exposure during remediation works',
   'Disturbance of in-situ asbestos or silica-bearing material during remediation exposes workers and neighbours — chronic health consequences and licensing breaches. Affects both worker health (45001) and environmental release (14001). Rev A — review before adoption.',
   'legal', 'multi', 'Safety',
   'Hazmat survey before disturbance; licensed Class A/B removalists engaged; wet-cutting/suppression methods; air monitoring on removal works; awareness training current.',
   3, 5, 2, 4, '2027-01-08', 'treating'),

  ('ea000000-0000-4000-a000-000000000009', 'RO-0009', 'risk',
   'Weather delays compress claims programme',
   'Extended wet weather compresses the programme, driving out-of-sequence work, rushed QA and claim/EOT disputes on fixed-date contracts. Rev A — review before adoption.',
   'project', 'quality', 'Project Delivery',
   'Programme float on weather-exposed activities; baseline vs actual tracked in the programme module; EOT and delay-notice clauses exercised per contract.',
   4, 3, 3, 2, '2027-07-02', 'open'),

  ('ea000000-0000-4000-a000-00000000000a', 'RO-0010', 'opportunity',
   'ISO 9001/14001/45001 certification opens tier-1 contractor tenders',
   'Certified integrated management system satisfies prequalification for tier-1 head contractors and government panels currently out of reach — step-change in addressable work. Rev A — review before adoption.',
   'context_analysis', 'multi', 'Strategic',
   'Entice management-system build under way; ISO roadmap phased to Stage 1 audit; registers seeded and operating.',
   3, 4, null, null, '2026-12-18', 'treating'),

  ('ea000000-0000-4000-a000-00000000000b', 'RO-0011', 'opportunity',
   'Plant GPS telemetry reduces rework and strengthens claims',
   'Machine guidance / GPS telemetry on earthworks plant cuts survey rework, evidences quantities for claims and improves programme confidence. Rev A — review before adoption.',
   'process', 'quality', 'Project Delivery',
   'Grade checking currently manual via surveyor visits; docket and diary records support claims.',
   3, 3, null, null, '2027-07-02', 'open')
on conflict do nothing;

insert into risk_treatments (id, risk_item_id, description, due_date, status) values
  ('eb000000-0000-4000-a000-000000000001', 'ea000000-0000-4000-a000-000000000001',
   'Document an estimating handover pack (pricing library, client contacts, live tender status) and cross-train the office manager on quote assembly.',
   '2026-09-30', 'open'),
  ('eb000000-0000-4000-a000-000000000002', 'ea000000-0000-4000-a000-000000000002',
   'Introduce ITP hold points for subcontracted structural and drainage work — no cover-up before inspection sign-off.',
   '2026-10-30', 'open'),
  ('eb000000-0000-4000-a000-000000000003', 'ea000000-0000-4000-a000-000000000003',
   'Bunding and spill-kit audit across water-adjacent projects; add long-reach boom kit to the wet-plant trailer.',
   '2026-08-28', 'open'),
  ('eb000000-0000-4000-a000-000000000004', 'ea000000-0000-4000-a000-000000000004',
   'Stand up the legal & compliance obligations register with per-permit conditions and scheduled compliance evaluations.',
   '2026-11-27', 'open'),
  ('eb000000-0000-4000-a000-000000000005', 'ea000000-0000-4000-a000-000000000005',
   'Engage geotechnical engineer for standing trench-support guidance covering typical soil profiles on deep-excavation projects.',
   '2026-09-25', 'open'),
  ('eb000000-0000-4000-a000-000000000006', 'ea000000-0000-4000-a000-000000000006',
   'Trial proximity-detection telemetry on the excavator fleet and formalise the positive-comms rule in the traffic management SWMS.',
   '2026-10-16', 'open'),
  ('eb000000-0000-4000-a000-000000000007', 'ea000000-0000-4000-a000-000000000008',
   'Set up an occupational air-monitoring contract and respirator fit-testing programme for remediation crews.',
   '2026-09-11', 'open'),
  ('eb000000-0000-4000-a000-000000000008', 'ea000000-0000-4000-a000-00000000000a',
   'Complete ISO roadmap Phase 2 modules, run one full internal audit cycle and book the Stage 1 certification audit.',
   '2026-12-18', 'open'),
  ('eb000000-0000-4000-a000-000000000009', 'ea000000-0000-4000-a000-00000000000b',
   'Pilot GPS machine guidance on the next bulk-earthworks project and compare survey rework hours against baseline.',
   '2027-02-26', 'open')
on conflict do nothing;

-- ─── 0023_objectives_kpis.sql ────────────────────────────────────────────
-- 0023_objectives_kpis.sql
-- Objectives & KPIs — ISO 9001/14001/45001 6.2 (objectives) + 9.1 (monitoring,
-- measurement, analysis, evaluation). A central register of management
-- objectives, each with a measurable target + named KPI tracked
-- period-by-period. Actuals come from MANUAL entry OR AUTO derivation via the
-- single server-side metrics engine (src/lib/kpi-metrics.ts) — one source per
-- objective, never mixed.
--
-- Conventions follow 0022_risk_register.sql / 0021 / 0020: current_app_role()
-- RLS, audit_whs() AFTER triggers, next_number('objective') sequence,
-- append-only audit_log.
--
-- Locked decisions implemented here:
--   * LTIFR hours-worked source is MANUAL monthly entry (company_hours) — the
--     office enters the payroll hours figure per month. Hours are NEVER
--     derived from field check-ins.
--   * One source per objective: source ∈ (manual|auto); auto_metric_key is
--     required iff source = 'auto' (CHECK below). The kpi_values entry guard
--     trigger additionally enforces at the DB that a manually-entered value
--     (entered_by set) can never land on an auto objective and vice versa.
--   * Direction-aware targets: direction ∈ (at_most|at_least). Traffic-light
--     derivation (on_track / at_risk / off_track) is pure TS in
--     src/lib/objectives.ts.
--   * Auto kpi_values are recomputed (UPSERT); the audit_whs() trigger records
--     every insert/update — that IS the evidence trail, no extra locking.
--   * company_hours has a uuid id (audit_whs() logs new.id); period_key is
--     UNIQUE and is the business key ('YYYY-MM').

------------------------------------------------------------------------------
-- 1. Tables
------------------------------------------------------------------------------

create table objectives (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,           -- OBJ-0001 via next_number('objective')
  title text not null,
  description text,
  iso_domain text not null check (iso_domain in (
    'quality','environmental','ohs','multi'
  )),
  metric_name text not null,             -- e.g. 'LTIFR', 'On-time delivery'
  unit text not null,                    -- count, %, rate, score, …
  target_value numeric not null,
  -- Target semantics: at_most = lower is better (LTIFR, NCR count);
  -- at_least = higher is better (% / score targets).
  direction text not null check (direction in ('at_most','at_least')),
  period text not null check (period in ('monthly','quarterly')),
  source text not null check (source in ('manual','auto')),
  auto_metric_key text,                  -- key into the TS AUTO_METRICS registry
  check ((source = 'auto') = (auto_metric_key is not null)),
  owner_id uuid references profiles(id),
  status text not null default 'active' check (status in (
    'active','achieved','retired'
  )),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index objectives_status_idx on objectives (status);
create index objectives_source_idx on objectives (source);

create table kpi_values (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid not null references objectives(id) on delete cascade,
  -- 'YYYY-MM' for monthly objectives, 'YYYY-Qn' for quarterly (AU calendar).
  period_key text not null check (period_key ~ '^\d{4}-((0[1-9]|1[0-2])|Q[1-4])$'),
  value numeric not null,
  note text,
  entered_by uuid references profiles(id), -- null = auto-derived by the engine
  computed_at timestamptz not null default now(),
  unique (objective_id, period_key)
);
create index kpi_values_objective_idx on kpi_values (objective_id);

-- The manual monthly hours-worked feed for LTIFR (payroll number).
create table company_hours (
  id uuid primary key default gen_random_uuid(),
  period_key text not null unique check (period_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  hours numeric not null check (hours >= 0),
  entered_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

-- Improvement actions raised when an objective runs off-track.
create table objective_actions (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid not null references objectives(id) on delete cascade,
  description text not null,
  assigned_to uuid references profiles(id),
  due_date date,
  status text not null default 'open' check (status in ('open','done')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index objective_actions_objective_idx on objective_actions (objective_id);
create index objective_actions_status_idx on objective_actions (status);

------------------------------------------------------------------------------
-- 2. kpi_values entry guard — DB enforcement of "one source per objective"
------------------------------------------------------------------------------

-- Belt-and-braces under the server-action guard: an AUTO objective can only
-- carry engine-computed rows (entered_by null); a MANUAL objective can only
-- carry attributed rows (entered_by set). Also pins the period_key shape to
-- the parent objective's period.
create function kpi_value_entry_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_source text;
  v_period text;
begin
  select source, period into v_source, v_period
  from objectives where id = new.objective_id;

  if v_source = 'auto' and new.entered_by is not null then
    raise exception 'manual entry is not allowed on an auto-derived objective';
  end if;
  if v_source = 'manual' and new.entered_by is null then
    raise exception 'values for a manual objective must record who entered them';
  end if;
  if v_period = 'monthly' and new.period_key !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'monthly objectives require a YYYY-MM period key';
  end if;
  if v_period = 'quarterly' and new.period_key !~ '^\d{4}-Q[1-4]$' then
    raise exception 'quarterly objectives require a YYYY-Qn period key';
  end if;
  return new;
end $$;

revoke execute on function kpi_value_entry_guard() from anon, authenticated, public;

create trigger kpi_values_entry_guard
  before insert or update on kpi_values
  for each row execute function kpi_value_entry_guard();

------------------------------------------------------------------------------
-- 3. RLS (admin/office full; supervisor SELECT; field none; deletes admin-only)
------------------------------------------------------------------------------

alter table objectives        enable row level security;
alter table kpi_values        enable row level security;
alter table company_hours     enable row level security;
alter table objective_actions enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'objectives','kpi_values','company_hours','objective_actions'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (current_app_role() in (''admin'',''office'',''supervisor''))',
      t || '_select_staff', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (current_app_role() in (''admin'',''office''))',
      t || '_insert_admin_office', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (current_app_role() in (''admin'',''office''))
         with check (current_app_role() in (''admin'',''office''))',
      t || '_update_admin_office', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (current_app_role() = ''admin'')',
      t || '_delete_admin', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 4. Audit triggers (reuse audit_whs() from 0010_whs.sql — immutable trail)
------------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'objectives','kpi_values','company_hours','objective_actions'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function audit_whs()',
      t || '_audit', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 5. Sequence: objective numbering (OBJ-0001 via next_number('objective'))
------------------------------------------------------------------------------

-- Starts at 10 — the nine seeded objectives below consume OBJ-0001…OBJ-0009.
insert into sequences (key, next_value) values ('objective', 10)
on conflict (key) do nothing;

------------------------------------------------------------------------------
-- 6. Seed — starter objectives across all three standards
--    (idempotent, stable UUIDs, Rev A — review before adoption)
------------------------------------------------------------------------------

insert into objectives
  (id, number, title, description, iso_domain, metric_name, unit,
   target_value, direction, period, source, auto_metric_key, status)
values
  ('fa100000-0000-4000-a000-000000000001', 'OBJ-0001',
   'Zero lost-time injuries',
   'Lost Time Injury Frequency Rate — lost-time injuries per million hours worked. Hours come from the manual monthly company-hours entry (payroll figure); lost-time injuries are injury incidents of severity 3 or higher. Rev A — review before adoption.',
   'ohs', 'LTIFR', 'rate', 0, 'at_most', 'monthly', 'auto', 'ltifr', 'active'),

  ('fa100000-0000-4000-a000-000000000002', 'OBJ-0002',
   'Zero environmental incidents',
   'Environmental incidents recorded in the incident register per month. Target zero — any environmental release or breach is investigated. Rev A — review before adoption.',
   'environmental', 'Environmental incidents', 'count', 0, 'at_most', 'monthly',
   'auto', 'environmental_incident_count', 'active'),

  ('fa100000-0000-4000-a000-000000000003', 'OBJ-0003',
   'Keep nonconformances low and visible',
   'NCRs raised per month across all sources. A monitoring objective — the target is a ceiling of 3/month; a spike signals a process problem to investigate, not a reason to stop raising NCRs. Rev A — review before adoption.',
   'quality', 'NCRs raised', 'count', 3, 'at_most', 'monthly', 'auto',
   'ncr_count', 'active'),

  ('fa100000-0000-4000-a000-000000000004', 'OBJ-0004',
   'Close corrective actions on time',
   'Of the CAPA actions completed in the month, the percentage completed on or before their due date. Actions without a due date are excluded. Rev A — review before adoption.',
   'quality', 'CAPA on-time close', '%', 90, 'at_least', 'monthly', 'auto',
   'capa_on_time_close_pct', 'active'),

  ('fa100000-0000-4000-a000-000000000005', 'OBJ-0005',
   'Deliver projects on programme',
   'Of the projects whose programme finished in the quarter (all tasks 100% complete), the percentage whose actual finish (latest task end date) was on or before the baseline programme end. Requires a baseline to be set. Rev A — review before adoption.',
   'quality', 'On-time delivery', '%', 95, 'at_least', 'quarterly', 'auto',
   'on_time_delivery_pct', 'active'),

  ('fa100000-0000-4000-a000-000000000006', 'OBJ-0006',
   'Keep worker competencies current',
   'Percentage of (active worker × mandatory role requirement) pairs with a current competency record. Snapshot of the register as at the refresh — only the current period is computed; history accrues as each month is refreshed. Rev A — review before adoption.',
   'multi', 'Training compliance', '%', 95, 'at_least', 'monthly', 'auto',
   'training_compliance_pct', 'active'),

  ('fa100000-0000-4000-a000-000000000007', 'OBJ-0007',
   'Close internal audits promptly',
   'Of the internal audits closed in the quarter, the percentage closed within 30 days of their planned date. Audits without a planned date are excluded. Rev A — review before adoption.',
   'multi', 'Audit on-time close', '%', 90, 'at_least', 'quarterly', 'auto',
   'audit_on_time_close_pct', 'active'),

  ('fa100000-0000-4000-a000-000000000008', 'OBJ-0008',
   'Keep clients happy',
   'Average customer satisfaction score out of 5 from post-project client feedback, entered quarterly by the office. Rev A — review before adoption.',
   'quality', 'Customer satisfaction', 'score', 4.5, 'at_least', 'quarterly',
   'manual', null, 'active'),

  ('fa100000-0000-4000-a000-000000000009', 'OBJ-0009',
   'Recycle site waste',
   'Percentage of waste (by tonnage) leaving site that goes to recycling or beneficial reuse rather than landfill, entered quarterly from waste dockets. Auto-derivation arrives with the environmental module. Rev A — review before adoption.',
   'environmental', 'Waste recycled', '%', 80, 'at_least', 'quarterly',
   'manual', null, 'active')
on conflict do nothing;

-- 2–3 months of company hours (~15-person crew ≈ 4,000 h/month) so LTIFR
-- computes on the first refresh. The current month is deliberately absent —
-- LTIFR stays null (not 0) until the payroll figure is entered.
insert into company_hours (id, period_key, hours) values
  ('fa200000-0000-4000-a000-000000000001', '2026-04', 3900),
  ('fa200000-0000-4000-a000-000000000002', '2026-05', 4200),
  ('fa200000-0000-4000-a000-000000000003', '2026-06', 4050)
on conflict do nothing;

-- ─── 0024_management_review.sql ──────────────────────────────────────────
-- 0024_management_review.sql
-- Management Review — ISO 9001/14001/45001 9.3. A structured record of
-- periodic top-management reviews of the integrated QHSE system: each review
-- carries date/period/chair/attendees, the CONTROLLED list of ISO-mandated
-- 9.3.2 inputs (each a RAG status + minute + a frozen jsonb data snapshot
-- auto-pulled from the live registers), and 9.3.3 outputs as dated actions
-- that live on in the tracker after the review closes.
--
-- Conventions follow 0023_objectives_kpis.sql / 0022 / 0021 / 0020:
-- current_app_role() RLS, audit_whs() AFTER triggers (which log new.id, so
-- every table carries a uuid id PK), next_number('mgmt_review') sequence,
-- append-only audit_log.
--
-- Locked decisions implemented here:
--   * Visibility: admin/office/supervisor SELECT only; FIELD HAS NO ACCESS —
--     management-review minutes are commercially sensitive. Writes a/o only;
--     deletes admin-only.
--   * Inputs are a CONTROLLED LIST (CHECK below, mirrored by the app constant
--     in src/lib/mgmt-review.ts) seeded per review at creation — never
--     user-configurable.
--   * Completion guard is SOFT and lives in the server action (close with
--     un-reviewed inputs requires an explicit confirm). It NEVER blocks on
--     open output actions — those are meant to stay open in the tracker.
--   * Closed-review lock (cheap DB belt-and-braces under the server actions):
--     - management_reviews: the only UPDATE allowed while closed is the admin
--       reopen (status moving OFF 'closed').
--     - inputs/attendees: frozen entirely while the parent review is closed
--       (snapshots are evidence — they never refresh after close).
--     - actions: stay updatable after close (the server action restricts a
--       closed review's action updates to status/completed fields only).

------------------------------------------------------------------------------
-- 1. Tables
------------------------------------------------------------------------------

create table management_reviews (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,            -- MR-0001 via next_number('mgmt_review')
  review_date date not null,
  period_covered text,                    -- e.g. 'Jul 2025 – Jun 2026'
  chaired_by uuid references profiles(id),
  status text not null default 'draft' check (status in (
    'draft','in_progress','closed'
  )),
  general_minutes text,
  closed_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index management_reviews_status_idx on management_reviews (status);

create table management_review_inputs (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references management_reviews(id) on delete cascade,
  -- The controlled ISO 9.3.2 input list — one row per key, seeded at review
  -- creation. Mirrors MGMT_REVIEW_INPUT_KEYS in src/lib/mgmt-review.ts.
  input_key text not null check (input_key in (
    'previous_actions_status',
    'context_changes',
    'customer_feedback_complaints',
    'objectives_kpi_performance',
    'process_performance_ncr_trends',
    'incidents_safety_performance',
    'audit_results',
    'risk_opportunity_effectiveness',
    'legal_compliance_status',
    'resource_adequacy',
    'worker_consultation_participation',
    'external_provider_performance',
    'improvement_opportunities'
  )),
  rag text check (rag in ('green','amber','red')), -- null until reviewed
  minute text,
  -- Auto-pulled register snapshot (frozen evidence; null for free-text-only
  -- inputs). The audit trigger logs jsonb 'data' changes as a marker only.
  data jsonb,
  reviewed boolean not null default false,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (review_id, input_key)
);
create index management_review_inputs_review_idx
  on management_review_inputs (review_id);

create table management_review_attendees (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references management_reviews(id) on delete cascade,
  profile_id uuid references profiles(id), -- internal attendee…
  name text,                               -- …or an external's name
  role_title text,
  created_at timestamptz not null default now(),
  check (profile_id is not null or name is not null)
);
create index management_review_attendees_review_idx
  on management_review_attendees (review_id);

-- 9.3.3 outputs: decisions and actions with owners + due dates. These live on
-- in the tracker after the review closes — never a close blocker.
create table management_review_actions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references management_reviews(id) on delete cascade,
  description text not null,
  assigned_to uuid references profiles(id),
  due_date date,
  status text not null default 'open' check (status in ('open','done')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index management_review_actions_review_idx
  on management_review_actions (review_id);
create index management_review_actions_status_idx
  on management_review_actions (status);

------------------------------------------------------------------------------
-- 2. Closed-review lock triggers (DB belt-and-braces)
------------------------------------------------------------------------------

-- The only UPDATE allowed on a closed review is the reopen itself (status
-- moving off 'closed' — admin-only, enforced in the server action).
create function mgmt_review_closed_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'closed' and new.status = 'closed' then
    raise exception 'This management review is closed — reopen it to make changes';
  end if;
  return new;
end $$;

revoke execute on function mgmt_review_closed_guard() from anon, authenticated, public;

create trigger management_reviews_closed_guard
  before update on management_reviews
  for each row execute function mgmt_review_closed_guard();

-- Inputs and attendees freeze entirely once the review is closed. When the
-- parent row is already gone (cascade delete of the review itself) the status
-- lookup returns null and the delete proceeds.
create function mgmt_review_child_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_review uuid;
  v_status text;
begin
  if tg_op = 'DELETE' then
    v_review := old.review_id;
  else
    v_review := new.review_id;
  end if;
  select status into v_status from management_reviews where id = v_review;
  if v_status = 'closed' then
    raise exception 'This management review is closed — its inputs and attendees are frozen';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

revoke execute on function mgmt_review_child_guard() from anon, authenticated, public;

create trigger management_review_inputs_closed_guard
  before insert or update or delete on management_review_inputs
  for each row execute function mgmt_review_child_guard();

create trigger management_review_attendees_closed_guard
  before insert or update or delete on management_review_attendees
  for each row execute function mgmt_review_child_guard();

------------------------------------------------------------------------------
-- 3. RLS (admin/office full; supervisor SELECT; field none; deletes admin-only)
------------------------------------------------------------------------------

alter table management_reviews          enable row level security;
alter table management_review_inputs    enable row level security;
alter table management_review_attendees enable row level security;
alter table management_review_actions   enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'management_reviews','management_review_inputs',
    'management_review_attendees','management_review_actions'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (current_app_role() in (''admin'',''office'',''supervisor''))',
      t || '_select_staff', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (current_app_role() in (''admin'',''office''))',
      t || '_insert_admin_office', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (current_app_role() in (''admin'',''office''))
         with check (current_app_role() in (''admin'',''office''))',
      t || '_update_admin_office', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (current_app_role() = ''admin'')',
      t || '_delete_admin', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 4. Audit triggers (reuse audit_whs() from 0010_whs.sql — immutable trail)
------------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'management_reviews','management_review_inputs',
    'management_review_attendees','management_review_actions'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function audit_whs()',
      t || '_audit', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 5. Sequence: review numbering (MR-0001 via next_number('mgmt_review'))
------------------------------------------------------------------------------

-- No seeded reviews: management reviews are REAL evidence — a fabricated MR
-- is worse than none. The 13 input definitions live in code
-- (src/lib/mgmt-review.ts) and are seeded per review at creation. The
-- Management Review Procedure already exists in the controlled document
-- register (INT-PRO-003) — referenced, not duplicated.
insert into sequences (key, next_value) values ('mgmt_review', 1)
on conflict (key) do nothing;

-- ─── 0025_legal_register.sql ─────────────────────────────────────────────
-- 0025_legal_register.sql
-- Legal & Compliance Obligations Register — ISO 45001/14001 6.1.3, 9001/14001/
-- 45001 9.1.2. A controlled register of legal and other requirements
-- (legislation, regulations, codes of practice, standards, permits, licences,
-- client requirements) plus periodic compliance EVALUATIONS against each —
-- date, evaluator, compliant/gap verdict, and on a gap a linked NCR (the NCR
-- register is the one CAPA spine).
--
-- Conventions follow 0024_management_review.sql / 0022 / 0021 / 0020:
-- current_app_role() RLS, audit_whs() AFTER triggers (log new.id → uuid id
-- PKs), next_number('legal_obligation') sequence, append-only audit_log.
--
-- Locked decisions implemented here:
--   * A re-evaluation is a NEW row, never an edit — compliance_evaluations has
--     NO UPDATE policy for anyone (not even admin) and no UPDATE server action
--     exists. Deletes are admin-only (cleanup path, no UI).
--   * current_compliance is DERIVED, never set by the app. The AFTER
--     INSERT/DELETE recompute trigger on compliance_evaluations is the ONLY
--     writer, and a BEFORE INSERT/UPDATE guard on legal_obligations REJECTS
--     any change to current_compliance that does not match the recompute from
--     the latest evaluation (by evaluated_on, then created_at). This is the
--     robust option: even a raw SQL UPDATE cannot desynchronise the column.
--   * next_review_date auto-advances to latest evaluated_on +
--     review_frequency_months on every evaluation insert; it stays manually
--     editable (initial scheduling before any evaluation exists).
--   * Jurisdiction is single-valued — duplicate the obligation per state if
--     ever needed.
--   * A 'gap' verdict raises/links an NCR: the ncrs source CHECK is extended
--     with 'legal_compliance' below.
--   * Seed content is starter boilerplate — every row is flagged "Rev A —
--     HSEQ review before relying on this for audit". current_compliance stays
--     'not_evaluated': evaluations are REAL evidence, never fabricated.

------------------------------------------------------------------------------
-- 1. Tables
------------------------------------------------------------------------------

create table legal_obligations (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,          -- LEG-0001 via next_number('legal_obligation')
  title text not null,
  category text not null check (category in (
    'act','regulation','code_of_practice','standard','permit','licence',
    'client_requirement','other'
  )),
  jurisdiction text not null check (jurisdiction in (
    'commonwealth','qld','nsw','local','other'
  )),
  iso_domain text not null check (iso_domain in (
    'quality','environmental','ohs','multi'
  )),
  summary text,                         -- what the requirement demands
  how_it_applies text,                  -- how it applies to the business
  how_we_comply text,                   -- controls/records demonstrating compliance
  -- Controlling procedure/policy in the controlled document register.
  controlling_document_id uuid references documents(id) on delete set null,
  responsible_id uuid references profiles(id),
  review_frequency_months int not null default 12
    check (review_frequency_months between 1 and 120),
  next_review_date date,
  -- DERIVED — see the guard/recompute triggers below. Never set by the app.
  current_compliance text not null default 'not_evaluated'
    check (current_compliance in ('compliant','gap','not_evaluated')),
  status text not null default 'active' check (status in ('active','retired')),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index legal_obligations_status_idx on legal_obligations (status);
create index legal_obligations_category_idx on legal_obligations (category);
create index legal_obligations_review_idx on legal_obligations (next_review_date);
create index legal_obligations_compliance_idx on legal_obligations (current_compliance);
create index legal_obligations_doc_idx on legal_obligations (controlling_document_id);

-- Append-only evaluation history. A re-evaluation is a NEW row.
create table compliance_evaluations (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references legal_obligations(id) on delete cascade,
  evaluated_on date not null,
  evaluator_id uuid references profiles(id),
  verdict text not null check (verdict in ('compliant','gap')),
  notes text,
  -- A gap links to the NCR/CAPA spine; SET NULL preserves the evaluation
  -- record if the NCR is ever removed.
  ncr_id uuid references ncrs(id) on delete set null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index compliance_evaluations_obligation_idx
  on compliance_evaluations (obligation_id);
create index compliance_evaluations_ncr_idx on compliance_evaluations (ncr_id);

------------------------------------------------------------------------------
-- 2. NCR source: legal compliance gaps escalate into the CAPA spine
------------------------------------------------------------------------------

alter table ncrs drop constraint ncrs_source_check;
alter table ncrs add constraint ncrs_source_check
  check (source in (
    'quality','environmental','customer_complaint','audit_finding',
    'supplier','safety','legal_compliance','other'
  ));

------------------------------------------------------------------------------
-- 3. current_compliance authority — recompute + guard triggers
------------------------------------------------------------------------------

-- Single source of truth: the latest evaluation (by evaluated_on, then
-- created_at) decides the parent's current_compliance; none → 'not_evaluated'.
create function legal_current_compliance(p_obligation uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select verdict from compliance_evaluations
       where obligation_id = p_obligation
       order by evaluated_on desc, created_at desc
       limit 1),
    'not_evaluated')
$$;

revoke execute on function legal_current_compliance(uuid) from anon, public;

-- AFTER INSERT/DELETE on compliance_evaluations → recompute the parent.
-- INSERT also advances next_review_date from the LATEST evaluated_on (not
-- necessarily the inserted row — backdated evaluations never wind the
-- schedule forward incorrectly). DELETE (admin cleanup only) recomputes the
-- verdict but leaves next_review_date alone — it is manually editable.
-- SECURITY DEFINER: supervisors may insert evaluations without holding an
-- UPDATE policy on legal_obligations.
create function legal_recompute_compliance() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_obligation uuid;
  v_latest_date date;
begin
  if tg_op = 'DELETE' then
    v_obligation := old.obligation_id;
    update legal_obligations
       set current_compliance = legal_current_compliance(v_obligation)
     where id = v_obligation;
    return old;
  end if;

  v_obligation := new.obligation_id;
  select evaluated_on into v_latest_date
    from compliance_evaluations
   where obligation_id = v_obligation
   order by evaluated_on desc, created_at desc
   limit 1;

  update legal_obligations o
     set current_compliance = legal_current_compliance(v_obligation),
         next_review_date =
           v_latest_date + make_interval(months => o.review_frequency_months)
   where o.id = v_obligation;
  return new;
end $$;

revoke execute on function legal_recompute_compliance() from anon, authenticated, public;

create trigger compliance_evaluations_recompute
  after insert or delete on compliance_evaluations
  for each row execute function legal_recompute_compliance();

-- Guard: current_compliance may only ever hold the recomputed value. The
-- recompute trigger's own UPDATE passes (it writes exactly that value);
-- anything else — app code, raw SQL, a compromised client — is rejected.
create function legal_compliance_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- A new obligation has no evaluations; only the default is legal.
    if new.current_compliance is distinct from 'not_evaluated' then
      raise exception 'current_compliance is derived from compliance evaluations and cannot be set directly';
    end if;
    return new;
  end if;
  if new.current_compliance is distinct from old.current_compliance
     and new.current_compliance is distinct from legal_current_compliance(new.id) then
    raise exception 'current_compliance is derived from compliance evaluations and cannot be set directly';
  end if;
  return new;
end $$;

revoke execute on function legal_compliance_guard() from anon, authenticated, public;

create trigger legal_obligations_compliance_guard
  before insert or update on legal_obligations
  for each row execute function legal_compliance_guard();

------------------------------------------------------------------------------
-- 4. RLS (admin/office manage obligations; supervisor reads both + records
--    evaluations in the field; field none; deletes admin-only; evaluations
--    have NO UPDATE policy — append-only for everyone)
------------------------------------------------------------------------------

alter table legal_obligations      enable row level security;
alter table compliance_evaluations enable row level security;

-- legal_obligations
create policy legal_obligations_select_staff on legal_obligations
  for select to authenticated
  using (current_app_role() in ('admin','office','supervisor'));
create policy legal_obligations_insert_admin_office on legal_obligations
  for insert to authenticated
  with check (current_app_role() in ('admin','office'));
create policy legal_obligations_update_admin_office on legal_obligations
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy legal_obligations_delete_admin on legal_obligations
  for delete to authenticated using (current_app_role() = 'admin');

-- compliance_evaluations: deliberately NO update policy (locked decision —
-- a re-evaluation is a new row, never an edit).
create policy compliance_evaluations_select_staff on compliance_evaluations
  for select to authenticated
  using (current_app_role() in ('admin','office','supervisor'));
create policy compliance_evaluations_insert_staff on compliance_evaluations
  for insert to authenticated
  with check (current_app_role() in ('admin','office','supervisor'));
create policy compliance_evaluations_delete_admin on compliance_evaluations
  for delete to authenticated using (current_app_role() = 'admin');

------------------------------------------------------------------------------
-- 5. Audit triggers (reuse audit_whs() from 0010_whs.sql — immutable trail)
------------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['legal_obligations','compliance_evaluations'] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function audit_whs()',
      t || '_audit', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 6. Sequence: obligation numbering (LEG-0001 via next_number('legal_obligation'))
------------------------------------------------------------------------------

-- Starts at 19 — the eighteen seeded obligations below consume LEG-0001…LEG-0018.
insert into sequences (key, next_value) values ('legal_obligation', 19)
on conflict (key) do nothing;

------------------------------------------------------------------------------
-- 7. Seed — starter obligation set for ECR (Entice Civil & Remediation Pty
--    Ltd): asbestos remediation (Class A/B), demolition, civil works,
--    contaminated land remediation and hazmat, operating as head contractor
--    in Queensland AND Northern NSW. Sourced from the company WHS Manual
--    (SMS-M-01 §6.2 legal register requirements). Licensed asbestos removal
--    is currently subcontracted; ECR's QLD Class A licence APPLICATION is in
--    progress (see LEG-0017).
--
--    Idempotent, stable UUIDs; EVERY row flagged "Rev A — HSEQ review before
--    relying on this for audit"; current_compliance stays 'not_evaluated' —
--    evaluations are real evidence, never fabricated; next_review_date
--    staggered across the coming 12 months. The company's own procedure
--    numbering (SMS-xx) is referenced in how_we_comply; controlling_document_id
--    links to the closest existing app document.
------------------------------------------------------------------------------

insert into legal_obligations
  (id, number, title, category, jurisdiction, iso_domain,
   summary, how_it_applies, how_we_comply,
   controlling_document_id, review_frequency_months, next_review_date, status,
   current_compliance)
values
  -- ── Queensland ─────────────────────────────────────────────────────────────
  ('ec000000-0000-4000-a000-000000000001', 'LEG-0001',
   'Work Health and Safety Act 2011 (Qld)', 'act', 'qld', 'ohs',
   'Primary duty of care on ECR as a PCBU: ensure the health and safety of workers and others so far as reasonably practicable. Officers must exercise due diligence. Notifiable incidents must be reported to WHSQ. Workers must be consulted. Rev A — HSEQ review before relying on this for audit.',
   'ECR is a PCBU and head contractor on asbestos remediation, demolition and civil projects in Queensland. Directors owe officer due-diligence duties. Most site work is high-risk construction work.',
   'SMS-03 Legal Obligations Procedure governs this register; the Director — Compliance and Technical maintains it. SWMS with worker sign-on, the incident register and toolbox consultation records sit in Entice. The HSEQ lead reports notifiable incidents to WHSQ.',
   'd0c00000-0000-4000-a000-000000000003', 12, '2027-06-30', 'active', 'not_evaluated'),

  ('ec000000-0000-4000-a000-000000000002', 'LEG-0002',
   'Work Health and Safety Regulation 2011 (Qld) — incl. Chapter 8 (asbestos)', 'regulation', 'qld', 'ohs',
   'Detailed WHS duties: SWMS for high-risk construction work, demolition notification, Chapter 8 asbestos duties (licensed removal, notification, air monitoring, clearance), plant and high-risk work licensing, health monitoring. Rev A — HSEQ review before relying on this for audit.',
   'Chapter 8 governs ECR''s core work. Licensed subcontractors currently perform Class A removal under ECR project management; ECR''s application for its own QLD Class A asbestos removal licence is in progress (LEG-0017). Demolition and civil scopes trigger SWMS, notification and licensing duties.',
   'SMS-13 Licensed Asbestos Removal Procedure controls removal work. ECR reviews subcontractor ARCPs and verifies WHSQ notification at least 5 days before removal starts. Independent LAA air monitoring and clearance certificates are hold points. Health monitoring records are retained for 40 years.',
   'd0c00000-0000-4000-a000-000000000003', 12, '2027-05-28', 'active', 'not_evaluated'),

  ('ec000000-0000-4000-a000-000000000003', 'LEG-0003',
   'How to Safely Remove Asbestos Code of Practice 2021 (Qld)', 'code_of_practice', 'qld', 'ohs',
   'Approved code for asbestos removal work: removal control plans, enclosures and decontamination, air monitoring with a 0.01 f/mL control level and 0.02 f/mL stop-work level, clearance inspection before reoccupation. Rev A — HSEQ review before relying on this for audit.',
   'Applies to every removal job ECR manages or performs. The air-monitoring control and stop levels bind removal work whether subcontracted or self-performed.',
   'SMS-13 requires an ARCP per removal job. An independent LAA runs air monitoring against the 0.01 f/mL control level; work stops at 0.02 f/mL. Clearance certificates are required before handback. NATA-accredited laboratories analyse samples.',
   'd0c00000-0000-4000-a000-000000000003', 12, '2026-09-30', 'active', 'not_evaluated'),

  ('ec000000-0000-4000-a000-000000000004', 'LEG-0004',
   'How to Manage and Control Asbestos in the Workplace Code of Practice 2021 (Qld)', 'code_of_practice', 'qld', 'ohs',
   'Approved code for managing in-situ asbestos: asbestos registers, asbestos management plans, controls for work that disturbs ACM, worker training. Rev A — HSEQ review before relying on this for audit.',
   'ECR works in buildings and on land that contain ACM. Crews must check the asbestos register before disturbing any structure or soil.',
   'ECR reviews the client''s asbestos register and hazmat survey before work starts. Site inductions cover ACM locations. Unexpected finds stop work and trigger reassessment under SMS-13.',
   'd0c00000-0000-4000-a000-000000000003', 12, '2026-10-30', 'active', 'not_evaluated'),

  ('ec000000-0000-4000-a000-000000000005', 'LEG-0005',
   'Environmental Protection Act 1994 (Qld)', 'act', 'qld', 'environmental',
   'General environmental duty: do not cause environmental harm without taking all reasonable and practicable measures. Duty to notify environmental harm. Environmentally relevant activities require approval. Rev A — HSEQ review before relying on this for audit.',
   'Remediation, demolition and civil works can release contaminants, sediment, dust and noise. Some remediation work occurs on EMR/CLR-listed land.',
   'Erosion and sediment controls go in before earthworks. Spill kits sit on all plant. The incident register carries the environmental category with duty-to-notify escalation.',
   'd0c00000-0000-4000-a000-000000000002', 12, '2027-04-30', 'active', 'not_evaluated'),

  ('ec000000-0000-4000-a000-000000000006', 'LEG-0006',
   'Environmental Protection Regulation 2019 (Qld) — regulated waste', 'regulation', 'qld', 'environmental',
   'Prescribes ERA thresholds, contaminated land provisions and regulated waste requirements. Asbestos and contaminated soil are regulated waste. Rev A — HSEQ review before relying on this for audit.',
   'Most ECR projects generate regulated waste — asbestos and contaminated soil leave site on most remediation jobs.',
   'ECR classifies waste before transport, uses licensed transporters and disposes only at licensed facilities. Waste tracking documentation is retained per project.',
   'd0c00000-0000-4000-a000-000000000002', 12, '2027-03-31', 'active', 'not_evaluated'),

  ('ec000000-0000-4000-a000-000000000007', 'LEG-0007',
   'Waste Reduction and Recycling Act 2011 (Qld)', 'act', 'qld', 'environmental',
   'Waste levy, waste tracking and reporting duties for waste moved to disposal. Rev A — HSEQ review before relying on this for audit.',
   'Spoil and demolition waste attract the levy. Trackable waste from remediation sites needs end-to-end documentation.',
   'Weighbridge dockets are retained against each project. Levy-liable loads are tracked to licensed facilities.',
   'd0c00000-0000-4000-a000-000000000002', 12, '2026-12-18', 'active', 'not_evaluated'),

  ('ec000000-0000-4000-a000-000000000008', 'LEG-0008',
   'Queensland Building and Construction Commission Act 1991 (Qld) — contractor licensing', 'act', 'qld', 'quality',
   'Contractor licensing: work only within the licence class scope held, meet minimum financial requirements, report annually. Unlicensed building work contracts are unenforceable. Rev A — HSEQ review before relying on this for audit.',
   'ECR contracts building, demolition and civil work in Queensland. Tendered scopes must sit within the licence classes held.',
   'The office checks licence class against scope at tender review and prepares MFR reporting annually with the accountant.',
   'd0c00000-0000-4000-a000-000000000001', 12, '2026-11-13', 'active', 'not_evaluated'),

  ('ec000000-0000-4000-a000-000000000009', 'LEG-0009',
   'Building Industry Fairness (Security of Payment) Act 2017 (Qld)', 'act', 'qld', 'quality',
   'Security of payment: payment claims and payment schedules within statutory timeframes, adjudication rights, trust accounts on eligible contracts. Rev A — HSEQ review before relying on this for audit.',
   'ECR claims against insurers and principals and receives subcontractor claims. Response timeframes are statutory.',
   'Progress claims issue from the Entice claims module against contract reference dates. The office logs incoming subcontractor claims and responds within statutory timeframes.',
   'd0c00000-0000-4000-a000-000000000001', 12, '2027-01-29', 'active', 'not_evaluated'),

  -- ── New South Wales (Northern NSW / Gold Coast corridor) ──────────────────
  ('ec000000-0000-4000-a000-00000000000a', 'LEG-0010',
   'Work Health and Safety Act 2011 (NSW)', 'act', 'nsw', 'ohs',
   'NSW primary WHS duty of care — mirrors the model law. Notifiable incidents must be reported to SafeWork NSW. Rev A — HSEQ review before relying on this for audit.',
   'ECR works as head contractor on Northern NSW projects in the Gold Coast corridor. NSW incidents are reported to SafeWork NSW, not WHSQ.',
   'Cross-border projects are flagged at start-up. Project plans carry SafeWork NSW notification contacts. The same SWMS and incident workflow applies.',
   'd0c00000-0000-4000-a000-000000000003', 12, '2027-02-26', 'active', 'not_evaluated'),

  ('ec000000-0000-4000-a000-00000000000b', 'LEG-0011',
   'Work Health and Safety Regulation 2017 (NSW)', 'regulation', 'nsw', 'ohs',
   'NSW WHS regulation: asbestos removal licensing and notification under SafeWork NSW, demolition licensing, high-risk work licensing, health monitoring. Rev A — HSEQ review before relying on this for audit.',
   'NSW removal and demolition work needs SafeWork NSW notifications and NSW-recognised licences. QLD notifications do not carry across the border.',
   'SMS-13 requires jurisdiction checks per job. ECR verifies subcontractor licences and notifications against the NSW regulation before mobilisation.',
   'd0c00000-0000-4000-a000-000000000003', 12, '2027-03-12', 'active', 'not_evaluated'),

  ('ec000000-0000-4000-a000-00000000000c', 'LEG-0012',
   'SafeWork NSW Codes of Practice — asbestos and demolition work', 'code_of_practice', 'nsw', 'ohs',
   'NSW approved codes for asbestos removal, asbestos management and demolition work. Evidence of what is reasonably practicable in NSW proceedings. Rev A — HSEQ review before relying on this for audit.',
   'NSW projects follow the NSW codes where they differ from the QLD codes.',
   'ARCPs and demolition work plans for NSW jobs are reviewed against the NSW codes. Differences from QLD practice are briefed at project start-up.',
   'd0c00000-0000-4000-a000-000000000003', 12, '2026-11-30', 'active', 'not_evaluated'),

  ('ec000000-0000-4000-a000-00000000000d', 'LEG-0013',
   'Protection of the Environment Operations Act 1997 (NSW)', 'act', 'nsw', 'environmental',
   'NSW environmental statute: immediate notification of pollution incidents, EPA licensing for scheduled activities, water/air/noise pollution offences. Rev A — HSEQ review before relying on this for audit.',
   'Northern NSW remediation and civil work sits under the POEO Act. Pollution incident notification is immediate — different from the QLD duty.',
   'NSW project plans carry the EPA notification protocol and contacts. Site supervisors are briefed on the immediate-notification duty at start-up.',
   'd0c00000-0000-4000-a000-000000000002', 12, '2026-10-16', 'active', 'not_evaluated'),

  ('ec000000-0000-4000-a000-00000000000e', 'LEG-0014',
   'Protection of the Environment Operations (Waste) Regulation 2014 (NSW) — asbestos waste', 'regulation', 'nsw', 'environmental',
   'NSW waste rules: asbestos waste transport and disposal requirements, waste tracking, WasteLocate reporting for asbestos waste movements. Rev A — HSEQ review before relying on this for audit.',
   'Asbestos waste from NSW sites must be tracked and disposed of at NSW-lawful facilities. Interstate movements engage both states'' rules.',
   'NSW asbestos waste moves under WasteLocate with licensed transporters. Disposal dockets are retained per project.',
   'd0c00000-0000-4000-a000-000000000002', 12, '2027-01-15', 'active', 'not_evaluated'),

  -- ── Commonwealth / national ────────────────────────────────────────────────
  ('ec000000-0000-4000-a000-00000000000f', 'LEG-0015',
   'National Environment Protection (Assessment of Site Contamination) Measure 1999 (Cth)', 'standard', 'commonwealth', 'environmental',
   'National framework for assessing site contamination: investigation levels (HILs/HSLs/EILs/ESLs), tiered risk assessment and data quality expectations. Sets remediation criteria and waste classification inputs. Rev A — HSEQ review before relying on this for audit.',
   'Consultants set ECR''s remediation scopes, validation criteria and soil classifications against ASC NEPM criteria. ECR executes to the plans built on them.',
   'ECR executes to the project remediation action plan. Validation sampling hold points are respected before backfill. Consultant validation reports are retained as project records.',
   'd0c00000-0000-4000-a000-000000000002', 12, '2027-02-12', 'active', 'not_evaluated'),

  ('ec000000-0000-4000-a000-000000000010', 'LEG-0016',
   'AS 2601-2001 The demolition of structures; AS/NZS 1715 & 1716 (respiratory protection)', 'standard', 'other', 'ohs',
   'AS 2601 sets demolition planning and execution requirements. AS/NZS 1715 governs selection, use and maintenance of respiratory protective equipment; AS/NZS 1716 sets the equipment standard. Rev A — HSEQ review before relying on this for audit.',
   'Demolition work plans reference AS 2601. Removal and hazmat crews rely on RPE selected and fit-tested to AS/NZS 1715 with AS/NZS 1716-compliant equipment.',
   'Demolition work plans cite AS 2601. RPE selection and fit testing follow AS/NZS 1715; equipment is purchased to AS/NZS 1716. Fit-test records sit in the training & competency register.',
   'd0c00000-0000-4000-a000-000000000003', 12, '2026-12-04', 'active', 'not_evaluated'),

  -- ── Licences / other requirements ──────────────────────────────────────────
  ('ec000000-0000-4000-a000-000000000011', 'LEG-0017',
   'QLD Class A Asbestos Removal Licence — application in progress', 'licence', 'qld', 'ohs',
   'A Class A licence authorises friable asbestos removal. Conditions: nominated supervisors, WHSQ notification at least 5 days before removal, asbestos removal control plans, independent air monitoring, clearance certificates, worker training and health monitoring. Status: ECR''s application is in progress. Rev A — HSEQ review before relying on this for audit.',
   'Until the licence is granted, licensed subcontractors perform Class A removal under ECR project management. On grant, ECR self-performs under the licence conditions.',
   'SMS-13 controls both modes. Today: ECR verifies subcontractor licences, reviews their ARCPs and confirms WHSQ notification at least 5 days before removal. Independent LAA air monitoring and clearance certificates are hold points. On grant: nominated supervisors, worker training and health monitoring (records retained 40 years) move in-house.',
   'd0c00000-0000-4000-a000-000000000003', 6, '2026-08-31', 'active', 'not_evaluated'),

  ('ec000000-0000-4000-a000-000000000012', 'LEG-0018',
   'Client / principal HSE and contract requirements', 'client_requirement', 'other', 'multi',
   'HSE and contract conditions imposed by insurers, loss adjusters, venues, schools and government principals: site inductions, permit systems, reporting timeframes, approval of management plans. Placeholder — record specific requirements per contract. Rev A — HSEQ review before relying on this for audit.',
   'ECR''s client base imposes conditions beyond legislation — school site access rules, venue operating windows, insurer reporting timeframes. Each contract needs review at award.',
   'The office reviews contract HSE requirements at award and flows them into the project plan and subcontractor packages. Crews are briefed at induction.',
   null, 6, '2026-09-11', 'active', 'not_evaluated')
on conflict do nothing;

-- ─── 0026_client_portal.sql ──────────────────────────────────────────────
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

-- ─── 0027_go_live_hardening.sql ──────────────────────────────────────────
-- 0027_go_live_hardening.sql
-- Go-live hardening batch (ISO roadmap §4.11 / §5 Phase-5 essentials):
--
--   1. Daily off-DB backup pipeline — private `backups` storage bucket,
--      `backup_runs` register, and service-role-only helper RPCs used by the
--      /api/cron/backup route (runtime table discovery + storage manifest).
--      ISO 7.5.3.2: records protected from loss.
--   2. In-app error capture — `app_errors` register written ONLY through the
--      anon-callable SECURITY DEFINER `log_app_error()` (crudely rate-limited),
--      read/resolve is admin-only.
--   3. Access review register — `access_reviews` (ACR-xxxx via
--      next_number('access_review')), admin full / office read, audit-trailed.
--
-- Conventions follow 0025/0024/0022: current_app_role() RLS, audit_whs()
-- AFTER triggers, next_number sequences, append-only audit_log.
--
-- Locked decisions implemented here:
--   * The `backups` bucket takes NO user-role write policies — every write
--     (export upload, blob mirror, prune) happens through the service role,
--     which bypasses storage RLS. Admins may read/download only.
--   * `backup_runs` has NO client INSERT/UPDATE/DELETE policies — rows are
--     written exclusively by the backup route under the service role.
--     backup_runs IS the log, so no audit trigger (noise, not evidence).
--   * `app_errors` INSERTs happen only via log_app_error(); the direct INSERT
--     path stays closed to every client role. The rate limiter DROPS silently
--     (returns false) instead of raising — raising inside error handling
--     would cascade failures into the very pages reporting them.
--   * app_errors UPDATE is admin-only and a guard trigger freezes every
--     column except `resolved` — the error record itself is evidence.

------------------------------------------------------------------------------
-- 1. backups bucket (private) + storage policies
------------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;

-- Admin download/list only. Deliberately NO insert/update/delete policies:
-- writes happen exclusively via the service role (bypasses RLS).
create policy "backups_select_admin" on storage.objects for select to authenticated
  using (bucket_id = 'backups' and current_app_role() = 'admin');

------------------------------------------------------------------------------
-- 2. backup_runs
------------------------------------------------------------------------------

create table backup_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running','success','failed')),
  tables_count int,
  rows_total bigint,
  storage_objects_count int,
  storage_bytes_mirrored bigint,
  export_bytes bigint,
  path text,                            -- key inside the backups bucket
  error text,
  trigger text not null check (trigger in ('cron','manual')),
  created_by uuid references profiles(id)
);
create index backup_runs_started_idx on backup_runs (started_at desc);
create index backup_runs_status_idx on backup_runs (status);

alter table backup_runs enable row level security;

create policy backup_runs_select_admin_office on backup_runs
  for select to authenticated
  using (current_app_role() in ('admin','office'));
-- No INSERT/UPDATE/DELETE policies: service-role writes only.

------------------------------------------------------------------------------
-- 3. Service-role helper RPCs for the backup route
--    (PostgREST cannot read information_schema / storage.objects directly)
------------------------------------------------------------------------------

-- Every base table in public, with the column the route should ORDER BY for
-- stable 1000-row pagination (primary key when one exists, first column
-- otherwise). Discovered at runtime so new tables are never missed.
create function backup_list_tables()
returns table(table_name text, order_col text)
language sql stable security definer set search_path = public as $$
  select c.relname::text,
         coalesce(
           (select a.attname::text
              from pg_index i
              join pg_attribute a
                on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
             where i.indrelid = c.oid and i.indisprimary
             limit 1),
           (select a.attname::text
              from pg_attribute a
             where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
             order by a.attnum
             limit 1)
         )
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
   order by c.relname
$$;

revoke execute on function backup_list_tables() from anon, authenticated, public;
grant execute on function backup_list_tables() to service_role;

-- Manifest of every object in the business buckets (attachments + branding):
-- name, size, updated_at. The route embeds this in the export and mirrors
-- new/changed blobs into backups/storage/<bucket>/<name>.
create function backup_storage_manifest()
returns table(bucket text, name text, size bigint, updated_at timestamptz)
language sql stable security definer set search_path = public, storage as $$
  select o.bucket_id::text,
         o.name::text,
         coalesce((o.metadata->>'size')::bigint, 0),
         o.updated_at
    from storage.objects o
   where o.bucket_id in ('attachments','branding')
   order by o.bucket_id, o.name
$$;

revoke execute on function backup_storage_manifest() from anon, authenticated, public;
grant execute on function backup_storage_manifest() to service_role;

------------------------------------------------------------------------------
-- 4. app_errors + log_app_error()
------------------------------------------------------------------------------

create table app_errors (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  source text not null check (source in ('server','client')),
  path text,
  message text not null,
  stack text,                           -- trimmed to 4000 chars by log_app_error
  user_role text,
  resolved boolean not null default false
);
create index app_errors_at_idx on app_errors (at desc);
create index app_errors_unresolved_idx on app_errors (at desc) where not resolved;

alter table app_errors enable row level security;

create policy app_errors_select_admin on app_errors
  for select to authenticated
  using (current_app_role() = 'admin');
create policy app_errors_update_admin on app_errors
  for update to authenticated
  using (current_app_role() = 'admin')
  with check (current_app_role() = 'admin');
-- No INSERT policy for any role — inserts go through log_app_error() only.
-- No DELETE policy — captured errors are records; resolve them instead.

-- Guard: an UPDATE may only flip `resolved`; every other column is frozen.
create function app_errors_update_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (to_jsonb(new) - 'resolved') is distinct from (to_jsonb(old) - 'resolved') then
    raise exception 'only the resolved flag may be updated on app_errors';
  end if;
  return new;
end $$;

revoke execute on function app_errors_update_guard() from anon, authenticated, public;

create trigger app_errors_update_guard
  before update on app_errors
  for each row execute function app_errors_update_guard();

-- The only write path. Granted to anon + authenticated so the branded error
-- pages (client) and instrumentation onRequestError (server, anon key) can
-- report. Crude flood control: once 100 rows landed in the last hour, drop
-- silently — the return value says whether the row was stored.
create function log_app_error(
  p_source text,
  p_path text,
  p_message text,
  p_stack text default null,
  p_user_role text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_source is null or p_source not in ('server','client') then
    return false;
  end if;
  if (select count(*) from app_errors where at > now() - interval '1 hour') >= 100 then
    return false;
  end if;
  insert into app_errors (source, path, message, stack, user_role)
  values (
    p_source,
    left(coalesce(p_path, ''), 500),
    left(coalesce(nullif(trim(p_message), ''), '(no message)'), 1000),
    left(p_stack, 4000),
    left(p_user_role, 20)
  );
  return true;
end $$;

grant execute on function log_app_error(text, text, text, text, text)
  to anon, authenticated;

------------------------------------------------------------------------------
-- 5. access_reviews (ACR-xxxx)
------------------------------------------------------------------------------

create table access_reviews (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,          -- ACR-0001 via next_number('access_review')
  reviewed_on date not null,
  reviewer_id uuid references profiles(id),
  findings text not null,
  actions text,
  next_review_due date not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index access_reviews_reviewed_idx on access_reviews (reviewed_on desc);
create index access_reviews_due_idx on access_reviews (next_review_due);

alter table access_reviews enable row level security;

create policy access_reviews_select_admin_office on access_reviews
  for select to authenticated
  using (current_app_role() in ('admin','office'));
create policy access_reviews_insert_admin on access_reviews
  for insert to authenticated
  with check (current_app_role() = 'admin');
create policy access_reviews_update_admin on access_reviews
  for update to authenticated
  using (current_app_role() = 'admin')
  with check (current_app_role() = 'admin');
create policy access_reviews_delete_admin on access_reviews
  for delete to authenticated
  using (current_app_role() = 'admin');

-- Audit trigger (reuse audit_whs() from 0010_whs.sql — immutable trail).
create trigger access_reviews_audit
  after insert or update or delete on access_reviews
  for each row execute function audit_whs();

-- Sequence: ACR numbering. No seeds — reviews must be real (ACR-0001 is the
-- first genuine review recorded through the UI).
insert into sequences (key, next_value) values ('access_review', 1)
on conflict (key) do nothing;

-- ─── 0028_portal_experience.sql ──────────────────────────────────────────
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

-- ─── 0029_portal_interactions.sql ────────────────────────────────────────
-- 0029_portal_interactions.sql
-- Client Portal CP2b — interactions (roadmap
-- docs/superpowers/plans/2026-07-03-client-portal-roadmap.md §CP2b).
--
--   * portal_messages — correspondence thread per property. Anchored on
--     (client_id, site_id) — NOT the link — so revoking/reissuing a portal
--     link preserves the client's history. client_link_id is traceability
--     only (which link wrote it) and drives the per-link rate limit.
--   * portal_requests — client work requests (REQ-xxxx via
--     next_number('portal_request')): title/description/urgency/photos →
--     office register → convert-to-quote (quote_id linkage).
--   * portal_acceptances — sign-on-the-glass evidence for quote/variation
--     decisions made through the portal (signer name + signature PNG +
--     timestamp + ip). One 'accepted' row per target, enforced by a partial
--     unique index AND the status-guarded UPDATE in portal_accept().
--   * quotes.portal_published / variations.portal_published — office chooses
--     what is signable; nothing is visible in the portal unless published.
--   * client_links.show_financials — per-link gate for the Billing tab
--     (issued invoices/claims for the property). Default OFF.
--
-- Security shape is identical to CP1/CP2a: NO anon table policies anywhere.
-- Every anonymous write goes through a SECURITY DEFINER function that
-- validates the token internally (portal_live_link), enforces rate limits and
-- returns null for dead tokens (no probing surface). Status transitions made
-- by portal_accept are the SAME transitions the office actions use
-- (quote sent→accepted, variation submitted→approved, decided_at stamped) —
-- see src/app/(office)/quotes/actions.ts and projects/[id]/variations/actions.ts.

------------------------------------------------------------------------------
-- 1. Tables
------------------------------------------------------------------------------

create table portal_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  -- Traceability only — the thread survives link reissue/revocation.
  client_link_id uuid references client_links(id) on delete set null,
  sender text not null check (sender in ('client','office')),
  sender_profile_id uuid references profiles(id),
  sender_name text check (sender_name is null or char_length(sender_name) <= 120),
  body text not null check (char_length(body) between 1 and 2000),
  read_by_office boolean not null default false,
  read_by_client boolean not null default false,
  created_at timestamptz not null default now(),
  -- office messages carry a profile, client messages a free-text name
  check (
    (sender = 'office' and sender_profile_id is not null)
    or (sender = 'client' and sender_name is not null)
  )
);
create index portal_messages_thread_idx on portal_messages (client_id, site_id, created_at);
create index portal_messages_office_unread_idx on portal_messages (client_id)
  where sender = 'client' and not read_by_office;

create table portal_requests (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,          -- REQ-0001 via next_number('portal_request')
  client_id uuid not null references clients(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  client_link_id uuid references client_links(id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  description text not null check (char_length(description) between 1 and 4000),
  urgency text not null default 'normal'
    check (urgency in ('low','normal','high','urgent')),
  -- Uploaded through the guarded /portal/[token]/request-upload route; the
  -- submit fn additionally pins every path to the uploading link's prefix.
  photo_paths text[] not null default '{}'
    check (coalesce(array_length(photo_paths, 1), 0) <= 5),
  status text not null default 'submitted'
    check (status in ('submitted','reviewed','quoted','scheduled','completed','declined')),
  quote_id uuid references quotes(id) on delete set null,
  handled_by uuid references profiles(id),
  handled_notes text check (handled_notes is null or char_length(handled_notes) <= 2000),
  created_at timestamptz not null default now()
);
create index portal_requests_client_idx on portal_requests (client_id, created_at desc);
create index portal_requests_site_idx on portal_requests (site_id);
create index portal_requests_status_idx on portal_requests (status);

create table portal_acceptances (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('quote','variation')),
  target_id uuid not null,
  client_id uuid not null references clients(id) on delete cascade,
  client_link_id uuid references client_links(id) on delete set null,
  action text not null check (action in ('accepted','declined')),
  signer_name text not null check (char_length(signer_name) between 1 and 120),
  -- PNG data URL from the signature pad; required for accepts, absent for
  -- declines. Same ceiling as form sign-ons (~100KB PNG as base64).
  signature_data text check (
    (action = 'accepted'
      and signature_data like 'data:image/png;base64,%'
      and char_length(signature_data) <= 140000)
    or (action = 'declined' and signature_data is null)
  ),
  reason text check (
    (action = 'declined' and char_length(reason) between 1 and 1000)
    or (action = 'accepted' and reason is null)
  ),
  ip inet,
  signed_at timestamptz not null default now()
);
create index portal_acceptances_target_idx on portal_acceptances (kind, target_id);
create index portal_acceptances_client_idx on portal_acceptances (client_id, signed_at desc);
-- Belt & braces against double-accept (the status-guarded UPDATE is the lock).
create unique index portal_acceptances_one_accept_idx
  on portal_acceptances (kind, target_id) where action = 'accepted';

-- Office chooses what the portal may show/sign. Publishing is only offered on
-- signable statuses (quote 'sent', variation 'submitted') in the UI; the
-- portal fns re-check status anyway.
alter table quotes     add column portal_published boolean not null default false;
alter table variations add column portal_published boolean not null default false;

-- Billing tab gate — per link, default OFF.
alter table client_links add column show_financials boolean not null default false;

------------------------------------------------------------------------------
-- 2. RLS — staff side only; NO anon policies on any table
------------------------------------------------------------------------------

alter table portal_messages    enable row level security;
alter table portal_requests    enable row level security;
alter table portal_acceptances enable row level security;

-- portal_messages: admin/office read + reply + mark-read; nothing else.
create policy portal_messages_select_admin_office on portal_messages
  for select to authenticated
  using (current_app_role() in ('admin','office'));
create policy portal_messages_insert_office on portal_messages
  for insert to authenticated
  with check (
    current_app_role() in ('admin','office')
    and sender = 'office'
    and sender_profile_id = auth.uid()
  );
create policy portal_messages_update_admin_office on portal_messages
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
-- No DELETE for anyone — the thread doubles as the correspondence log.

-- Guard: staff updates may only flip the read flags; body/sender are frozen.
create function portal_messages_update_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (to_jsonb(new) - 'read_by_office' - 'read_by_client')
     is distinct from
     (to_jsonb(old) - 'read_by_office' - 'read_by_client') then
    raise exception 'only read flags may be updated on portal_messages';
  end if;
  return new;
end $$;
revoke execute on function portal_messages_update_guard() from anon, authenticated, public;

create trigger portal_messages_update_guard
  before update on portal_messages
  for each row execute function portal_messages_update_guard();

-- portal_requests: admin/office manage; supervisor read-only; field none.
create policy portal_requests_select_staff on portal_requests
  for select to authenticated
  using (current_app_role() in ('admin','office','supervisor'));
create policy portal_requests_insert_admin_office on portal_requests
  for insert to authenticated
  with check (current_app_role() in ('admin','office'));
create policy portal_requests_update_admin_office on portal_requests
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy portal_requests_delete_admin on portal_requests
  for delete to authenticated
  using (current_app_role() = 'admin');

-- portal_acceptances: staff read-only evidence. Writes happen exclusively in
-- portal_accept()/portal_decline() — no INSERT/UPDATE/DELETE policy at all.
create policy portal_acceptances_select_admin_office on portal_acceptances
  for select to authenticated
  using (current_app_role() in ('admin','office'));

------------------------------------------------------------------------------
-- 3. Audit triggers (audit_whs from 0010 — INSERT stores summary fields only,
--    never the signature payload)
------------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['portal_requests','portal_acceptances'] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function audit_whs()',
      t || '_audit', t);
  end loop;
end $$;

-- REQ numbering.
insert into sequences (key, next_value) values ('portal_request', 1)
on conflict (key) do nothing;

------------------------------------------------------------------------------
-- 4. portal_resolve_link — expose show_financials so the portal knows whether
--    to render the Billing tab (server still re-checks in portal_billing)
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
    'company_abn', s.abn,
    'show_financials', l.show_financials);
end $$;

------------------------------------------------------------------------------
-- 5. Correspondence fns
------------------------------------------------------------------------------

-- Client posts a message on one of their own properties. Rate limit: 20
-- client messages per rolling hour per link. Returns:
--   null                       dead token or site outside the client's scope
--   {'error':'invalid'}        bad arguments
--   {'error':'rate_limited'}   over the hourly cap
--   {'ok':true}                stored
create function portal_post_message(
  p_token text, p_site uuid, p_name text, p_body text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_name text := left(trim(coalesce(p_name, '')), 120);
  v_body text := trim(coalesce(p_body, ''));
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if not exists (select 1 from sites where id = p_site and client_id = l.client_id) then
    return null;
  end if;

  if v_name = '' or v_body = '' or char_length(v_body) > 2000 then
    return jsonb_build_object('error', 'invalid');
  end if;

  if (select count(*) from portal_messages
       where client_link_id = l.id
         and sender = 'client'
         and created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  insert into portal_messages
    (client_id, site_id, client_link_id, sender, sender_name, body,
     read_by_client, read_by_office)
  values (l.client_id, p_site, l.id, 'client', v_name, v_body, true, false);

  return jsonb_build_object('ok', true);
end $$;

-- The thread for one property, oldest first. Marks office messages as read by
-- the client (hence volatile). Office sender names come from profiles.
create function portal_thread(p_token text, p_site uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_thread jsonb;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if not exists (select 1 from sites where id = p_site and client_id = l.client_id) then
    return null;
  end if;

  update portal_messages
     set read_by_client = true
   where client_id = l.client_id and site_id = p_site
     and sender = 'office' and not read_by_client;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id,
      'sender', m.sender,
      'sender_name', case when m.sender = 'office'
        then coalesce(pr.full_name, 'Office') else m.sender_name end,
      'body', m.body,
      'created_at', m.created_at)
      order by m.created_at, m.id), '[]'::jsonb)
    into v_thread
    from portal_messages m
    left join profiles pr on pr.id = m.sender_profile_id
   where m.client_id = l.client_id and m.site_id = p_site;

  return v_thread;
end $$;

------------------------------------------------------------------------------
-- 6. Work request fns
------------------------------------------------------------------------------

-- Client submits a work request against one of their properties. Rate limit:
-- 10 per rolling 24h per link. Photo paths must sit under this link's own
-- upload prefix (portal-requests/<link id>/…) — you cannot attach another
-- link's uploads. Returns {'ok':true,'number':'REQ-0001'} on success.
create function portal_submit_request(
  p_token text, p_site uuid, p_title text, p_description text,
  p_urgency text, p_photo_paths text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_title text := left(trim(coalesce(p_title, '')), 200);
  v_desc text := trim(coalesce(p_description, ''));
  v_paths text[] := coalesce(p_photo_paths, '{}');
  v_prefix text;
  v_path text;
  v_number text;
  v_id uuid;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if not exists (select 1 from sites where id = p_site and client_id = l.client_id) then
    return null;
  end if;

  if v_title = '' or v_desc = '' or char_length(v_desc) > 4000
     or p_urgency not in ('low','normal','high','urgent')
     or coalesce(array_length(v_paths, 1), 0) > 5 then
    return jsonb_build_object('error', 'invalid');
  end if;

  v_prefix := 'portal-requests/' || l.id::text || '/';
  foreach v_path in array v_paths loop
    if v_path not like v_prefix || '%' or position('..' in v_path) > 0 then
      return jsonb_build_object('error', 'invalid');
    end if;
  end loop;

  if (select count(*) from portal_requests
       where client_link_id = l.id
         and created_at > now() - interval '24 hours') >= 10 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  v_number := 'REQ-' || lpad(next_number('portal_request')::text, 4, '0');

  insert into portal_requests
    (number, client_id, site_id, client_link_id, title, description,
     urgency, photo_paths)
  values (v_number, l.client_id, p_site, l.id, v_title, v_desc,
          p_urgency, v_paths)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'number', v_number, 'id', v_id);
end $$;

-- The client's own requests (optionally one property), newest first. Status
-- only — never quote amounts or office notes.
create function portal_my_requests(p_token text, p_site uuid default null)
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
      'photo_count', coalesce(array_length(r.photo_paths, 1), 0),
      'created_at', r.created_at)
      order by r.created_at desc)
    from portal_requests r
    join sites s on s.id = r.site_id
    where r.client_id = l.client_id
      and (p_site is null or r.site_id = p_site)
  ), '[]'::jsonb);
end $$;

-- Upload gate for request photos: validates the token, rate-limits uploads
-- (40 per rolling 24h per link, logged through portal_views) and hands the
-- route the link id that prefixes the storage path. The route enforces
-- size/type/count on the files themselves.
create function portal_register_upload(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if (select count(*) from portal_views
       where client_link_id = l.id
         and path = 'upload:portal-request-photo'
         and viewed_at > now() - interval '24 hours') >= 40 then
    return jsonb_build_object('allowed', false);
  end if;

  insert into portal_views (client_link_id, site_id, path)
  values (l.id, null, 'upload:portal-request-photo');

  return jsonb_build_object('allowed', true, 'link_id', l.id);
end $$;

------------------------------------------------------------------------------
-- 7. Approval fns (sign on the glass)
------------------------------------------------------------------------------

-- Published quotes/variations for this client. DELIBERATE exception to the
-- portal's no-money rule: an approval needs its number and total — and ONLY
-- that. Quote amount = total inc GST (what the client-facing PDF shows);
-- variation amount = sell_amount ex GST (contract adjustment). No costs,
-- margins or budgets, ever.
--   {'pending':[…], 'decided':[…]} — pending items are signable now; decided
--   items were accepted/declined through the portal (display only).
create function portal_approvals(p_token text, p_site uuid default null)
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
           q.status, 'sent' as signable_status
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
           v.status, 'submitted' as signable_status
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
    coalesce((select jsonb_agg(jsonb_build_object(
        'kind', i.kind, 'id', i.id, 'number', i.number, 'title', i.title,
        'context', i.context, 'site_id', i.site_id, 'amount', i.amount,
        'gst_inclusive', i.gst_inclusive, 'date', i.item_date,
        'action', a.action, 'signer_name', a.signer_name,
        'signed_on', to_char(a.signed_at at time zone 'Australia/Brisbane',
                             'YYYY-MM-DD'))
        order by a.signed_at desc)
      from items i
      join lateral (
        select * from portal_acceptances a
        where a.kind = i.kind and a.target_id = i.id
        order by a.action = 'accepted' desc, a.signed_at desc
        limit 1
      ) a on true
    ), '[]'::jsonb)
  into v_pending, v_decided;

  return jsonb_build_object('pending', v_pending, 'decided', v_decided);
end $$;

-- Entitlement check + view log for the portal PDF proxy. Null unless the
-- item is published and belongs to this client (pending or already decided —
-- clients may re-open what they signed).
create function portal_approval_file(p_token text, p_kind text, p_id uuid)
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
       and q.portal_published and q.status in ('sent','accepted');
  elsif p_kind = 'variation' then
    select 'VO-' || v.number::text, p.site_id into v_number, v_site
      from variations v
      join projects p on p.id = v.project_id
     where v.id = p_id and p.client_id = l.client_id
       and v.portal_published and v.status in ('submitted','approved');
  end if;

  if v_number is null then return null; end if;

  insert into portal_views (client_link_id, site_id, path)
  values (l.id, v_site, left('download:approval:' || p_kind || ':' || p_id::text, 300));

  return jsonb_build_object('number', v_number);
end $$;

-- Accept: flips the target with the SAME transition the office uses
-- (quote sent→accepted / variation submitted→approved, decided_at = now()),
-- atomically status-guarded, and records the signature evidence. Returns:
--   null                        dead token / not entitled / not published
--   {'error':'invalid'}         bad signer/signature payload
--   {'error':'not_acceptable'}  wrong status or already decided
--   {'ok':true,'number':…}      done
create function portal_accept(
  p_token text, p_kind text, p_id uuid,
  p_signer_name text, p_signature text, p_ip text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_signer text := left(trim(coalesce(p_signer_name, '')), 120);
  v_number text;
  v_client uuid;
  v_ip inet;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if p_kind not in ('quote','variation') then return null; end if;

  if v_signer = ''
     or coalesce(p_signature, '') not like 'data:image/png;base64,%'
     or char_length(p_signature) > 140000 then
    return jsonb_build_object('error', 'invalid');
  end if;

  begin
    v_ip := nullif(trim(coalesce(p_ip, '')), '')::inet;
  exception when others then
    v_ip := null;
  end;

  if p_kind = 'quote' then
    select q.number, q.client_id into v_number, v_client
      from quotes q
     where q.id = p_id and q.client_id = l.client_id and q.portal_published;
    if v_number is null then return null; end if;

    -- Atomic status guard — mirrors setQuoteStatus (sent → accepted).
    update quotes set status = 'accepted', decided_at = now()
     where id = p_id and status = 'sent';
    if not found then return jsonb_build_object('error', 'not_acceptable'); end if;
  else
    select 'VO-' || v.number::text, p.client_id into v_number, v_client
      from variations v
      join projects p on p.id = v.project_id
     where v.id = p_id and p.client_id = l.client_id and v.portal_published;
    if v_number is null then return null; end if;

    -- Atomic status guard — mirrors setVariationStatus (submitted → approved).
    update variations set status = 'approved', decided_at = now()
     where id = p_id and status = 'submitted';
    if not found then return jsonb_build_object('error', 'not_acceptable'); end if;
  end if;

  insert into portal_acceptances
    (kind, target_id, client_id, client_link_id, action, signer_name,
     signature_data, ip)
  values (p_kind, p_id, v_client, l.id, 'accepted', v_signer, p_signature, v_ip);

  return jsonb_build_object('ok', true, 'number', v_number);
end $$;

-- Decline: records the reason for office attention. The target's status is
-- NOT changed — office follows up (may republish, revise or mark lost/rejected
-- through the normal office actions).
create function portal_decline(
  p_token text, p_kind text, p_id uuid, p_signer_name text, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_signer text := left(trim(coalesce(p_signer_name, '')), 120);
  v_reason text := trim(coalesce(p_reason, ''));
  v_client uuid;
  v_number text;
  v_status text;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if p_kind not in ('quote','variation') then return null; end if;

  if v_signer = '' or v_reason = '' or char_length(v_reason) > 1000 then
    return jsonb_build_object('error', 'invalid');
  end if;

  if p_kind = 'quote' then
    select q.number, q.client_id, q.status into v_number, v_client, v_status
      from quotes q
     where q.id = p_id and q.client_id = l.client_id and q.portal_published;
  else
    select 'VO-' || v.number::text, p.client_id, v.status
      into v_number, v_client, v_status
      from variations v
      join projects p on p.id = v.project_id
     where v.id = p_id and p.client_id = l.client_id and v.portal_published;
  end if;
  if v_number is null then return null; end if;

  -- Only pending items can be declined, and only once (accept wins).
  if (p_kind = 'quote' and v_status <> 'sent')
     or (p_kind = 'variation' and v_status <> 'submitted')
     or exists (select 1 from portal_acceptances a
                 where a.kind = p_kind and a.target_id = p_id) then
    return jsonb_build_object('error', 'not_acceptable');
  end if;

  insert into portal_acceptances
    (kind, target_id, client_id, client_link_id, action, signer_name, reason)
  values (p_kind, p_id, v_client, l.id, 'declined', v_signer, v_reason);

  return jsonb_build_object('ok', true, 'number', v_number);
end $$;

------------------------------------------------------------------------------
-- 8. Billing (gated financial history)
------------------------------------------------------------------------------

-- Issued invoices (site's jobs) and claims (site's projects) — number, date,
-- amount, status. Null unless the link's show_financials flag is ON. Drafts
-- and voids never appear.
create function portal_billing(p_token text, p_site uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
begin
  l := portal_live_link(p_token);
  if l.id is null or not l.show_financials then return null; end if;

  if not exists (select 1 from sites where id = p_site and client_id = l.client_id) then
    return null;
  end if;

  return coalesce((
    select jsonb_agg(row_j order by row_j->>'date' desc, row_j->>'number')
    from (
      select jsonb_build_object(
        'kind', 'invoice',
        'number', i.number,
        'context', j.number || ' — ' || j.title,
        'date', i.issue_date,
        'amount', (select round(coalesce(sum(round(il.qty * il.unit_sell, 2)), 0)
                          * (1 + i.gst_rate / 100), 2)
                     from invoice_lines il where il.invoice_id = i.id),
        'status', i.status) as row_j
      from invoices i
      join jobs j on j.id = i.job_id and j.site_id = p_site
      where i.client_id = l.client_id
        and i.status in ('sent','paid')

      union all

      select jsonb_build_object(
        'kind', 'claim',
        'number', p.number || ' · Claim ' || c.number::text,
        'context', p.number || ' — ' || p.name,
        'date', c.reference_date,
        'amount', c.total_inc_gst,
        'status', c.status) as row_j
      from claims c
      join projects p on p.id = c.project_id
        and p.site_id = p_site and p.client_id = l.client_id
      where c.status in ('submitted','certified','paid')
    ) rows
  ), '[]'::jsonb);
end $$;

------------------------------------------------------------------------------
-- 9. Grants — the anon portal consumes ONLY these functions
------------------------------------------------------------------------------

grant execute on function portal_post_message(text, uuid, text, text) to anon, authenticated;
grant execute on function portal_thread(text, uuid) to anon, authenticated;
grant execute on function portal_submit_request(text, uuid, text, text, text, text[]) to anon, authenticated;
grant execute on function portal_my_requests(text, uuid) to anon, authenticated;
grant execute on function portal_register_upload(text) to anon, authenticated;
grant execute on function portal_approvals(text, uuid) to anon, authenticated;
grant execute on function portal_approval_file(text, text, uuid) to anon, authenticated;
grant execute on function portal_accept(text, text, uuid, text, text, text) to anon, authenticated;
grant execute on function portal_decline(text, text, uuid, text, text) to anon, authenticated;
grant execute on function portal_billing(text, uuid) to anon, authenticated;

-- ─── 0030_swms_two.sql ───────────────────────────────────────────────────
-- 0030_swms_two.sql
-- SWMS 2.0: rebuild the SWMS document model around the anatomy of a real
-- professional SWMS (document control, HRCW trigger checklist, minimum
-- competency/PPE/equipment/monitoring, work-step risk table with H/M/L
-- initial/residual ratings, stop-work triggers, emergency response scenarios,
-- references) plus instance-level project-specific details captured at issue.
--
-- Shapes are documented and validated in src/lib/swms.ts (zod). Risk ratings
-- are practical H/M/L by design — NOT the risk register's 5×5 numerics; the
-- numeric matrix appears as static reference text in the PDF only.
--
-- Legacy data: existing templates/instances keep body + hazards untouched
-- (nothing dropped); their hazard rows are mapped into steps below.

------------------------------------------------------------------------------
-- 1. swms_templates: structured sections
------------------------------------------------------------------------------

alter table swms_templates
  add column doc_control jsonb not null default '{}'::jsonb,          -- {prepared_by, approved_by, scope_note}
  add column hrcw_items jsonb not null default '[]'::jsonb,           -- [{id, label, suggested}]
  add column requirements jsonb not null default '{}'::jsonb,         -- {competency, licences_permits, ppe, equipment, monitoring}
  add column steps jsonb not null default '[]'::jsonb,                -- [{step, hazards, initial_risk, controls, residual_risk, responsible}]
  add column stop_work_triggers jsonb not null default '[]'::jsonb,   -- [string]
  add column emergency_scenarios jsonb not null default '[]'::jsonb,  -- [{scenario, immediate_action, notification}]
  add column references_list jsonb not null default '[]'::jsonb,      -- [string]
  add constraint swms_templates_doc_control_object check (jsonb_typeof(doc_control) = 'object'),
  add constraint swms_templates_hrcw_items_array check (jsonb_typeof(hrcw_items) = 'array'),
  add constraint swms_templates_requirements_object check (jsonb_typeof(requirements) = 'object'),
  add constraint swms_templates_steps_array check (jsonb_typeof(steps) = 'array'),
  add constraint swms_templates_stop_work_array check (jsonb_typeof(stop_work_triggers) = 'array'),
  add constraint swms_templates_emergency_array check (jsonb_typeof(emergency_scenarios) = 'array'),
  add constraint swms_templates_references_array check (jsonb_typeof(references_list) = 'array');

------------------------------------------------------------------------------
-- 2. swms_instances: snapshot columns + project-specific sections
------------------------------------------------------------------------------

alter table swms_instances
  add column doc_control jsonb not null default '{}'::jsonb,
  add column hrcw_items jsonb not null default '[]'::jsonb,
  add column requirements jsonb not null default '{}'::jsonb,
  add column steps jsonb not null default '[]'::jsonb,
  add column stop_work_triggers jsonb not null default '[]'::jsonb,
  add column emergency_scenarios jsonb not null default '[]'::jsonb,
  add column references_list jsonb not null default '[]'::jsonb,
  add column project_details jsonb not null default '{}'::jsonb,      -- {work_location, work_dates, workers_roles, other_pcbus, client_contact, nearest_hospital, comms_arrangements, known_hazards_info, permits_required}
  add column hrcw_answers jsonb not null default '{}'::jsonb,         -- {[itemId]: 'yes'|'no'|'na'}
  add column emergency_contacts jsonb not null default '{}'::jsonb,   -- {coordinator, first_aid, assembly_point}
  add constraint swms_instances_doc_control_object check (jsonb_typeof(doc_control) = 'object'),
  add constraint swms_instances_hrcw_items_array check (jsonb_typeof(hrcw_items) = 'array'),
  add constraint swms_instances_requirements_object check (jsonb_typeof(requirements) = 'object'),
  add constraint swms_instances_steps_array check (jsonb_typeof(steps) = 'array'),
  add constraint swms_instances_stop_work_array check (jsonb_typeof(stop_work_triggers) = 'array'),
  add constraint swms_instances_emergency_array check (jsonb_typeof(emergency_scenarios) = 'array'),
  add constraint swms_instances_references_array check (jsonb_typeof(references_list) = 'array'),
  add constraint swms_instances_project_details_object check (jsonb_typeof(project_details) = 'object'),
  add constraint swms_instances_hrcw_answers_object check (jsonb_typeof(hrcw_answers) = 'object'),
  add constraint swms_instances_emergency_contacts_object check (jsonb_typeof(emergency_contacts) = 'object');

------------------------------------------------------------------------------
-- 3. Audit trigger: mark the new large jsonb payloads instead of diffing them
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
        elsif k in ('schema','hazards','data','body',
                    'doc_control','hrcw_items','requirements','steps',
                    'stop_work_triggers','emergency_scenarios','references_list',
                    'project_details','hrcw_answers','emergency_contacts') then
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

------------------------------------------------------------------------------
-- 4. get_shared_doc: external sign-on read-through carries the full structure
------------------------------------------------------------------------------

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
             'hazards', s.hazards, 'version', s.version,
             'doc_control', s.doc_control,
             'hrcw_items', s.hrcw_items,
             'hrcw_answers', s.hrcw_answers,
             'requirements', s.requirements,
             'steps', s.steps,
             'stop_work_triggers', s.stop_work_triggers,
             'emergency_scenarios', s.emergency_scenarios,
             'emergency_contacts', s.emergency_contacts,
             'project_details', s.project_details,
             'references_list', s.references_list),
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

grant execute on function get_shared_doc(text) to anon, authenticated;

------------------------------------------------------------------------------
-- 5. Legacy mapping: hazards → steps, body → doc_control.scope_note
--    (body and hazards columns stay untouched — nothing dropped)
------------------------------------------------------------------------------

update swms_templates set
  steps = coalesce((
    select jsonb_agg(jsonb_build_object(
      'step', h ->> 'task',
      'hazards', h ->> 'hazards',
      'initial_risk', coalesce(h ->> 'risk', 'M'),
      'controls', h ->> 'controls',
      'residual_risk', coalesce(h ->> 'residual_risk', 'L'),
      'responsible', 'Site Supervisor'))
    from jsonb_array_elements(hazards) h
  ), '[]'::jsonb),
  doc_control = jsonb_build_object(
    'prepared_by', '', 'approved_by', '', 'scope_note', coalesce(body, ''))
where steps = '[]'::jsonb;

update swms_instances set
  steps = coalesce((
    select jsonb_agg(jsonb_build_object(
      'step', h ->> 'task',
      'hazards', h ->> 'hazards',
      'initial_risk', coalesce(h ->> 'risk', 'M'),
      'controls', h ->> 'controls',
      'residual_risk', coalesce(h ->> 'residual_risk', 'L'),
      'responsible', 'Site Supervisor'))
    from jsonb_array_elements(hazards) h
  ), '[]'::jsonb),
  doc_control = jsonb_build_object(
    'prepared_by', '', 'approved_by', '', 'scope_note', coalesce(body, ''))
where steps = '[]'::jsonb;

------------------------------------------------------------------------------
-- 6. ECR templates (Rev A) — 3 legacy civil templates rewritten in the full
--    structure + 4 contractor-flavoured new templates. Style: short sentences,
--    active voice, responsibilities to named positions.
------------------------------------------------------------------------------

-- 6.1 Excavation >1.5m & trenching (rewrite)
update swms_templates set
  version = version + 1,
  doc_control = jsonb_build_object(
    'prepared_by', 'Director — Compliance and Technical',
    'approved_by', 'Director — Site Delivery',
    'scope_note', 'Bulk and trench excavation deeper than 1.5 m, including benching, battering, shoring and work near underground services. Applies to ECR self-performed excavation on civil and remediation projects. Subcontractors prepare their own SWMS. Rev A — review before adoption.'),
  hrcw_items = '[
    {"id":"excavation","label":"Work in, near or above excavations, trenches, pits or unstable ground.","suggested":"yes"},
    {"id":"mobile_plant","label":"Work near mobile plant, excavators, trucks or powered equipment.","suggested":"yes"},
    {"id":"services","label":"Work on or near energised electrical services or underground services.","suggested":"yes"},
    {"id":"contaminated_soil","label":"Disturbance of contaminated or potentially contaminated soil, water or other material.","suggested":"no"},
    {"id":"asbestos","label":"Work on or near asbestos or asbestos-containing material.","suggested":"no"},
    {"id":"public_access","label":"Work in areas accessible by occupants, tenants, pedestrians or the public.","suggested":"no"},
    {"id":"extreme_conditions","label":"Work in extreme heat, storms or flood-affected areas.","suggested":"no"}
  ]'::jsonb,
  requirements = jsonb_build_object(
    'competency', 'General construction induction (white card) for all workers. Plant operators verified competent for the plant used. The Site Supervisor briefs the crew on this SWMS before work starts. Competency records held in the training register.',
    'licences_permits', 'High-risk work licences where required for the plant used. Permit to dig signed daily before ground is broken. Current Before You Dig Australia plans on site.',
    'ppe', 'Hard hat, safety boots, high-visibility clothing, gloves and eye protection. Hearing protection near operating plant.',
    'equipment', 'Shoring or trench shields rated for the ground conditions. Access ladders. Edge barricading and signage. Dewatering pump on standby. Service locator.',
    'monitoring', 'A competent person inspects the excavation daily and after rain, vibration or any change in ground conditions. Inspections recorded on the daily pre-start.'),
  steps = '[
    {"step":"Plan the excavation and confirm services","hazards":"Unlocated services, wrong ground assumptions, unplanned high-risk work","initial_risk":"H","controls":"Obtain current Before You Dig Australia plans. Scan with a service locator. Pothole by hand within 500 mm of marked services. Confirm geotech requirements for benching, battering or shoring. Sign the permit to dig before ground is broken.","residual_risk":"M","responsible":"Director — Site Delivery / signed permit to dig"},
    {"step":"Excavate trench or bank cut deeper than 1.5 m","hazards":"Trench or bank collapse, engulfment","initial_risk":"H","controls":"Bench, batter or shore to the geotech requirements. No entry to an unprotected excavation. Keep spoil and plant at least 1 m from the edge. A competent person inspects daily and after rain.","residual_risk":"M","responsible":"Site Supervisor / daily inspection record"},
    {"step":"Operate plant near the excavation","hazards":"Plant rollover into the excavation, workers struck by slewing plant","initial_risk":"H","controls":"Keep a 3 m exclusion zone with a spotter. Use two-way radio between operator and ground crew. Run plant travel paths parallel to the edge.","residual_risk":"M","responsible":"Site Supervisor"},
    {"step":"Access and egress","hazards":"Falls into the excavation","initial_risk":"M","controls":"Provide ladder access within 9 m of any worker in the trench. Barricade and sign all open edges. Provide task lighting for early starts.","residual_risk":"L","responsible":"Site Supervisor"},
    {"step":"Manage water after rain","hazards":"Flooded excavation, bank instability","initial_risk":"M","controls":"Keep a dewatering pump on standby. Inspect batters after rain before anyone re-enters. Stop work if water is rising.","residual_risk":"L","responsible":"Site Supervisor"},
    {"step":"Backfill and close out","hazards":"Open excavation left unattended","initial_risk":"M","controls":"Backfill, or cover and barricade, before leaving site. Report residual hazards to the client contact. Record any changes to this SWMS.","residual_risk":"L","responsible":"Site Supervisor / close-out record"}
  ]'::jsonb,
  stop_work_triggers = '[
    "Ground conditions change, water enters the excavation or a face shows cracking or movement.",
    "An unlocated service is found or struck.",
    "Unexpected fill, odour, staining, buried waste or suspect asbestos material is uncovered.",
    "The protection system does not match the geotech requirements.",
    "Any person or plant item enters the exclusion zone without authorisation."
  ]'::jsonb,
  emergency_scenarios = '[
    {"scenario":"Trench collapse with a person engulfed","immediate_action":"Call 000. Do not enter the excavation. Keep everyone clear of the failed face. Start rescue only under emergency services direction.","notification":"Notify the Director — Site Delivery immediately. Preserve the scene. Notify the regulator if the incident is notifiable."},
    {"scenario":"Service strike (electrical or gas)","immediate_action":"Stop work. Keep everyone clear. Treat all services as live. Call the asset owner emergency line, and 000 if there is fire, arcing or gas release.","notification":"Notify the Director — Site Delivery. Do not resume until the asset owner confirms the service is safe."},
    {"scenario":"Injury or near miss","immediate_action":"Make the area safe. Give first aid. Call 000 if required.","notification":"Notify the Site Supervisor. Record the incident in the register. Review this SWMS before work restarts."}
  ]'::jsonb,
  references_list = '[
    "Work Health and Safety Regulation 2011 (Qld) — high-risk construction work and excavation duties.",
    "Safe Work Australia Code of Practice: Excavation work.",
    "Safe Work Australia guidance: Safe work method statements for high-risk construction work.",
    "ECR WHS Management System procedures and registers."
  ]'::jsonb
where id = 'a7000000-0000-4000-a000-000000000001';

-- 6.2 Concrete spalling repair — height work (rewrite)
update swms_templates set
  version = version + 1,
  doc_control = jsonb_build_object(
    'prepared_by', 'Director — Compliance and Technical',
    'approved_by', 'Director — Site Delivery',
    'scope_note', 'Concrete spalling repair from rope access or elevating work platform, including breakout, reinforcement treatment and reinstatement. Applies to ECR self-performed remedial works, often above occupied or public areas. Subcontractors prepare their own SWMS. Rev A — review before adoption.'),
  hrcw_items = '[
    {"id":"fall_2m","label":"Work where a person could fall more than 2 m.","suggested":"yes"},
    {"id":"public_access","label":"Work in areas accessible by occupants, tenants, pedestrians or the public.","suggested":"yes"},
    {"id":"mobile_plant","label":"Work near mobile plant, elevating work platforms or powered equipment.","suggested":"yes"},
    {"id":"hazardous_chemicals","label":"Work involving hazardous chemicals, fuels, solvents, lead, silica, mould or biological hazards.","suggested":"yes"},
    {"id":"asbestos","label":"Work on or near asbestos or asbestos-containing material.","suggested":"no"},
    {"id":"services","label":"Work on or near energised electrical services or underground services.","suggested":"no"}
  ]'::jsonb,
  requirements = jsonb_build_object(
    'competency', 'General construction induction (white card). IRATA certification for rope access technicians. High-risk work licence for boom-type elevating work platforms over 11 m. The Site Supervisor briefs the crew on this SWMS before work starts.',
    'licences_permits', 'Elevating work platform high-risk work licence where required. Client permits for work above occupied or public areas. Building access permits as required.',
    'ppe', 'Hard hat with chin strap, safety boots, high-visibility clothing, gloves and safety glasses. Fit-tested P2 respirator for concrete breakout. Full-body harness with inspected lanyards for height work.',
    'equipment', 'Twin-rope systems with independent anchors, or an elevating work platform with current inspection. On-tool dust extraction or wet-cutting equipment. Tool lanyards. Overhead protection and drop-zone barricading. Eye wash. Safety data sheets on site.',
    'monitoring', 'Daily harness, rope and anchor inspection before use. Visual dust checks during breakout — stop and re-wet if visible dust leaves the work area.'),
  steps = '[
    {"step":"Set up rope access or position the elevating work platform","hazards":"Fall from height","initial_risk":"H","controls":"IRATA-certified technicians only on ropes. Use twin-rope systems with independent anchors. Elevating work platform operators hold the required high-risk work licence. Inspect harnesses and lanyards daily before use.","residual_risk":"M","responsible":"Site Supervisor / daily inspection record"},
    {"step":"Establish drop zones below the work area","hazards":"Falling objects striking the public or workers","initial_risk":"H","controls":"Install overhead protection or hoarding where required. Barricade drop zones and post a spotter. Fit lanyards to all hand tools.","residual_risk":"L","responsible":"Site Supervisor"},
    {"step":"Break out spalled concrete","hazards":"Respirable crystalline silica dust","initial_risk":"H","controls":"Use on-tool dust extraction or wet cutting. No dry cutting or dry grinding. Wear fit-tested P2 respirators. Keep the exclusion zone below the work clear.","residual_risk":"M","responsible":"Site Supervisor / fit-test records"},
    {"step":"Treat reinforcement and apply epoxy or repair mortar","hazards":"Skin and eye contact with hazardous chemicals","initial_risk":"M","controls":"Keep safety data sheets on site. Wear nitrile gloves and safety glasses. Mix in a ventilated area. Keep the eye wash within reach.","residual_risk":"L","responsible":"All workers"},
    {"step":"Handle repair materials","hazards":"Musculoskeletal strain","initial_risk":"M","controls":"Apply a 20 kg bag limit per person. Lift materials to the work deck mechanically. Use team lifts for awkward loads.","residual_risk":"L","responsible":"All workers"}
  ]'::jsonb,
  stop_work_triggers = '[
    "Wind or weather exceeds the limits for the elevating work platform or rope access plan.",
    "A rope, anchor, harness or lanyard fails inspection or is damaged in use.",
    "A member of the public enters a drop zone.",
    "Suspect asbestos-containing material is found in the substrate or coatings — escalate under the ACM disturbance response SWMS.",
    "Visible dust leaves the work area during breakout."
  ]'::jsonb,
  emergency_scenarios = '[
    {"scenario":"Worker suspended in harness after a fall","immediate_action":"Call 000. Start the rope rescue plan immediately — do not leave the worker suspended. Keep the area below clear.","notification":"Notify the Director — Site Delivery. Quarantine the equipment involved. Record the incident and review this SWMS."},
    {"scenario":"Falling object strikes a person below","immediate_action":"Make the area safe. Give first aid and call 000 if required. Stop overhead work.","notification":"Notify the Director — Site Delivery and the client contact. Do not restart until drop-zone controls are reviewed."},
    {"scenario":"Chemical splash to skin or eyes","immediate_action":"Rinse with water or eye wash for at least 15 minutes. Remove contaminated clothing. Seek medical advice with the safety data sheet.","notification":"Notify the Site Supervisor. Record the exposure and arrange health monitoring if required."}
  ]'::jsonb,
  references_list = '[
    "Work Health and Safety Regulation 2011 (Qld) — falls and high-risk construction work duties.",
    "Safe Work Australia Code of Practice: Managing the risk of falls at workplaces.",
    "WorkSafe Queensland guidance: managing respirable crystalline silica dust in construction.",
    "ECR WHS Management System procedures and registers."
  ]'::jsonb
where id = 'a7000000-0000-4000-a000-000000000002';

-- 6.3 Working near live traffic (rewrite)
update swms_templates set
  version = version + 1,
  doc_control = jsonb_build_object(
    'prepared_by', 'Director — Compliance and Technical',
    'approved_by', 'Director — Site Delivery',
    'scope_note', 'Works on or adjacent to trafficked roadways under an approved Traffic Control Plan. Applies to ECR self-performed civil works. Subcontractors prepare their own SWMS. Rev A — review before adoption.'),
  hrcw_items = '[
    {"id":"traffic","label":"Work on or adjacent to a road or other trafficked area.","suggested":"yes"},
    {"id":"mobile_plant","label":"Work near mobile plant, excavators, trucks or powered equipment.","suggested":"yes"},
    {"id":"public_access","label":"Work in areas accessible by occupants, tenants, pedestrians or the public.","suggested":"yes"},
    {"id":"services","label":"Work on or near energised electrical services or underground services.","suggested":"no"},
    {"id":"extreme_conditions","label":"Work at night, in storms or in other low-visibility conditions.","suggested":"no"}
  ]'::jsonb,
  requirements = jsonb_build_object(
    'competency', 'General construction induction (white card). Accredited traffic controllers for all stop/slow and traffic management duties. The Site Supervisor briefs the crew on the Traffic Control Plan and this SWMS before each shift.',
    'licences_permits', 'Approved Traffic Management Plan and Traffic Control Plan for the site. Road corridor permits where required by the road authority.',
    'ppe', 'Class D or D/N high-visibility garments for all workers on or near the road. Hard hat, safety boots, gloves and eye protection.',
    'equipment', 'Advance warning signage, cones, delineation and physical barriers per the Traffic Control Plan. Shadow vehicle for setup where required. Tower lighting for night work. Two-way radios.',
    'monitoring', 'The Site Supervisor checks the traffic control setup against the Traffic Control Plan at the start of each shift and after any change. Review the plan after every near miss or intrusion.'),
  steps = '[
    {"step":"Set up and pack down traffic control","hazards":"Workers struck by live traffic","initial_risk":"H","controls":"Work to the approved Traffic Control Plan. Use accredited traffic controllers. Place advance warning signage first. Set up against the traffic flow with a shadow vehicle where required.","residual_risk":"M","responsible":"Site Supervisor / TCP checklist"},
    {"step":"Work within the coned-off work zone","hazards":"Vehicle intrusion into the work area","initial_risk":"H","controls":"Use physical barriers where the posted speed is over 60 km/h. Keep buffer and taper lengths per the Traffic Control Plan. No work outside the delineated zone. Wear Class D or D/N garments.","residual_risk":"M","responsible":"Site Supervisor"},
    {"step":"Move plant in and out of the site","hazards":"Collision with passing vehicles or pedestrians","initial_risk":"M","controls":"A traffic controller manages every site access movement. Reverse only with a spotter. Keep flashing beacons and reversing alarms operational.","residual_risk":"L","responsible":"Site Supervisor"},
    {"step":"Work at night or in low visibility","hazards":"Drivers fail to see workers or the work zone","initial_risk":"M","controls":"Use tower lighting positioned to avoid glare to traffic. Wear retroreflective D/N garments. Review the Traffic Control Plan for night conditions before the shift.","residual_risk":"L","responsible":"Director — Site Delivery"}
  ]'::jsonb,
  stop_work_triggers = '[
    "A vehicle intrudes into the work zone.",
    "The Traffic Control Plan cannot be maintained as approved.",
    "A traffic controller is not accredited or leaves position without relief.",
    "Visibility drops below safe levels due to weather, dust or lighting failure."
  ]'::jsonb,
  emergency_scenarios = '[
    {"scenario":"Vehicle strikes a worker or enters the work zone","immediate_action":"Call 000. Make the scene safe without entering live traffic. Give first aid. Stop all work.","notification":"Notify the Director — Site Delivery and the road authority. Preserve the scene. Notify the regulator if the incident is notifiable."},
    {"scenario":"Plant collision with a passing vehicle","immediate_action":"Stop work. Check for injuries and give first aid. Isolate the plant. Restore traffic control before anything else moves.","notification":"Notify the Director — Site Delivery. Record the incident and review the Traffic Control Plan before restart."}
  ]'::jsonb,
  references_list = '[
    "Work Health and Safety Regulation 2011 (Qld) — high-risk construction work duties.",
    "Queensland MUTCD Part 3 and the approved Traffic Management Plan for the site.",
    "Safe Work Australia guidance: traffic management in workplaces.",
    "ECR WHS Management System procedures and registers."
  ]'::jsonb
where id = 'a7000000-0000-4000-a000-000000000003';

-- 6.4 Asbestos removal support works & ACM disturbance response (new)
insert into swms_templates (
  id, title, body, hazards, version, active,
  doc_control, hrcw_items, requirements, steps,
  stop_work_triggers, emergency_scenarios, references_list
) values (
  'a7000000-0000-4000-a000-000000000004',
  'Asbestos removal support works & ACM disturbance response',
  null, '[]'::jsonb, 1, true,
  jsonb_build_object(
    'prepared_by', 'Director — Compliance and Technical',
    'approved_by', 'Director — Site Delivery',
    'scope_note', 'Support works for licensed asbestos removal (exclusion zones, waste handling support, decontamination support) and response to unexpected finds of suspect asbestos-containing material during ECR works. ECR does not remove asbestos under this SWMS — a licensed removalist performs removal under its own SWMS and asbestos removal control plan. Clearance certificates are hold points: no reoccupation before a clearance certificate is issued. Rev A — review before adoption.'),
  '[
    {"id":"asbestos","label":"Work on or near asbestos or asbestos-containing material.","suggested":"yes"},
    {"id":"public_access","label":"Work in areas accessible by occupants, tenants, pedestrians or the public.","suggested":"yes"},
    {"id":"hazardous_chemicals","label":"Work involving hazardous chemicals, lead, silica, mould or biological hazards.","suggested":"no"},
    {"id":"demolition","label":"Demolition of a load-bearing element or work affecting structural stability.","suggested":"no"},
    {"id":"confined_space","label":"Work in or near a confined space, ceiling void or poorly ventilated area.","suggested":"no"},
    {"id":"fall_2m","label":"Work where a person could fall more than 2 m.","suggested":"no"}
  ]'::jsonb,
  jsonb_build_object(
    'competency', 'Asbestos awareness training for all workers. General construction induction (white card). Site-specific induction covering the asbestos register and the removalist control plan. The Director — Compliance and Technical reviews competency records before mobilisation.',
    'licences_permits', 'A licensed asbestos removalist is engaged for all removal work — Class A for friable, Class A or B for non-friable as applicable. ECR workers do not remove asbestos under this SWMS. Client permits and site inductions as required.',
    'ppe', 'Disposable coveralls (type 5/6) and fit-tested P2 respirator as a minimum where disturbance of asbestos-containing material is credible. Gloves and decontaminable safety boots or boot covers. Inside any removal zone, PPE per the removalist control plan.',
    'equipment', 'Barricading and asbestos warning signage for exclusion zones. Wetting agent and sealant. Heavy-duty asbestos waste bags and labels. Decontamination supplies. Spill kit.',
    'monitoring', 'Air monitoring by an independent licensed asbestos assessor where required by the removal control plan. Stop and review if any result is at or above 0.01 fibres/mL. Clearance inspection and certificate before reoccupation — this is a hold point.'),
  '[
    {"step":"Review the asbestos register and removal control plan before start","hazards":"Unidentified asbestos-containing material, wrong work scope","initial_risk":"H","controls":"Review the asbestos register, survey reports and the removalist control plan. Confirm the removal boundary, exclusion zones and clearance hold points. Brief the crew before mobilisation.","residual_risk":"M","responsible":"Director — Compliance and Technical / pre-start briefing record"},
    {"step":"Set up exclusion zones and signage","hazards":"Workers or the public entering a contaminated area","initial_risk":"H","controls":"Barricade the work area per the control plan. Post asbestos warning signage. Control access through one point. Keep occupants and the public clear at all times.","residual_risk":"M","responsible":"Site Supervisor"},
    {"step":"Support licensed removal from outside the removal zone","hazards":"Fibre exposure at the zone boundary","initial_risk":"H","controls":"Stay outside the removal zone unless inducted under the removalist control plan. Follow the removalist decontamination arrangements. Do not handle asbestos waste unless trained and equipped for it.","residual_risk":"M","responsible":"Site Supervisor"},
    {"step":"Respond to an unexpected find of suspect ACM","hazards":"Uncontrolled fibre release","initial_risk":"H","controls":"Stop work immediately. Isolate the area and keep everyone out. Keep the material damp if safe to do so. Do not dry sweep or use compressed air. Report to the Site Supervisor at once.","residual_risk":"M","responsible":"All workers"},
    {"step":"Escalate the find and arrange licensed controls","hazards":"Disturbance spreading, wrong controls applied","initial_risk":"H","controls":"The Site Supervisor notifies the Director — Compliance and Technical. Arrange sampling by a competent person, or treat the material as asbestos. Engage a licensed removalist for any removal. Work does not restart in the area until controls are confirmed.","residual_risk":"M","responsible":"Director — Compliance and Technical"},
    {"step":"Support waste handling and decontamination","hazards":"Secondary contamination leaving the zone","initial_risk":"M","controls":"Double-bag and label asbestos waste. Follow the decontamination sequence before leaving the zone. Bag disposable PPE as asbestos waste. Dispose only at a licensed facility with waste tracking.","residual_risk":"L","responsible":"Site Supervisor / waste records"},
    {"step":"Clearance and reoccupation","hazards":"Reoccupation of a contaminated area","initial_risk":"H","controls":"Hold point: no reoccupation until an independent licensed asbestos assessor or competent person issues a clearance certificate. The Director — Compliance and Technical confirms the certificate is on file before handback.","residual_risk":"L","responsible":"Director — Compliance and Technical / clearance certificate"}
  ]'::jsonb,
  '[
    "Unexpected friable or suspect asbestos-containing material is found or disturbed.",
    "Asbestos warning signage or barricades are removed or breached.",
    "An air monitoring result is at or above 0.01 fibres/mL.",
    "The work drifts toward asbestos removal — only a licensed removalist removes asbestos.",
    "A worker is not fit-tested, trained or equipped for the task."
  ]'::jsonb,
  '[
    {"scenario":"Suspected asbestos fibre release","immediate_action":"Stop work. Isolate the area and prevent access. Keep the material damp if safe. Do not dry sweep or use compressed air.","notification":"Notify the Director — Compliance and Technical and the client. Engage a licensed removalist if removal is required. Notify the regulator if the incident is notifiable. Review this SWMS."},
    {"scenario":"PPE breach or suspected exposure inside a zone","immediate_action":"Leave the zone through the decontamination sequence. Do not spread contamination. Wash exposed skin.","notification":"Notify the Site Supervisor and the Director — Compliance and Technical. Record the exposure and arrange health monitoring."},
    {"scenario":"Unauthorised person enters an exclusion zone","immediate_action":"Stop work. Escort the person out through the decontamination point. Re-secure the zone.","notification":"Notify the Site Supervisor and the client contact. Review access controls before restart."}
  ]'::jsonb,
  '[
    "Work Health and Safety Regulation 2011 (Qld) Chapter 8 — asbestos duties.",
    "Safe Work Australia Code of Practice: How to manage and control asbestos in the workplace.",
    "Safe Work Australia Code of Practice: How to safely remove asbestos.",
    "ECR WHS Management System procedure SMS-13 and the asbestos registers."
  ]'::jsonb
) on conflict (id) do nothing;

-- 6.5 Demolition works — partial & strip-out (new)
insert into swms_templates (
  id, title, body, hazards, version, active,
  doc_control, hrcw_items, requirements, steps,
  stop_work_triggers, emergency_scenarios, references_list
) values (
  'a7000000-0000-4000-a000-000000000005',
  'Demolition works — partial & strip-out',
  null, '[]'::jsonb, 1, true,
  jsonb_build_object(
    'prepared_by', 'Director — Compliance and Technical',
    'approved_by', 'Director — Site Delivery',
    'scope_note', 'Partial demolition and internal strip-out of structures: soft strip, non-structural removal and controlled removal of minor structural elements under the demolition work plan. AS 2601 applies. Subcontractors prepare their own SWMS. Rev A — review before adoption.'),
  '[
    {"id":"demolition","label":"Demolition of a load-bearing element or work affecting structural stability.","suggested":"yes"},
    {"id":"asbestos","label":"Work on or near asbestos or asbestos-containing material.","suggested":"yes"},
    {"id":"services","label":"Work on or near energised electrical services or underground services.","suggested":"yes"},
    {"id":"mobile_plant","label":"Work near mobile plant, excavators, trucks or powered equipment.","suggested":"yes"},
    {"id":"fall_2m","label":"Work where a person could fall more than 2 m.","suggested":"no"},
    {"id":"public_access","label":"Work in areas accessible by occupants, tenants, pedestrians or the public.","suggested":"yes"},
    {"id":"hazardous_chemicals","label":"Work involving hazardous chemicals, lead, silica, mould or biological hazards.","suggested":"no"}
  ]'::jsonb,
  jsonb_build_object(
    'competency', 'General construction induction (white card). Asbestos awareness training. Demolition briefing against the demolition work plan before start. Plant operators verified competent.',
    'licences_permits', 'Demolition licence or notification where the work is licensable or notifiable in the jurisdiction. Services isolation confirmed by the Director — Site Delivery before strip-out starts. Client permits as required.',
    'ppe', 'Hard hat, safety boots, high-visibility clothing, gloves, eye protection and hearing protection. Fit-tested P2 respirator for dusty work.',
    'equipment', 'Props and shoring per the engineered sequence. Barricading and signage for exclusion zones. Water for dust suppression. Lock-out tag-out kit. Waste segregation bins.',
    'monitoring', 'The Site Supervisor checks structural condition at the start of each shift and after each structural element is removed. Watch for movement, cracking and unexpected load paths. Dust checks at the site boundary.'),
  '[
    {"step":"Review the demolition work plan and asbestos register","hazards":"Hidden asbestos-containing material, wrong demolition sequence","initial_risk":"H","controls":"Confirm the structure has a current asbestos register review or clearance before strip-out. Review the demolition sequence against AS 2601. Confirm structural assumptions with the engineer where required.","residual_risk":"M","responsible":"Director — Site Delivery / demolition work plan"},
    {"step":"Isolate services","hazards":"Electrocution, gas release, flooding","initial_risk":"H","controls":"The Director — Site Delivery confirms electrical, gas, water and communications isolation before work starts. Lock out and tag isolation points. Treat all services as live until verified dead.","residual_risk":"M","responsible":"Director — Site Delivery / isolation certificates"},
    {"step":"Establish exclusion zones","hazards":"Workers or the public struck by falling debris","initial_risk":"H","controls":"Barricade the work area and drop zones. Size the exclusion zone to the element being removed. No entry below overhead work at any time.","residual_risk":"M","responsible":"Site Supervisor"},
    {"step":"Soft strip and non-structural removal","hazards":"Manual handling injuries, sharps, dust","initial_risk":"M","controls":"Strip in the planned sequence. De-nail or fold sharps as they are produced. Wet down dusty materials before and during removal. Use mechanical aids for heavy elements.","residual_risk":"L","responsible":"Site Supervisor"},
    {"step":"Remove minor structural elements","hazards":"Uncontrolled collapse","initial_risk":"H","controls":"Follow the engineered sequence. Prop or shore before cutting. Remove one element at a time. Stop if unexpected movement, cracking or load paths are found.","residual_risk":"M","responsible":"Director — Site Delivery"},
    {"step":"Segregate and remove waste","hazards":"Contaminated waste mixed with general waste, plant interaction","initial_risk":"M","controls":"Segregate waste streams at source. Track regulated waste. Load trucks with a spotter. Keep pedestrian routes separated from plant routes.","residual_risk":"L","responsible":"Site Supervisor / waste dockets"}
  ]'::jsonb,
  '[
    "Unexpected asbestos-containing material or other hazardous material is found.",
    "Structural movement, cracking or an unexpected load path appears.",
    "A service assumed isolated is found live.",
    "An exclusion zone is breached.",
    "High wind or weather makes debris control ineffective."
  ]'::jsonb,
  '[
    {"scenario":"Structural movement or partial collapse","immediate_action":"Evacuate the structure and exclusion zone. Call 000 if anyone is trapped or injured. Do not re-enter.","notification":"Notify the Director — Site Delivery. Obtain engineering advice before any re-entry. Notify the regulator if the incident is notifiable."},
    {"scenario":"Contact with a live service","immediate_action":"Do not touch the casualty until the source is isolated. Isolate at the main if safe. Give first aid and call 000.","notification":"Notify the Director — Site Delivery. Re-verify every isolation before work restarts."},
    {"scenario":"Unexpected asbestos find","immediate_action":"Stop work in the area. Isolate and keep the material damp if safe. Follow the ACM disturbance response SWMS.","notification":"Notify the Director — Compliance and Technical. Engage a licensed removalist if removal is required."}
  ]'::jsonb,
  '[
    "AS 2601 — The demolition of structures.",
    "Safe Work Australia Code of Practice: Demolition work.",
    "Work Health and Safety Regulation 2011 (Qld) — demolition and asbestos duties.",
    "ECR WHS Management System procedures and registers."
  ]'::jsonb
) on conflict (id) do nothing;

-- 6.6 Contaminated soil excavation & handling (new)
insert into swms_templates (
  id, title, body, hazards, version, active,
  doc_control, hrcw_items, requirements, steps,
  stop_work_triggers, emergency_scenarios, references_list
) values (
  'a7000000-0000-4000-a000-000000000006',
  'Contaminated soil excavation & handling',
  null, '[]'::jsonb, 1, true,
  jsonb_build_object(
    'prepared_by', 'Director — Compliance and Technical',
    'approved_by', 'Director — Site Delivery',
    'scope_note', 'Excavation, handling, stockpiling and off-site disposal of contaminated or potentially contaminated soil on remediation projects. Works follow the remediation action plan and waste classification for the site. Subcontractors prepare their own SWMS. Rev A — review before adoption.'),
  '[
    {"id":"contaminated_soil","label":"Disturbance of contaminated or potentially contaminated soil, water or other material.","suggested":"yes"},
    {"id":"excavation","label":"Work in, near or above excavations, trenches, pits or unstable ground.","suggested":"yes"},
    {"id":"mobile_plant","label":"Work near mobile plant, excavators, trucks or powered equipment.","suggested":"yes"},
    {"id":"services","label":"Work on or near energised electrical services or underground services.","suggested":"yes"},
    {"id":"hazardous_chemicals","label":"Work involving hazardous chemicals, fuels, solvents, lead, silica, mould or biological hazards.","suggested":"yes"},
    {"id":"asbestos","label":"Work on or near asbestos or asbestos-containing material.","suggested":"no"},
    {"id":"public_access","label":"Work in areas accessible by occupants, tenants, pedestrians or the public.","suggested":"no"}
  ]'::jsonb,
  jsonb_build_object(
    'competency', 'General construction induction (white card). Briefing on the remediation action plan and waste classification before start. Plant operators verified competent. Asbestos awareness training where fill may contain asbestos.',
    'licences_permits', 'Permit to dig signed before excavation. Licensed waste carriers for off-site disposal. Disposal facility approvals matching the waste classification. Regulated waste transport documentation.',
    'ppe', 'Safety boots, long sleeves and pants, high-visibility clothing, nitrile gloves under work gloves and safety glasses. Disposable coveralls where contact with contaminated material is credible. Fit-tested P2 respirator where dust or vapour exposure is credible.',
    'equipment', 'Water cart or hose for dust suppression. Stockpile liner and covers. Bunding. Decontamination station. Spill kit. Gas monitor where volatile contamination is possible.',
    'monitoring', 'Visual dust checks at the work face and site boundary. Vapour monitoring where volatile contamination is possible. Air monitoring where required by the remediation action plan. Stop and review on any alarm or odour.'),
  '[
    {"step":"Review contamination information and locate services","hazards":"Unknown contaminants, service strike","initial_risk":"H","controls":"Review the remediation action plan, site assessment reports and waste classification. Obtain service plans, scan and pothole before excavation. Confirm excavation extents and clean/dirty zones.","residual_risk":"M","responsible":"Director — Compliance and Technical / RAP and permit to dig"},
    {"step":"Excavate contaminated soil","hazards":"Dust and vapour exposure, engulfment","initial_risk":"H","controls":"Keep workers out of the excavation where practicable. Wet down the face and loads. Work upwind where possible. Stop if odours, free product, buried waste or suspect asbestos material appear.","residual_risk":"M","responsible":"Site Supervisor"},
    {"step":"Stockpile and cover","hazards":"Contaminated run-off, dust, cross contamination","initial_risk":"M","controls":"Stockpile on lined ground within a bunded area. Cover stockpiles at the end of each shift and before rain. Keep clean and dirty zones separated.","residual_risk":"L","responsible":"Site Supervisor"},
    {"step":"Load and transport for disposal","hazards":"Spillage in transit, disposal at the wrong facility","initial_risk":"H","controls":"Confirm the waste classification before loading. Use licensed carriers only. Cover every load. Complete waste tracking documentation. Dispose only at an approved facility.","residual_risk":"M","responsible":"Director — Compliance and Technical / waste tracking records"},
    {"step":"Decontaminate plant and personnel","hazards":"Contamination tracked off site","initial_risk":"M","controls":"Decontaminate plant, tools and boots at the decontamination station before leaving the dirty zone. Bag disposable PPE as contaminated waste. No eating, drinking or smoking in the work zone.","residual_risk":"L","responsible":"All workers"},
    {"step":"Validate and close out","hazards":"Residual contamination left in place","initial_risk":"M","controls":"Confirm validation sampling per the remediation action plan before backfill. Record quantities, dockets and variations. Report residual hazards to the client.","residual_risk":"L","responsible":"Director — Compliance and Technical / validation records"}
  ]'::jsonb,
  '[
    "Unexpected odour, staining, free product, buried waste or suspect asbestos material is uncovered.",
    "A gas monitor alarms or a worker reports symptoms.",
    "Dust is visible leaving the site boundary.",
    "Soil is about to leave site without a confirmed waste classification.",
    "Run-off from the work area or a stockpile is escaping containment."
  ]'::jsonb,
  '[
    {"scenario":"Gas or vapour alarm, or strong odour","immediate_action":"Stop work. Move everyone upwind. Remove ignition sources if safe. Do not re-enter until readings are safe.","notification":"Notify the Director — Compliance and Technical. Reassess controls and monitoring before re-entry."},
    {"scenario":"Skin contact with contaminated material","immediate_action":"Wash the area with clean water and soap. Remove contaminated clothing. Seek first aid or medical advice.","notification":"Notify the Site Supervisor. Record the exposure and arrange health monitoring if required."},
    {"scenario":"Spill during loading or transport","immediate_action":"Stop the source if safe. Contain with the spill kit. Prevent entry to drains and waterways.","notification":"Notify the Director — Compliance and Technical and the client. Notify the environmental regulator if required. Dispose of spill waste correctly."}
  ]'::jsonb,
  '[
    "Work Health and Safety Regulation 2011 (Qld) — hazardous chemicals and excavation duties.",
    "Environmental Protection Act 1994 (Qld) — waste tracking and general environmental duty.",
    "Safe Work Australia Code of Practice: Managing risks of hazardous chemicals in the workplace.",
    "The site remediation action plan and waste classification report.",
    "ECR WHS Management System procedures and registers."
  ]'::jsonb
) on conflict (id) do nothing;

-- 6.7 Silica-generating concrete & masonry work (new)
insert into swms_templates (
  id, title, body, hazards, version, active,
  doc_control, hrcw_items, requirements, steps,
  stop_work_triggers, emergency_scenarios, references_list
) values (
  'a7000000-0000-4000-a000-000000000007',
  'Silica-generating concrete & masonry work',
  null, '[]'::jsonb, 1, true,
  jsonb_build_object(
    'prepared_by', 'Director — Compliance and Technical',
    'approved_by', 'Director — Site Delivery',
    'scope_note', 'Cutting, grinding, drilling, breaking and scabbling of concrete, masonry and stone by ECR crews. Wet methods or on-tool extraction are mandatory. Dry cutting is prohibited. Rev A — review before adoption.'),
  '[
    {"id":"hazardous_chemicals","label":"Work generating respirable crystalline silica dust.","suggested":"yes"},
    {"id":"mobile_plant","label":"Work near mobile plant or powered equipment.","suggested":"no"},
    {"id":"public_access","label":"Work in areas accessible by occupants, tenants, pedestrians or the public.","suggested":"no"},
    {"id":"fall_2m","label":"Work where a person could fall more than 2 m.","suggested":"no"},
    {"id":"services","label":"Work on or near energised electrical services or embedded services.","suggested":"no"}
  ]'::jsonb,
  jsonb_build_object(
    'competency', 'General construction induction (white card). Silica awareness training. Respirator fit testing current for every worker doing or near the task. The Site Supervisor briefs the crew on this SWMS before start.',
    'licences_permits', 'Client permits for cutting or penetrations. Services scan before drilling or cutting into slabs and walls.',
    'ppe', 'Fit-tested P2 respirator as a minimum for the task. Hearing protection, eye protection, gloves, safety boots and high-visibility clothing.',
    'equipment', 'Wet-cutting saws with a working water feed. On-tool extraction shrouds with an M-class or H-class vacuum. Water supply. Sealable bags for dust and filters.',
    'monitoring', 'Visual dust checks during every cut. Air monitoring where the task risk assessment requires it. Respiratory health monitoring for workers with ongoing exposure risk, arranged by the Director — Compliance and Technical.'),
  '[
    {"step":"Plan the task and pick the method","hazards":"Uncontrolled silica dust generation","initial_risk":"H","controls":"Choose the lowest-dust method first: order pre-cut materials, or use wet cutting or on-tool extraction. Dry cutting is prohibited. Confirm water supply and vacuum before start. Scan for embedded services.","residual_risk":"M","responsible":"Site Supervisor"},
    {"step":"Cut, grind or drill with wet methods","hazards":"Respirable crystalline silica exposure","initial_risk":"H","controls":"Keep water flowing to the blade for the whole cut. Wear a fit-tested P2 respirator. Keep other workers out of the dust zone.","residual_risk":"M","responsible":"All workers / fit-test records"},
    {"step":"Use on-tool extraction where wet methods are not practicable","hazards":"Dust escaping the shroud","initial_risk":"H","controls":"Fit the shroud and an M-class or H-class vacuum. Empty the vacuum wet or into sealed bags. Never blow down with compressed air.","residual_risk":"M","responsible":"Site Supervisor"},
    {"step":"Clean up slurry and dust","hazards":"Dried slurry re-suspending as dust","initial_risk":"M","controls":"Remove slurry before it dries. Wet-wipe or vacuum surfaces with an M-class or H-class vacuum. No dry sweeping.","residual_risk":"L","responsible":"All workers"},
    {"step":"Maintain cutting and extraction equipment","hazards":"Failed water feed or extraction going unnoticed","initial_risk":"M","controls":"Check water feed, shrouds, hoses and filters each shift. Tag out defective equipment. Report defects to the Site Supervisor.","residual_risk":"L","responsible":"Site Supervisor / pre-start records"}
  ]'::jsonb,
  '[
    "Visible dust during cutting, grinding or drilling.",
    "The water feed or extraction system fails.",
    "A worker in the dust zone is not wearing a fit-tested P2 respirator.",
    "Dry cutting is observed — stop the task immediately."
  ]'::jsonb,
  '[
    {"scenario":"Uncontrolled dust release","immediate_action":"Stop the task. Wet down the area. Clear workers from the dust zone until it settles.","notification":"Notify the Site Supervisor and the Director — Compliance and Technical. Review controls before restart. Record the event."},
    {"scenario":"Worker reports respiratory symptoms","immediate_action":"Move the worker to fresh air. Give first aid and seek medical advice.","notification":"Notify the Director — Compliance and Technical. Record the exposure and arrange health monitoring."}
  ]'::jsonb,
  '[
    "Work Health and Safety Regulation 2011 (Qld) — respirable crystalline silica provisions.",
    "Managing respirable crystalline silica dust exposure in construction and manufacturing (Qld Code of Practice).",
    "Safe Work Australia guidance: crystalline silica and silicosis.",
    "ECR WHS Management System procedures and registers."
  ]'::jsonb
) on conflict (id) do nothing;

-- ─── 0031_environmental.sql ──────────────────────────────────────────────
-- 0031_environmental.sql
-- Environmental module — ISO 14001 operational core (roadmap §4.8):
--   (1) Aspects & Impacts register with significance rating (6.1.2)
--   (2) Waste / spoil load tracking — every load leaving site is a numbered
--       record (classification, qty+unit, receiving facility, docket) reconciled
--       against project permit allowances (8.1 / 9.1)
--   (3) Licensed facilities + project permits with expiry traffic-lights
-- Monitoring (dust/noise/water + weekly ESCP) rides the existing forms engine —
-- two templates are seeded below; no new runtime.
--
-- Conventions follow 0025 / 0022 / 0014: current_app_role() RLS, audit_whs()
-- AFTER triggers, next_number('waste_load') sequence, append-only audit_log.
--
-- Locked decisions implemented here:
--   * Significance = likelihood × severity (both 1–5) with a FIXED threshold:
--     significance and significant (score >= 12) are GENERATED columns — the
--     rating basis can never drift from the stored rows. The threshold is
--     mirrored once in TypeScript (src/lib/env.ts) with a vitest pinning the
--     two together.
--   * Facility/permit gating is WARN + override reason (waste_loads.
--     override_reason), never a hard block — the truck is at the gate.
--   * Load volume is m³ OR tonnes per load (unit stored on the load); permits
--     state their own allowance unit. Reconciliation sums only loads in the
--     permit's unit; other-unit loads are surfaced, never silently converted.
--   * Aspects are edited in place — the audit trigger carries history.
--   * Exceedance on a monitoring submission SUGGESTS raising an environmental
--     incident (prefilled link in the app) — never auto-creates one.
--   * Field role: can log waste loads (they are at the gate) + attach docket
--     photos, and sees only loads they created or on their assigned
--     projects/jobs; office/supervisor manage everything; aspects/facilities/
--     permits are office-managed master data.

------------------------------------------------------------------------------
-- 1. Tables
------------------------------------------------------------------------------

-- Licensed receiving facilities (landfill / transfer / recycling). Dedicated
-- table, NOT vendors — a facility is a licensed place, not a trading account.
create table env_facilities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  licence_no text,
  licence_expiry date,                  -- expiry traffic-light (compliance.ts)
  waste_types text,                     -- classifications accepted (free text)
  active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index env_facilities_active_idx on env_facilities (active);

-- Project permits / approvals with a waste allowance (RAP volume, EA condition,
-- levy approval …). The permit states its own unit; reconciliation compares
-- SUM(loads in that unit) against allowance_qty.
create table env_permits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,              -- permit / approval reference
  description text,
  classification text not null check (classification in (
    'general','green','concrete_masonry','contaminated_soil','regulated',
    'asbestos','other'
  )),
  allowance_qty numeric(12,2) not null check (allowance_qty > 0),
  allowance_unit text not null check (allowance_unit in ('m3','t')),
  expiry date,                          -- expiry traffic-light
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index env_permits_project_idx on env_permits (project_id);
create index env_permits_expiry_idx on env_permits (expiry);

-- Every load leaving site. WL-0001 via next_number('waste_load'). Docket
-- photos/PDFs attach via attachments parent_type 'waste_load' (CHECK below).
create table waste_loads (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,          -- WL-0001
  project_id uuid references projects(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  date date not null,                   -- AU calendar day (app passes todayAU)
  classification text not null check (classification in (
    'general','green','concrete_masonry','contaminated_soil','regulated',
    'asbestos','other'
  )),
  classification_detail text,           -- free detail (e.g. 'Cat A friable ACM')
  qty numeric(12,2) not null check (qty > 0),
  unit text not null check (unit in ('m3','t')),
  facility_id uuid references env_facilities(id) on delete set null,
  permit_id uuid references env_permits(id) on delete set null,
  transporter text,                     -- free text …
  vendor_id uuid references vendors(id) on delete set null,  -- … or a vendor
  docket_ref text,                      -- weighbridge / tipping docket number
  notes text,
  -- WARN + override, never block: when the app raised a gating warning
  -- (expired facility licence / permit over allowance / expired permit) and
  -- the user proceeded, the reason is recorded here.
  override_reason text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  check (project_id is not null or job_id is not null)
);
create index waste_loads_project_idx on waste_loads (project_id);
create index waste_loads_job_idx on waste_loads (job_id);
create index waste_loads_date_idx on waste_loads (date);
create index waste_loads_classification_idx on waste_loads (classification);
create index waste_loads_facility_idx on waste_loads (facility_id);
create index waste_loads_permit_idx on waste_loads (permit_id);
create index waste_loads_created_by_idx on waste_loads (created_by);

-- Company-wide aspects & impacts library (ISO 14001 6.1.2). Edited in place —
-- the audit trigger is the history. significance/significant are GENERATED so
-- the rating maths and the >= 12 threshold cannot drift per-row.
create table env_aspects (
  id uuid primary key default gen_random_uuid(),
  activity text not null,               -- what we do
  aspect text not null,                 -- how it interacts with the environment
  impact text not null,                 -- what could happen
  likelihood smallint not null check (likelihood between 1 and 5),
  severity smallint not null check (severity between 1 and 5),
  significance smallint generated always as (likelihood * severity) stored,
  significant boolean generated always as ((likelihood * severity) >= 12) stored,
  existing_controls text,
  objective_id uuid references objectives(id) on delete set null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index env_aspects_significant_idx on env_aspects (significant);

------------------------------------------------------------------------------
-- 2. Attachments: waste loads get their own parent_type ('waste_load')
------------------------------------------------------------------------------

alter table attachments drop constraint attachments_parent_type_check;
alter table attachments add constraint attachments_parent_type_check
  check (parent_type in (
    'job','project','quote','invoice','claim','po','vendor','diary',
    'variation','package','incident','form_submission','ncr','waste_load'
  ));

-- Attachment READ scope (0019) + owner storage delete (0015) both whitelist
-- parents/folders — extend each with 'waste_load' so supervisors/field can
-- read docket rows + signed URLs, and a field uploader's compensating cleanup
-- (removeUploadedObject) actually removes the object.

drop policy if exists attachments_select_scoped on public.attachments;
create policy attachments_select_scoped on public.attachments
  for select to authenticated
  using (
    current_app_role() in ('admin','office')
    or parent_type in (
      'job','project','diary','incident','form_submission','ncr','waste_load'
    )
  );

drop policy if exists "attachments_select_scoped" on storage.objects;
create policy "attachments_select_scoped" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (
      current_app_role() in ('admin','office')
      or (storage.foldername(name))[1] in (
        'job','project','diary','incident','form_submission','ncr',
        'swms','whs-documents','waste_load'
      )
    )
  );

drop policy if exists "attachments_delete_own" on storage.objects;
create policy "attachments_delete_own" on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and owner_id = auth.uid()::text
    and (storage.foldername(name))[1] in (
      'job','project','quote','invoice','claim','po','vendor','diary',
      'variation','package','incident','form_submission','ncr','waste_load'
    )
  );

------------------------------------------------------------------------------
-- 3. RLS
------------------------------------------------------------------------------

alter table env_facilities enable row level security;
alter table env_permits    enable row level security;
alter table waste_loads    enable row level security;
alter table env_aspects    enable row level security;

-- env_facilities: master data — everyone reads (field picks a facility at the
-- gate), admin/office write, admin deletes.
create policy env_facilities_select_authenticated on env_facilities
  for select to authenticated using (auth.uid() is not null);
create policy env_facilities_insert_admin_office on env_facilities
  for insert to authenticated
  with check (current_app_role() in ('admin','office'));
create policy env_facilities_update_admin_office on env_facilities
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy env_facilities_delete_admin on env_facilities
  for delete to authenticated using (current_app_role() = 'admin');

-- env_permits: staff read (reconciliation is an office/supervisor surface),
-- admin/office write, admin deletes.
create policy env_permits_select_staff on env_permits
  for select to authenticated
  using (current_app_role() in ('admin','office','supervisor'));
create policy env_permits_insert_admin_office on env_permits
  for insert to authenticated
  with check (current_app_role() in ('admin','office'));
create policy env_permits_update_admin_office on env_permits
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy env_permits_delete_admin on env_permits
  for delete to authenticated using (current_app_role() = 'admin');

-- waste_loads: admin/office/supervisor full read + write; FIELD can INSERT
-- loads they create and SELECT loads they created or on projects/jobs they
-- are assigned to (mirrors the field's own-work scoping used elsewhere);
-- updates staff-only; deletes admin-only.
create policy waste_loads_select_staff_or_own on waste_loads
  for select to authenticated
  using (
    current_app_role() in ('admin','office','supervisor')
    or created_by = auth.uid()
    or (project_id is not null and exists (
      select 1 from assignments a
      where a.user_id = auth.uid() and a.project_id = waste_loads.project_id
    ))
    or (job_id is not null and exists (
      select 1 from assignments a
      where a.user_id = auth.uid() and a.job_id = waste_loads.job_id
    ))
  );
create policy waste_loads_insert_staff_or_own on waste_loads
  for insert to authenticated
  with check (
    current_app_role() in ('admin','office','supervisor')
    or (current_app_role() = 'field' and created_by = auth.uid())
  );
create policy waste_loads_update_staff on waste_loads
  for update to authenticated
  using (current_app_role() in ('admin','office','supervisor'))
  with check (current_app_role() in ('admin','office','supervisor'));
create policy waste_loads_delete_admin on waste_loads
  for delete to authenticated using (current_app_role() = 'admin');

-- env_aspects: staff read, admin/office manage (edit-in-place), admin deletes.
-- Field has NO access — the register is a management document.
create policy env_aspects_select_staff on env_aspects
  for select to authenticated
  using (current_app_role() in ('admin','office','supervisor'));
create policy env_aspects_insert_admin_office on env_aspects
  for insert to authenticated
  with check (current_app_role() in ('admin','office'));
create policy env_aspects_update_admin_office on env_aspects
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy env_aspects_delete_admin on env_aspects
  for delete to authenticated using (current_app_role() = 'admin');

------------------------------------------------------------------------------
-- 4. Audit triggers (reuse audit_whs() — immutable trail; aspects edit-in-place
--    history lives here)
------------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['env_facilities','env_permits','waste_loads','env_aspects'] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function audit_whs()',
      t || '_audit', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 5. Sequence: waste load numbering (WL-0001 via next_number('waste_load'))
------------------------------------------------------------------------------

insert into sequences (key, next_value) values ('waste_load', 1)
on conflict (key) do nothing;

------------------------------------------------------------------------------
-- 6. Seed — aspects library (~15 rows for asbestos remediation / demolition /
--    civil), 3 placeholder licensed facilities ('[CONFIRM]' per ECR drafting
--    standard), 2 monitoring form templates. Idempotent, stable UUIDs, every
--    row flagged "Rev A — review before adoption".
------------------------------------------------------------------------------

insert into env_aspects
  (id, activity, aspect, impact, likelihood, severity, existing_controls, objective_id)
values
  ('ee100000-0000-4000-a000-000000000001',
   'Asbestos removal and remediation', 'Airborne fibre release beyond the work zone',
   'Asbestos fibre exposure to workers, neighbours and the public; land/air contamination requiring re-clean and regulator notification. Rev A — review before adoption.',
   2, 5,
   'Licensed removalists under ARCP; enclosures/wetting; independent LAA air monitoring at 0.01 f/mL control level; clearance before handback (SMS-13).',
   'fa100000-0000-4000-a000-000000000002'),
  ('ee100000-0000-4000-a000-000000000002',
   'Contaminated-land remediation', 'Contaminated runoff leaving the work area',
   'Contaminants mobilised into stormwater or neighbouring land; EPA duty-to-notify harm. Rev A — review before adoption.',
   3, 4,
   'Bunded work zones; sealed haul routes where practicable; runoff captured and tested before discharge; ESCP maintained.',
   'fa100000-0000-4000-a000-000000000002'),
  ('ee100000-0000-4000-a000-000000000003',
   'Plant refuelling and hydraulic hoses', 'Fuel or oil spill to ground or waterway',
   'Soil and waterway contamination; fish kills; immediate POEO/EP Act notification. Rev A — review before adoption.',
   3, 5,
   'Spill kits on all plant; refuelling exclusion distance from drains and waterways; daily plant checks for leaks; incident register escalation.',
   'fa100000-0000-4000-a000-000000000002'),
  ('ee100000-0000-4000-a000-000000000004',
   'Demolition, crushing and earthworks', 'Dust generation',
   'Nuisance and respirable dust affecting neighbours and workers; silica exposure; complaints and stop-work. Rev A — review before adoption.',
   4, 3,
   'Water carts and suppression on crushers; wet cutting; stockpile covers; monitoring records on dusty scopes; community notification.',
   null),
  ('ee100000-0000-4000-a000-000000000005',
   'Demolition and civil works near receptors', 'Noise and vibration emissions',
   'Amenity impacts and complaints; permit-hour breaches; structural vibration damage claims. Rev A — review before adoption.',
   4, 2,
   'Work within approved hours; attended noise checks on sensitive sites; plant selection and hoarding; complaint line briefed at start-up.',
   null),
  ('ee100000-0000-4000-a000-000000000006',
   'Demolition strip-out and site clearance', 'Mixed waste to landfill',
   'Recoverable material lost to landfill; waste levy cost; missed recycling targets. Rev A — review before adoption.',
   4, 2,
   'Source separation (concrete/steel/green); licensed facilities with recycling gate acceptance; waste loads tracked per project in Entice.',
   'fa100000-0000-4000-a000-000000000009'),
  ('ee100000-0000-4000-a000-000000000007',
   'On-site fuel and chemical storage', 'Bulk fuel/chemical storage and handling',
   'Tank or IBC failure contaminating soil/groundwater; fire; dangerous-goods breaches. Rev A — review before adoption.',
   2, 4,
   'Self-bunded tanks; SDS register and dangerous-goods segregation; storage away from drains; spill response in site induction.',
   null),
  ('ee100000-0000-4000-a000-000000000008',
   'Excavation and dewatering', 'Groundwater disturbance and dewatering discharge',
   'Drawdown effects; discharge of turbid/contaminated groundwater to stormwater. Rev A — review before adoption.',
   2, 4,
   'Dewatering plans on affected scopes; settlement/treatment before discharge; discharge testing against criteria; permits checked at start-up.',
   null),
  ('ee100000-0000-4000-a000-000000000009',
   'Bulk earthworks', 'Sediment discharge from disturbed areas',
   'Sediment to stormwater/waterways; regulator penalty notices; downstream damage. Rev A — review before adoption.',
   4, 4,
   'ESCP installed before disturbance; weekly ESCP inspections (seeded form); controls maintained after rain; stabilised site exit.',
   'fa100000-0000-4000-a000-000000000002'),
  ('ee100000-0000-4000-a000-00000000000a',
   'Site establishment and clearing', 'Vegetation clearing and habitat disturbance',
   'Loss of protected vegetation/fauna habitat; clearing-permit breaches. Rev A — review before adoption.',
   2, 4,
   'Clearing limits pegged and fenced; permits/approvals verified before clearing; fauna spotter where conditions require; no-go zones inducted.',
   null),
  ('ee100000-0000-4000-a000-00000000000b',
   'Plant and truck operations', 'Plant exhaust emissions and fuel use',
   'Air emissions and greenhouse gases; fuel cost; idling complaints on urban sites. Rev A — review before adoption.',
   4, 2,
   'Plant maintained to schedule; no-idle rule in inductions; haul-route planning to cut double handling.',
   null),
  ('ee100000-0000-4000-a000-00000000000c',
   'Concrete works', 'Concrete washout and slurry',
   'High-pH slurry to ground or stormwater; drain blockage; fish kills. Rev A — review before adoption.',
   3, 4,
   'Designated lined washout point per site; washout contained and disposed as waste; no washout to drains — inducted rule.',
   null),
  ('ee100000-0000-4000-a000-00000000000d',
   'Backfilling and reinstatement', 'Imported fill quality',
   'Contaminated or non-conforming fill imported to site; site becomes contaminated land; validation failure and re-excavation. Rev A — review before adoption.',
   2, 5,
   'Fill only from documented sources with certificates/classification; visual + docket check at the gate; validation sampling per RAP hold points.',
   null),
  ('ee100000-0000-4000-a000-00000000000e',
   'Stockpiling of spoil and materials', 'Stockpile management',
   'Wind-blown dust and sediment runoff from unprotected stockpiles; cross-contamination of clean and contaminated spoil. Rev A — review before adoption.',
   4, 3,
   'Contaminated stockpiles covered and bunded on hardstand; separation and signage by classification; stockpiles clear of drains and boundaries.',
   null),
  ('ee100000-0000-4000-a000-00000000000f',
   'Site operations in occupied areas', 'Community amenity (traffic, hours, odour, light)',
   'Complaints from schools/venues/residents; access restrictions; reputational damage with principals. Rev A — review before adoption.',
   3, 2,
   'Approved work hours; traffic management plans; advance notification letters; complaint response through the office.',
   null)
on conflict do nothing;

-- Placeholder licensed facilities — '[CONFIRM]' per the ECR drafting standard:
-- real gate names, licence numbers and expiry dates to be confirmed by the
-- office before relying on them for audit.
insert into env_facilities (id, name, licence_no, licence_expiry, waste_types, active)
values
  ('ee200000-0000-4000-a000-000000000001',
   '[CONFIRM] Licensed landfill — asbestos/regulated (SEQ)', '[CONFIRM] EA no.',
   '2027-06-30',
   'Asbestos waste; contaminated soil; regulated waste. Rev A — confirm gate acceptance before use.',
   true),
  ('ee200000-0000-4000-a000-000000000002',
   '[CONFIRM] Resource recovery / C&D recycling facility (SEQ)', '[CONFIRM] EA no.',
   '2027-03-31',
   'Concrete/masonry; green waste; general C&D. Rev A — confirm gate acceptance before use.',
   true),
  ('ee200000-0000-4000-a000-000000000003',
   '[CONFIRM] Licensed facility — Northern NSW (POEO/WasteLocate)', '[CONFIRM] EPA licence no.',
   '2026-12-31',
   'Asbestos waste (WasteLocate); general solid waste. Rev A — confirm gate acceptance before use.',
   true)
on conflict do nothing;

-- Monitoring templates (forms engine, kind 'custom' — conducted from the field
-- Safety tab). Both carry a reading + limit + "exceeded" checkbox; an exceeded
-- submission surfaces a "Raise environmental incident" suggestion in the app.
insert into form_templates (id, kind, name, description, schema, version, active, requires_signon)
values
  ('ee300000-0000-4000-a000-000000000001', 'custom',
   'Dust / Noise / Water Monitoring Record',
   'Environmental monitoring reading against its limit (ISO 14001 9.1.1). If the limit is exceeded, raise an environmental incident from the submission. Rev A — review before adoption.',
   '[
     {"key":"monitoring_type","label":"Monitoring type","type":"select","options":["Dust deposition","Airborne dust / PM10","Noise (dBA)","Water — turbidity (NTU)","Water — pH","Asbestos air monitoring (f/mL)","Other"],"required":true},
     {"key":"location","label":"Monitoring location / point","type":"text","options":[],"required":true},
     {"key":"reading_value","label":"Reading value","type":"number","options":[],"required":true},
     {"key":"reading_unit","label":"Reading unit (e.g. f/mL, dBA, NTU)","type":"text","options":[],"required":true},
     {"key":"limit_value","label":"Limit / criterion value","type":"number","options":[],"required":true},
     {"key":"exceeded","label":"Reading exceeds the limit / criterion?","type":"checkbox","options":[],"required":false},
     {"key":"instrument","label":"Instrument / method","type":"text","options":[],"required":false},
     {"key":"weather","label":"Weather conditions","type":"text","options":[],"required":false},
     {"key":"comments","label":"Comments / actions taken","type":"textarea","options":[],"required":false},
     {"key":"photos","label":"Photos of monitoring point","type":"photo","options":[],"required":false}
   ]'::jsonb,
   1, true, false),
  ('ee300000-0000-4000-a000-000000000002', 'custom',
   'Weekly Erosion & Sediment Control Inspection',
   'Weekly ESCP inspection (and after rain) — ISO 14001 8.1/9.1.1. If a limit is exceeded or sediment leaves site, raise an environmental incident from the submission. Rev A — review before adoption.',
   '[
     {"key":"escp_current","label":"ESCP current and available on site?","type":"checkbox","options":[],"required":false},
     {"key":"rain_since_last","label":"Rain since last inspection?","type":"checkbox","options":[],"required":false},
     {"key":"perimeter_controls","label":"Perimeter sediment controls in place and functional?","type":"checkbox","options":[],"required":false},
     {"key":"entry_exit","label":"Stabilised site entry/exit maintained?","type":"checkbox","options":[],"required":false},
     {"key":"drain_inlets","label":"Drain inlets protected?","type":"checkbox","options":[],"required":false},
     {"key":"stockpiles_protected","label":"Stockpiles covered/bunded and clear of drains?","type":"checkbox","options":[],"required":false},
     {"key":"washout_contained","label":"Concrete washout contained?","type":"checkbox","options":[],"required":false},
     {"key":"dewatering_controlled","label":"Dewatering discharges controlled and clear?","type":"checkbox","options":[],"required":false},
     {"key":"turbidity_reading","label":"Discharge turbidity reading (NTU) — if discharging","type":"number","options":[],"required":false},
     {"key":"turbidity_limit","label":"Turbidity limit (NTU)","type":"number","options":[],"required":false},
     {"key":"exceeded","label":"Any limit exceeded or sediment discharge observed?","type":"checkbox","options":[],"required":false},
     {"key":"actions_required","label":"Defects found / actions required","type":"textarea","options":[],"required":false},
     {"key":"photos","label":"Photos of controls","type":"photo","options":[],"required":false}
   ]'::jsonb,
   1, true, false)
on conflict do nothing;

-- ─── 0032_itp_lots.sql ───────────────────────────────────────────────────
-- 0032_itp_lots.sql
-- ITP / Lot conformance / test records — ISO 9001 §8.5.1/8.5.2/8.6/8.7/7.1.5.
-- A civil QC register proving work was inspected and tested against spec
-- before acceptance:
--
--   itp_templates + itp_template_items   reusable inspection & test plans
--                                        (activity × criteria × H/W/S point)
--   itp_instances + itp_instance_items   one adoption per project — template
--                                        rows are COPIED at adoption so a
--                                        later template edit never silently
--                                        changes an in-flight ITP
--   lots                                 work broken into conformance lots
--                                        (LOT-0001 via next_number('lot'))
--   lot_inspections                      per-lot, per-ITP-item pass/fail
--   lot_test_results                     compaction/concrete/survey/validation
--                                        test records with spec ranges
--
-- HOLD-POINT UNIFICATION (locked decision): the programme hold_points table is
-- EXTENDED, not duplicated — task_id relaxed to nullable, lot_id +
-- itp_instance_item_id added, origin 'programme'|'quality', and a CHECK that
-- exactly one parent context exists. Quality hold points reuse the existing
-- notify/release flow; the programme Gantt/PDF filter to origin='programme'.
--
-- CONFORMANCE is computed by lot_conformance(lot_id) (SQL, never hand-set) and
-- mirrored into lots.status by sync triggers (inspections, tests, hold points,
-- linked-NCR closes). 'closed' is a lifecycle state set by the server action
-- behind the close gate: no open hold points, no failed record without a
-- linked CLOSED NCR (NCR close carries verification-of-effectiveness).
--
-- FAILURES raise NCRs: inspection/test failures link an NCR via ncr_id; the
-- ncrs source CHECK gains 'itp' (mirrors how 'legal_compliance' landed in
-- 0025). Both the ncrs source CHECK and the attachments parent-type CHECK are
-- rebuilt DYNAMICALLY from whatever values exist live (a sibling migration
-- adds 'waste_load' — order must not matter), keeping all existing values and
-- adding ours ('lot' seeded alongside 'waste_load' so either apply order
-- converges).
--
-- FIELD role is READ-ONLY on all ITP/lot tables in v1 (SELECT yes, write no).
-- Conventions follow 0014/0020: current_app_role() RLS, audit_whs() AFTER
-- triggers, next_number sequences, idempotent Rev A seeds with stable UUIDs.

------------------------------------------------------------------------------
-- 1. Tables
------------------------------------------------------------------------------

create table itp_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  activity text not null,               -- the work activity the plan covers
  discipline text,                      -- e.g. Civil / Remediation
  active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index itp_templates_active_idx on itp_templates (active);

create table itp_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references itp_templates(id) on delete cascade,
  position int not null,
  description text not null,            -- the inspection / test
  acceptance_criteria text not null,
  spec_ref text,                        -- e.g. 'AS 3798 §8'
  point_type text not null default 'surveillance'
    check (point_type in ('hold','witness','surveillance')),
  record_required boolean not null default true,
  responsible text,                     -- who inspects / verifies
  created_at timestamptz not null default now()
);
create index itp_template_items_template_idx on itp_template_items (template_id, position);

create table itp_instances (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,          -- ITP-0001 via next_number('itp')
  project_id uuid not null references projects(id) on delete cascade,
  template_id uuid not null references itp_templates(id),
  title text not null,                  -- template name snapshot at adoption
  activity text not null,               -- template activity snapshot
  status text not null default 'active' check (status in ('active','closed')),
  adopted_by uuid references profiles(id),
  adopted_at timestamptz not null default now()
);
create index itp_instances_project_idx on itp_instances (project_id);
create index itp_instances_template_idx on itp_instances (template_id);

create table itp_instance_items (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references itp_instances(id) on delete cascade,
  position int not null,
  description text not null,            -- copied from the template at adoption
  acceptance_criteria text not null,
  spec_ref text,
  point_type text not null default 'surveillance'
    check (point_type in ('hold','witness','surveillance')),
  record_required boolean not null default true,
  responsible text,
  status text not null default 'pending'
    check (status in ('pending','passed','failed','na')),
  checked_by uuid references profiles(id),
  checked_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create index itp_instance_items_instance_idx on itp_instance_items (instance_id, position);

create table lots (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,          -- LOT-0001 via next_number('lot')
  project_id uuid not null references projects(id) on delete cascade,
  itp_instance_id uuid not null references itp_instances(id),
  description text not null,            -- what work the lot covers
  location text,                        -- chainage / area / level
  -- Lifecycle + conformance. open/conforming/nonconforming are COMPUTED by
  -- lot_conformance() and mirrored here by the sync triggers below; 'closed'
  -- is set only by the gated server action.
  status text not null default 'open'
    check (status in ('open','conforming','nonconforming','closed')),
  opened_on date not null default (now() at time zone 'Australia/Brisbane')::date,
  closed_at timestamptz,
  closed_by uuid references profiles(id),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index lots_project_idx on lots (project_id);
create index lots_instance_idx on lots (itp_instance_id);
create index lots_status_idx on lots (status);

create table lot_inspections (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references lots(id) on delete cascade,
  itp_instance_item_id uuid not null references itp_instance_items(id) on delete cascade,
  result text not null check (result in ('pass','fail')),
  notes text,
  inspected_by uuid references profiles(id),
  inspected_at timestamptz not null default now(),
  -- A failed inspection raises an NCR; the lot cannot close while a failure
  -- lacks a linked CLOSED NCR (gate in the server action + lot_conformance()).
  ncr_id uuid references ncrs(id) on delete set null,
  created_at timestamptz not null default now()
);
create index lot_inspections_lot_idx on lot_inspections (lot_id);
create index lot_inspections_item_idx on lot_inspections (itp_instance_item_id);
create index lot_inspections_ncr_idx on lot_inspections (ncr_id);

create table lot_test_results (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references lots(id) on delete cascade,
  test_type text not null check (test_type in (
    'compaction','concrete_strength','survey_conformance',
    'environmental_validation','other'
  )),
  description text not null,            -- e.g. 'Density ratio — layer 2, ch 120'
  value numeric,                        -- measured value (nullable: pass/fail-only tests)
  uom text,                             -- unit of measure, e.g. '% MDD', 'MPa'
  spec_min numeric,
  spec_max numeric,
  pass boolean not null,
  lab_ref text,                         -- NATA report / docket reference
  tested_on date,
  ncr_id uuid references ncrs(id) on delete set null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index lot_test_results_lot_idx on lot_test_results (lot_id);
create index lot_test_results_ncr_idx on lot_test_results (ncr_id);

------------------------------------------------------------------------------
-- 2. Hold-point unification — extend programme hold_points (locked decision)
------------------------------------------------------------------------------

alter table hold_points alter column task_id drop not null;

alter table hold_points
  add column origin text not null default 'programme'
    check (origin in ('programme','quality')),
  add column lot_id uuid references lots(id) on delete cascade,
  add column itp_instance_item_id uuid references itp_instance_items(id) on delete set null;

-- Exactly one parent context: a programme hold point sits on a task, a
-- quality hold point sits on a lot. Existing rows are all origin='programme'
-- with a task_id, so this validates cleanly.
alter table hold_points add constraint hold_points_parent_check check (
  (origin = 'programme' and task_id is not null and lot_id is null)
  or (origin = 'quality' and lot_id is not null and task_id is null)
);

create index hold_points_lot_idx on hold_points (lot_id);

------------------------------------------------------------------------------
-- 3. Dynamic CHECK extensions (order-independent vs sibling 0031)
------------------------------------------------------------------------------

-- attachments.parent_type: keep every value currently live, add 'lot' (ours)
-- and 'waste_load' (sibling's — seeded so either apply order converges).
do $$
declare
  vals text[];
begin
  select coalesce(array_agg(distinct m[1]), '{}'::text[]) into vals
  from pg_constraint c
  cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
  where c.conname = 'attachments_parent_type_check'
    and c.conrelid = 'public.attachments'::regclass;

  if coalesce(array_length(vals, 1), 0) = 0 then
    raise exception 'attachments_parent_type_check not found — refusing to guess the value list';
  end if;

  if not (vals @> array['lot'])        then vals := array_append(vals, 'lot'); end if;
  if not (vals @> array['waste_load']) then vals := array_append(vals, 'waste_load'); end if;

  execute 'alter table public.attachments drop constraint attachments_parent_type_check';
  execute format(
    'alter table public.attachments add constraint attachments_parent_type_check check (parent_type = any (array[%s]::text[]))',
    (select string_agg(quote_literal(v), ', ') from unnest(vals) v)
  );
end $$;

-- ncrs.source: keep every value currently live, add 'itp' (mirrors 0025's
-- 'legal_compliance' extension).
do $$
declare
  vals text[];
begin
  select coalesce(array_agg(distinct m[1]), '{}'::text[]) into vals
  from pg_constraint c
  cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
  where c.conname = 'ncrs_source_check'
    and c.conrelid = 'public.ncrs'::regclass;

  if coalesce(array_length(vals, 1), 0) = 0 then
    raise exception 'ncrs_source_check not found — refusing to guess the value list';
  end if;

  if not (vals @> array['itp']) then vals := array_append(vals, 'itp'); end if;

  execute 'alter table public.ncrs drop constraint ncrs_source_check';
  execute format(
    'alter table public.ncrs add constraint ncrs_source_check check (source = any (array[%s]::text[]))',
    (select string_agg(quote_literal(v), ', ') from unnest(vals) v)
  );
end $$;

------------------------------------------------------------------------------
-- 4. Attachment read scope: supervisors/field may read 'lot' evidence
--    (recreates the 0019 scoped policies with the operational set extended;
--    'waste_load'/'env_permit' included so the sibling module's evidence
--    survives whichever migration lands second)
------------------------------------------------------------------------------

drop policy if exists attachments_select_scoped on public.attachments;
create policy attachments_select_scoped on public.attachments
  for select to authenticated
  using (
    current_app_role() in ('admin','office')
    or parent_type in (
      'job','project','diary','incident','form_submission','ncr',
      'lot','waste_load','env_permit'
    )
  );

drop policy if exists "attachments_select_scoped" on storage.objects;
create policy "attachments_select_scoped" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (
      current_app_role() in ('admin','office')
      or (storage.foldername(name))[1] in (
        'job','project','diary','incident','form_submission','ncr',
        'swms','whs-documents','lot','waste_load','env_permit'
      )
    )
  );

------------------------------------------------------------------------------
-- 5. Conformance function + status sync (never hand-set)
------------------------------------------------------------------------------

-- Computed conformance for a lot:
--   'nonconforming'  any failed inspection/test without a linked CLOSED NCR
--   'open'           unreleased quality hold point, or a record-required item
--                    (not NA) still lacking a passing inspection for this lot
--   'conforming'     everything inspected/passed (failures resolved via
--                    closed NCRs count as dispositioned)
create function lot_conformance(p_lot uuid) returns text
language sql stable
as $$
  select case
    when exists (
      select 1 from lot_inspections li
      left join ncrs n on n.id = li.ncr_id
      where li.lot_id = p_lot
        and li.result = 'fail'
        and (n.id is null or n.status <> 'closed')
    ) or exists (
      select 1 from lot_test_results tr
      left join ncrs n on n.id = tr.ncr_id
      where tr.lot_id = p_lot
        and tr.pass = false
        and (n.id is null or n.status <> 'closed')
    ) then 'nonconforming'
    when exists (
      select 1 from hold_points hp
      where hp.lot_id = p_lot and hp.status <> 'released'
    ) then 'open'
    when exists (
      select 1
      from lots l
      join itp_instance_items ii on ii.instance_id = l.itp_instance_id
      where l.id = p_lot
        and ii.status <> 'na'
        and ii.record_required
        and not exists (
          select 1 from lot_inspections li2
          where li2.lot_id = p_lot
            and li2.itp_instance_item_id = ii.id
            and li2.result = 'pass'
        )
    ) then 'open'
    else 'conforming'
  end
$$;

-- Mirrors lot_conformance() into lots.status for non-closed lots (register
-- filtering / dashboards read the stored value; the close gate re-computes
-- live). No-op when the value is unchanged so the audit trail stays clean.
create function lot_status_refresh(p_lot uuid) returns void
language plpgsql
as $$
begin
  update lots
     set status = lot_conformance(p_lot)
   where id = p_lot
     and status <> 'closed'
     and status is distinct from lot_conformance(p_lot);
end $$;

create function lot_records_sync() returns trigger
language plpgsql
as $$
begin
  perform lot_status_refresh(coalesce(new.lot_id, old.lot_id));
  return null;
end $$;
revoke execute on function lot_records_sync() from anon, authenticated, public;

create trigger lot_inspections_status_sync
  after insert or update or delete on public.lot_inspections
  for each row execute function lot_records_sync();

create trigger lot_test_results_status_sync
  after insert or update or delete on public.lot_test_results
  for each row execute function lot_records_sync();

create function lot_hold_point_sync() returns trigger
language plpgsql
as $$
begin
  if coalesce(new.lot_id, old.lot_id) is not null then
    perform lot_status_refresh(coalesce(new.lot_id, old.lot_id));
  end if;
  return null;
end $$;
revoke execute on function lot_hold_point_sync() from anon, authenticated, public;

create trigger hold_points_lot_status_sync
  after insert or update or delete on public.hold_points
  for each row execute function lot_hold_point_sync();

-- Closing (or reopening) an NCR can resolve a lot failure — refresh every lot
-- linked to it via a failed inspection or test.
create function lot_ncr_sync() returns trigger
language plpgsql
as $$
declare
  l uuid;
begin
  for l in
    select distinct lot_id from (
      select lot_id from lot_inspections where ncr_id = new.id
      union
      select lot_id from lot_test_results where ncr_id = new.id
    ) linked
  loop
    perform lot_status_refresh(l);
  end loop;
  return null;
end $$;
revoke execute on function lot_ncr_sync() from anon, authenticated, public;

create trigger ncrs_lot_status_sync
  after update of status on public.ncrs
  for each row execute function lot_ncr_sync();

------------------------------------------------------------------------------
-- 6. RLS — field is READ-ONLY on ITP/lots v1 (SELECT yes, no writes)
------------------------------------------------------------------------------

alter table itp_templates      enable row level security;
alter table itp_template_items enable row level security;
alter table itp_instances      enable row level security;
alter table itp_instance_items enable row level security;
alter table lots               enable row level security;
alter table lot_inspections    enable row level security;
alter table lot_test_results   enable row level security;

-- Templates: admin/office manage (Settings builder); everyone reads.
create policy itp_templates_select_authenticated on itp_templates
  for select to authenticated using (auth.uid() is not null);
create policy itp_templates_insert_admin_office on itp_templates
  for insert to authenticated
  with check (current_app_role() in ('admin','office'));
create policy itp_templates_update_admin_office on itp_templates
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy itp_templates_delete_admin on itp_templates
  for delete to authenticated using (current_app_role() = 'admin');

create policy itp_template_items_select_authenticated on itp_template_items
  for select to authenticated using (auth.uid() is not null);
create policy itp_template_items_insert_admin_office on itp_template_items
  for insert to authenticated
  with check (current_app_role() in ('admin','office'));
create policy itp_template_items_update_admin_office on itp_template_items
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy itp_template_items_delete_admin_office on itp_template_items
  for delete to authenticated
  using (current_app_role() in ('admin','office'));

-- Instances / items / lots / records: staff (a/o/s) manage; field reads.
do $$
declare t text;
begin
  foreach t in array array[
    'itp_instances','itp_instance_items','lots','lot_inspections','lot_test_results'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (auth.uid() is not null)',
      t || '_select_authenticated', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (current_app_role() in (''admin'',''office'',''supervisor''))',
      t || '_insert_staff', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (current_app_role() in (''admin'',''office'',''supervisor''))
         with check (current_app_role() in (''admin'',''office'',''supervisor''))',
      t || '_update_staff', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (current_app_role() = ''admin'')',
      t || '_delete_admin', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 7. Audit triggers (append-only audit_log — ISO records control)
------------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'itp_templates','itp_template_items','itp_instances','itp_instance_items',
    'lots','lot_inspections','lot_test_results'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function audit_whs()',
      t || '_audit', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 8. Sequences: ITP-0001 / LOT-0001 via next_number
------------------------------------------------------------------------------

insert into sequences (key, next_value) values ('itp', 1), ('lot', 1)
on conflict (key) do nothing;

------------------------------------------------------------------------------
-- 9. Seed — 5 civil/remediation ITP templates (idempotent, stable UUIDs,
--    Rev A — review before adoption)
------------------------------------------------------------------------------

insert into itp_templates (id, name, activity, discipline) values
  ('b1000000-0000-4000-a000-000000000001',
   'Bulk Earthworks & Subgrade — Rev A',
   'Bulk earthworks and subgrade preparation', 'Civil'),
  ('b1000000-0000-4000-a000-000000000002',
   'Stormwater Drainage — Rev A',
   'Stormwater drainage installation', 'Civil'),
  ('b1000000-0000-4000-a000-000000000003',
   'Concrete Works — Rev A',
   'Structural and minor concrete works', 'Civil'),
  ('b1000000-0000-4000-a000-000000000004',
   'Asbestos Remediation Validation — Rev A',
   'Asbestos removal and clearance validation', 'Remediation'),
  ('b1000000-0000-4000-a000-000000000005',
   'Contaminated Land Validation — Rev A',
   'Contaminated soil excavation and validation', 'Remediation')
on conflict do nothing;

insert into itp_template_items
  (id, template_id, position, description, acceptance_criteria, spec_ref, point_type, record_required, responsible)
values
  -- 1. Bulk Earthworks & Subgrade
  ('b2000000-0000-4000-a000-000000000101', 'b1000000-0000-4000-a000-000000000001', 1,
   'Survey set-out and existing services located',
   'Set-out matches IFC drawings; underground services located, marked and protected',
   'IFC drawings; DBYD', 'surveillance', true, 'Site supervisor'),
  ('b2000000-0000-4000-a000-000000000102', 'b1000000-0000-4000-a000-000000000001', 2,
   'Strip topsoil and remove unsuitable material',
   'Topsoil stockpiled separately; unsuitable/deleterious material removed as directed',
   'AS 3798 §4', 'surveillance', true, 'Site supervisor'),
  ('b2000000-0000-4000-a000-000000000103', 'b1000000-0000-4000-a000-000000000001', 3,
   'Proof roll subgrade',
   'No visible deflection, rutting or springing under a loaded roller pass',
   'AS 3798 §5.4', 'witness', true, 'Geotechnical engineer'),
  ('b2000000-0000-4000-a000-000000000104', 'b1000000-0000-4000-a000-000000000001', 4,
   'Layer compaction testing',
   'Density ratio ≥ 95% Standard MDD; moisture within ±2% of OMC; min 1 test per 500 m² per layer',
   'AS 1289 5.4.1 / AS 3798 §8', 'surveillance', true, 'NATA laboratory'),
  ('b2000000-0000-4000-a000-000000000105', 'b1000000-0000-4000-a000-000000000001', 5,
   'Subgrade level conformance survey',
   'Finished subgrade within +10/−25 mm of design level; survey conformance report issued before pavement',
   'AS 3798; project specification', 'hold', true, 'Surveyor / Superintendent'),

  -- 2. Stormwater Drainage
  ('b2000000-0000-4000-a000-000000000201', 'b1000000-0000-4000-a000-000000000002', 1,
   'Trench excavation and bedding',
   'Trench to line, level and grade; bedding zone material and thickness per specification',
   'AS/NZS 3725', 'surveillance', true, 'Site supervisor'),
  ('b2000000-0000-4000-a000-000000000202', 'b1000000-0000-4000-a000-000000000002', 2,
   'Pipe supply verification',
   'Pipe class/type matches design; no transit damage; jointing components correct',
   'AS/NZS 4058; IFC drawings', 'surveillance', true, 'Site supervisor'),
  ('b2000000-0000-4000-a000-000000000203', 'b1000000-0000-4000-a000-000000000002', 3,
   'Pre-backfill joint and alignment inspection',
   'Joints correctly made; line and level within tolerance prior to any backfill',
   'AS/NZS 3725 §7', 'witness', true, 'Superintendent'),
  ('b2000000-0000-4000-a000-000000000204', 'b1000000-0000-4000-a000-000000000002', 4,
   'Trench backfill compaction',
   'Density ratio ≥ 95% Standard MDD in trafficked areas; layers ≤ 200 mm compacted thickness',
   'AS 1289 5.4.1', 'surveillance', true, 'NATA laboratory'),
  ('b2000000-0000-4000-a000-000000000205', 'b1000000-0000-4000-a000-000000000002', 5,
   'As-constructed survey and CCTV',
   'Invert levels within ±10 mm; CCTV shows joints sound and no defects; as-built lodged',
   'Project specification; WSAA', 'hold', true, 'Surveyor / Superintendent'),

  -- 3. Concrete Works
  ('b2000000-0000-4000-a000-000000000301', 'b1000000-0000-4000-a000-000000000003', 1,
   'Formwork and reinforcement pre-pour inspection',
   'Formwork to line/level and robust; reinforcement size, spacing, laps and cover per drawings',
   'AS 3600; AS 3610', 'hold', true, 'Engineer / Superintendent'),
  ('b2000000-0000-4000-a000-000000000302', 'b1000000-0000-4000-a000-000000000003', 2,
   'Concrete supply docket check',
   'Mix design, strength grade and slump per specification; discharged within 90 min of batching',
   'AS 1379', 'surveillance', true, 'Site supervisor'),
  ('b2000000-0000-4000-a000-000000000303', 'b1000000-0000-4000-a000-000000000003', 3,
   'Slump testing on delivery',
   'Slump within ±15 mm of specified value',
   'AS 1012.3.1', 'surveillance', true, 'Testing technician'),
  ('b2000000-0000-4000-a000-000000000304', 'b1000000-0000-4000-a000-000000000003', 4,
   'Compressive strength cylinders',
   'Sampled min 1 set per 50 m³ or part thereof; 28-day strength ≥ specified f''c',
   'AS 1012.8 / AS 1012.9; AS 1379', 'surveillance', true, 'NATA laboratory'),
  ('b2000000-0000-4000-a000-000000000305', 'b1000000-0000-4000-a000-000000000003', 5,
   'Curing regime',
   'Curing compound or wet curing maintained min 7 days; surfaces protected from damage',
   'AS 3600 §17', 'surveillance', true, 'Site supervisor'),

  -- 4. Asbestos Remediation Validation
  ('b2000000-0000-4000-a000-000000000401', 'b1000000-0000-4000-a000-000000000004', 1,
   'Removal control area established',
   'Barricades, signage, decontamination unit and negative-air enclosure (Class A) in place before removal starts',
   'WHS Reg 2011 (Qld) Ch 8; How to Safely Remove Asbestos COP', 'witness', true, 'Asbestos supervisor'),
  ('b2000000-0000-4000-a000-000000000402', 'b1000000-0000-4000-a000-000000000004', 2,
   'Air monitoring during removal',
   'Respirable fibre concentration < 0.01 f/mL at the control boundary; results reported within 24 h',
   'Membrane Filter Method NOHSC:3003', 'surveillance', true, 'Licensed asbestos assessor'),
  ('b2000000-0000-4000-a000-000000000403', 'b1000000-0000-4000-a000-000000000004', 3,
   'Visual clearance inspection of removal area',
   'No visible asbestos residue, dust or debris within the removal area or waste routes',
   'How to Safely Remove Asbestos COP', 'surveillance', true, 'Licensed asbestos assessor'),
  ('b2000000-0000-4000-a000-000000000404', 'b1000000-0000-4000-a000-000000000004', 4,
   'Clearance certificate before reoccupation',
   'Clearance certificate issued (visual clearance + clearance air monitoring < 0.01 f/mL) BEFORE the area is reoccupied',
   'WHS Reg 2011 (Qld) r 473; company SMS', 'hold', true, 'Licensed asbestos assessor'),
  ('b2000000-0000-4000-a000-000000000405', 'b1000000-0000-4000-a000-000000000004', 5,
   'Waste transport and disposal dockets',
   'All ACM consigned to a licensed facility; waste transport certificates/dockets retained',
   'EPA waste tracking; POEO Waste Reg (NSW)', 'surveillance', true, 'Site supervisor'),

  -- 5. Contaminated Land Validation
  ('b2000000-0000-4000-a000-000000000501', 'b1000000-0000-4000-a000-000000000005', 1,
   'Excavation extents versus RAP',
   'Excavation extents surveyed and consistent with the Remediation Action Plan',
   'RAP; project specification', 'surveillance', true, 'Surveyor'),
  ('b2000000-0000-4000-a000-000000000502', 'b1000000-0000-4000-a000-000000000005', 2,
   'Validation sampling of base and walls',
   'Sampling density and locations per the SAQP grid; samples to NATA lab under chain of custody',
   'ASC NEPM 2013 Sch B2', 'surveillance', true, 'Environmental consultant'),
  ('b2000000-0000-4000-a000-000000000503', 'b1000000-0000-4000-a000-000000000005', 3,
   'Laboratory results versus adopted criteria',
   'All validation results below the adopted assessment criteria (HIL/EIL/ESL/Management Limits)',
   'ASC NEPM 2013 Sch B1', 'witness', true, 'Environmental consultant'),
  ('b2000000-0000-4000-a000-000000000504', 'b1000000-0000-4000-a000-000000000005', 4,
   'Imported fill certification',
   'Imported material certified VENM/ENM with source documentation before placement',
   'ASC NEPM; EPA resource recovery', 'surveillance', true, 'Site supervisor'),
  ('b2000000-0000-4000-a000-000000000505', 'b1000000-0000-4000-a000-000000000005', 5,
   'Validation report accepted',
   'Validation report accepted by the environmental consultant/auditor before backfill or handover',
   'RAP; ASC NEPM 2013', 'hold', true, 'Environmental consultant')
on conflict do nothing;

-- ─── 0033_cp3_email.sql ──────────────────────────────────────────────────
-- 0033_cp3_email.sql
-- Client Portal CP3 — email engine, notification preferences and feedback
-- (roadmap docs/superpowers/plans/2026-07-03-client-portal-roadmap.md §CP3).
--
--   * email_log — every attempted outbound email (sent | failed | skipped).
--     The app degrades gracefully: with no RESEND_API_KEY configured the send
--     wrapper still logs the attempt as 'skipped', so the owner can see what
--     WOULD have gone out before turning sending on. Admin SELECT only; the
--     ONLY write path is log_email() below (definer, flood-capped) — it works
--     identically from the cron route, office server actions and the
--     anonymous portal actions (mirrors log_app_error from 0027).
--   * client_links.notifications_enabled — per-link opt-out for the daily
--     client compliance digest (office toggles it on the client Portal card).
--   * portal_feedback — post-completion satisfaction ratings captured in the
--     portal ("How did we do?"), one per link per completed work. Feeds the
--     customer_satisfaction_avg AUTO metric (src/lib/kpi-metrics.ts).
--
-- Security shape is identical to CP1/CP2: NO anon table policies anywhere;
-- anonymous writes go through SECURITY DEFINER functions that validate the
-- token internally (portal_live_link), enforce rate limits and return null
-- for dead tokens.

------------------------------------------------------------------------------
-- 1. email_log
------------------------------------------------------------------------------

create table email_log (
  id uuid primary key default gen_random_uuid(),
  to_address text not null,
  subject text not null,
  template text not null,               -- template key, e.g. 'office_new_request'
  entity_kind text,                     -- related entity ('portal_request', 'client', …)
  entity_id uuid,
  status text not null check (status in ('sent','failed','skipped')),
  provider_id text,                     -- Resend message id when sent
  error text,
  created_at timestamptz not null default now()
);
create index email_log_created_idx on email_log (created_at desc);
-- Digest idempotency lookup: template + entity + day.
create index email_log_dedup_idx on email_log (template, entity_kind, entity_id, created_at desc);

alter table email_log enable row level security;

create policy email_log_select_admin on email_log
  for select to authenticated
  using (current_app_role() = 'admin');
-- No INSERT/UPDATE/DELETE policies for any client role — rows are written
-- exclusively via log_email() (or the service role in the cron route).
-- email_log IS the log, so no audit trigger (noise, not evidence).

-- The only client-visible write path. Granted to anon + authenticated so the
-- send wrapper can log from every context (anonymous portal actions, office
-- server actions, cron). Crude flood control mirrors log_app_error: once 200
-- rows landed in the last hour, drop silently.
create function log_email(
  p_to text,
  p_subject text,
  p_template text,
  p_status text,
  p_entity_kind text default null,
  p_entity_id uuid default null,
  p_provider_id text default null,
  p_error text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_status is null or p_status not in ('sent','failed','skipped') then
    return false;
  end if;
  if (select count(*) from email_log where created_at > now() - interval '1 hour') >= 200 then
    return false;
  end if;
  insert into email_log
    (to_address, subject, template, status, entity_kind, entity_id, provider_id, error)
  values (
    left(coalesce(nullif(trim(p_to), ''), '(none)'), 320),
    left(coalesce(nullif(trim(p_subject), ''), '(no subject)'), 500),
    left(coalesce(nullif(trim(p_template), ''), 'unknown'), 100),
    p_status,
    left(p_entity_kind, 50),
    p_entity_id,
    left(p_provider_id, 100),
    left(p_error, 1000)
  );
  return true;
end $$;

grant execute on function log_email(text, text, text, text, text, uuid, text, text)
  to anon, authenticated;

------------------------------------------------------------------------------
-- 2. client_links.notifications_enabled (daily digest opt-out, per link)
------------------------------------------------------------------------------

alter table client_links
  add column notifications_enabled boolean not null default true;

------------------------------------------------------------------------------
-- 3. portal_feedback
------------------------------------------------------------------------------

create table portal_feedback (
  id uuid primary key default gen_random_uuid(),
  client_link_id uuid not null references client_links(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  -- Exactly one completed work reference.
  job_id uuid references jobs(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 2000),
  created_at timestamptz not null default now(),
  check (
    (job_id is not null and project_id is null)
    or (job_id is null and project_id is not null)
  )
);
create index portal_feedback_client_idx on portal_feedback (client_id, created_at desc);
create index portal_feedback_site_idx on portal_feedback (site_id);
create index portal_feedback_created_idx on portal_feedback (created_at);
-- One rating per link per completed work (belt & braces with the fn check).
create unique index portal_feedback_link_job_idx
  on portal_feedback (client_link_id, job_id) where job_id is not null;
create unique index portal_feedback_link_project_idx
  on portal_feedback (client_link_id, project_id) where project_id is not null;

alter table portal_feedback enable row level security;

-- Staff read-only evidence; writes happen exclusively in
-- portal_submit_feedback() — no INSERT/UPDATE/DELETE policy at all.
create policy portal_feedback_select_admin_office on portal_feedback
  for select to authenticated
  using (current_app_role() in ('admin','office'));

-- Audit trail (audit_whs from 0010).
create trigger portal_feedback_audit
  after insert or update or delete on portal_feedback
  for each row execute function audit_whs();

------------------------------------------------------------------------------
-- 4. Anonymous portal fns (security definer; token validated internally)
------------------------------------------------------------------------------

-- Client rates a COMPLETED work on one of their own properties. Rules:
--   * jobs must be completed/invoiced/paid; projects must be closed — the
--     same grouping the portal's works-history timeline uses
--     (workGroupForJob/workGroupForProject in src/lib/portal-experience.ts).
--   * one rating per link per work; 10 submissions per rolling 24h per link.
-- Returns:
--   null                      dead token / work not this client's / not completed
--   {'error':'invalid'}       bad rating or oversized comment
--   {'error':'rate_limited'}  over the daily cap
--   {'error':'already'}       this link already rated this work
--   {'ok':true}               stored
create function portal_submit_feedback(
  p_token text, p_kind text, p_id uuid, p_rating int, p_comment text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_site uuid;
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if p_kind not in ('job','project') then return null; end if;

  if p_rating is null or p_rating < 1 or p_rating > 5
     or char_length(coalesce(v_comment, '')) > 2000 then
    return jsonb_build_object('error', 'invalid');
  end if;

  if p_kind = 'job' then
    select j.site_id into v_site
      from jobs j
      join sites s on s.id = j.site_id and s.client_id = l.client_id
     where j.id = p_id and j.status in ('completed','invoiced','paid');
  else
    select p.site_id into v_site
      from projects p
      join sites s on s.id = p.site_id and s.client_id = l.client_id
     where p.id = p_id and p.status = 'closed';
  end if;
  if v_site is null then return null; end if;

  if (select count(*) from portal_feedback
       where client_link_id = l.id
         and created_at > now() - interval '24 hours') >= 10 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  if exists (select 1 from portal_feedback
              where client_link_id = l.id
                and ((p_kind = 'job' and job_id = p_id)
                  or (p_kind = 'project' and project_id = p_id))) then
    return jsonb_build_object('error', 'already');
  end if;

  insert into portal_feedback
    (client_link_id, client_id, site_id, job_id, project_id, rating, comment)
  values (
    l.id, l.client_id, v_site,
    case when p_kind = 'job' then p_id end,
    case when p_kind = 'project' then p_id end,
    p_rating, v_comment
  );

  return jsonb_build_object('ok', true);
end $$;

-- The feedback THIS LINK has already submitted (drives the works-tab card
-- state: rate vs thank-you). Optionally scoped to one property.
create function portal_my_feedback(p_token text, p_site uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'job_id', f.job_id,
      'project_id', f.project_id,
      'rating', f.rating)
      order by f.created_at desc)
    from portal_feedback f
    where f.client_link_id = l.id
      and (p_site is null or f.site_id = p_site)
  ), '[]'::jsonb);
end $$;

-- Property name for notification emails composed from the anonymous portal
-- actions (they cannot read sites directly). Null unless the site belongs to
-- the token's client — same guard as every other portal fn.
create function portal_site_name(p_token text, p_site uuid) returns text
language sql stable security definer set search_path = public as $$
  select s.name
  from portal_live_link(p_token) l
  join sites s on s.id = p_site and s.client_id = l.client_id
  where l.id is not null;
$$;

grant execute on function portal_submit_feedback(text, text, uuid, int, text) to anon, authenticated;
grant execute on function portal_my_feedback(text, uuid) to anon, authenticated;
grant execute on function portal_site_name(text, uuid) to anon, authenticated;

-- ─── 0034_request_sync.sql ───────────────────────────────────────────────
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

-- ─── 0035_calendar_feeds.sql ─────────────────────────────────────────────
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

-- ─── 0036_prestart_meeting.sql ───────────────────────────────────────────
-- 0036_prestart_meeting.sql
-- Adds the 'prestart_meeting' WHS form kind: a crew DAILY PRE-START MEETING
-- (briefing + crew sign-on) — a sibling to 'toolbox'. Deliberately DISTINCT from
-- the existing plant/machine 'prestart' kind (which is bound to a plant item and
-- collects no attendance). Mirrors the 0020 'audit' pattern for the kind checks,
-- then seeds a system "Daily Pre-Start Meeting" template with requires_signon=true.

------------------------------------------------------------------------------
-- 1. Allow the new kind on both forms-engine tables
------------------------------------------------------------------------------

alter table form_templates drop constraint form_templates_kind_check;
alter table form_templates add constraint form_templates_kind_check
  check (kind in ('prestart','take5','toolbox','induction','incident','custom','audit','prestart_meeting'));

alter table form_submissions drop constraint form_submissions_kind_check;
alter table form_submissions add constraint form_submissions_kind_check
  check (kind in ('prestart','take5','toolbox','induction','incident','custom','audit','prestart_meeting'));

------------------------------------------------------------------------------
-- 2. System Daily Pre-Start Meeting template (a default, not demo data).
--    requires_signon=true so it collects the day's crew sign-on (in-app + QR),
--    exactly like the Toolbox Talk template. Fields are a starting point — an
--    admin can tailor them to ECR's SMS pre-start form in Settings → WHS Forms.
------------------------------------------------------------------------------

insert into form_templates (id, kind, name, description, schema, version, active, requires_signon) values
  ('fa000000-0000-4000-a000-0000000000a1', 'prestart_meeting', 'Daily Pre-Start Meeting',
   'Daily crew pre-start held before work begins. Record the briefing, then collect crew sign-on for the day.',
   '[
     {"key":"weather","label":"Weather / site conditions","type":"text","required":false},
     {"key":"work_planned","label":"Work planned today","type":"textarea","required":true},
     {"key":"key_hazards","label":"Key hazards today","type":"textarea","required":true},
     {"key":"controls","label":"Controls in place","type":"textarea","required":true},
     {"key":"swms_referenced","label":"SWMS / SDS referenced today","type":"text","required":false},
     {"key":"permits","label":"Permits in place (asbestos removal control plan, hot work, confined space)","type":"text","required":false},
     {"key":"plant_equipment","label":"Plant & equipment in use today","type":"textarea","required":false},
     {"key":"emergency_confirmed","label":"Emergency arrangements confirmed (assembly point, first aider, spill kit)","type":"checkbox","required":true},
     {"key":"matters_raised","label":"Matters raised by crew","type":"textarea","required":false},
     {"key":"conducted_by","label":"Conducted by","type":"text","required":true}
   ]'::jsonb, 1, true, true)
on conflict (id) do nothing;

-- ─── 0037_prestart_sms_fields.sql ────────────────────────────────────────
-- 0037_prestart_sms_fields.sql
-- Aligns the seeded "Daily Pre-Start Meeting" template (from 0036) to ECR's
-- controlled form SMS-F-11 "Pre-Start Meeting Record": briefing header, the
-- 8-item daily-checks table (Yes/No/N/A), comments/action refs, and issues
-- raised. The SMS "Attendance" table (Name/Company/Signature) is captured by
-- the built-in sign-on (requires_signon), and Project/site + Date come from the
-- submission itself, so they are not duplicated as fields.
--
-- Safe to replace the schema in place (version stays 1): the template has no
-- submissions yet, so there is no snapshotted data to preserve.

update form_templates set
  name = 'Daily Pre-Start Meeting',
  description = 'Daily crew pre-start meeting (ref SMS-F-11). Record the briefing and daily checks, then collect crew sign-on (Name / Company / Signature) for the day.',
  schema = '[
    {"key":"led_by","label":"Led by","type":"text","required":true},
    {"key":"weather","label":"Weather / site conditions","type":"text","required":false},
    {"key":"activities","label":"Today''s activities and areas of work","type":"textarea","required":true},
    {"key":"hazards_changed","label":"Hazards introduced or changed today (deliveries, plant movements, concurrent trades, occupant interfaces, weather)","type":"textarea","required":true},
    {"key":"chk_swms","label":"SWMS / ARCP for today''s work current and on site","type":"select","options":["Yes","No","N/A"],"required":true},
    {"key":"chk_permits","label":"Permits required today in place","type":"select","options":["Yes","No","N/A"],"required":true},
    {"key":"chk_plant","label":"Plant daily pre-start checks completed","type":"select","options":["Yes","No","N/A"],"required":true},
    {"key":"chk_enclosure","label":"Enclosure, NPU and decontamination checked (removal sites)","type":"select","options":["Yes","No","N/A"],"required":true},
    {"key":"chk_air_monitoring","label":"Air monitoring in place for today''s removal work","type":"select","options":["Yes","No","N/A"],"required":true},
    {"key":"chk_barriers","label":"Barriers, signage and exclusion zones in place","type":"select","options":["Yes","No","N/A"],"required":true},
    {"key":"chk_ppe","label":"PPE and RPE available and worn; fit checks done","type":"select","options":["Yes","No","N/A"],"required":true},
    {"key":"chk_first_aider","label":"First aider on site; emergency plan unchanged","type":"select","options":["Yes","No","N/A"],"required":true},
    {"key":"comments","label":"Comments / action references","type":"textarea","required":false},
    {"key":"issues_raised","label":"Issues raised by workers and responses","type":"textarea","required":false}
  ]'::jsonb
where id = 'fa000000-0000-4000-a000-0000000000a1';

-- ─── 0038_budget_line_attribution.sql ────────────────────────────────────
-- 0038_budget_line_attribution.sql
-- Per-line budget attribution: optionally point a PO line, a commitment, or a
-- cost at a specific budget line. NULL => fall back to cost_code_id grouping
-- (existing behaviour). Mirrors the nullable-FK pattern in 0032_itp_lots.sql.
-- Column addition is covered by the existing table-wide RLS policies (0003),
-- so no policy/grant changes are required. Existing rows stay NULL (no backfill).

alter table po_lines
  add column budget_line_id uuid references budget_lines(id) on delete set null;

alter table commitments
  add column budget_line_id uuid references budget_lines(id) on delete set null;

alter table costs
  add column budget_line_id uuid references budget_lines(id) on delete set null;

create index po_lines_budget_line_idx    on po_lines (budget_line_id);
create index commitments_budget_line_idx on commitments (budget_line_id);
create index costs_budget_line_idx       on costs (budget_line_id);

-- ─── 0039_project_mobilisation.sql ───────────────────────────────────────
-- Project checklists (mirror of job_checklist_items) + a flag that lets a
-- checklist template auto-apply when a quote converts. Seeds ECR's
-- mobilisation checklist for asbestos/civil works.

create table project_checklist_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  text text not null,
  position int not null default 0,
  done boolean not null default false,
  done_by uuid references profiles(id),
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index project_checklist_items_project_idx
  on project_checklist_items (project_id, position);

alter table project_checklist_items enable row level security;

create policy project_checklist_items_read on project_checklist_items
  for select to authenticated using (auth.uid() is not null);

-- Unlike job checklists (field can tick), mobilisation items are compliance
-- records (notification lodged, ARCP issued) — staff-only writes.
create policy project_checklist_items_insert_staff on project_checklist_items
  for insert to authenticated
  with check (current_app_role() in ('admin','office','supervisor'));

create policy project_checklist_items_update_staff on project_checklist_items
  for update to authenticated
  using (current_app_role() in ('admin','office','supervisor'))
  with check (current_app_role() in ('admin','office','supervisor'));

create policy project_checklist_items_delete_staff on project_checklist_items
  for delete to authenticated
  using (current_app_role() in ('admin','office','supervisor'));

-- Templates flagged auto_apply_on_convert seed the checklist at conversion.
alter table checklist_templates
  add column auto_apply_on_convert boolean not null default false;

insert into checklist_templates (title, items, auto_apply_on_convert) values (
  'Mobilisation — before work starts',
  array[
    'WorkSafe QLD asbestos removal notification lodged (5 business days before Class A/B work)',
    'Asbestos Removal Control Plan (ARCP) issued to site',
    'SWMS attached to this work and signed by crew',
    'Crew licences, tickets and inductions verified',
    'Air monitoring arranged (licensed asbestos assessor)',
    'Waste transport and disposal facility booked',
    'Client and site access confirmed'
  ],
  true
);

-- ─── 0040_form_amendments.sql ────────────────────────────────────────────
-- Corrections without mutation: a submission may declare it AMENDS an earlier
-- one. Both rows stay immutable (no UPDATE policy exists on form_submissions);
-- the chain is the audit trail.
alter table form_submissions
  add column amends uuid references form_submissions(id);
create index form_submissions_amends_idx
  on form_submissions (amends) where amends is not null;

-- ─── 0041_renewal_requests.sql ───────────────────────────────────────────
-- A portal work request can reference the compliance item that triggered it
-- (the "red light -> request re-inspection" loop).
alter table portal_requests
  add column compliance_item_id uuid references property_compliance_items(id);
create index portal_requests_compliance_item_idx
  on portal_requests (compliance_item_id) where compliance_item_id is not null;

-- Replace the submit RPC with an optional compliance-item param. The item
-- must belong to the same site (and therefore the same client as the link).
drop function portal_submit_request(text, uuid, text, text, text, text[]);
create function portal_submit_request(
  p_token text, p_site uuid, p_title text, p_description text,
  p_urgency text, p_photo_paths text[] default '{}',
  p_compliance_item uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_title text := left(trim(coalesce(p_title, '')), 200);
  v_desc text := trim(coalesce(p_description, ''));
  v_paths text[] := coalesce(p_photo_paths, '{}');
  v_prefix text;
  v_path text;
  v_number text;
  v_id uuid;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if not exists (select 1 from sites where id = p_site and client_id = l.client_id) then
    return null;
  end if;

  if p_compliance_item is not null and not exists (
    select 1 from property_compliance_items
    where id = p_compliance_item and site_id = p_site
  ) then
    return null;
  end if;

  if v_title = '' or v_desc = '' or char_length(v_desc) > 4000
     or p_urgency not in ('low','normal','high','urgent')
     or coalesce(array_length(v_paths, 1), 0) > 5 then
    return jsonb_build_object('error', 'invalid');
  end if;

  v_prefix := 'portal-requests/' || l.id::text || '/';
  foreach v_path in array v_paths loop
    if v_path not like v_prefix || '%' or position('..' in v_path) > 0 then
      return jsonb_build_object('error', 'invalid');
    end if;
  end loop;

  if (select count(*) from portal_requests
       where client_link_id = l.id
         and created_at > now() - interval '24 hours') >= 10 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  v_number := 'REQ-' || lpad(next_number('portal_request')::text, 4, '0');

  insert into portal_requests
    (number, client_id, site_id, client_link_id, title, description,
     urgency, photo_paths, compliance_item_id)
  values (v_number, l.client_id, p_site, l.id, v_title, v_desc,
          p_urgency, v_paths, p_compliance_item)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'number', v_number, 'id', v_id);
end $$;
grant execute on function portal_submit_request(text, uuid, text, text, text, text[], uuid) to anon, authenticated;

-- ─── 0042_portal_uploads.sql ─────────────────────────────────────────────
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

-- ─── 0043_register_links.sql ─────────────────────────────────────────────
-- Register-scope links: a per-site, compliance-only portal view suitable for
-- printing as an on-site "asbestos register" QR poster (the register must be
-- readily accessible at the workplace).
alter table client_links
  add column scope text not null default 'full' check (scope in ('full','register')),
  add column site_id uuid references sites(id);
-- register links must pin a site
alter table client_links
  add constraint client_links_register_site check (scope <> 'register' or site_id is not null);

-- portal_resolve_link: expose client_id (compliance-report route), scope and
-- site_id (register-only links). Extends the 0029 definition verbatim.
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
    'client_id', l.client_id,
    'client_name', v_client_name,
    'label', l.label,
    'company_name', coalesce(s.company_name, 'Entice'),
    'logo_path', s.logo_path,
    'company_phone', s.phone,
    'company_email', s.email,
    'company_address', s.address,
    'company_abn', s.abn,
    'show_financials', l.show_financials,
    'scope', l.scope,
    'site_id', l.site_id);
end $$;

-- ─── 0044_portal_invoices.sql ────────────────────────────────────────────
-- Invoices become openable in the portal: billing rows carry the invoice id
-- and a token-gated entitlement fn guards the watermarked PDF proxy
-- (/portal/[token]/invoice-pdf/[id]).

-- portal_billing: add 'id' per row (invoice uuid / claim uuid; only invoice
-- ids are consumed — the portal renders a download link for invoices).
create or replace function portal_billing(p_token text, p_site uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
begin
  l := portal_live_link(p_token);
  if l.id is null or not l.show_financials then return null; end if;

  if not exists (select 1 from sites where id = p_site and client_id = l.client_id) then
    return null;
  end if;

  return coalesce((
    select jsonb_agg(row_j order by row_j->>'date' desc, row_j->>'number')
    from (
      select jsonb_build_object(
        'kind', 'invoice',
        'id', i.id,
        'number', i.number,
        'context', j.number || ' — ' || j.title,
        'date', i.issue_date,
        'amount', (select round(coalesce(sum(round(il.qty * il.unit_sell, 2)), 0)
                          * (1 + i.gst_rate / 100), 2)
                     from invoice_lines il where il.invoice_id = i.id),
        'status', i.status) as row_j
      from invoices i
      join jobs j on j.id = i.job_id and j.site_id = p_site
      where i.client_id = l.client_id
        and i.status in ('sent','paid')

      union all

      select jsonb_build_object(
        'kind', 'claim',
        'id', c.id,
        'number', p.number || ' · Claim ' || c.number::text,
        'context', p.number || ' — ' || p.name,
        'date', c.reference_date,
        'amount', c.total_inc_gst,
        'status', c.status) as row_j
      from claims c
      join projects p on p.id = c.project_id
        and p.site_id = p_site and p.client_id = l.client_id
      where c.status in ('submitted','certified','paid')
    ) rows
  ), '[]'::jsonb);
end $$;

-- Entitlement gate for the portal invoice PDF: the link must be live with
-- billing enabled, and the invoice must be the client's own, sent or paid.
-- Logs the download to portal_views. Returns null when not entitled.
create function portal_invoice_file(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_number text;
begin
  l := portal_live_link(p_token);
  if l.id is null or not l.show_financials then return null; end if;

  select i.number into v_number
  from invoices i
  where i.id = p_id
    and i.client_id = l.client_id
    and i.status in ('sent','paid');
  if v_number is null then return null; end if;

  insert into portal_views (client_link_id, site_id, path)
  values (l.id, null, left('file:invoice:' || v_number, 300));

  return jsonb_build_object('ok', true, 'number', v_number);
end $$;
grant execute on function portal_invoice_file(text, uuid) to anon, authenticated;

-- ─── 0045_takeoff.sql ────────────────────────────────────────────────────
-- Takeoff & estimating: measured/extracted quantities per quote, mapped to
-- the rate library and pushed into quote lines. Money-adjacent — admin/office
-- only, like the quotes tables.

create table takeoff_sheets (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  attachment_id uuid not null references attachments(id) on delete cascade,
  name text not null,
  page int not null default 1,
  -- metres per PDF point at this sheet's page; null until calibrated
  scale_m_per_pt numeric,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index takeoff_sheets_quote_idx on takeoff_sheets (quote_id, created_at);

create table takeoff_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  sheet_id uuid references takeoff_sheets(id) on delete set null,
  source text not null default 'manual'
    check (source in ('measured','manual','report','assembly')),
  shape text check (shape in ('area','line','count')),
  geometry jsonb,
  deduction boolean not null default false,
  color text,
  description text not null,
  qty numeric(14,3) not null default 0,
  unit text not null default 'ea',
  rate_item_id uuid references rate_items(id),
  unit_cost numeric(12,2),
  markup_pct numeric(6,2),
  section_title text,
  notes text,
  group_id uuid,
  position int not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index takeoff_items_quote_idx on takeoff_items (quote_id, position);
create index takeoff_items_sheet_idx on takeoff_items (sheet_id) where sheet_id is not null;

-- Assemblies: one unit of the assembly explodes into component quantities.
create table takeoff_assemblies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null default 'm2',
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table takeoff_assembly_components (
  id uuid primary key default gen_random_uuid(),
  assembly_id uuid not null references takeoff_assemblies(id) on delete cascade,
  rate_item_id uuid references rate_items(id),
  description text not null,
  unit text not null default 'ea',
  -- component qty per 1 assembly unit (e.g. 0.5 labour-hours per m2)
  factor numeric(14,4) not null default 1,
  -- OR a flat qty regardless of assembly qty (mobilisation, clearance, ...)
  fixed_qty numeric(14,3),
  position int not null default 0
);
create index takeoff_assembly_components_idx
  on takeoff_assembly_components (assembly_id, position);

-- Provenance: a quote line can point back at the takeoff item it came from.
alter table quote_lines add column takeoff_item_id uuid references takeoff_items(id);

-- RLS: admin/office FOR ALL (money tables pattern).
alter table takeoff_sheets enable row level security;
alter table takeoff_items enable row level security;
alter table takeoff_assemblies enable row level security;
alter table takeoff_assembly_components enable row level security;

create policy takeoff_sheets_office on takeoff_sheets
  for all to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy takeoff_items_office on takeoff_items
  for all to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy takeoff_assemblies_office on takeoff_assemblies
  for all to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy takeoff_assembly_components_office on takeoff_assembly_components
  for all to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));

-- Starter assemblies (ECR asbestos work). Components carry NO rate_items —
-- the owner maps rates in Settings -> Estimating; factors are editable
-- defaults, not gospel.
insert into takeoff_assemblies (name, unit, description) values
  ('Class A friable removal — ceiling/wall', 'm2',
   'Explodes m2 into removal labour, encapsulant, waste bags and air monitoring allowance'),
  ('Non-friable AC sheet removal', 'm2',
   'Bonded asbestos cement sheeting — labour, wrap, disposal allowance'),
  ('Asbestos job fixed costs', 'job',
   'Per-job pack: notification admin, decon unit, signage/barricading, clearance inspection');

insert into takeoff_assembly_components (assembly_id, description, unit, factor, fixed_qty, position)
select a.id, c.description, c.unit, coalesce(c.factor, 1), c.fixed_qty, c.position
from takeoff_assemblies a
join (values
  ('Class A friable removal — ceiling/wall', 'Removal labour', 'hr', 0.5::numeric, null::numeric, 0),
  ('Class A friable removal — ceiling/wall', 'Encapsulant/PVA', 'L', 0.3, null, 1),
  ('Class A friable removal — ceiling/wall', '200um waste bags', 'ea', 0.2, null, 2),
  ('Class A friable removal — ceiling/wall', 'Air monitoring shift', 'ea', null, 1, 3),
  ('Non-friable AC sheet removal', 'Removal labour', 'hr', 0.25, null, 0),
  ('Non-friable AC sheet removal', 'Poly wrap 200um', 'm2', 1.2, null, 1),
  ('Non-friable AC sheet removal', 'Disposal allowance (15kg/m2)', 't', 0.015, null, 2),
  ('Asbestos job fixed costs', 'WorkSafe notification admin', 'ea', null, 1, 0),
  ('Asbestos job fixed costs', 'Decon unit supply', 'ea', null, 1, 1),
  ('Asbestos job fixed costs', 'Signage & barricading', 'ea', null, 1, 2),
  ('Asbestos job fixed costs', 'Clearance inspection (LAA)', 'ea', null, 1, 3)
) as c(assembly_name, description, unit, factor, fixed_qty, position)
  on c.assembly_name = a.name;

-- ─── 0046_takeoff_fk.sql ─────────────────────────────────────────────────
-- 0046: takeoff provenance FK — on delete set null.
-- 0045 created quote_lines.takeoff_item_id with the default NO ACTION, which
-- blocks deleting any takeoff item that has been pushed to the quote. The
-- intended semantics: the quote line keeps its data and simply loses the
-- provenance link (mirrors takeoff_items.sheet_id on delete set null).

alter table quote_lines
  drop constraint quote_lines_takeoff_item_id_fkey;

alter table quote_lines
  add constraint quote_lines_takeoff_item_id_fkey
  foreign key (takeoff_item_id) references takeoff_items(id) on delete set null;

-- ─── 0047_pm_allocation.sql ──────────────────────────────────────────────
-- 0047: PM allocation — an office-side owner on quotes, carried through
-- conversion to jobs/projects. Display/filter only; separate from the
-- site-facing supervisor_id.
alter table quotes add column pm_id uuid references profiles(id);
alter table jobs add column pm_id uuid references profiles(id);
alter table projects add column pm_id uuid references profiles(id);

-- ─── 0048_archive_records.sql ────────────────────────────────────────────
-- 0048: reversible archive for quotes/jobs/projects (mirrors clients.archived).
-- Archived records hide from lists/pickers/reports but stay reachable by id;
-- Settings → Archive restores them. Nothing is ever deleted.
alter table quotes   add column archived boolean not null default false, add column archived_at timestamptz;
alter table jobs     add column archived boolean not null default false, add column archived_at timestamptz;
alter table projects add column archived boolean not null default false, add column archived_at timestamptz;

-- ─── 0049_takeoff_snapshot_kind.sql ──────────────────────────────────────
-- 0049: plan snapshot on sheets + cost category on quote lines.
-- (Backfilled repo copy — applied to the live DB from a handed paste on
-- 2026-07-12 before this file was committed.)
alter table takeoff_sheets add column snapshot_path text;
alter table quote_lines add column kind text check (kind in ('labour','plant','material','subbie','other'));

-- ─── 0050_quote_footer.sql ───────────────────────────────────────────────
-- 0050: quote footer — Settings-managed fine print (exclusions, payment
-- terms) printed on quote PDFs under the validity line, mirroring
-- invoice_footer / claim_footer.
alter table settings add column quote_footer text;

-- ─── 0051_maintenance_log.sql ────────────────────────────────────────────
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

-- ─── 0052_maintenance_attachment_parent.sql ──────────────────────────────
-- 0052: allow 'maintenance' attachments.
-- 0051 added the maintenance_entries table and taught the app that photo
-- evidence attaches with parent_type 'maintenance', but the attachments
-- CHECK constraint still rejected the value — every evidence upload failed
-- with "new row for relation 'attachments' violates check constraint". This
-- appends 'maintenance' to the live constraint idempotently (same read-current-
-- values-then-append pattern proven in 0032).
do $$
declare
  vals text[];
begin
  select coalesce(array_agg(distinct m[1]), '{}'::text[]) into vals
  from pg_constraint c
  cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
  where c.conname = 'attachments_parent_type_check'
    and c.conrelid = 'public.attachments'::regclass;

  if coalesce(array_length(vals, 1), 0) = 0 then
    raise exception 'attachments_parent_type_check not found — refusing to guess the value list';
  end if;

  if not (vals @> array['maintenance']) then
    vals := array_append(vals, 'maintenance');
    execute 'alter table public.attachments drop constraint attachments_parent_type_check';
    execute format(
      'alter table public.attachments add constraint attachments_parent_type_check check (parent_type = any (array[%s]::text[]))',
      (select string_agg(quote_literal(v), ', ') from unnest(vals) v)
    );
  end if;
end $$;

-- ─── 0053_maintenance_chasing.sql ────────────────────────────────────────
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

-- ─── migration history bookkeeping ──────────────────────────────────────────
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text
);
insert into supabase_migrations.schema_migrations (version, name, statements) values
  ('0001', 'schema', array['-- applied via fresh-install combined paste']),
  ('0002', 'functions', array['-- applied via fresh-install combined paste']),
  ('0003', 'rls', array['-- applied via fresh-install combined paste']),
  ('0004', 'profile_guard', array['-- applied via fresh-install combined paste']),
  ('0005', 'storage', array['-- applied via fresh-install combined paste']),
  ('0006', 'checklists_costcodes', array['-- applied via fresh-install combined paste']),
  ('0007', 'security_hardening', array['-- applied via fresh-install combined paste']),
  ('0008', 'programme', array['-- applied via fresh-install combined paste']),
  ('0009', 'programme_extras', array['-- applied via fresh-install combined paste']),
  ('0010', 'whs', array['-- applied via fresh-install combined paste']),
  ('0011', 'attachment_parents', array['-- applied via fresh-install combined paste']),
  ('0012', 'whs_documents', array['-- applied via fresh-install combined paste']),
  ('0013', 'documents', array['-- applied via fresh-install combined paste']),
  ('0014', 'ncr_capa', array['-- applied via fresh-install combined paste']),
  ('0015', 'storage_fixes', array['-- applied via fresh-install combined paste']),
  ('0016', 'diary_audit', array['-- applied via fresh-install combined paste']),
  ('0017', 'claim_pct_precision', array['-- applied via fresh-install combined paste']),
  ('0018', 'form_submission_schema', array['-- applied via fresh-install combined paste']),
  ('0019', 'attachment_read_scope', array['-- applied via fresh-install combined paste']),
  ('0020', 'internal_audit', array['-- applied via fresh-install combined paste']),
  ('0021', 'training_competency', array['-- applied via fresh-install combined paste']),
  ('0022', 'risk_register', array['-- applied via fresh-install combined paste']),
  ('0023', 'objectives_kpis', array['-- applied via fresh-install combined paste']),
  ('0024', 'management_review', array['-- applied via fresh-install combined paste']),
  ('0025', 'legal_register', array['-- applied via fresh-install combined paste']),
  ('0026', 'client_portal', array['-- applied via fresh-install combined paste']),
  ('0027', 'go_live_hardening', array['-- applied via fresh-install combined paste']),
  ('0028', 'portal_experience', array['-- applied via fresh-install combined paste']),
  ('0029', 'portal_interactions', array['-- applied via fresh-install combined paste']),
  ('0030', 'swms_two', array['-- applied via fresh-install combined paste']),
  ('0031', 'environmental', array['-- applied via fresh-install combined paste']),
  ('0032', 'itp_lots', array['-- applied via fresh-install combined paste']),
  ('0033', 'cp3_email', array['-- applied via fresh-install combined paste']),
  ('0034', 'request_sync', array['-- applied via fresh-install combined paste']),
  ('0035', 'calendar_feeds', array['-- applied via fresh-install combined paste']),
  ('0036', 'prestart_meeting', array['-- applied via fresh-install combined paste']),
  ('0037', 'prestart_sms_fields', array['-- applied via fresh-install combined paste']),
  ('0038', 'budget_line_attribution', array['-- applied via fresh-install combined paste']),
  ('0039', 'project_mobilisation', array['-- applied via fresh-install combined paste']),
  ('0040', 'form_amendments', array['-- applied via fresh-install combined paste']),
  ('0041', 'renewal_requests', array['-- applied via fresh-install combined paste']),
  ('0042', 'portal_uploads', array['-- applied via fresh-install combined paste']),
  ('0043', 'register_links', array['-- applied via fresh-install combined paste']),
  ('0044', 'portal_invoices', array['-- applied via fresh-install combined paste']),
  ('0045', 'takeoff', array['-- applied via fresh-install combined paste']),
  ('0046', 'takeoff_fk', array['-- applied via fresh-install combined paste']),
  ('0047', 'pm_allocation', array['-- applied via fresh-install combined paste']),
  ('0048', 'archive_records', array['-- applied via fresh-install combined paste']),
  ('0049', 'takeoff_snapshot_kind', array['-- applied via fresh-install combined paste']),
  ('0050', 'quote_footer', array['-- applied via fresh-install combined paste']),
  ('0051', 'maintenance_log', array['-- applied via fresh-install combined paste']),
  ('0052', 'maintenance_attachment_parent', array['-- applied via fresh-install combined paste']),
  ('0053', 'maintenance_chasing', array['-- applied via fresh-install combined paste'])
on conflict (version) do nothing;

-- ─── instance identity ──────────────────────────────────────────────────────
update settings set company_name = 'G Site Solutions';
