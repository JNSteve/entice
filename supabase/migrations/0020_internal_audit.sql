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
