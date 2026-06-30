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
