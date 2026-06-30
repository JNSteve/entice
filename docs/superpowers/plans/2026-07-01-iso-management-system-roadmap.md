# ISO Management-System Roadmap — Entice (9001 / 14001 / 45001)

> Master roadmap synthesising 11 module design specs into one sequenced build-and-go-live plan. Builds on shipped Entice v1 + the WHS module (audit_log triggers, forms engine, controlled-docs, SWMS/share-links, CAPA, PDF/CSV infra, RLS conventions, `next_number` numbering). Date: 2026-07-01. Owner sign-off pending on the per-module decisions flagged below.

---

## 1. Executive summary

Entice already runs the operational business (quotes→jobs/projects, claims, procurement, schedule, field PWA, programme Gantt) and a full WHS module. This roadmap closes the remaining **ISO 9001 (Quality) + ISO 14001 (Environmental) + ISO 45001 (OHS)** management-system gaps so the platform becomes the company's **management system of record** — the system an external certification auditor opens on day one. It does this by reusing the proven Entice primitives (append-only `audit_log` with Postgres AFTER-triggers, the versioned controlled-document library, the configurable forms engine, the incident/CAPA workflow, share-link/QR external sign-off, `next_number` numbering, and the register-table + CSV + PDF UI) rather than inventing new platform mechanics. Eleven modules close the named clauses: Document Control (7.5), NCR/CAPA (10.2), Internal Audit (9.2), Management Review (9.3), Risk & Opportunity (6.1), Objectives & KPIs (6.2/9.1), Legal & Compliance Obligations (6.1.3/9.1.2), Environmental Aspects/Waste/Monitoring (14001 operational core), ITP/Lot Conformance (9001 8.5/8.6/8.7), Training & Competency (7.2), and a cross-cutting Production & Use-Readiness workstream.

**Honest position:** software *supports* certification; it does not *grant* it. Entice will hold and protect the records (immutably, with full audit trail) and structure the process so the right things get captured. But the company still needs (a) its own **documented procedures** — the actual policy/procedure text the modules reference and seed as "Rev A — review before adoption" stubs — signed off by the business owner, and (b) a **short operating record**: a management system is judged on *evidence it has run*, so a handful of completed audits, a management review, recorded NCRs closed to verification, and live objective data must exist before a Stage 2 audit. The tool makes producing that record cheap; it cannot retroactively manufacture history.

**Accreditation is a business choice.** A certificate from a JAS-ANZ-accredited certification body carries more weight (and is often a tender/prequalification prerequisite) than one from a non-accredited certifier; the latter is cheaper and faster but may not satisfy head-contractor or government panel requirements. The platform is indifferent to which is chosen — the same records satisfy either. The owner should pick the certifier based on who the company tenders to, then book Stage 1 once Phase 1–2 below are live and seeded.

---

## 2. Audit-ready minimum (the shortest path)

This is the subset a Stage 2 auditor asks for **on day one**. It is exactly the modules flagged `auditMustHave=true` (all 11 carry it — the discipline below is to ship the *foundations first* and seed real starter content) plus the non-negotiable production-readiness items. Treat this as the Phase 1 + early-Phase-2 gate.

**Foundation modules an auditor opens first**

- [ ] **Controlled Document register (7.5)** — policies, procedures, blank forms with draft→approved→issued workflow, named approver≠author, version chain, review-due surfacing, and read-acknowledgement. This is the "show me your documented information" question. *Generalises `whs_documents` → `documents`.*
- [ ] **NCR / CAPA register (10.2)** — numbered nonconformities with root-cause + **mandatory verification-of-effectiveness** before close. The first register an auditor opens to evidence 10.2; the spine many other modules link to.
- [ ] **Internal Audit programme (9.2)** — a planned year of audits, ISO-aligned checklists (reusing the forms engine), classified findings that raise CAPAs, and an audit-report PDF. Auditors want to see you audit yourself.
- [ ] **Management Review (9.3)** — at least one completed, minuted review covering Q/E/OHS with the mandated inputs considered and dated output actions.
- [ ] **Risk & Opportunity register (6.1)** — a populated strategic/operational R&O register across all three standards.
- [ ] **Objectives & KPIs (6.2 / 9.1)** — measurable objectives with live (even if partly manual) period data showing the system is monitored.
- [ ] **Training & Competency register (7.2)** — proof every worker is competent/current for their work; the competency matrix and expiry traffic-lights.

**Essential production-readiness (without these the records are not defensible)**

- [ ] **Deploy** — reproducible Vercel deploy with env vars (incl. `NEXT_PUBLIC_SITE_URL`/`NEXT_PUBLIC_APP_URL` for share-link/QR absolute URLs), custom domain, preview→prod promotion. *Do this early — everything else is tested against prod.*
- [ ] **Backup & retention** — scheduled DB + Storage export beyond Supabase's 7-day PITR, plus a written, version-controlled **Records Retention & Backup Policy** loaded into the controlled-document register. "Show me your records are protected from loss" (7.5.3.2).
- [ ] **Timezone correctness** — single `Australia/Brisbane` date helper replacing every server-local `new Date()`/`todayStr()` so record dates are correct on Vercel's UTC servers. Wrong record dates undermine every other artefact.
- [ ] **Security go-live** — seeded demo passwords rotated, leaked-password protection on, error monitoring live, RLS advisors clear, first access review recorded.
- [ ] **Wipe demo / keep config** — go-live switch that purges demo transactional data but preserves seeded ISO starter content and config, so the team starts on populated (not empty, not fake) registers.

---

## 3. Phased roadmap

Six phases, dependency-ordered. Document Control and NCR/CAPA are foundations many others link to, so they come first. Production-readiness threads throughout — **deploy + timezone land in Phase 1** because every later module is verified against the deployed, date-correct app; backup/retention and the go-live gate close at the end. ITP depends on NCR/CAPA. Audit, Management Review and Objectives consume NCR/audit data, so they follow.

| Phase | Name | Modules | Milestone unlocked | Size |
|---|---|---|---|---|
| **1** | Foundations + deploy (audit-ready minimum, part A) | Production & Use-Readiness (deploy + timezone + iso_documents generalisation), Controlled Document Control, NCR/CAPA | Records-control spine live, date-correct, on a real domain; the two registers an auditor opens first exist | XL |
| **2** | Conformance & competence (audit-ready minimum, part B) | Internal Audit Programme, Training & Competency, Risk & Opportunity | Self-audit capability + competence evidence + 6.1 R&O register; **bookable for Stage 1** | XL |
| **3** | Governance loop | Management Review, Objectives & KPIs, Legal & Compliance Obligations | 9.3 review with real inputs; 6.2/9.1 measured objectives; 6.1.3/9.1.2 obligations evaluated — the management loop closes | XL |
| **4** | Quality & environmental operational core | ITP / Lot Conformance / Test Records, Environmental Aspects / Waste / Monitoring | 9001 8.5/8.6/8.7 production-control evidence + 14001 operational core (significant aspects, waste tracking, monitoring) | XL |
| **5** | Go-live hardening | Production & Use-Readiness (backup/retention, security, wipe-demo, onboarding, ISO starter seeding) | Backups running + retention policy controlled; demo wiped; team onboarded; **production AND use ready** | L |
| **6** | Surveillance & continual improvement (steady state) | (no new modules) operate the system: run audits, reviews, refresh KPIs, close NCRs/CAPAs | A populated operating record exists; **bookable for Stage 2 / surveillance** | ongoing |

**Why this order**
- **Phase 1** ships the records-control spine. The Production & Use-Readiness module's `whs_documents → iso_documents/documents` generalisation and the Controlled Document module's generalisation are the *same refactor* — they must land together once, not twice. NCR/CAPA generalises `corrective_actions` (nullable `incident_id` + new parent columns + a CHECK that exactly one parent is set); this single schema change is depended on by Internal Audit, ITP, Risk treatments, and Legal evaluations, so it is done here, in coordination, before any consumer.
- **Phase 2** delivers self-audit + competence + R&O — the rest of the audit-ready minimum. After Phase 2 the company can book Stage 1.
- **Phase 3** closes the loop: Management Review consumes NCR/audit trends; Objectives consumes incidents/forms/audit-close/NCR data; Legal reuses the CAPA engine. All three are cheap because their dependencies already exist.
- **Phase 4** is the heavier operational QC/environmental work — important for civil/remediation but not what a generic IMS auditor opens first, so it follows the governance core. ITP's NCR link requires Phase 1's CAPA generalisation.
- **Phase 5** is the go-live gate (backups, security, wipe-demo, onboarding, ISO starter seeding that *survives* the wipe).
- **Phase 6** is operating discipline, not a build: certification is earned by *running* the system.

---

## 4. Per-module summaries

### 4.1 Controlled Document Control (7.5)
- **Purpose:** Generalise the WHS-only `whs_documents` into a company-wide controlled-document register — single source of truth for policies, procedures, work instructions, blank forms, registers, plans, external standards/SDS — adding a formal approval workflow (draft→in_review→approved→issued→superseded/archived) with named reviewer/approver+dates, controlled distribution with read-acknowledgement, and review scheduling/overdue surfacing.
- **ISO clauses:** 9001 7.5.1/7.5.2/7.5.3, 4.4; 14001 7.5; 45001 7.5.
- **Size:** L.
- **Key entities:** `documents` (replaces `whs_documents`), `document_acknowledgements`; per-category `sequences` keys.
- **Reuses:** `whs_documents` table + full UI/zod as the starting point; `audit_whs()` trigger + `audit_log`; `form_signons` pattern (internal path vs external base64 signature, insert-own-or-staff RLS) cloned into acknowledgements; `next_number`; `current_app_role()` RLS; PDF infra (`document-register` type); WHS overview "Needs attention" review-due card generalised; field controlled-docs listing.
- **Seed:** ISO documented-information structure as draft starters — Quality/Environmental/OHS Policies, Document & Records Control, Internal Audit, Management Review, NCR & Corrective Action, Risk & Opportunity, Competence/Training procedures (the procedures other modules reference); per-category numbering keys; migrate existing `whs_documents` rows in as `system='ohs'`.
- **Dependencies:** AU-time standardisation; a QMS/Integrated hub nav slot (can ship under `/whs` and be promoted); soft FK target for NCR/Audit links.
- **Owner decision:** **REPLACE vs EXTEND** `whs_documents` — spec recommends REPLACE with a generalised `documents` table + data migration (breaking refactor of shipped WHS UI; needs sign-off). Also: collapse "reviewed" into a timestamp vs a distinct status; whether targeted distribution lists are needed (extra `distribution_targets` table); storage-prefix rename strategy.

### 4.2 Nonconformance (NCR) + Corrective/Preventive Action (CAPA) (10.2)
- **Purpose:** Generalise the safety-only `incidents`+`corrective_actions` into a company-wide NCR/CAPA spine. Any nonconformity (quality, environmental, complaint, audit finding, supplier, safety) is a numbered NCR driven open→investigating→actions→verified→closed with immediate containment, structured root cause, corrective+preventive actions, disposition of nonconforming output, and a **mandatory verification-of-effectiveness gate** before close.
- **ISO clauses:** 9001 10.2/8.7/9.1.2/10.3/9.3; 14001 10.2; 45001 10.2; 7.5 records control.
- **Size:** L.
- **Key entities:** `ncrs`, `capa_actions`.
- **Reuses:** `audit_whs()` triggers; `incidents`/`corrective_actions` UI + state-machine as the literal seed (copy detail/table/actions); `next_number` (`ncr`→NCR-0001); PDF infra (`ncr` type, `NcrPdf`); register UI + StatusBadge/SeverityBadge; `PhotoUpload`/`AttachmentList`/`AuditHistory`; incident link via `incident_id`.
- **Seed:** `ncr` sequence; "Raise NCR" entry points (vendor=supplier, project quality/WHS tab, escalate-from-incident); source/category config consts; an ISO NCR-control procedure stub + blank NCR/CAPA form template; pre-built by-source/by-status analytics for the 9.3 management-review export.
- **Dependencies:** Audit/Findings module (ship `audit_finding_id` nullable-no-FK now, constrain later); Management Review consumes the trending query; AU-time.
- **Owner decision:** NEW tables vs extend `incidents` (recommended NEW; link incidents via `incident_id`). Whether field can raise NCRs (recommended yes, SELECT+INSERT only). Whether `capa_actions` and `corrective_actions` coexist or converge. The verification gate must be **non-bypassable**.

### 4.3 Internal Audit Programme (9.2)
- **Purpose:** Plan a year of audits (the programme), conduct each against an ISO-aligned checklist (reusing the forms engine), record classified findings, raise CAPAs from nonconformities, generate an audit-report PDF, and track findings to closure with coverage reporting across processes and clauses.
- **ISO clauses:** 9001/14001/45001 9.2; 10.2 (findings→CAPA); 7.5; 5.3/9.3 (auditor objectivity, results→review).
- **Size:** L.
- **Key entities:** `audit_programmes`, `audit_areas`, `audits`, `audit_findings`.
- **Reuses:** `form_templates`/`form_submissions` engine (checklist = template kind `'audit'`, immutable submission snapshot); incidents/CAPA workflow for findings; `audit_whs()` triggers; `next_number` (`AUD`); PDF (`audit` type, `AuditReportPdf`); register UI + new WHS "Audits" tab; `AuditHistory`; optional share-link/QR for external auditor sign-off.
- **Seed:** `audit_areas` for Entice's real processes; ISO-aligned checklist templates (9001 QMS, 14001 env, 45001 OHS, integrated site) as `kind='audit'`; a starter draft programme + 1–2 planned audits; `AUD` prefix.
- **Dependencies:** **NCR/CAPA's `corrective_actions` generalisation** (shared schema change — done once); forms-engine `kind` extension to add `'audit'`; PDF/numbering registries; AU-time.
- **Owner decision:** `corrective_actions` generalisation shape (recommended nullable `incident_id` + nullable `finding_id` + CHECK exactly-one-parent). Draft-checklist-while-in-progress then freeze on complete. Findings decoupled from per-row pass/fail. Canonical `audit_areas` list (real process list). Major-NC closure requires root-cause + effectiveness (coordinate with CAPA).

### 4.4 Management Review (9.3)
- **Purpose:** A structured record of periodic top-management reviews of the integrated QHSE system. Each review carries a date/agenda, attendees, the fixed ISO-mandated INPUTS (each a RAG status + minute), and OUTPUTS as decisions + dated actions; closing locks it and generates a Management Review Report PDF. Auto-pulls live trend data (open NCRs/CAPAs, incidents, overdue actions, audits, KPIs) so management demonstrably "considers" the required inputs.
- **ISO clauses:** 9001/14001/45001 9.3 (inputs 9.3.2, outputs 9.3.3); 10.1–10.2; 7.5.
- **Size:** M.
- **Key entities:** `management_reviews`, `management_review_inputs`, `management_review_attendees`, `management_review_actions`.
- **Reuses:** `corrective_actions` pattern for the actions tracker; `audit_whs()` triggers; `next_number` (`mgmt_review`→MR-0001); RLS conventions; PDF (`mgmt-review` type); WHS hub shell or sibling `/reviews` route; register UI + `AuditHistory`; `fetchAuditFor`.
- **Seed:** the 11–14 ISO input definitions as an app constant seeded per review; `mgmt_review` sequence; plain-English helper text per input; a blank Management Review Procedure in the controlled-doc library; a default annual cadence note.
- **Dependencies:** edit `src/lib/numbering.ts` (`mgmt_review`/`MR`); soft dependency on NCR/CAPA + Internal Audit registers for the `nc_capa_trends`/`audit_results` auto-pull (free-text/proxy until they exist); AU-time.
- **Owner decision:** field-role visibility (recommended restrict SELECT to a/o/s — minutes are commercially sensitive). Completion guard is a **soft warning on un-reviewed inputs only — never block on open output actions** (they are meant to stay open in the tracker). Inputs are a controlled CHECK list, not user-configurable. `/whs` hub vs sibling `/reviews` route.

### 4.5 Risk & Opportunity Register (6.1)
- **Purpose:** A management-system AND project-level register of risks/opportunities addressing 6.1. Each item records context/source + ISO domain, is rated through a 5×5 likelihood×consequence matrix into inherent and residual ratings, lists existing controls + treatment actions (optionally promoted to CAPA), and carries owner/review-date/lifecycle. Company-scoped or project-scoped (a "Risk" tab on projects). Distinct from SWMS task-level hazard analysis.
- **ISO clauses:** 9001 6.1 + 4.1/4.2; 14001 6.1.1–6.1.4; 45001 6.1.1–6.1.4; supports 9.3 + 10.2.
- **Size:** L.
- **Key entities:** `risk_items` (generated `inherent_score`/`rating`, `residual_*`), `risk_treatments`.
- **Reuses:** `audit_whs()` triggers; `incidents`/`corrective_actions` pattern (`risk_treatments` near-copy, promotable via `corrective_action_id`); SWMS hazard-matrix idea generalised to numeric 5×5 + `risk_rating()` band fn; variations-register UI pattern; `next_number` (`RO`); RLS; PDF (`risk-register` type); CSV; project-tab insertion + `/whs/risks` hub; Settings matrix/category config.
- **Seed:** `risk` sequence; 5×5 matrix labels + rating bands single-sourced in `risk_rating()`; a starter ISO R&O item set across all three standards (key-person dependency, subcontractor defects, spill-to-waterway, EPA non-compliance, excavation collapse, plant-pedestrian, fatigue, plus opportunities like ISO-cert opening tenders); default category list.
- **Dependencies:** migration `0013_risk_register.sql` (depends on `audit_whs`/`current_app_role`/`audit_log` + projects/profiles); zod schemas; project-tabs + `/whs/risks` hub; PDF route; optional Settings config.
- **Owner decision:** single-source rating bands in an IMMUTABLE SQL fn (generated columns) vs admin-configurable (compute in app). Promote-to-CAPA approach (recommended a system "Risk treatment actions" incident parent vs relaxing `corrective_actions`). Heat-map default (inherent vs residual) and risk-vs-opportunity colour scales. `iso_domain='multi'` acceptance.

### 4.6 Objectives & KPIs (6.2 / 9.1)
- **Purpose:** A central register of management objectives, each with a measurable target + named KPI tracked period-by-period. KPI actuals come from MANUAL entry and AUTO derivation via a single server-side metrics engine (incidents→LTIFR/count, NCR rate & on-time close, programme/claims→on-time delivery, form_submissions→training/induction compliance, audits→close rate, environmental %). Objectives dashboard (on-track/at-risk/off-track), trend charts, CSV/PDF for management review.
- **ISO clauses:** 9001 6.2/9.1.1/9.1.3/9.3; 14001 6.2/9.1.1; 45001 6.2/9.1.1.
- **Size:** L.
- **Key entities:** `objectives`, `kpi_values`, `objective_actions`; `sequences` seed.
- **Reuses:** `next_number` (`objective`→OBJ-0001); `audit_whs()` triggers; RLS; `corrective_actions` pattern for `objective_actions`; `deriveComplianceStatus` traffic-light (direction-aware); `reports/periods.ts` + `periodRange()`; existing source tables for auto KPIs; recharts (installed); CSV + register UI; PDF (`objectives` type, `ObjectivesPdf`); tabbed hub pattern.
- **Seed:** `objective` sequence; ~9 stable-UUID starter objectives (auto+manual mix per standard — LTIFR target 0, toolbox/training %, CAPA on-time-close %, NCR rate, on-time delivery 95%, customer satisfaction 4.5/5, waste recycled 80%, environmental incidents 0, audit on-time close); the `auto_metric_key` registry as a typed const map; `refresh_objective_kpis()` RPC + daily cron / "Refresh metrics" action.
- **Dependencies:** NCR/CAPA module (NCR-rate/on-time-close metrics; manual placeholders until then); Internal Audit (audit-close-rate); AU-time; a cron mechanism; stable source-table shapes.
- **Owner decision:** **LTIFR hours-worked source** (timesheets vs manual) — sign off before building or the headline safety KPI is wrong. "On-time delivery" source definition (programme baseline-vs-actual vs claim/milestone). Period-label format + only computing elapsed periods. One source per objective (no mixed manual/auto). Direction-aware amber semantics. Keep the boundary: this module *consumes* audit/NCR data, it does not absorb those functions.

### 4.7 Legal & Compliance Obligations Register (6.1.3 / 9.1.2)
- **Purpose:** A controlled register of legal and other requirements (legislation, regulations, standards, codes, permits, licences, client requirements) plus periodic compliance evaluations against each — date, evaluator, compliant/gap verdict, and on a gap a linked CAPA. Each obligation records jurisdiction, how it applies, how we comply (referencing a controlling procedure in the document library), responsible person, and a review cadence.
- **ISO clauses:** 45001 6.1.3; 14001 6.1.3; 9001/14001/45001 9.1.2; 45001/14001 7.5; 9001 7.1.6/7.5.3.
- **Size:** M.
- **Key entities:** `legal_obligations`, `compliance_evaluations`; `corrective_actions` generalised (add `obligation_id`, relax `incident_id`, CHECK).
- **Reuses:** `audit_whs()` triggers; `corrective_actions` + the whole CAPA workflow/dashboard/PDF generalised; `whs_documents` as the controlling-procedure library; register UI + `deriveComplianceStatus` (against `next_review_date`/`current_compliance`); CSV; PDF (`legal-register` + `legal-obligation` types); `next_number` (`LEG`); RLS; WHS hub "Legal" tab.
- **Seed:** `legal_obligation` sequence; ~12–15 starter obligations for AU civil/remediation (WHS Act/Reg, SafeWork Codes, Security of Payment, EPA waste/contaminated-land, POEO, ASC NEPM, asbestos licensing, dangerous goods, erosion & sediment, contractor licence, client HSE placeholder) pre-filled and ISO-tagged; matching controlling docs in the library; default 12-month review frequency.
- **Dependencies:** `corrective_actions` generalisation (shared with NCR/CAPA + others — done once); `whs_documents` (document picker FK); existing `next_number`/`audit_whs`/`current_app_role`; WHS hub tab; AU-time.
- **Owner decision:** `current_compliance` source of truth (recommended trigger recompute from latest evaluation). Re-evaluation must be a NEW row, never an edit (no UPDATE policy). Single-valued jurisdiction + duplicate rows per state vs `text[]`. Seed legal content is starter boilerplate — **HSEQ lead must review before relying on it for audit.**

### 4.8 Environmental Aspects / Waste-Spoil / Monitoring (14001 operational core)
- **Purpose:** A project-scoped EMS closing the 14001 operational core in three parts: (1) an Aspects & Impacts register with significance rating, controls and linked objective (the "significant aspects" basis, 6.1.2); (2) Waste/Spoil load tracking — every load leaving site as a record (classification, source, receiving facility, weighbridge docket, volume/tonnage) reconciled against RAP/permit allowances with asbestos transport fields (8.1, 9.1); (3) Environmental Monitoring — dust/noise/water readings + weekly ESCP inspections via the existing forms engine.
- **ISO clauses:** 14001 6.1.2/6.1.3/8.1/8.2/9.1.1/9.1.2; 9001/14001 7.5.
- **Size:** L.
- **Key entities:** `env_aspects` (versioned), `env_objectives`, `waste_loads`, `env_facilities`, `env_permits`.
- **Reuses:** `audit_whs()` triggers; forms engine (monitoring/ESCP as seeded templates, zero new runtime); `attachments` (parent_type `waste_load`/`env_permit`, existing docket meta + field promote-to-load path); `whs_documents` versioning pattern for aspects; incidents (`environmental`)+CAPA for exceedances; `deriveComplianceStatus` for facility/permit licence expiry; PDF (`env-aspects`, `waste-loads`, `waste-reconciliation` types); register UI + CSV; `next_number` (`waste_load`→WL-0001); project tab + `/env` hub.
- **Seed:** `waste_load` sequence; ~15–20 company-wide aspect library rows for civil/remediation; placeholder licensed-landfill facilities; 2 form templates (Dust/Noise/Water Monitoring, Weekly ESCP Inspection); a default significance threshold (e.g. ≥12) + starter env objectives; extend `attachments_parent_type_check`.
- **Dependencies:** forms engine, incidents/CAPA, attachments + field docket capture, projects/tab framework, PDF route, `next_number` — all built; AU-time for load/monitoring dates.
- **Owner decision:** significance method + threshold + whether condition (normal/abnormal/emergency) is in v1. Facility/permit gating strength (recommended warn + override reason, not hard block). `env_facilities` vs `vendors` overlap (recommended dedicated table). Reconciliation units (m³ vs tonnes — documented conversion or one unit per permit). State-specific asbestos transport artefacts (WasteLocate vs other). Aspect versioning vs in-place edit. Auto exceedance→incident trigger is phase-2 unless wanted now.

### 4.9 ITP / Lot Conformance / Test Records (9001 8.5/8.6/8.7)
- **Purpose:** A civil QC register proving work was inspected and tested against spec before acceptance. Reusable ITP templates (activity × inspection/test × acceptance criteria/spec ref × Hold/Witness/Surveillance × record-required × responsible) → one ITP instance per project → work divided into LOTS, each carrying inspection records and TEST RESULTS (compaction/NATA, concrete cylinders, survey) with evidence. Hold-point items must be released before work proceeds (reusing programme `hold_points`); a failing test/item raises a linked NCR. Output: per-lot Lot Conformance Report PDF + ITP PDF.
- **ISO clauses:** 9001 8.5.1/8.5.2/8.6/8.7/7.1.5/7.5.
- **Size:** L.
- **Key entities:** `itp_templates`, `itp_template_items`, `itp_instances`, `itp_instance_items`, `lots`, `lot_inspections`, `lot_test_results`; `sequences` seeds; `attachments` extension; `hold_points` extension.
- **Reuses:** programme `hold_points` + `setHoldPointStatus`/`ReleaseDialog` (extend with `lot_id`/`itp_instance_item_id` + `'quality'` origin — unify hold points); `whs_documents` versioning for templates; forms `template_version` snapshot pattern for instances; incidents/CAPA as the NCR target; `audit_whs()` triggers; `attachments` evidence (lot/inspection/test); `next_number` (`itp`,`lot`); PDF (`itp`,`lot` types); register UI + conformance traffic-light; project Quality tab + Settings ITP builder; field PWA inspection capture.
- **Seed:** 4–6 civil starter ITP templates (Bulk Earthworks/Subgrade, Stormwater Drainage, Concrete Works, Flexible Pavement, Sewer/Water Retic) with realistic AS criteria (AS 3798/95% Std MDD, AS 1289, AS 3600); `test_type`/`lot_type` enums; `itp`/`lot` sequences; register PDF types; "Raise NCR" affordance on failures.
- **Dependencies:** **NCR/CAPA module** (lot/test failures raise/link an NCR — stub/disabled until it lands); document-control (templates ultimately register in the controlled-doc index); programme `hold_points` column additions; AU-time; PDF/attachments/numbering/audit-trigger registries.
- **Owner decision:** hold-point unification (recommended extend `hold_points` + relax its `task_id NOT NULL`; programme Gantt + delete policy must tolerate quality-origin rows). Conformance computed by SQL fn `lot_conformance()` not hand-set. Template-edit immutability (copy rows at adoption; new version needs deliberate re-adopt). Sequence NCR/CAPA first or ship with a flagged stub. Test-result depth (single numeric vs sub-results/jsonb for multi-break concrete / multi-point compaction). Field write scope (read-only is safer default).

### 4.10 Training & Competency Register (7.2)
- **Purpose:** A per-person register of licences, tickets, VOCs, inductions and courses with issuer/dates/evidence, proving every worker is competent and current. A "worker" links to a staff profile or stands alone as a subbie individual. Records drive an expiry traffic-light, a competency matrix, and a role/task→required-competency map; the schedule's assignment flow warns (non-blocking) when an unqualified/expired person is rostered. Exports a training-matrix CSV/PDF and per-worker competency PDF.
- **ISO clauses:** 9001 7.2/7.1.2; 14001 7.2; 45001 7.2/7.3/8.1.
- **Size:** L.
- **Key entities:** `workers`, `competency_types`, `competency_records`, `role_competency_requirements`.
- **Reuses:** `deriveComplianceStatus`/`ComplianceLight`/`expiryColour` (vendor compliance 30-day rule); `audit_whs()` triggers; `whs_documents` evidence pattern (private bucket `competency/` prefix, signed URLs, supersedes chain); `next_number` (`competency`→CMP-0001); `ComplianceDocDialog` shape; `PhotoUpload`/attachments (or inline evidence_path, preferred); PDF (`training-matrix`, `competency` types); CSV; RLS; WHS hub tab + overview card; Settings config; schedule hook (`createAssignment`/`AssignDialog`).
- **Seed:** `competency_types` (is_system) with AU/ISO starters (White Card, Working at Heights, Confined Space, EWP, Traffic Control, Asbestos Awareness/Removal A/B, plant VOCs, HRWL dogging/rigging/scaffold/forklift, First Aid/CPR 12mo, driver licences, inductions); a baseline `role_competency_requirements`; backfill a `workers` row per active profile so the matrix is populated day one.
- **Dependencies:** attachments parent-type migration IF using attachments (else self-contained inline evidence); schedule module for the warning hook; profiles/users for backfill; PDF route + DocShell; vendors helpers (extract to `src/lib` if shared); AU-time for expiry comparison.
- **Owner decision:** worker identity sync (recommended trigger + backfill from profiles). Schedule warning non-blocking (warn+note vs hard stop; field self-roster may bypass). Task-level requirements phase-2 (role/trade shippable now). Expiry status derived vs a cron flip. Evidence inline vs attachments. **Privacy** — whether field workers can see peers' tickets (may need self-or-staff read like `form_signons`). De-dup rule: latest non-superseded active record per (worker, competency_type) drives the light.

### 4.11 Production & Use Readiness (cross-cutting workstream)
- **Purpose:** Take Entice from "demo that works" to "production AND use ready" — five deliverables: (1) reproducible Vercel deploy; (2) long-term backup & retention beyond 7-day PITR + a controlled retention policy; (3) app-wide timezone fix (single `Australia/Brisbane` helper replacing ~60 files of server-local date math); (4) security hardening (rotate passwords, leaked-password protection, error monitoring, RLS advisors clear, access review); (5) use-readiness — seed ISO starter content + a "wipe demo, keep config" go-live switch + an in-app onboarding guide so the team starts on populated registers.
- **ISO clauses:** 9001/14001/45001 7.5.3 (retention/protection/version), 7.5.3.2 (records protected from loss), 7.5.2 (correct date stamps), 5.2/6.2 (seeded policies/objectives), 9.2/9.1 (seeded checklists), DR/BC for documented info; ISO 27001-aligned access control.
- **Size:** L (split across Phase 1 deploy+timezone+iso_documents and Phase 5 backup+security+wipe+seeding).
- **Key entities:** extend `settings` (timezone, demo_data_loaded, go_live_at, leaked_password_protection_enabled, retention_policy_years); `backup_runs`; `retention_rules`; `access_reviews`; `iso_documents` (generalise of `whs_documents`); `src/lib/tz.ts` (code, no table).
- **Reuses:** `audit_whs()` triggers on the new registers; `whs_documents`→`iso_documents` controlled-doc generalisation; `current_app_role()` RLS + settings policy; forms engine (audit/inspection checklists, restore-test as a submission); `next_number` (`access_review`→ACR); PDF (`retention-policy`, `access-review` types); register UI + CSV; settings singleton + Settings page; `rls-check.mjs` as the RLS verification gate; demo-seed abort-if-not-empty pattern mirrored for an idempotent `iso-starter.sql`.
- **Seed:** ISO starter policies/procedures into `iso_documents`; pre-created empty registers (Backups, Retention, Access Reviews); audit/inspection/review-agenda form templates; `retention_rules` defaults (quality/env 7yr, WHS 5yr, serious safety/asbestos 40yr, financial 7yr); objective starters; a Go-Live checklist with gates.
- **Dependencies:** Supabase Pro + a durable off-platform backup target (S3 / cold bucket); Vercel Cron + custom domain/DNS; Sentry + `SENTRY_DSN`; `NEXT_PUBLIC_SITE_URL`/`NEXT_PUBLIC_APP_URL` set for share-link/QR; coordinate `whs_documents→iso_documents` with the Document Control module (one rename, not two); owner sign-off on ISO starter content.
- **Owner decision:** timezone refactor touches ~60 files — ban raw `new Date()` date math via lint/grep gate, route all through `src/lib/tz.ts`, add a UTC-clock Vitest; confirm the company isn't in a DST state (Brisbane has no DST). `wipe_demo_data()` is destructive — explicit allow-list (not blanket truncate), admin-only security-definer RPC, type-company-name confirmation, audit row, backup-first. Storage backup approach (manifest + incremental, off-peak). Leaked-password/RLS-advisor are dashboard actions the app can only record/attest.

---

## 5. Production & Use Ready checklist

The consolidated readiness workstream (module 4.11), split by when it lands. Treat the Phase-1 items as blocking for *any* real record-keeping and the Phase-5 items as blocking for go-live.

**Deploy (Phase 1)**
- [ ] GitHub → Vercel import; env vars set (Supabase URL/anon/service-role, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_URL`, `SENTRY_DSN`, `BACKUP_BUCKET`/`CRON_SECRET`).
- [ ] Custom domain attached; preview→prod promotion documented in README.
- [ ] Share-link/QR absolute URLs verified against the prod domain.

**Timezone (Phase 1)**
- [ ] `src/lib/tz.ts` (`todayAU`/`nowAU`/`fmtDateAU`/`isFutureAU`, `Australia/Brisbane`).
- [ ] Replace server-local date math in diaries, timesheets/assignments, claim reference dates, future-date guards, programme/report windows (~60 files).
- [ ] UTC-clock Vitest (mock 23:00 UTC → correct AU calendar day); grep/lint gate banning raw date-only `new Date()`.
- [ ] Confirm operating state has no DST (or use the correct zone).

**Backup & retention (Phase 5)**
- [ ] Vercel Cron `/api/cron/backup` (CRON_SECRET-guarded, service-role) → DB export + Storage manifest → durable off-platform bucket → `backup_runs` row with row_counts/size.
- [ ] Monthly restore-test recorded as a form_submission; failures alert via Sentry/email.
- [ ] `retention_rules` seeded (quality/env 7yr, WHS 5yr, serious safety/asbestos 40yr, financial 7yr).
- [ ] Records Retention & Backup Policy PDF generated + loaded into the controlled-document register with review_due.

**Security / go-live (Phase 5)**
- [ ] Rotate all seeded demo passwords.
- [ ] Supabase leaked-password protection on (flag recorded).
- [ ] Sentry receiving errors.
- [ ] RLS/security advisors clear; `rls-check.mjs` green (new ISO tables added to the immutability regression).
- [ ] First `access_reviews` (ACR-0001) recorded.

**Seeding (survives the wipe — Phase 5)**
- [ ] Idempotent `supabase/seed/iso-starter.sql` (separate from demo seed): ISO policy/procedure templates into `iso_documents`, pre-created registers, audit/inspection/review-agenda form templates, objective starters.
- [ ] All module starter content (per §4) seeded with stable UUIDs / on-conflict-do-nothing; flagged "Rev A — review before adoption".

**Onboarding (Phase 5)**
- [ ] "Wipe demo data, keep config" switch — admin-only `wipe_demo_data()` security-definer RPC, explicit demo-table allow-list, type-company-name confirmation, audit row, sets `demo_data_loaded=false`/`go_live_at=now()`.
- [ ] In-app `/settings/guide` onboarding page + README "Going to production" runbook (deploy → seed ISO starter → wipe demo → rotate passwords → configure backups → verify timezone).

---

## 6. How we'll build each

Every module follows the proven Entice pattern — the same loop that shipped the WHS module — so the team is never inventing process, only content:

1. **Brainstorm the specifics with the owner.** Run `superpowers:brainstorming` against the module's open decisions in §4 (e.g. REPLACE-vs-EXTEND for documents, the `corrective_actions` generalisation shape, LTIFR hours source, significance threshold). Lock the decisions in a short header block before any code — exactly as the WHS plan did.
2. **Migration + RLS + audit trigger.** One numbered migration: tables, generated columns/CHECKs, `next_number` sequence seeds, operational RLS via `current_app_role()`, and the `audit_whs()` AFTER-trigger added to the migration's trigger DO-block array (so every create/edit/sign/close is immutable — the heart of ISO records control). Money-grade restriction only where data is sensitive (management-review minutes, competency records).
3. **Office UI + registers + PDF.** Clone the closest existing register (incidents/vendors/whs_documents) into a filterable table + detail page + CSV export (`src/lib/csv.ts`) + a new PDF type in the single `/api/pdf/[type]/[id]/route.tsx` switch on the shared DocShell. Wire the relevant project tab / WHS-or-`/env`-or-`/reviews` hub tab, the "Needs attention" overview card, and Settings config where the module is configurable.
4. **Seed ISO starter content.** Load the per-module starters from §4 (idempotent, stable UUIDs, on-conflict-do-nothing, flagged "Rev A — review before adoption") so the register is populated and demonstrably clause-complete on first login — never a blank screen.
5. **Adversarially verify — including actually loading the page.** Run `superpowers:verification-before-completion`: build/tests/lint/`rls-check.mjs` green; attempt update/delete on immutable rows and confirm they fail; exercise the workflow end-to-end (raise→action→verify→close, plan→conduct→close-out); generate the PDF and the CSV; **and actually open the page in the deployed app and confirm it renders with the seeded data** — no "looks done" claims without evidence.

---

*Modules: 11 (10 feature + 1 cross-cutting readiness). Phases: 6. Audit-ready minimum: §2. All grounded in the supplied specs — no modules invented beyond the 11 given.*
