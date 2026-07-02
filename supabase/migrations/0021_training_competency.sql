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
