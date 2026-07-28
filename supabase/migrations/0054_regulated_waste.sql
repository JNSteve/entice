-- 0054_regulated_waste.sql
-- Queensland regulated (trackable) waste tracking — the statutory movement
-- record and the master-data it draws on.
--
-- Built against DETSI "Waste Tracking — Bulk Upload Data File Specification",
-- ESR/2023/6563 version 2.01, 25 January 2023. Prescribed information is
-- Schedule 12 of the Environmental Protection Regulation 2019; trackable wastes
-- are Schedule 11. Design record: docs/superpowers/specs/
-- 2026-07-28-qld-waste-tracking-design.md (field table, [VERIFY] register).
--
-- Locked decisions implemented here:
--   * SNAPSHOT EVERYTHING. Generator, transporter and receiver details are
--     copied onto the movement at creation as well as referenced by id. This is
--     a five-year record (EP Reg ss78(3), 79(4), 80(4)) and must show what was
--     true on the day, not what the party's record says today.
--   * LOAD NUMBERS NEVER REPEAT. A dedicated sequence, not the `sequences`
--     table: next_number() is an UPDATE…RETURNING, so a rolled-back insert
--     hands the same number out again. nextval() is non-transactional and never
--     does. maxvalue 9999999 (the spec's NNNNNNN) with `no cycle` turns
--     exhaustion into an error rather than a repeat, and the column is unique.
--   * NO DELETE PATH. No delete policy exists below, and a before-update
--     trigger rejects any change to load_seq and freezes the statutory fields
--     once lodged_at is set.
--   * NULLABILITY FOLLOWS WHAT IS KNOWN. Generator, waste, transporter identity
--     and receiver identity are non-null at capture. Parts 2 and 3 stay null
--     until the transporter and receiver report. The database is permissive
--     enough to record reality; the EXPORT is what refuses a non-conforming
--     file, because the department rejects such a file in full.
--   * TRANSPORTERS ARE VENDORS. A transporter is a trading account, so this
--     extends the vendors register rather than contradicting 0031's reason for
--     keeping env_facilities separate ("a licensed place, not a trading
--     account"). The EA number rides vendor_compliance_docs as a new
--     'environmental_authority' kind, inheriting the 30-day expiry traffic
--     light, the register column and the dialogs already built.
--   * RECEIVER EA IS env_facilities.licence_no. It already carries
--     licence_expiry for the traffic light; a second column would be a
--     competing source of truth.
--   * WASTE AND DISPOSAL CODES ARE NOT CONSTRAINED IN THE SCHEMA — only their
--     shape is. The specification states the appendix codes "are subject to
--     change by the department" (§2.1), so the authoritative lists live in
--     src/lib/waste/qld-codes.ts where a departmental change is a code change,
--     not a migration.
--
-- The general waste load flow (waste_loads, 0031) is left untouched.

------------------------------------------------------------------------------
-- 1. Submitter identity — spec §2.4.1 (file name) and §2.4.3 fields 1–2
------------------------------------------------------------------------------

-- The 3-letter unique identifier is ALLOCATED BY DETSI and must be approved
-- before bulk upload files may be lodged lawfully (spec cover page). Null until
-- allocated; the export refuses to run without it. Field 1 (Submitters Company
-- Name) is settings.company_name, which already exists.
alter table settings
  add column budf_identifier text
    check (budf_identifier is null or budf_identifier ~ '^[A-Za-z]{3}$'),
  add column budf_approved_at date;

comment on column settings.budf_identifier is
  'DETSI-allocated 3-letter bulk-upload identifier (the AAA of AAANNNNNNN). Null until allocated by the department.';
comment on column settings.budf_approved_at is
  'Date DETSI approved bulk upload lodgement. Null = not approved; the export warns.';

------------------------------------------------------------------------------
-- 2. Transporters — vendors + the existing compliance-doc expiry logic
------------------------------------------------------------------------------

-- Spec fields 26–29 (depot street number, street name, suburb, postcode) are
-- all null-not-allowed, and vendors carried no address.
alter table vendors
  add column street_number text,
  add column street_name text,
  add column suburb text,
  add column postcode text,
  add column is_waste_transporter boolean not null default false,
  -- Bulk upload lodges all three parts under ECR's identifier, making ECR the
  -- AGENT for this transporter. The Regulation requires the agreement be
  -- produced to the department on request; a non-null date IS the flag, and the
  -- signed copy attaches with parent_type 'vendor'.
  add column agent_agreement_date date;

create index vendors_waste_transporter_idx on vendors (is_waste_transporter)
  where is_waste_transporter;

comment on column vendors.is_waste_transporter is
  'Selectable as a transporter on regulated waste movements.';
comment on column vendors.agent_agreement_date is
  'Date the waste-tracking agent agreement was signed. Null = none held; the export warns.';

-- EA number as a compliance document: reference = the EA number, expiry_date =
-- its expiry (already not null on this table). This is what buys EA-number
-- expiry monitoring for free.
-- Read-current-values-then-append, the pattern proven in 0032 and 0052.
do $$
declare
  vals text[];
begin
  select coalesce(array_agg(distinct m[1]), '{}'::text[]) into vals
  from pg_constraint c
  cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
  where c.conname = 'vendor_compliance_docs_kind_check'
    and c.conrelid = 'public.vendor_compliance_docs'::regclass;

  if coalesce(array_length(vals, 1), 0) = 0 then
    raise exception 'vendor_compliance_docs_kind_check not found — refusing to guess the value list';
  end if;

  if not (vals @> array['environmental_authority']) then
    vals := array_append(vals, 'environmental_authority');
    execute 'alter table public.vendor_compliance_docs drop constraint vendor_compliance_docs_kind_check';
    execute format(
      'alter table public.vendor_compliance_docs add constraint vendor_compliance_docs_kind_check check (kind = any (array[%s]::text[]))',
      (select string_agg(quote_literal(v), ', ') from unnest(vals) v)
    );
  end if;
end $$;

------------------------------------------------------------------------------
-- 3. Receiving facilities — spec fields 38–46
------------------------------------------------------------------------------

-- licence_no is the receiver environmental authority (field 38) and already has
-- licence_expiry driving the expiry traffic-light. Only the details the spec
-- requires and this table lacked are added.
alter table env_facilities
  add column abn text,
  add column street_number text,
  add column street_name text,
  add column suburb text,
  add column postcode text,
  add column contact_name text,
  add column contact_number text,
  add column receives_regulated boolean not null default false,
  add column agent_agreement_date date;

create index env_facilities_receives_regulated_idx on env_facilities (receives_regulated)
  where receives_regulated;

comment on column env_facilities.licence_no is
  'Licence reference. For a QLD receiving facility this IS the environmental authority number (BUDF field 38, max 15 chars).';
comment on column env_facilities.receives_regulated is
  'Selectable as a receiver on regulated waste movements.';
comment on column env_facilities.agent_agreement_date is
  'Date the waste-tracking agent agreement was signed. Null = none held; the export warns.';

------------------------------------------------------------------------------
-- 4. The load number sequence — spec §2.4.3 field 2 (AAANNNNNNN)
------------------------------------------------------------------------------

-- NNNNNNN is 7 digits and "cannot be repeated (or duplicated in any future
-- submission)". Deliberately NOT the `sequences` table — see the header note.
create sequence regulated_waste_load_seq
  as bigint start with 1 minvalue 1 maxvalue 9999999 no cycle;

-- Explicit, not inherited. This is the first real Postgres sequence in the
-- schema (everything else numbers through the `sequences` table), so the
-- default-privilege path is untested here — without USAGE, every insert would
-- fail on nextval().
grant usage, select on sequence regulated_waste_load_seq to authenticated;
revoke all on sequence regulated_waste_load_seq from anon;

------------------------------------------------------------------------------
-- 5. The movement record
------------------------------------------------------------------------------

create table regulated_waste_movements (
  id uuid primary key default gen_random_uuid(),

  -- Field 2: the NNNNNNN. Unique-constrained; the trigger below forbids change.
  load_seq bigint not null unique default nextval('regulated_waste_load_seq'),

  -- ── Operational links ────────────────────────────────────────────────────
  project_id uuid references projects(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  permit_id uuid references env_permits(id) on delete set null,

  -- ── Generator, fields 3–12 ───────────────────────────────────────────────
  -- generator_kind records WHO WAS DECIDED to be the generator. ECR does the
  -- removal work and is often the actual generator; as a subcontractor to a
  -- builder it often is not. Never the agent lodging on their behalf.
  generator_kind text not null check (generator_kind in ('client', 'company')),
  generator_client_id uuid references clients(id) on delete set null,
  generator_site_id uuid references sites(id) on delete set null,
  generator_name text not null,
  generator_abn text,
  generator_street_number text not null,
  generator_street_name text not null,
  generator_suburb text not null,
  generator_postcode text not null,
  generator_contact_name text not null,
  generator_contact_number text not null,
  collection_date date not null,
  local_government_area text,

  -- ── Waste as classified by the generator, fields 13–16 ───────────────────
  waste_physical_nature text not null
    check (waste_physical_nature in ('L', 'S', 'M', 'P')),
  waste_code text not null check (waste_code ~ '^[A-Z][0-9]{3}$'),
  waste_amount numeric(12, 2) not null check (waste_amount > 0),
  -- [VERIFY V-1] The spec gives max size 2 yet permits 'Each' and 'IBC'.
  waste_unit text not null
    check (waste_unit in ('kg', 'L', 'm3', 'Each', 'IBC')),

  -- ── Dangerous goods, fields 17–22 — all optional ─────────────────────────
  dg_un_class text,
  dg_un_number text,
  dg_subsidiary_risk text,
  dg_packaging_count text,
  dg_packaging_type text,
  -- [VERIFY V-2] The spec gives max size 1 yet permits 'II' and 'III'.
  dg_packing_group text check (dg_packing_group in ('I', 'II', 'III')),

  -- ── Transporter identity and authority, fields 23–31 ─────────────────────
  transporter_vendor_id uuid references vendors(id) on delete set null,
  transporter_name text not null,
  transporter_contact_name text not null,
  transporter_contact_number text not null,
  transporter_street_number text not null,
  transporter_street_name text not null,
  transporter_suburb text not null,
  transporter_postcode text not null,
  transporter_abn text,
  -- NOT NULL by design. It is an offence under s96 of the Environmental
  -- Protection Regulation 2019 to give trackable waste to an unauthorised
  -- transporter; a load cannot be recorded without the authority number.
  transporter_ea_number text not null,

  -- ── Part 2, fields 32–37 — null until the transporter reports ────────────
  transporter_collection_date date,
  vehicle1_plate text,
  vehicle1_type text check (vehicle1_type in ('V', 'T')),
  -- [VERIFY V-5] The spec marks Vehicle 2 null-not-allowed, but a rigid tipper
  -- with no trailer has no second vehicle. Optional here and in the export.
  vehicle2_plate text,
  vehicle2_type text check (vehicle2_type in ('V', 'T')),
  transporter_discrepancy text,
  part2_submitted_at timestamptz,
  part2_submitted_by text,
  part2_source text check (part2_source in ('link', 'office')),
  -- Details the transporter corrected on their own link. Snapshotted here and
  -- flagged for office review; never written back over the vendor record.
  transporter_declared_variance jsonb,

  -- ── Receiver identity, fields 38–46 ──────────────────────────────────────
  receiver_facility_id uuid references env_facilities(id) on delete set null,
  receiver_ea_number text,
  receiver_name text not null,
  receiver_contact_name text not null,
  receiver_contact_number text not null,
  receiver_street_number text not null,
  receiver_street_name text not null,
  receiver_suburb text not null,
  receiver_postcode text not null,
  receiver_abn text,

  -- ── Part 3, fields 47–53 — null until the receiver reports ───────────────
  received_date date,
  -- [VERIFY V-4] The "Null allowed" cell is blank for this field alone; treated
  -- as required by the export, being the substance of Part 3.
  disposal_code text check (disposal_code ~ '^[DR][0-9]{1,2}[AB]?$'),
  receiver_physical_nature text
    check (receiver_physical_nature in ('L', 'S', 'M', 'P')),
  receiver_waste_code text check (receiver_waste_code ~ '^[A-Z][0-9]{3}$'),
  receiver_amount numeric(12, 2) check (receiver_amount >= 0),
  receiver_unit text check (receiver_unit in ('kg', 'L', 'm3', 'Each', 'IBC')),
  receiver_discrepancy text,
  part3_submitted_at timestamptz,
  part3_submitted_by text,
  part3_source text check (part3_source in ('link', 'office')),

  -- ── Fields 54–55 ─────────────────────────────────────────────────────────
  waste_description text,
  consignment_authorisation text,

  -- ── Lodgement ────────────────────────────────────────────────────────────
  wtc_reference text,                       -- Connect Waste Transport Certificate
  lodged_at timestamptz,
  lodgement_method text
    check (lodgement_method in ('connect', 'bulk_upload')),
  -- The identifier actually submitted under, snapshotted at lodgement.
  budf_identifier text,
  notes text,

  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),

  check (project_id is not null or job_id is not null)
);

create index regulated_waste_movements_project_idx on regulated_waste_movements (project_id);
create index regulated_waste_movements_job_idx on regulated_waste_movements (job_id);
create index regulated_waste_movements_permit_idx on regulated_waste_movements (permit_id);
create index regulated_waste_movements_collection_idx on regulated_waste_movements (collection_date);
-- The monthly file is selected on the DISPOSAL month (spec §2.4), not collection.
create index regulated_waste_movements_received_idx on regulated_waste_movements (received_date);
create index regulated_waste_movements_lodged_idx on regulated_waste_movements (lodged_at);
create index regulated_waste_movements_transporter_idx on regulated_waste_movements (transporter_vendor_id);
create index regulated_waste_movements_facility_idx on regulated_waste_movements (receiver_facility_id);
create index regulated_waste_movements_created_by_idx on regulated_waste_movements (created_by);

comment on table regulated_waste_movements is
  'Schedule 12 prescribed information for one trackable waste movement. Five-year statutory record — no delete path, and statutory fields freeze on lodgement. Built to DETSI ESR/2023/6563 v2.01.';
comment on column regulated_waste_movements.load_seq is
  'The NNNNNNN of the BUDF unique identifier (field 2). From regulated_waste_load_seq; must never repeat across any submission, ever.';

------------------------------------------------------------------------------
-- 6. Immutability: no renumbering, and statutory fields freeze on lodgement
------------------------------------------------------------------------------

create or replace function regulated_waste_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.load_seq is distinct from old.load_seq then
    raise exception 'load_seq is immutable — the BUDF unique identifier must never change';
  end if;

  -- Once lodged with the department, only the certificate reference and notes
  -- may change. Everything else is the record as submitted.
  if old.lodged_at is not null then
    if to_jsonb(new) - 'wtc_reference' - 'notes'
       is distinct from
       to_jsonb(old) - 'wtc_reference' - 'notes' then
      raise exception
        'Movement % is lodged — only wtc_reference and notes may change. Record a discrepancy instead.',
        old.load_seq;
    end if;
  end if;

  return new;
end $$;

revoke execute on function regulated_waste_guard() from anon, authenticated, public;

create trigger regulated_waste_movements_guard
  before update on regulated_waste_movements
  for each row execute function regulated_waste_guard();

------------------------------------------------------------------------------
-- 7. Attachments: docket photos on movements, agent agreements on facilities
------------------------------------------------------------------------------

-- Defensive extension of the parent_type list, per 0052: read the existing
-- values and append rather than restating them.
do $$
declare
  vals text[];
  want text[] := array['regulated_waste_movement', 'env_facility'];
  v text;
  changed boolean := false;
begin
  select coalesce(array_agg(distinct m[1]), '{}'::text[]) into vals
  from pg_constraint c
  cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
  where c.conname = 'attachments_parent_type_check'
    and c.conrelid = 'public.attachments'::regclass;

  if coalesce(array_length(vals, 1), 0) = 0 then
    raise exception 'attachments_parent_type_check not found — refusing to guess the value list';
  end if;

  foreach v in array want loop
    if not (vals @> array[v]) then
      vals := array_append(vals, v);
      changed := true;
    end if;
  end loop;

  if changed then
    execute 'alter table public.attachments drop constraint attachments_parent_type_check';
    execute format(
      'alter table public.attachments add constraint attachments_parent_type_check check (parent_type = any (array[%s]::text[]))',
      (select string_agg(quote_literal(v2), ', ') from unnest(vals) v2)
    );
  end if;
end $$;

-- Read scope (0019) and owner storage delete (0015) whitelist parents/folders.
-- These policies are restated in full, per repo convention — the lists below are
-- the LIVE ones (both selects last set in 0032, delete_own last set in 0031)
-- with 'regulated_waste_movement' appended, so field can attach docket photos.
--
-- 'maintenance' is deliberately NOT added here. 0052 added it to the CHECK
-- constraint but no migration ever added it to these policies; whether that is
-- intended is a separate question and changing access control for another
-- module inside a waste-tracking migration would be the wrong place to settle it.
--
-- Agent agreements need no entry: they attach with parent_type 'vendor' and
-- 'env_facility', which stay admin/office-only via the first clause.
drop policy if exists attachments_select_scoped on public.attachments;
create policy attachments_select_scoped on public.attachments
  for select to authenticated
  using (
    current_app_role() in ('admin','office')
    or parent_type in (
      'job','project','diary','incident','form_submission','ncr',
      'lot','waste_load','env_permit','regulated_waste_movement'
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
        'swms','whs-documents','lot','waste_load','env_permit',
        'regulated_waste_movement'
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
      'variation','package','incident','form_submission','ncr','waste_load',
      'regulated_waste_movement','env_facility'
    )
  );

------------------------------------------------------------------------------
-- 8. RLS — mirrors waste_loads (0031), MINUS any delete policy
------------------------------------------------------------------------------

alter table regulated_waste_movements enable row level security;

-- Field logs the load — they are the ones at the gate — and sees their own or
-- their assigned work. Staff see everything.
create policy regulated_waste_select_staff_or_own on regulated_waste_movements
  for select to authenticated
  using (
    current_app_role() in ('admin','office','supervisor')
    or created_by = auth.uid()
    or (project_id is not null and exists (
      select 1 from assignments a
      where a.user_id = auth.uid() and a.project_id = regulated_waste_movements.project_id
    ))
    or (job_id is not null and exists (
      select 1 from assignments a
      where a.user_id = auth.uid() and a.job_id = regulated_waste_movements.job_id
    ))
  );

create policy regulated_waste_insert_staff_or_own on regulated_waste_movements
  for insert to authenticated
  with check (
    current_app_role() in ('admin','office','supervisor')
    or (current_app_role() = 'field' and created_by = auth.uid())
  );

create policy regulated_waste_update_staff on regulated_waste_movements
  for update to authenticated
  using (current_app_role() in ('admin','office','supervisor'))
  with check (current_app_role() in ('admin','office','supervisor'));

-- NO DELETE POLICY, DELIBERATELY. This is a five-year statutory record; RLS
-- denies deletes to every authenticated role, admin included.

------------------------------------------------------------------------------
-- 9. Audit trail
------------------------------------------------------------------------------

create trigger regulated_waste_movements_audit
  after insert or update or delete on public.regulated_waste_movements
  for each row execute function audit_whs();
