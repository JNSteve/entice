# WHS & Traceability Module — Implementation Plan

> Executes with subagent-driven development. Builds on the shipped Entice v1 (see 2026-06-11-entice-v1.md). Owner approved design 2026-06-12: forms engine (core four + incidents), external sign + subbie SWMS submission, safety-records full audit. Target: ISO 9001/14001 records-control evidence base.

**Locked decisions**
- External (no-login) signatures stored as PNG **data URLs in the DB** (capped 100KB) — avoids anon storage writes for signatures. Internal signatures keep the existing storage path approach.
- Subbie SWMS PDF uploads: storage policy allows **anon INSERT only** into `attachments` bucket under `public-submissions/` prefix (no anon select/update/delete); path randomised client-side `public-submissions/{uuid}.pdf`; row created via security-definer RPC validating the share token.
- Audit is **trigger-based** (Postgres AFTER triggers on WHS tables) writing append-only `audit_log`; no update/delete policies for anyone. Actor from `auth.uid()`; external actions logged via the RPCs with actor_name 'External — {name}'.
- Form templates are **versioned**: editing fields/name bumps version; submissions snapshot `template_version` + `kind` + full `data` jsonb. Submissions immutable post-insert (no UPDATE policy) — incidents live in their own table with a workflow instead.
- Share links: random 32+ char token, kinds `signon` (target swms_instance or form template+parent) and `subbie_swms` (target project), optional expiry, deactivatable. Public routes `/sign/[token]` and `/submit/[token]` use security-definer RPCs `get_shared_doc(token)`, `submit_shared_signon(...)`, `submit_subbie_swms(...)`.
- QR: `qrcode` npm package; QR poster = branded A4 PDF route `/api/pdf/qr-poster/{linkId}` (auth a/o/s).
- Field bottom nav becomes: My Day, Diary, **Safety** (SWMS + forms), Photos.

## Tasks

### W1 — Schema, RLS, audit triggers, template seed
`supabase/migrations/0010_whs.sql`: form_templates (kind prestart|take5|toolbox|induction|incident|custom, schema jsonb, version, active, requires_signon), form_submissions (template snapshot fields, project/job/plant nullable, data jsonb, submitted_by/at; NO update policy), form_signons (submission_id, profile_id nullable, name, company, signature_path nullable, signature_data nullable, signed_at), incidents (number INC seq, project/job nullable, type injury|near_miss|property|environmental, severity 1-5, occurred_at, location, description, immediate_action, reported_by, status open|investigating|closed, closed_at), corrective_actions (incident_id, description, assigned_to, due_date, status open|done, completed_at), share_links (token unique, kind, swms_instance_id nullable, form_template_id nullable, project_id, expires_at, active, created_by), subbie_swms (project_id, vendor_id nullable, company_name, contact_name, email, title, file_path, status submitted|under_review|accepted|rejected, reviewed_by/at, review_notes), audit_log (at, actor_id, actor_name, entity_type, entity_id, project_id, action, detail jsonb; INSERT-only RLS, SELECT a/o/s, no update/delete). Triggers `audit_whs()` on swms_instances, swms_signatures, hold_points, form_templates, form_submissions, form_signons, incidents, corrective_actions, subbie_swms, share_links (insert+update; delete where allowed). RPCs (security definer): get_shared_doc, submit_shared_signon, submit_subbie_swms + 'inc' sequence. Storage policy anon insert `public-submissions/%`. Seed 5 system templates with realistic AU fields.

### W2 — Settings → WHS form template builder
Template list (kind, name, vN, active, submissions count), builder dialog/page: field rows (key auto from label, label, type text|textarea|number|select|checkbox|date|time|photo|signature|rating, options, required), reorder, preview pane. Edit bumps version (confirm). requires_signon toggle (toolbox/induction kinds default on). Admin only.

### W3 — Field Safety tab
Nav restructure (Safety tab absorbs SWMS). Safety home: SWMS list (existing), 'New form' grid by kind (icons), recent submissions. Form fill page: renders template schema (all field types incl. photo via existing upload lib + signature via SignaturePad), validation per required, pre-start links plant select, submit → immutable, success screen. Take 5 optimised: single screen.

### W4 — Office registers + form PDF
WHS hub skeleton page /whs (sidebar item, a/o + supervisor read) with tabs: Overview (stub until W9), Forms registers (per kind: filter project/date/person, detail drawer with rendered data + signons), Incidents (W5), Subbie SWMS (W7), Audit (W8). Generic FormPdf (data rendered by schema field order + signon table) + route case 'form'.

### W5 — Incidents + corrective actions
Register (number, type, severity, project, occurred, status, open actions count), new incident dialog (field app too — incident is also fillable from Safety tab via its template kind → creates incidents row not form_submission), detail page: workflow open→investigating→closed (closed requires all actions done), corrective_actions CRUD (assignee, due), photos. Dashboard card: open incidents + overdue actions (ops-visible). IncidentPdf + route case.

### W6 — External signing + QR
Share link create UI on SWMS instance section + toolbox/induction submissions ('Get sign-on link/QR'). Public /sign/[token]: doc read-through (SWMS hazards table or form data), sign form (name, company, signature pad) → RPC; thanks screen; handles expired/inactive. Sign-ons appear in registers flagged External. QR poster PDF route + qrcode dep. Copy link + mailto buttons.

### W7 — Subbie SWMS submission + review
'Request subbie SWMS' button on project WHS context → creates subbie_swms share link, copy/mailto/QR. Public /submit/[token]: company/contact/email/title + PDF upload (anon storage prefix) → RPC row. Review queue in WHS hub + project tab: view PDF (signed URL via authed user), accept/reject + notes (audited). Accepted shows in project documents.

### W8 — Audit trail UI
WHS hub Audit tab: filterable table (date range, project, entity type, actor, action) paginated, CSV export. Per-record 'History' affordance on SWMS instance, incident, subbie SWMS detail (modal listing its audit rows). Verify trigger coverage + immutability (update/delete attempts fail) — automated check in rls-check.mjs extension.

### W9 — WHS hub overview, project WHS tab, E2E + docs
Hub Overview: open incidents, overdue corrective actions, pending subbie reviews, sign-ons last 7d, forms submitted last 7d, expiring-soon nothing? (vendor compliance already on dashboard — link). Project WHS tab aggregating project-scoped: SWMS, forms, sign-ons, incidents, subbie queue. Seed demo WHS data (submissions, a toolbox with signons incl. one external, an open incident w/ overdue action, a pending subbie SWMS, share links). E2E sweep: public sign flow end-to-end (anon HTTP), subbie upload flow, audit immutability, form PDF, QR poster, regression (build/tests/lint/rls-check). README + spec phase-2 list updates.
