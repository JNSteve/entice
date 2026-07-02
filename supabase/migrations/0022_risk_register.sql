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
