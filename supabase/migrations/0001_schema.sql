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
