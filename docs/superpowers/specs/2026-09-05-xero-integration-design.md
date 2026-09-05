# Xero integration — two-way invoicing via OAuth 2.0

**Date:** 2026-09-05 · **Status:** Design approved by owner in chat (2026-09-05); implementation plan at `docs/superpowers/plans/2026-09-05-xero-integration.md`; not yet built · **Module:** Money (invoices, claims, payments), Settings, client portal billing tab

## 1. Why

Invoices are raised in Xero today and transcribed by hand into ECR. ECR then
guesses at paid status. The owner wants Xero data to land in ECR on its own,
and wants "Send invoice" in ECR to go out through Xero so there is one ledger.

ECR already ships a one-way **Xero Sales CSV export** (`src/lib/xero.ts`,
Money page button). It hard-codes account 200 and never learns what happened
after the import. This design replaces it with a live, two-way connection over
Xero's OAuth 2.0 API, keeping Xero as the ledger of record.

## 2. Owner decisions (2026-09-05)

| Decision | Choice |
|---|---|
| Connection type | **Standard OAuth 2.0 web app** (free), not a paid Custom Connection. One "Connect to Xero" click in Settings; refresh token kept alive by the nightly cron. |
| Direction | **Both ways, one owner per invoice at a time.** ECR drafts → pushed to Xero on send, then Xero owns the record. Xero-raised invoices → pulled into ECR as read-only mirrors. Payments, credits and voids flow Xero → ECR only. |
| Who emails the client | **Xero**, using the org's invoice template, via the API email endpoint. A Settings switch can fall back to ECR's own PDF/email. |
| Scope of this build | The **"safe and worth having"** set (§4). Supplier bills → job costing deferred to a phase 2 once a month of tracked data exists. |
| Data boundary | **No payroll, no employee data, no bank data, no bills, no client personal data beyond name/ABN.** See §3. Owner's words: sensitive client data and payroll are not to be taken from Xero. |
| Compliance | Must meet **Xero's security standard for API consumers** (ticked on app creation). See §9. |
| MFA for office logins | Required by the Xero standard. **Separate follow-on build**, to be done **before the real ECR org is connected**. Demo Company testing may proceed without it. |
| Xero app ownership | App registered under the owner's personal Xero login for Demo Company testing. Re-registered under the **business's own Xero login** once the owner is invited to the ECR org (Standard or Adviser role). |
| Redirect URIs | `https://entice-pink.vercel.app/api/xero/callback` (prod) + `http://localhost:3000/api/xero/callback` (dev). Editable in the Xero app config when the domain changes. |

## 3. Data boundary — what crosses the line

This section is a contract. Anything not listed under "reads" or "writes" is
**never requested**, and a unit test pins the exact scope string.

**Scopes requested (exactly these):**
`offline_access accounting.invoices accounting.payments accounting.contacts accounting.settings`

**ECR reads from Xero**

| Object | Fields kept | Not kept |
|---|---|---|
| Sales invoices (`Type == "ACCREC"`, statuses AUTHORISED / PAID / VOIDED) | InvoiceID, InvoiceNumber, Reference, Status, Date, DueDate, LineAmountTypes, Total, AmountPaid, AmountCredited, AmountDue, FullyPaidOnDate, UpdatedDateUTC, line Description / Quantity / UnitAmount / AccountCode / TaxType / Tracking, Contact.ContactID, online invoice URL | DRAFT and SUBMITTED invoices (the bookkeeper's work in progress), DELETED invoices, attachments, history notes |
| Payments on those invoices | PaymentID, Invoice.InvoiceID, Date, Amount, Reference, Status, IsReconciled, UpdatedDateUTC | Bank account details, the Account the payment landed in |
| Contacts | ContactID, Name, TaxNumber (ABN), whether an email address exists (boolean only), UpdatedDateUTC | Email addresses, phones, postal/street addresses, bank account numbers, contact persons, balances, discounts, any other field |
| Reference data | Accounts of type REVENUE / SALES / OTHERINCOME (Code, Name, Type, TaxType, Status); Tax rates (Name, TaxType, EffectiveRate, Status); Tracking categories and their options (ids, names, status); Organisation name + short code | Every other account type, bank accounts, currencies, users |

**ECR writes to Xero**

| Action | When | Payload |
|---|---|---|
| Create contact | First push for a client with no `xero_contact_id` and no match by ABN/name | Name, TaxNumber (ABN), EmailAddress of the ECR primary contact (needed so Xero can email the invoice). Nothing else. |
| Create invoice (ACCREC, status AUTHORISED) | "Send via Xero" on an ECR draft invoice; "Certify" on a progress claim | §5.2 / §5.3 |
| Email invoice | Immediately after create, when the Settings email mode is `xero` | `POST /Invoices/{id}/Email` (no body) |
| Create tracking option | First push for a job/project with no `xero_tracking_option_id` | Option name = ECR job/project number |
| Archive tracking option | Nightly, for jobs/projects paid/closed > 90 days | Status ARCHIVED (see VERIFY-3) |

**Never, in any phase built under this spec**

- Bills / purchases (`ACCPAY`), purchase orders, expense claims
- Bank accounts, bank transactions, bank feeds, reconciliation state
- Payroll: employees, timesheets, pay runs, leave, superannuation — no payroll scope is ever requested
- Reports, journals, manual journals, budgets, fixed assets, files
- Contact addresses, phone numbers, bank details, notes
- Any update or delete of an invoice, payment, contact or credit note in Xero. ECR creates, then only reads. The single exception is archiving a tracking option ECR itself created.
- Xero user or organisation data beyond the org name

## 4. Feature set (this build)

1. Connect / disconnect in Settings, with org name, connected-by, last sync.
2. **Send via Xero** for invoices; **Certify → Xero invoice** for progress claims.
3. **Nightly pull + Sync now**: paid / part-paid / credited / voided state, payments, Xero-raised invoices as mirrors, unmatched queue.
4. **Contacts** linked by ABN then exact name; leftovers linked by hand; created on first invoice when missing.
5. **Tracking category "Job"** option per job/project on every pushed invoice (gives Xero a per-job P&L and gives ECR a match key on pull).
6. **Pay-now link** (Xero online invoice URL) on the invoice page and on the portal billing tab behind the existing `show_financials` gate.
7. **Reference data + mapping** in Settings: income account per line kind, claims account, GST / no-GST tax rate, tracking category.
8. **Sync register**: runs and per-record events, admin/office visible, 1-year+ retention.
9. Dashboard alert when the connection needs attention or a sync failed.

## 5. Architecture and flows

### 5.1 Connect

- **Env (Vercel prod + `.env.local`):** `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_TOKEN_KEY` (32 random bytes, base64; generated by the build, never in the repo). Redirect URI is derived from `NEXT_PUBLIC_APP_URL` + `/api/xero/callback`.
- `GET /api/xero/connect` — admin only (`requireRole('admin')`). Generates a random `state`, stores its SHA-256 in an httpOnly, Secure, SameSite=Lax cookie (10 min), 302s to `https://login.xero.com/identity/connect/authorize?response_type=code&client_id&redirect_uri&scope&state`.
- `GET /api/xero/callback` — admin only. Verifies `state` against the cookie (timing-safe), exchanges `code` at `https://identity.xero.com/connect/token` (Basic auth with client id:secret), calls `GET https://api.xero.com/connections` to list authorised tenants. Exactly one tenant is stored as active. If Xero returns more than one, the callback stores nothing and Settings shows a one-off picker. Responds with a **302** to `/settings?tab=xero` — never renders tokens or codes in a body (Xero standard §2).
- **Switching orgs** (Demo Company → real ECR): if the callback's tenant id differs from the one previously stored, the Xero tab demands the new org name be typed to confirm, then **clears every `xero_*` link column** on invoices, claims, payments, clients, jobs, projects and empties the reference cache. The sync register is kept.
- **Disconnect:** `DELETE https://api.xero.com/connections/{connectionId}`, then tokens are wiped and the row set to `disconnected`. Link columns are kept (a reconnect to the same org keeps working).

### 5.2 Send via Xero (invoices)

Replaces `markInvoiceSent` when a connection is active. Runs server-side, admin/office, in this order; each step is idempotent so a retry after a timeout resumes rather than duplicates.

1. Existing guards from `markInvoiceSent` (draft, non-empty, non-zero total).
2. **Contact**: use `clients.xero_contact_id`; else search Xero by ABN, then exact name; else create. Store the id.
3. **Tracking option**: use `jobs.xero_tracking_option_id`; else create under the configured category, store the id. If the category is full (VERIFY-3) the push continues without tracking and logs a warning event.
4. **Look-before-create**: `GET /Invoices?InvoiceNumbers={ecr number}`. Adopt an existing invoice **only** if it is an `ACCREC` invoice for the **same contact** in `AUTHORISED` or `PAID` (an earlier attempt that timed out before ECR recorded it). Voided/deleted ones are ignored. Any other live invoice with that number — a supplier bill, another contact's invoice, a bookkeeper's draft — is a **conflict and the push fails** with a clear message rather than adopting or duplicating (this is the VERIFY-1 collision case). Otherwise create:
   - `Type: ACCREC`, `Status: AUTHORISED`, `LineAmountTypes: Exclusive`
   - `InvoiceNumber`: the ECR number; `Reference`: job number + " " + job title (truncated to Xero's limit)
   - `Date` = `issue_date`; `DueDate` = `due_date ?? issue_date + clients.payment_terms_days`
   - Lines: `Description`, `Quantity` = `qty`, `UnitAmount` = `unit_sell` (ex GST), `AccountCode` from the mapping for the line's `kind` (new nullable `invoice_lines.kind`, carried from quote lines; falls back to the default income account), `TaxType` = configured GST rate (default `OUTPUT`) or configured no-GST rate (default `EXEMPTOUTPUT`) when `invoices.gst_rate = 0`, `Tracking` = [{ TrackingCategoryID, TrackingOptionID }]
5. **Total check**: compare Xero's `Total` with `docTotals(...).total`. A difference > $0.02 (per-line vs per-document GST rounding) does not fail the push; it is logged as a `warning` event and shown on the invoice page. Xero's total is stored in `xero_total`.
6. `GET /Invoices/{id}/OnlineInvoice` → store `xero_online_url`.
7. If email mode is `xero`: `POST /Invoices/{id}/Email`. Requires the Xero contact to have an email address; if not, the push still succeeds and the UI says "Xero could not email — add an email to the contact in Xero, or send ECR's PDF".
8. Only now: `status = 'sent'`, `sent_at`, `origin = 'ecr'`, `xero_pushed_at`, `syncJobStatus`, existing `notifyClientInvoiceSent` (portal deep link; skips the PDF attachment when Xero emailed).

Failure at any step before 8 leaves a normal editable draft and shows the Xero error text.

### 5.3 Certify → Xero invoice (progress claims)

`certifyClaim` gains the same push after its existing writes:
- One line: `Description` = "Progress claim PC-{n} — {project number} {project name}", `Quantity 1`, `UnitAmount` = `certified_amount` (this is GST-inclusive in ECR, see `markClaimPaid`), so the invoice uses `LineAmountTypes: Inclusive` and Xero derives the GST.
- `InvoiceNumber` = `PC-{project number}-{n}`; `Reference` = project number; tracking option = the project's.
- `AccountCode` = the claims account from Settings.
- Stores `claims.xero_invoice_id`, `xero_status`, `xero_online_url`, `xero_pushed_at`.
- A failed push does **not** undo certification (the certificate is a fact); the claim shows "Not in Xero — retry" and the Xero tab lists it.

### 5.4 Pull (nightly + Sync now)

Runs inside the existing `/api/cron/notify` handler (Vercel Hobby allows two crons and both are used) at 06:00 Brisbane, and on demand from Settings / Money via a server action. A run is refused while another run is `running` and younger than 10 minutes.

1. **Token**: refresh if the access token expires within 5 minutes. Store the rotated refresh token before using it. `invalid_grant` → connection `needs_reconnect`, office email via the existing email engine, run `failed`.
2. **Reference data**: accounts, tax rates, tracking categories → upsert cache.
3. **Invoices**: `GET /Invoices?where=Type=="ACCREC"&Statuses=AUTHORISED,PAID,VOIDED&page=n` with `If-Modified-Since = last successful sync − 1 hour` (or 90 days back on the first run — the last quarter; older history stays in Xero). Each run has a 240-second budget: when it runs out the run stops, is marked `partial` and truncated, and resumes from the same watermark next time. The paged list may omit line items, so a mirror always fetches the full invoice before its lines are written or refreshed.. For each:
   - Known by `xero_invoice_id`; else by `InvoiceNumber == invoices.number` **only** for `origin = 'ecr'` invoices that are not yet linked, are `sent`/`paid`/`void`, and whose client's `xero_contact_id` agrees with the Xero contact (or either side is unknown) — a blank InvoiceNumber never matches. Claims are found by their stored `xero_invoice_id`. Update Xero-owned columns and derive status (§7); a `draft` is never status-flipped. Mirrors (`origin = 'xero'`) also get their lines and `gst_rate` re-derived from Xero on every sync.
   - Unknown: create a **mirror** `invoices` row with `origin = 'xero'`, `number` = Xero InvoiceNumber, header + lines copied, `client_id` from the contact link (or a **client created from name + ABN only** when no client matches — flagged `needs_review`), `job_id` from the tracking option, else from a job/project number found in `Reference` (same client only), else null → **Needs matching** queue. Lines and `gst_rate` come from the pure `mirrorLinesFromXero` (rate = TotalTax ÷ SubTotal; `Inclusive` unit prices backed out to ex-GST; `NoTax` → 0). When the ECR-derived total does not reconcile with Xero's `Total` within 2 cents the mirror is flagged `needs_review` and a warning is logged. If the lines cannot be written the mirror row is rolled back rather than left at $0.
4. **Payments**: `GET /Payments` with the same `If-Modified-Since`, `PaymentType == "ACCRECPAYMENT"`. Upsert `payments` by `xero_payment_id` with `source = 'xero'`, `method = 'xero'`, `reference` = Xero Reference, against the linked invoice **or the pushed progress claim** (`claim_id`) — real Xero amounts, so part-payments are exact. A Xero `DELETED` payment removes **only** the ECR row that the sync itself created (`source = 'xero'`); ECR-entered payments are never deleted by the sync.
5. **Tracking hygiene**: archive options for jobs paid / projects closed > 90 days (VERIFY-3).
6. Write the run row (`success` / `partial` / `failed`) and per-record events. Rate limiting: sequential calls; on `429` sleep `Retry-After` (cap 60 s) once, a second `429` ends the run as `partial`. The watermark (`last_sync_at`) advances to the run's start time whenever the run reached the end of every page — even when individual records warned or failed (those live in the register and inside the one-hour overlap) — and is held back only when the run was **truncated** by a rate limit or a fatal error, so nothing is skipped and a permanently-odd record cannot pin the window forever.

### 5.5 Contacts

- On connect and each sync: pull contacts modified since last sync (fields per §3). Match `TaxNumber` (digits only) to `clients.abn`, then case-insensitive exact `Name`. Store `xero_contact_id`. Leftovers appear in the Xero tab with a client picker; both directions of a manual link are logged.
- ECR never updates a Xero contact. Creating one sends name, ABN and the ECR primary contact's email.

## 6. Data model (migration `0063_xero.sql`)

```sql
-- Singleton connection. NO RLS policies: service role only.
create table xero_connection (
  id int primary key default 1 check (id = 1),
  tenant_id text, tenant_name text, connection_id text,
  access_token_enc text, refresh_token_enc text,   -- AES-256-GCM, base64 "iv.ct.tag"
  access_expires_at timestamptz, scopes text,
  status text not null default 'disconnected'
    check (status in ('connected','needs_reconnect','disconnected')),
  connected_by uuid references profiles(id), connected_at timestamptz,
  last_refresh_at timestamptz, last_sync_at timestamptz, last_sync_status text,
  updated_at timestamptz not null default now()
);

alter table invoices
  add column origin text not null default 'ecr' check (origin in ('ecr','xero')),
  add column xero_invoice_id text unique, add column xero_number text,
  add column xero_status text, add column xero_total numeric(14,2),
  add column xero_amount_paid numeric(14,2), add column xero_amount_credited numeric(14,2),
  add column xero_amount_due numeric(14,2), add column xero_online_url text,
  add column xero_pushed_at timestamptz, add column xero_emailed_at timestamptz,
  add column xero_synced_at timestamptz,
  add column needs_review boolean not null default false;   -- unmatched job or auto-created client
-- kind reuses RATE_KINDS (src/lib/zod.ts), the same values quote_lines.kind uses
alter table invoice_lines add column kind text
  check (kind in ('labour','plant','material','subbie','other'));

alter table claims
  add column xero_invoice_id text unique, add column xero_status text,
  add column xero_amount_due numeric(14,2), add column xero_online_url text,
  add column xero_pushed_at timestamptz, add column xero_emailed_at timestamptz,
  add column xero_synced_at timestamptz;
-- partial indexes on jobs/projects.xero_tracking_option_id (the pull probes them per mirrored invoice)

alter table payments
  add column xero_payment_id text unique,
  add column source text not null default 'ecr' check (source in ('ecr','xero'));

alter table clients  add column xero_contact_id text unique;
alter table jobs     add column xero_tracking_option_id text;
alter table projects add column xero_tracking_option_id text;

-- Reference cache (select admin/office; writes service role).
create table xero_accounts   (code text primary key, name text, type text, tax_type text, status text, synced_at timestamptz);
create table xero_tax_rates  (tax_type text primary key, name text, effective_rate numeric(6,3), status text, synced_at timestamptz);
create table xero_tracking_categories (id text primary key, name text, status text, synced_at timestamptz);
create table xero_tracking_options (id text primary key, category_id text references xero_tracking_categories(id), name text, status text, synced_at timestamptz);
-- Contacts cache exists ONLY so the manual "link client → contact" picker has a list.
-- Holds exactly the §3 fields: id, name, ABN, whether an email exists. Nothing else.
create table xero_contacts  (contact_id text primary key, name text, abn text, has_email boolean, status text, synced_at timestamptz);

alter table settings
  add column xero_email_mode text not null default 'xero' check (xero_email_mode in ('xero','ecr')),
  add column xero_default_account text, add column xero_account_by_kind jsonb not null default '{}',
  add column xero_claims_account text, add column xero_gst_tax_type text default 'OUTPUT',
  add column xero_no_gst_tax_type text default 'EXEMPTOUTPUT', add column xero_tracking_category_id text;

-- Register (select admin/office; writes service role only; never pruned).
create table xero_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(), finished_at timestamptz,
  status text not null check (status in ('running','success','partial','failed')),
  trigger text not null check (trigger in ('cron','manual','push')),
  invoices_pulled int default 0, invoices_created int default 0, payments_upserted int default 0,
  contacts_linked int default 0, pushed int default 0, warnings int default 0, errors int default 0,
  error text, created_by uuid references profiles(id)
);
create table xero_sync_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references xero_sync_runs(id) on delete cascade,
  direction text not null check (direction in ('push','pull')),
  entity text not null check (entity in ('invoice','claim','payment','contact','tracking','reference','connection')),
  entity_id uuid, xero_id text,
  action text not null check (action in ('created','updated','voided','matched','unmatched','archived','skipped','warning','failed')),
  detail text, created_at timestamptz not null default now()
);
```

`portal_billing` (0044 definition) is re-created to add `pay_url` = `invoices.xero_online_url` (invoices only, still behind `show_financials`). No other portal RPC changes.

Invoices, payments and claims have no `audit_log` triggers today; the Xero audit trail is `xero_sync_runs` / `xero_sync_events`, which record every push, pull, match, org switch and failure with actor (`created_by`) and timestamp.

## 7. Status derivation for Xero-linked records

| Xero | ECR invoice | Notes |
|---|---|---|
| AUTHORISED, AmountDue > 0 | `sent` | `paid_at` null |
| AUTHORISED, AmountDue = 0 (credited) | `paid` | `paid_at` = last payment/credit date |
| PAID | `paid`, `paid_at = FullyPaidOnDate` | `syncJobStatus` runs after |
| VOIDED | `void` | Xero-sourced payments stay as history; ECR's own `voidInvoice` guard (refuses when payments exist) does not apply to the sync |
| Claims: PAID | `claims.status = 'paid'`, `paid_at`; the payment row itself arrives through the Payments pull (real Xero amount, `claim_id`, `source = 'xero'`) | |
| Claims: VOIDED | `xero_status = 'VOIDED'` only; claim stays `certified` (no `void` in the claims CHECK) | Red note on the claim + register event |

On a Xero-linked invoice or claim the ECR **Record payment**, **Delete payment** and **Void** actions are disabled with the message "Managed in Xero — ECR picks this up on the next sync."

## 8. UI

- **Settings → Xero tab** (`xero-section.tsx`): connection card (Connect / Disconnect / re-authorise; org; connected by; last sync), **Sync now**, mapping form (default income account, per-kind overrides, claims account, GST + no-GST tax rate, tracking category; all pickers fed from the cache), email mode switch, unlinked-clients list with contact picker, pending claim pushes, register (runs with expandable events). Secrets never reach the client: `page.tsx` passes presence booleans like it does for Resend.
- **Invoice page**: Xero panel (Xero number/status, paid/credited/due, pay-now link, Open in Xero, total-mismatch warning). Draft: "Send via Xero" (or "Mark sent" when disconnected; email mode `ecr` still pushes but ECR emails). Linked: payment/void controls replaced by the managed-in-Xero note. Line editor gains a `kind` select.
- **Money page**: Xero status column with pay link; filters gain **Needs matching**; **Sync now**; CSV export hidden while connected.
- **Job / project pages**: invoice lists include mirrors matched to that work with a "from Xero" tag; claims show Xero status after certify.
- **Dashboard**: existing outstanding figures now live; red card only for `needs_reconnect` or a failed/partial run.
- **Portal billing tab**: Pay now button when `pay_url` is present. Nothing else changes for portal or field.

## 9. Compliance with Xero's security standard for API consumers

| Requirement | How ECR meets it |
|---|---|
| OAuth 2.0 only; tokens/customer identifiers never exposed in the app | Tokens live in `xero_connection` with no RLS policies (service role only); server code only; never in a response body, log line or client component |
| Refresh token encrypted (AES-128+), key separate from code | AES-256-GCM, key = `XERO_TOKEN_KEY` env var in Vercel, not in the repo |
| TLS 1.2+ in transit | Vercel and Supabase enforce; all Xero calls are HTTPS |
| Sensitive values in URL params → 302, never in a body | Callback 302s to Settings; `code`/`state` never rendered |
| Strong customer authentication (2SA minimum) for app users | **Follow-on build: TOTP MFA for admin/office roles (Supabase Auth MFA), required before the real org is connected** |
| OWASP Top 10: validated redirects, Secure + HttpOnly cookies, injection | `state` cookie httpOnly/Secure/SameSite, timing-safe compare; Supabase SSR cookies; parameterised queries throughout |
| Encryption at rest (NIST) for financial/personal data | Supabase Postgres volumes encrypted at rest (Sydney) |
| Audit logging: timestamp, actor, event, outcome, source; ≥ 1 year; immutable | Append-only `audit_log` triggers + `xero_sync_runs` / `xero_sync_events` (service-role writes only, never pruned, covered by nightly backups) |
| Data hosting risk assessed | All data in Sydney (Supabase ap-southeast-2, Vercel syd1) |
| Security monitoring and anomaly reporting to Xero | `app_errors` capture + sync failures surfaced; process item added to the ISO security register: report Xero-related anomalies to Xero |
| Indirect data access disclosed | None — no third party receives Xero data |

## 10. Code layout

- `src/lib/xero/` — `client.ts` (fetch wrapper: base URL, tenant header, refresh-once on 401, 429 handling, quota headers), `tokens.ts` (encrypt/decrypt, refresh, single-flight), `map.ts` (pure mappers ECR ↔ Xero, status derivation, ABN normalisation), `push.ts`, `pull.ts`, `contacts.ts`, `reference.ts`, `register.ts`.
- Existing CSV code moves to `src/lib/xero-csv.ts` (import + test updated) to free the `xero/` name.
- Routes: `src/app/api/xero/connect/route.ts`, `src/app/api/xero/callback/route.ts`. Sync hooked into `src/app/api/cron/notify/route.ts`.
- Actions: `src/app/(office)/settings/xero-actions.ts` (connect helpers, mapping save, link contact, sync now, disconnect), changes in `invoices/actions.ts` and `projects/[id]/claims/actions.ts`.
- All Xero DB access via `createAdminClient()` after the usual `requireRole` guard on user-triggered paths; cron uses the service role as today. Locally the service-role key is empty, so `.env.local` needs it for Demo Company testing (or the routes 503 with the existing friendly message).

## 11. Testing

- **Unit (vitest):** mappers both directions incl. rounding cases; status derivation table (§7); scope string equals §3 exactly; AES round trip + tamper detection; client wrapper with mocked `fetch` (401→refresh→retry once, 429→wait→retry, quota header parse); look-before-create idempotency; payments upsert/delete rules; ABN/name matching.
- **RLS probe (`rls-check.mjs`):** `xero_connection` unreadable by admin/office/field/anon sessions; register readable by admin/office only; cache readable by admin/office.
- **Live, Demo Company (pre-real-org gate):** connect → mapping → send an ECR invoice via Xero (email received, pay link opens) → pay it in Xero → Sync now flips ECR to paid with a payment row → void one in Xero → ECR void → raise one in Xero with the job number in Reference → mirror matched → raise one without → Needs matching → link by hand → certify a claim → Xero invoice → disconnect/reconnect. Portal billing shows Pay now behind `show_financials`. Prove cross-checks in the register.

## 12. VERIFY register (confirm during Demo Company testing)

| # | Question | Fallback if wrong |
|---|---|---|
| VERIFY-1 | Does Xero's own auto-numbering collide with ECR `INV-xxxx` numbers pushed via the API, or does Xero advance its next number past them? | Ask the bookkeeper to set Xero's next-invoice prefix to something other than `INV-`; on a duplicate-number error the push fails clearly. Mirrors whose Xero number collides with an existing ECR number are stored with a ` (Xero)` suffix. |
| VERIFY-2 | Does `POST /Invoices/{id}/Email` need anything beyond status AUTHORISED and a contact email? | Fall back to email mode `ecr` for that invoice with a clear note. |
| VERIFY-3 | Do **archived** tracking options count toward Xero's 100-options-per-category limit? | If they do: tracking options for **projects only**, jobs matched by `Reference`. |
| VERIFY-4 | Does the granular `accounting.settings` scope cover creating/archiving tracking options, or is read-only enough for everything except that? | Drop to `accounting.settings.read` and have the bookkeeper create the option by hand (ECR shows the exact name to create). |
| VERIFY-5 | Per-line vs per-invoice GST rounding: how often does the total differ by cents? | Already tolerated (§5.2 step 5); if frequent, switch pushes to `LineAmountTypes: Inclusive` with ECR-computed inclusive unit prices. |

## 13. Rollout

1. Build + unit tests + RLS probe on a feature branch; migration 0063 applied by the owner via the dashboard paste (include the `schema_migrations` row).
2. Owner adds `XERO_TOKEN_KEY` (handed over out of band) alongside the already-saved `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` in Vercel; local `.env.local` gets the same plus the service-role key.
3. Live Demo Company run (§11) under the owner's personal Xero login.
4. **MFA follow-on build** shipped and switched on for admin/office.
5. Owner gets a Standard/Adviser login on the business's Xero org; re-registers the app there; updates the Vercel env; connects the real org (org-switch confirmation clears demo link columns).
6. Bookkeeper briefed: raise sales invoices in ECR where a job exists; put the job number in Reference when raising directly in Xero; do payments/credits/voids in Xero only.

## 14. Out of scope / later

- **Phase 2:** supplier bills (`ACCPAY`) tagged with the job tracking option → job costing against POs. Needs the `accounting.invoices` scope already held; separate spec.
- Attach ECR PDFs / handover packs to Xero invoices (`accounting.attachments`).
- Payroll / timesheets: **never under this spec**; would be its own risk review if ever.
- Xero Quotes, purchase orders, bank feeds, reports: not planned.

## 15. Open items for the owner

- Get invited to the business's Xero organisation (Standard or Adviser) so the app can be re-registered under the business login.
- Confirm the org's Xero plan supports tracking categories, and that fewer than two uncertified apps are already connected to it.
- Tell the bookkeeper the numbering / reference conventions once VERIFY-1 is settled.
