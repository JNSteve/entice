# Entice — Civil & Remediation Operations Platform: Design Spec

**Date:** 2026-06-11
**Status:** Approved by owner (brainstorming session)
**Product name:** Entice

## 1. Purpose

Entice is an all-in-one operations platform for a 10–30 person Australian civil works and remediation contracting company. It replaces the fragmented stack (Excel estimates, paper site diaries, Word SWMS, spreadsheet claims, whiteboard scheduling) with one system covering the full lifecycle: client → quote → job/project → scheduling → field capture → cost control → procurement → progress claims/invoices → reports.

It deliberately spans a gap no commercial product covers: **dual-mode work**. Field-service tools (ServiceM8, simPRO) only model short jobs; project tools (Nexvia, Procore) only model long contracts. Entice models both, sharing one client base, one crew/plant pool, one compliance layer, and one money view.

## 2. Users and roles

| Role | Who | Sees/does |
|---|---|---|
| **Admin** | Owner/director | Everything, plus settings, users, rate libraries |
| **Office** | Estimator, admin, accounts | Clients, quotes, jobs, projects, claims, invoices, procurement, reports |
| **Supervisor** | Site supervisors / leading hands | Their projects/jobs in full, schedule, field tools, site diaries, SWMS admin for their sites; no company-wide financials |
| **Field** | Labourers, operators | My Day, check in/out, diary contribution, SWMS sign-on, photos. No financials at all |

Auth: email + password via Supabase Auth. Roles stored on a `profiles` table; enforced in the database with Postgres row-level security (RLS) and in the UI.

## 3. Work modes

### Projects (civil contracts)
Long-running contracted works. Carry: contract sum, retention regime (% per claim, cap %, split at practical completion), defects liability period, client references, budget by cost code, committed costs (POs + subcontracts), variations register, monthly progress claims, retention ledger.

### Jobs (remediation / minor works)
Short quoted works. Status spine: **Quote → Scheduled → In Progress → Completed → Invoiced → Paid** (plus **Lost** for dead quotes). Invoice generated from the job on completion.

Both attach to the same Clients/Sites, appear on the same schedule board, and use the same field capture (diary, SWMS, timesheets, photos).

## 4. Modules — v1 scope

### 4.1 Dashboard (office)
- Active projects and jobs with status and traffic-light health (budget vs actual, claim due)
- Claims due this month (based on each project's claim cycle/reference date)
- Quotes awaiting response, with age
- Unpaid invoices / uncertified claims
- Today's schedule summary (who's where)
- Insurance/licence expiries approaching (subbies and own)

### 4.2 Clients & Sites
- Clients (builders, strata managers, councils, facility managers, insurers) with type tag
- Multiple sites per client; multiple contacts per client with roles (job contact, billing, etc.)
- Client page shows all quotes/jobs/projects/invoices for that client

### 4.3 Quotes
- Quote builder: sections + line items; each line = description, qty, unit, unit cost, markup %, sell. Lines can pull from the **rate library** (labour classes, plant rates wet/dry, materials, subbie allowances)
- Quote-level summary: total cost, total sell, margin $ and %
- Branded PDF generation; mark Sent / Accepted / Lost (with reason)
- Convert: accepted quote → **Job** (lines become job budget/invoice basis) or → **Project** (lines become budget lines by cost code, quote total becomes contract sum)
- Quote register with conversion-rate stats

### 4.4 Jobs
- Job card: client/site, description, status, assigned crew, scheduled dates, quoted value
- Checklist items; notes; photo gallery; attachments (dockets, reports)
- Materials/cost capture against the job (for actual-vs-quoted profitability)
- Complete → generate invoice (from quoted lines or actuals); track sent/paid

### 4.5 Projects
- Project record: contract details (sum, type e.g. AS 4000/subcontract, retention % per claim + cap + PC split, DLP months, LD rate optional), client refs, key dates
- **Budget:** lines grouped by cost code (editable company cost-code list). Each line: budget amount; system shows committed (POs+subcontracts), actuals (recorded costs), forecast final, variance
- **Purchase orders:** to suppliers/subbies, line items coded to cost codes, statuses Draft/Issued/Closed; PDF generation; committed cost rolls into budget view
- **Variations register:** number, title, status (**Notified → Priced → Submitted → Approved / Rejected → Claimed**), client ref, cost & sell, time-bar date with dashboard warning, notes/attachments. Approved variations adjust contract sum for claims
- **Progress claims:** claim builder shows contract trade/budget lines + approved variations; user enters % complete or $ this claim per line; system computes: total claimed to date − retention (per retention rules) − previously claimed = **this claim**. Generates claim PDF (suitable for service under SOP Act conventions: claim number, reference date, ABN, amounts ex/inc GST). Track status: Draft → Submitted → Certified (with certified amount, schedule received date) → Paid. Variance between claimed and certified is visible
- **Retention ledger:** per project, accumulates retention withheld per claim; records releases (PC release, final release) with expected dates surfaced on dashboard
- Site diary register, photos, documents, SWMS all visible per project

### 4.6 Procurement (ProcurePro-lite)
- **Vendor database** (subbies + suppliers): trades, contacts, default payment terms, insurance policies (PL, workers comp) and licences with expiry dates → dashboard warnings
- **Trade packages** per project: name, budget, owner, let-by date, status (**Planned → RFQ Out → Quotes In → Recommended → Awarded**); procurement schedule view per project (table of packages × status/dates/budget vs awarded)
- **RFQs:** select vendors for a package, compose email with attachments (scope docs/drawings from project documents), send via system (mailto/SMTP — see 7.6), track per-vendor status (Invited / Quoted / Declined)
- **Quote comparison:** enter received quotes (amount, inclusions, exclusions, notes) → side-by-side levelling table against package budget; mark recommended
- **Award:** converts winning quote into a **subcontract commitment** (a committed cost like a PO, typed as subcontract) against the package's cost code; package marked Awarded

### 4.7 Schedule
- Week board: rows = staff (and optionally crews), columns = days; assignments are jobs or project tasks dragged on
- Assignment = person + date(s) + job/project + optional note
- Field users see only their own assignments (My Day)
- Conflicts (double-booking) flagged visually

### 4.8 Field experience (phone-first responsive web, installable PWA)
- **My Day:** today's assignments with site address (tap to open maps), scope notes, contacts
- **Check in / check out** per assignment → creates timesheet entries (start/stop, auto-duration); office can view/edit/approve timesheets weekly
- **Site diary** (per project per day; jobs get a lighter "work log"): weather, crew on site (prefilled from schedule), plant on site, work performed, delays/standdowns, instructions received, visitors, photos. One tap to add yourself. PDF export per day/range
- **SWMS:** company SWMS template library (admin-managed, rich text + hazard/control table) → instantiate site-specific copy on a project/job → workers read and sign on phone (name + drawn signature + timestamp); revision bumps require re-sign; register shows who has/hasn't signed
- **Photos:** camera capture straight onto job/project with caption; stored in Supabase Storage; gallery views office-side
- **Dockets:** photo + metadata (supplier, docket no., date, job/project, cost code optional) for later reconciliation

### 4.9 Invoices & money
- Job invoices: from quoted lines or actuals; branded PDF; statuses Draft/Sent/Paid (part-payments recorded)
- Progress claims live in Projects but appear in the money view
- **Xero-ready CSV export** of invoices (Xero sales invoice import format); live API sync is phase 2
- Payments recorded manually in v1

### 4.10 Reports
- Project profitability: budget vs committed vs actual vs claimed, forecast margin
- WIP report: work performed not yet claimed/invoiced
- Quote conversion: sent vs won by client/period
- Outstanding: unpaid invoices, uncertified claims, retention held by project with due-release dates
- Timesheet summary by person/week (export CSV for payroll)

### 4.11 Settings
- Company profile (name, ABN, logo, claim/invoice footer text) — used on all PDFs
- Users & roles management
- Rate library (labour/plant/material/subbie rates)
- Cost codes list (seeded with a sensible civil/remediation default set)
- SWMS template library
- Job checklist templates
- **Plant register:** company plant/equipment list (name, type, rego, owned/hired, hourly rate). Referenced by site diaries ("plant on site") and schedule notes; pre-starts and service tracking are phase 2
- Numbering sequences (quotes Q-xxxx, jobs J-xxxx, projects P-xxxx, POs, claims, invoices, variations per project)

## 5. Out of scope for v1 (phase 2 backlog)

1. Xero live API sync (two-way invoices/payments/contacts)
2. ITPs, lot-based QA, hold/witness points, NCR register
3. Plant pre-start checklists and service tracking (plant register + allocation IS in v1)
4. Subbie self-service portal and e-signatures on subcontracts
5. Multi-step approval workflows / delegation of authority
6. Offline capture (v1 requires connectivity on site)
7. Client portal (quote acceptance online, claim viewing)
8. SMS notifications; email automation beyond RFQ sending
9. Native mobile apps (PWA covers v1)
10. Scope-of-works template library for procurement
11. Payroll (timesheets export to CSV; payroll stays in Xero)

## 6. Data model (core entities)

`profiles` (user, role) · `clients` · `contacts` · `sites` · `rate_items` · `cost_codes` · `quotes` + `quote_sections` + `quote_lines` · `jobs` (+ checklist items, work logs) · `projects` · `budget_lines` · `purchase_orders` + `po_lines` · `variations` · `claims` + `claim_lines` · `retention_entries` · `vendors` + `vendor_compliance_docs` · `packages` + `package_rfqs` (per-vendor) + `package_quotes` · `commitments` (subcontracts; POs roll up too) · `invoices` + `invoice_lines` + `payments` · `assignments` (schedule) · `timesheet_entries` · `diaries` + diary child rows (labour, plant, photos) · `swms_templates` + `swms_instances` + `swms_signatures` · `attachments` (polymorphic: parent_type + parent_id) · `plant` · `costs` (actual costs recorded against jobs/projects/cost codes) · `settings` / `sequences`

Single-tenant (one company). All tables carry created_by/created_at. Money stored as numeric cents-safe (numeric(12,2)), GST handled at document level (10% AU, ex-GST entry convention).

### Claim math (the critical invariant)
For each claim line: `claimed_to_date = % complete × (line value)`. Claim total = Σ lines + Σ approved variations claimed − previously claimed to date. Retention this claim = min(retention % × claim gross, remaining headroom under cap % × contract sum) — withheld after subtotal. GST applied last. All claim figures snapshot at submission (immutable once submitted; corrections via next claim).

## 7. Architecture

### 7.1 Stack
- **Next.js 15** (App Router, TypeScript) deployed on **Vercel**
- **Supabase**: Postgres, Auth, Storage (photos/PDF/attachments), RLS
- **Tailwind CSS + shadcn/ui** components; phone-first layouts for field routes
- **PDF generation:** @react-pdf/renderer server-side (quotes, claims, invoices, POs, diary exports, SWMS)
- Charts: recharts (dashboard/reports)

### 7.2 App structure
- `/` dashboard (role-routed: field users land on My Day)
- `/clients`, `/quotes`, `/jobs`, `/projects/[id]/(budget|claims|variations|procurement|diary|docs)`, `/schedule`, `/money`, `/reports`, `/settings`
- `/field` — My Day, check-in, diary, SWMS, photos (phone-optimised)
- Server components for data; server actions for mutations; Supabase client with RLS-scoped access

### 7.3 Security
- RLS on every table; role checks via `profiles.role`
- Field role: read own assignments, insert diary/timesheet/photo/signature rows, no financial table access
- Storage buckets with policy-scoped access
- Supabase service-role key only in server-side code

### 7.4 PDFs and branding
All outbound documents (quote, invoice, claim, PO, RFQ cover, diary export, SWMS) share one branded layout: Entice/company logo, ABN, addresses, document numbering, GST summary.

### 7.5 Numbering
Per-type sequence table with atomic increment (Postgres function) — no duplicate claim/invoice numbers under concurrency.

### 7.6 RFQ email sending
v1: generate the RFQ email body + attachment links and open via `mailto:`/copy-to-clipboard, recording it as sent. (SMTP/Resend integration is a fast-follow; avoids deliverability setup blocking v1.)

## 8. Error handling

- Form validation with zod on all server actions; friendly inline errors
- Claim/variation/invoice submission guarded by status transitions (no editing submitted claims; void-and-redraft pattern)
- Optimistic UI only for low-stakes actions (checklists); money mutations are round-trip confirmed
- Photo upload retries with queued progress UI on flaky site connections; max size guard + client-side compression
- Audit basics: created_by/updated_by/timestamps on all records

## 9. Testing

- **Vitest** unit tests for all money math: claim calculations (retention cap edge cases, variations entering claims, negative variance), quote totals/margins, GST rounding (round half up at line level, document total = Σ lines)
- Integration tests for status transition guards (can't claim on unapproved variation, can't edit submitted claim)
- RLS tests: field role cannot select financial tables (run against local Supabase)
- Seed script with realistic demo data (clients, a civil project mid-claims, remediation jobs in various states) so the app is explorable immediately
- Manual test pass on phone viewport for all `/field` routes before sign-off

## 10. Success criteria

v1 is done when, using seeded + real data:
1. A quote can be created from the rate library, PDF'd, accepted, and converted to both a job and a project
2. A project can run a full monthly claim cycle including an approved variation and retention, producing a correct claim PDF (hand-checked math)
3. A trade package can go RFQ → comparison → award and show up in committed costs
4. A field user on a phone can check in, fill a site diary with photos, and sign a SWMS — and the office sees it all live
5. A job can be completed and invoiced, and the invoice exported in Xero CSV format
6. Roles are enforced: a field login cannot reach money screens or data (verified by RLS test)

## 11. Build phases (within v1)

1. **Foundation:** Supabase schema + RLS + auth + roles + app shell + settings/seed
2. **CRM & Quotes:** clients/sites/contacts, rate library, quote builder + PDF + convert
3. **Jobs & Invoicing:** job lifecycle, checklists, invoices + PDF + Xero CSV
4. **Projects money core:** budgets, POs, variations, claims + retention + PDFs
5. **Procurement:** vendors, packages, RFQs, comparison, award → commitments
6. **Schedule & Field:** schedule board, My Day, check-in/timesheets, diary, SWMS, photos
7. **Dashboard & Reports:** dashboards, reports, polish, seed-data walkthrough, deploy
