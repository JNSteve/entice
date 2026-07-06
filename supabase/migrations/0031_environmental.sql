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
