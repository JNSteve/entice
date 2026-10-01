# Daily field sign-offs — design

**Date:** 2026-10-01
**Status:** Draft for owner review

## Problem

Disputes arise at claim/invoice time over how many hours, how much plant and
how much material went into a job. ECR wants a daily record, agreed by the
client as the work happens, so totals at the end of a job or project "marry up"
with no argument.

## Summary

Each day's field entries (staff time, subbie labour, plant hours, materials,
work summary, photos) are frozen into a **daily sign-off snapshot**. The
snapshot is stored as a draft for the ECR PM to review, edit and **release** to
the client portal. The client reviews it in the portal and either **signs** it
or **disputes specific lines** (their figure + reason) while signing the rest.
Disputes are resolved by the PM issuing a revised version. Every version,
signature and response is kept against the job/project.

Quantities only — **no rates or dollar values** appear on the sheet.

## Decisions (owner, 2026-10-01)

| Topic | Decision |
|---|---|
| Material capture | Crew pick from the job's quote lines / price list / plant register, enter qty; free-text fallback. No prices shown to field. |
| Pricing on sheet | Quantities only. |
| Contents | Staff hours, subbie labour, plant hours, materials, work summary, selected photos. (Running totals vs scope: not now.) |
| Who sends | The job/project **PM** reviews and releases. Admin/office may release when no PM is set. Nothing goes to the client automatically. |
| Signing | Client portal only (no on-site signing on the supervisor's device). |
| Disputes | Line-level: client flags lines with their qty + reason, signs the rest; PM revises → v2. |
| Reminders | None automatic. Register shows days awaiting; PM chases. |

## Data model — migration 0068

### `field_usage` — new field entries

Crew-logged usage for a day. No money columns, so field may write it.

| column | notes |
|---|---|
| id, created_at, updated_at | |
| job_id / project_id | exactly one set (check constraint) |
| date | the work day |
| user_id | who logged it (default auth.uid()) |
| kind | `material` \| `plant` \| `subbie` |
| quote_line_id | nullable — scope item it is against |
| rate_item_id | nullable — price-list item |
| plant_id | nullable — plant register item |
| description | required (copied from the picked item or typed) |
| qty, unit | material/plant qty (plant: hours) |
| company, headcount, hours | subbie only |
| notes | |

RLS: field may insert/update/delete **own** rows for today and yesterday
(Brisbane); supervisor/office/admin full access on jobs/projects they can see.

### `field_day_notes` — work summary

`(job_id | project_id, date, summary, updated_by)`, unique per parent+date.
Projects already have `diaries.work_performed`; for projects the snapshot uses
the diary's `work_performed` when present, else `field_day_notes.summary`.

### `daily_signoffs` — the snapshot header

| column | notes |
|---|---|
| id | |
| job_id / project_id | exactly one |
| date | |
| version | 1, 2, … ; unique (parent, date, version) |
| status | `draft` → `released` → `signed` \| `disputed`; any → `superseded` |
| summary | work summary (frozen) |
| photo_ids | uuid[] of attachments chosen by the PM |
| built_at, built_by | null built_by = overnight run |
| released_at, released_by | |
| source_hash | hash of source rows at build time (see "Source changed") |
| supersedes_id | previous version |

At most one non-superseded version per parent+date (partial unique index).

### `daily_signoff_lines`

| column | notes |
|---|---|
| id, signoff_id, sort | |
| section | `labour` \| `subbie` \| `plant` \| `material` |
| description | e.g. staff name, item name |
| qty, unit | labour/plant: hours |
| scope_label | quote line description, if linked (text, frozen) |
| flags | text[] e.g. `still_checked_in`, `unapproved`, `long_shift` |
| source | jsonb `{timesheet_entry_ids:[…]}` / `{field_usage_id}` / `{manual:true}` |

Lines are editable only while the header is `draft`.

### `daily_signoff_responses`

| column | notes |
|---|---|
| id, signoff_id | unique per signoff (one response per version) |
| client_id, client_link_id | from the portal token |
| signer_name | required |
| signature_data | PNG data URL, ≤ `MAX_SIGNATURE_CHARS`, prefix-checked |
| disputes | jsonb `[{line_id, client_qty, reason}]`, empty = signed clean |
| ip, signed_at | |

Audit trigger redacts `signature_data` (same as `portal_acceptances`).

## Snapshot builder (`src/lib/signoffs/build.ts`)

Pure function `buildSnapshotLines(input) → lines[]`, unit-tested, fed by a
loader that reads, for one parent + date:

- **Labour** — `timesheet_entries` for the parent and date, grouped per person:
  hours = Σ(end_at − start_at), rounded to 0.25 h. Flags: `still_checked_in`
  (end_at null — hours shown as 0, PM must fix), `unapproved`, `long_shift`
  (> 12 h). Overnight entries belong to the date of `start_at`.
- **Subbie / plant / material** — `field_usage` rows, one line each, with
  `scope_label` from the linked quote line.
- **Summary** — see `field_day_notes` above.
- **Photos** — not auto-selected; the PM ticks from that day's attachments.

`build` never overwrites a released/signed version. Rebuilding a `draft`
replaces its lines.

## Flows

### Field (crew)

My Day gets a **"Used today"** card per job/project worked:
- add material/plant: search the job's quote lines first, then price list,
  then plant register; or type free text; enter qty (+ unit);
- add subbie: company, headcount, hours;
- "Today's work" summary box.
Entries list with edit/delete (own, today/yesterday).

### Overnight draft build

The existing 6 am Brisbane cron (`/api/cron/notify`) gains a step: for each
job/project with timesheet entries or field_usage on the previous day and no
existing sign-off for that date, build a `draft` v1. No email to anyone.

### PM review and release (office)

- **Jobs:** new "Sign-offs" section on `jobs/[id]` (the page has no tabs).
- **Projects:** new "Sign-offs" tab next to Diary (`projects/[id]/signoffs`).
- **`/signoffs`** page: "To release" (drafts on jobs/projects where I am PM, or
  all for admin/office), "Awaiting client" (with days waiting), "Disputed".

Register row per date: status, version, released/signed dates, PDF link,
"source changed" badge. Draft view: edit/add/delete lines, edit summary, pick
photos, "Rebuild from entries", **Release to client**.

Release is allowed for the parent's `pm_id`, or admin/office. Release is
blocked (with a message) when:
- any line is flagged `still_checked_in`;
- the job/project is not `client_shared`, or the client has no live
  full-scope portal link ("Share this job with the client portal first").

Release is a status-guarded update (`draft` → `released`), then the client
contact gets the portal email (new template `client_signoff_released`,
linking to the sign-off page; logged via `email_log`).

"Build snapshot" button on any day without a sign-off lets the PM build a draft
on demand.

### Client (portal)

- Sign-offs listed on the work page (`portal/[token]/works/[kind]/[id]`) and
  pending ones under Approvals.
- Sign-off page: header, summary, lines by section, photos. Each line has a
  "Dispute" toggle revealing *their qty* + *reason* (required).
- Submit: name + `SignaturePad` → RPC `portal_signoff_respond(token, id,
  signer_name, signature_data, disputes)`:
  - checks the token is live and the sign-off belongs to the token's client
    and is `released`;
  - inserts the response; sets status `signed` (no disputes) or `disputed`
    (status-guarded, so a double submit fails cleanly).
- Read RPCs `portal_signoffs(token, kind, id)` / `portal_signoff(token, id)`,
  security definer, granted to anon — the existing `portal_live_link` guard.
  No anon table policies.

### Dispute resolution

PM is notified (office email + register "Disputed"). PM opens the sheet, sees
the client's figures, and clicks **Revise**: creates v(n+1) as a `draft`
copied from v(n) with disputed lines pre-set to the client's qty (editable);
v(n) → `superseded` on release of v(n+1). Release proceeds as normal.

### Source changed

`source_hash` is recomputed when the register loads; if timesheet_entries or
field_usage for that date changed after build, the row shows "source changed
since snapshot". Informational only — the signed record is never altered.

## PDF

`src/pdf/DailySignoffPdf.tsx` (DocShell): header (job/project, client, site,
date, version), summary, lines by section with scope labels, photos, then
either the signature block (name, image, time, IP) or the disputed lines
(our qty / client qty / reason). Served by `api/pdf/signoff/[id]` (office)
and a portal route (token-checked, service-role render, as `approval-pdf`).

## Errors and edge cases

- No entries for a day → no draft built.
- Release blocked conditions above.
- Signing a superseded/unreleased sheet → RPC error "This sign-off is no
  longer current".
- Signature too large / wrong prefix → rejected (shared validator).
- Two PMs release at once → status guard; second gets "already released".
- Timesheet edits after release → "source changed" badge only.

## Out of scope

- Running totals vs scope quantities.
- On-site signing, automatic client reminders.
- Rates/dollar values on sheets; feeding sign-offs into claims/invoices.
- Offline capture (see site-diary-moments draft).

## Testing

- Unit: `buildSnapshotLines` — grouping per person, 0.25 h rounding,
  overnight shift, missing check-out, long shift, scope labels.
- Unit: dispute payload validation.
- RPC/live proof on a `zz`-prefixed test job: crew logs time + usage →
  overnight/manual build → PM edits and releases → portal sign with one
  dispute → PM revises → v2 released → clean sign → PDFs for both versions.
  Also: token from another client cannot read or sign; double submit fails.
  Clean up test records afterwards.
