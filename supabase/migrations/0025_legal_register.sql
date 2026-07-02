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
