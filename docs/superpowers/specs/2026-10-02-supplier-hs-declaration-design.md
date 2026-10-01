# Supplier H&S Declaration — design

**Date:** 2026-10-02
**Status:** Approved in brainstorming, pending spec review

## Goal

Before a supplier/subbie prices or works on our job or project, they complete and sign a
health & safety declaration: Yes/No/N/A questions, required uploads (insurance certificates,
SWMS), and a signed declaration. The completed declaration is saved against **that job or
project and that supplier**, reviewed by the office, and kept as a compliance record.

Works identically for **jobs and projects**. Projects additionally surface it on the
procurement RFQ list and warn on award.

## Non-goals (this build)

- A supplier portal (accounts, dashboard, multi-package view). Deliberately deferred — live
  procurement volume is tiny (2 vendors, 1 RFQ, 0 POs as of 2026-10-01).
- Suppliers submitting quotes, POs or invoices online. The declaration page is the natural
  place to add quote upload later.
- Automatic emailing. Links are copied or opened in Gmail, matching how RFQs go out today.
- Hard-blocking award. Award shows a warning only.

## Data

### Question template (reuses the forms engine)

- `form_templates.kind` / `form_submissions.kind` check constraints gain `supplier_declaration`.
  (`form_submissions` itself is **not** used for declarations — it requires a staff
  `submitted_by`.)
- Template `schema` is the existing `[{key,label,type,options,required}]` shape, plus:
  - optional `section` string (renders "Part A — Company compliance" etc. as group headers);
  - new field type `upload`: `{type:'upload', key, label, required, expiry: boolean,
    compliance_kind?: 'public_liability'|'workers_comp'|'licence'|'other'}`. A Yes/No/N/A
    question may carry `upload_key` to pair it with its upload field.
- Editable in the existing Settings form-template editor (which already bumps `version` on
  schema change). The editor needs to understand `section` and `upload`.
- Migration seeds one active template "Supplier H&S Declaration" with the agreed questions:
  - **Part A — Company compliance:** (1) current public liability insurance → upload cert +
    expiry, required; (2) current workers comp → upload cert + expiry, required; (3) workers hold
    required licences/tickets (asbestos removal licence, White Card, plant tickets) → upload,
    optional; (4) current SWMS covering the high-risk work in this scope → upload SWMS,
    required; (5) all workers trained in and signed that SWMS; (6) fitness-for-work / drug &
    alcohol policy in place.
  - **Part B — Fit for work & site:** (7) all workers fit for work (not impaired by fatigue,
    drugs, alcohol, illness); (8) required PPE; (9) tools/plant in safe working order and
    tested & tagged; (10) workers will complete our site induction and a daily Take 5 /
    prestart before starting; (11) understand the scope and site hazards (asbestos,
    contamination, heights, services).
  - **Declaration text:** "I declare the above is true and correct and that I am authorised to
    sign on behalf of {company}."

### `supplier_declarations` (new)

| column | notes |
|---|---|
| id | uuid pk |
| vendor_id | fk vendors, `on delete restrict` |
| project_id / job_id | fk, `on delete cascade`; check: exactly one is set |
| package_id | nullable fk packages (set when requested from an RFQ row) |
| template_id, template_version, template_snapshot | snapshot of the schema at link creation so later edits don't change an open link |
| token | random, unique; `expires_at` = created + 30 days |
| status | `sent` → `opened` → `submitted` → `accepted` / `rejected`; plus `cancelled` |
| answers | jsonb `{key: 'yes'\|'no'\|'na', ...}` |
| has_no_answers | boolean, computed on submit |
| signer_name, signer_position, signature_data | signature is the base64 PNG data URL (≤140k chars, as `submit_shared_signon`) |
| submitted_at, submitted_ip | |
| reviewed_by, reviewed_at, reject_reason | |
| signed_pdf_attachment_id | fk attachments, set on accept |
| created_by, created_at, opened_at | |

- Partial unique index: at most one row per (vendor, project|job) with status in
  (`sent`,`opened`) — one open link at a time.
- RLS: office/admin full access via existing role helpers; no direct anon access.

### Uploaded files

- Stored in the private `attachments` bucket under the **job/project prefix**
  (`job/<id>/declarations/<decl id>/…` or `project/<id>/…`), recorded in `attachments` with
  `parent_type` `job`/`project` and `meta = {supplier_declaration_id, field_key, expiry_date}`
  — so they appear in the job/project documents.
- No anon storage policy. Upload goes through a route handler that validates the token via a
  definer RPC, then writes with the service-role client (same pattern as
  `portal/[token]/document-upload` + `portal_register_upload`).
- PDF/JPEG/PNG/HEIC only, ≤ 20 MB each, per-token rate limit. Files uploaded but never
  submitted are flagged `meta.pending = true`; the daily `api/cron/notify` run deletes pending
  files (storage object + attachment row) whose declaration is cancelled or past `expires_at`.
  Re-uploading the same field replaces the previous pending file.

### Anon RPCs (security definer, granted to anon)

- `declaration_resolve(token)` → header info (our company, job/project name + number, site
  address, supplier name), template snapshot, status, and list of already-uploaded files.
  Marks `opened` on first call. Errors on expired/cancelled; returns "already submitted" state
  for submitted/accepted/rejected.
- `declaration_register_upload(token, field_key, filename, content_type, size)` → validates and
  returns the storage path to write; rate-limited.
- `declaration_submit(token, answers, uploads[], signer_name, signer_position, signature_data,
  ip)` → validates every required question answered and every required upload present (and
  expiry given where required), sets `has_no_answers`, status `submitted`, writes `audit_log`.

## Screens

### Office — shared `SupplierDeclarationsPanel`

Used on the **project WHS tab** and the **job page** (same component, parent type/id props).

- List: supplier, status badge, sent/submitted dates, red flag if any "No".
- **Request declaration**: pick supplier (vendors list) → creates row → dialog with *Copy link*
  and *Open in Gmail* (pre-filled short message; supplier email if on file). If an open link
  already exists for that supplier: offer *Re-send existing* or *Cancel and create new*.
- **Cancel link** on sent/opened rows.

### Office — review page

`/declarations/[id]` (office route): questions + answers (No highlighted), uploaded files with
expiry, signature/name/position/time/IP.

- **Accept** → generate signed PDF (react-pdf, `src/pdf/`) and save as an attachment on the
  job/project; for each upload with `compliance_kind` + expiry, upsert
  `vendor_compliance_docs` (vendor, kind, reference "Declaration <date>", expiry) — so the
  RFQ compliance dots stay current; status `accepted`.
- **Reject** with required reason → status `rejected`; office can request a new link.

### Projects — procurement extras

- RFQ list rows (`rfq-section.tsx`): declaration badge per invited vendor (Not requested /
  Sent / Submitted / Accepted / Rejected) and a *Request declaration* shortcut (sets
  `package_id`).
- Award (`award-section.tsx`): if chosen vendor has no accepted declaration on this project,
  confirm dialog "No accepted H&S declaration — award anyway?".

### Supplier — `/declare/[token]` (public, no login)

- Added to the auth-proxy exclusions alongside `/sign`, `/submit`, `/receive`.
- Mobile-first single page: header (our company, job/project, site address, supplier), Part A
  / Part B with Yes/No/N/A per question, upload fields (PDF or camera photo, expiry date
  where asked), declaration text, full name, position, `SignaturePad`, Submit.
- Answers/name autosaved to `localStorage` keyed by token (try/catch) so a closed tab resumes.
- After submit: "Thanks — submitted to {company}". Reopening shows "Already submitted".
  Expired/cancelled: "This link is no longer active — contact {company} for a new one."

## Edge cases

- One open link per supplier per job/project (index + UI re-send/cancel choice).
- Template edited after link sent → supplier sees the snapshot.
- Vendor with declarations can't be deleted (`restrict`); job/project deletion cascades.
- Token only ever exposes its own declaration — no other vendors, prices, or documents.
- Signature payload size capped; text inputs length-capped; answers validated against the
  snapshot keys only.

## Testing

- SQL/RPC tests: expired, cancelled, already-submitted tokens rejected; required-field
  validation; job-scoped token can't write under a project prefix; one-open-link index.
- Unit tests: `has_no_answers` computation, snapshot handling, compliance-doc upsert mapping.
- Live end-to-end on a **zz-prefixed test job and test project** (cleaned up after): request →
  open as supplier → upload → sign → accept → signed PDF in documents → vendor compliance dot
  green → award warning on a project package.
