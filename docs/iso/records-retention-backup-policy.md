# Records Retention & Backup Policy

| | |
|---|---|
| **Document number** | INT-POL-001 |
| **System** | Integrated (ISO 9001 / 14001 / 45001 — clause 7.5.3, documented information) |
| **Revision** | Rev A (starter — review and adopt before use) |
| **Owner / responsibility** | Director |
| **Review cycle** | Annually, or after any change to hosting, backup tooling or legislation |

This is the ready-to-adopt text for the controlled document registered in
Entice as **INT-POL-001** (Documents register → Records Retention & Backup
Policy). To adopt it: review the text, adjust anything company-specific,
export/print it to PDF, upload the PDF against the register entry, and take
the document through review → approval → issue in Entice.

## 1. Purpose

Ensure the business records held in Entice (the company's operations platform)
are protected against loss, retained for as long as legislation and the
integrated management system require, and recoverable if the platform or its
hosting provider fails.

## 2. Scope

All electronic records created or stored in Entice: clients, quotes, jobs,
projects, financial records (POs, claims, invoices, payments, retention),
site diaries, timesheets, WHS records (SWMS, sign-ons, incident reports,
corrective actions), NCR/CAPA records, controlled documents and
acknowledgements, programme records, attachments and the audit log.

## 3. Backup arrangements

Three independent layers protect the records. Layer 1 is the provider's own
backup; layers 2 and 3 are Entice's, so no single provider failure or account
mistake can destroy all copies.

### 3.1 Platform backups (automatic — provider)

Entice's database is hosted on Supabase (Pro plan), which provides:

- **Daily automated database backups** with a rolling **7-day** restore
  window (proven in a real restore). This is the FIRST restore path for any
  recent loss.
- Uploaded files (photos, dockets, PDFs, signature images) are stored in
  Supabase Storage, which is covered by the provider's infrastructure
  redundancy.

The Director confirms these settings remain enabled whenever the hosting plan
changes.

### 3.2 Nightly application export (automatic — Entice)

Every night at **3:00 am Brisbane** a scheduled job (Vercel cron →
`/api/cron/backup`, authenticated by a `CRON_SECRET` and running under the
platform service credential) automatically:

1. Exports **every database table** — discovered at run time, so tables added
   later are never missed — into a single compressed JSON file
   (`db/YYYY-MM-DD-HHmm.json.gz`) in a private, admin-only `backups` storage
   bucket, with per-table row counts.
2. Embeds a **manifest of every uploaded file** (name, size, last modified)
   and mirrors files that are new or changed since the previous run into the
   same bucket (capped at 500 MB per run; anything skipped is listed in the
   export).
3. **Prunes exports older than 35 days**, giving a rolling five-week window
   that is independent of, and longer than, the provider's 7 days.
4. Records the run — timing, row counts, sizes, success/failure — in the
   **Settings → Backups** register. A failed or missing backup (no success in
   the last 26 hours) raises a "Needs attention" alert on the office
   dashboard. Admins can also click **Run backup now** at any time (e.g.
   before a risky change).

### 3.3 Monthly off-platform export (manual)

Both layers above live with providers. To keep a copy fully outside them:

1. On or about the **first business day of each month**, an admin signs in to
   Entice and opens **Settings → Backups**.
2. Click **Export all data**. The browser downloads a single JSON file named
   `entice-backup-YYYYMMDD.json` containing every business table with
   per-table row counts in the file header. (Signature image blobs and
   uploaded files are excluded from the JSON — they remain in Supabase
   Storage and in the nightly bucket mirror; the header records how many are
   excluded.)
3. Store the file **off-platform** — on the company drive (and/or an
   encrypted external drive held by the Director), not inside Supabase or on
   the machine of a single staff member only.
4. Keep at least the **most recent 12 monthly exports**; older exports may be
   deleted once outside every retention period in section 4.
5. Spot-check the file opens and the row counts look plausible before filing
   it.

The manual export runs under the exporting admin's own database permissions.

## 4. Retention periods

Records are retained for at least the periods below, counted from the end of
the financial year in which the record was created (or the project completed,
whichever is later), unless a longer statutory period applies:

| Record class | Minimum retention |
|---|---|
| Quality and environmental records (quotes, diaries, ITP/hold points, NCR/CAPA, audits, management review) | **7 years** |
| WHS records (SWMS, sign-ons, inductions, general incident reports, corrective actions) | **5 years** |
| Serious incident records (notifiable incidents) and asbestos-related records (registers, surveys, exposure/health monitoring) | **40 years** |
| Financial records (quotes, POs, claims, invoices, payments, retention, timesheets) | **7 years** |
| Controlled documents (policies, procedures) | Life of document + 7 years after supersession |

Nothing in Entice auto-deletes records; deletion is a deliberate,
admin-only action and must not occur inside a retention period.

## 5. Restore and loss response

- **Accidental data change/deletion (within 7 days):** Director (or delegate)
  restores via the Supabase dashboard (Database → Backups) to a point before
  the error — fastest and complete.
- **Loss outside the 7-day window:** restore from the newest nightly export
  in the `backups` bucket (up to 35 days back; Settings → Backups lists every
  run and its file path). Mirrored uploads live under
  `backups/storage/<bucket>/<path>` in the same bucket.
- **Provider failure:** rebuild from the latest monthly off-platform JSON
  export plus source records (emails, issued PDFs); the nightly bucket
  exports also remain downloadable while the storage service is reachable.
- Any restore event is recorded as an incident/NCR in Entice with a CAPA
  reviewing whether backup frequency or retention needs tightening.

## 6. Responsibilities

| Role | Responsibility |
|---|---|
| **Director** | Owns this policy; ensures the Supabase plan keeps daily backups enabled and the nightly export job (3.2) keeps running; holds/controls the off-platform export copies; approves any deletion of records |
| **Admin users** | Act on any dashboard backup alert (Settings → Backups shows the failing run); run the monthly export procedure (3.3) and file the export |
| **All staff** | Create records in Entice (not in private spreadsheets/phones) so this policy actually covers them |
