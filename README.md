# Entice

Entice is a complete construction operations platform for civil and remediation contractors. It covers the full project lifecycle — from quoting and scheduling through to progress claims and procurement — with a field-first mobile interface alongside an office management suite.

**Modules:**
- Quotes (line-item builder, rate library, PDF)
- Jobs (work logs, checklists, costs, invoices)
- Projects (budget, programme (Gantt) with dependencies / baseline / hold points, variations, progress claims / time-bar, purchase orders, procurement packages / RFQ / comparison / award, retention, site diary, WHS tab)
- WHS & Traceability (forms engine, incidents + corrective actions, SWMS sign-on incl. external QR links, subbie SWMS collection, append-only audit trail)
- Scheduling (crew assignment board)
- Field app (mobile daily tasks, site diary, Safety tab — dynamic forms, Take 5, plant pre-starts, incident capture, pass-the-phone sign-on)
- Clients & Vendors
- Settings (users, cost codes, plant, labour rates, checklists, SWMS, company)
- Money (Xero-ready export)

---

## Architecture

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, React 19, TypeScript) |
| Database / Auth | Supabase (Postgres + RLS + Auth) |
| Hosting | Vercel (zero-config, Edge-ready) |
| PDF generation | @react-pdf/renderer |
| UI | Tailwind CSS v4 + shadcn/ui (Radix primitives) |

**Repo layout:**
```
src/app/          # Next.js app router — (office)/ + field/ + login/ + api/
src/components/   # Shared UI components (shadcn + custom)
src/lib/          # Server utilities, Supabase clients, money/claims logic
supabase/
  migrations/     # Numbered SQL migrations (apply in order)
  seed/           # Demo data seed + RLS checker + signature placeholder
tests/            # Vitest unit tests
```

---

## Local development

### Environment variables

Create a `.env.local` file in the project root:

| Variable | Value | Where to find it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | Supabase dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | Supabase dashboard → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Supabase dashboard → Project Settings → API → service_role (keep secret — server-side only, never expose to the browser) |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Set to your Vercel URL in production |

### Norton / corporate SSL note (this machine only)

On machines with Norton SSL inspection, prefix npm commands:

```powershell
$env:NODE_EXTRA_CA_CERTS='C:\Users\nickj\norton-ssl-root-ca.pem'; npm install
$env:NODE_EXTRA_CA_CERTS='C:\Users\nickj\norton-ssl-root-ca.pem'; npm run dev
```

### Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The root `/` redirects to `/projects` (office) or `/field` depending on role.

---

## Demo login accounts

All demo accounts use password **`Entice!234`**. Change passwords and email addresses in **Settings → Users** before any real use.

| Email | Role | Name | Notes |
|---|---|---|---|
| `admin@entice.local` | admin | Admin | Full access; created by Supabase seed bootstrap |
| `office@entice.local` | office | Office User | Office suite access |
| `super@entice.local` | supervisor | Sam Field | Can assign jobs + view field |
| `field1@entice.local` | field | Jack Labour | Field app only |
| `field2@entice.local` | field | Mia Operator | Field app only |

> **Important:** These are demo credentials for local/staging use only. Update all passwords and use real email addresses before going live.

---

## Database

### Migrations

Apply migrations in order against your Supabase project (Supabase dashboard → SQL Editor, or via the Supabase CLI):

| File | Description |
|---|---|
| `supabase/migrations/0001_schema.sql` | Full schema — all tables, enums, indexes |
| `supabase/migrations/0002_functions.sql` | Postgres functions and triggers |
| `supabase/migrations/0003_rls.sql` | Row-level security policies |
| `supabase/migrations/0004_profile_guard.sql` | Profile creation guard trigger |
| `supabase/migrations/0005_storage.sql` | Storage buckets + policies |
| `supabase/migrations/0006_checklists_costcodes.sql` | Default checklists and cost code seed |

### Seed data

`supabase/seed/seed.sql` populates a full demo company scenario ("Entice Civil") with clients, projects, quotes, jobs, POs, claims, and crew. Only run against a fresh (empty) install — the script aborts if any clients rows exist.

After seeding, run:
```bash
node supabase/seed/upload-signature-placeholder.mjs
```
This uploads the shared signature placeholder image used by all seed diary signatures.

### RLS checker

```bash
node supabase/seed/rls-check.mjs
```
Runs a series of role-impersonated queries to verify RLS policies are working as expected for all roles (admin, office, supervisor, field).

---

## PDFs

The app generates PDFs server-side using `@react-pdf/renderer`. PDF types and their API route patterns:

| Document | Route |
|---|---|
| Quote | `GET /api/quotes/[id]/pdf` |
| Invoice | `GET /api/invoices/[id]/pdf` |
| Purchase Order | `GET /api/projects/[id]/pos/[poId]/pdf` |
| Progress Claim | `GET /api/projects/[id]/claims/[claimId]/pdf` |
| SWMS | `GET /api/swms/[id]/pdf` |

PDFs are streamed directly; no files are written to disk.

WHS documents (form submissions, incident reports, SWMS, QR posters, programme) are served by the consolidated route `GET /api/pdf/[type]/[id]` with types `form`, `incident`, `swms`, `qr-poster`, `programme`, `diary` / `diary-range`.

---

## WHS & Traceability

The WHS module lives at `/whs` (office hub: Overview / Forms / Incidents / Subbie SWMS / Audit), on each project's **WHS tab**, and in the field app's **Safety tab**.

**Forms engine.** Admin-managed, versioned form templates (Settings → WHS forms) drive dynamic field forms: plant pre-starts, Take 5s, toolbox talks, site inductions, incident reports and custom forms. Every submission records the template version it was filled against; submissions are immutable (no update path — RLS enforced). The forms register filters by kind / project / person / date and exports CSV.

**Incidents & corrective actions.** Field or office capture, INC-numbered, severity 1–5, status flow open → investigating → closed. Corrective actions carry assignees and due dates; overdue actions surface on the dashboard Safety card and the WHS Overview.

**External sign-on (QR / link) how-to.** From a SWMS card or a toolbox/induction submission, choose *Share link* → set a label and optional expiry → copy the link, email it, or download the printable **QR poster (PDF)** for the site shed. Workers and visitors without a login open `/sign/{token}` on their phone, enter name + company and sign on a canvas. The signature lands against the exact SWMS version (or form submission), and an `external_signon` audit row names the signer.

**Subbie SWMS flow.** *Request subbie SWMS* (WHS hub or project WHS tab) creates a public `/submit/{token}` link for a project. The subcontractor uploads their SWMS PDF with company/contact details — no login. Submissions queue in the Subbie SWMS register for office review (accept / reject with notes) and can be matched to a vendor.

**Audit trail.** Every WHS table writes to an append-only `audit_log` via triggers (insert/update/delete with changed-field detail, plus explicit `external_*` events). Nobody — including admins — can update or delete audit rows (verified by `rls-check.mjs`). The register at `/whs/audit` filters by date / project / entity / actor / action and exports CSV; per-record history cards appear on incidents, SWMS and share links.

**ISO-style traceability notes:** versioned templates (submissions pin the version they used), immutable records (no update/delete paths on submissions and sign-ons), an append-only audit log, and filterable registers with CSV export for evidence packs.

---

## Deploy to Vercel

1. Push this repo to GitHub (any branch).
2. Go to [vercel.com/new](https://vercel.com/new) and import the repository.
3. Set the following environment variables in the Vercel project settings:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key |
   | `NEXT_PUBLIC_SITE_URL` | Your Vercel deployment URL (e.g. `https://entice.vercel.app`) |

4. Leave the build command as the default (`next build`). Click **Deploy**.

No Supabase auth redirect URL allowlist configuration is needed — the app uses password-only authentication with no OAuth redirects.

### Backups & retention

Going live means the database becomes the system of record, so backups are part
of go-live, not an afterthought:

- Supabase Pro provides daily automated backups with 7-day point-in-time
  recovery — confirm these stay enabled on the project.
- **Settings → Data & Backup** (admin only) exports every business table to a
  single `entice-backup-YYYYMMDD.json` — run it monthly and store the file
  off-platform.
- Retention periods, the export procedure and responsibilities are set out in
  the [Records Retention & Backup Policy](docs/iso/records-retention-backup-policy.md)
  (registered in the app as controlled document `INT-POL-001` — review and
  adopt it via the Documents register).

---

## Phase 2 backlog

From the product specification §5 — planned for a future phase:

- Xero API sync (live account push, not just CSV export)
- ITPs (inspection & test plans), lots, and NCRs (non-conformance reports)
- Subcontractor portal (self-service docket submission)
- Approval workflows (multi-level sign-off for variations, POs, claims)
- Offline PWA (service worker + background sync for no-signal field use)
- Client portal (read-only claim/variation visibility)
- SMS notifications (claim submissions, approvals)
- Payroll export (integration with payroll providers)
