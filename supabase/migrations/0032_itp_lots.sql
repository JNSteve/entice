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
