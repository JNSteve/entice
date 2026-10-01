# SWMS title page — auto-filled from the job

**Date:** 2026-10-02
**Status:** Approved design, pending implementation plan

## Goal

When the office issues a template SWMS from a job (or project), a standard
title page fills itself from what the portal already knows — client, job, site,
dates, client contact, principal contractor — instead of being typed by hand.
The filled values are snapshotted onto the SWMS so an issued (and signed)
SWMS never changes when client or site records are later edited.

One fixed title-page layout for every SWMS (a "title page template" in code);
the data comes from the portal. No per-template cover designs.

## Scope

In:
- Template-based SWMS issued from the job page and the project WHS tab
  (both use `AddSwmsDialog` in `src/components/SwmsInstancesSection.tsx`).
- A cover page as page 1 of the SWMS PDF.
- The same title-page block at the top of the on-screen SWMS views.

Out:
- Uploaded-PDF SWMS (`document_attachment_id` set) — we don't write onto the
  owner's own document; its register page is unchanged.
- A standalone "Issue SWMS" screen with client → job dropdowns (option B,
  declined).
- Editing the title page after issue (follow-up if wanted; today's "Revise"
  only bumps the version and carries the snapshot over unchanged).
- Prepared by / approved by on the cover — they stay in Document control.

## Data

New migration (next free number — `0068_daily_signoffs.sql` exists, so
`0069_swms_title_page.sql`; re-check at implementation time):

```sql
alter table swms_instances add column title_page jsonb;
```

Nullable. `null` = issued before this feature → PDF/views render exactly as
today. No backfill.

Shape (zod `swmsTitlePageSchema` in `src/lib/swms.ts`, all strings, trimmed,
may be empty):

| key | label | prefill source |
|---|---|---|
| `client_name` | Client | `clients.name` |
| `principal_contractor` | Principal contractor | `clients.name` (editable — often the builder) |
| `job_ref` | Job / project | `jobs.number — jobs.title` or `projects.number — projects.name` |
| `site_address` | Site address | job/project `sites`: `address, suburb state postcode`; else `clients.address`; else empty |
| `work_dates` | Work dates | job `scheduled_start`–`scheduled_end` / project `start_date`, formatted `d MMM yyyy`; empty if none |
| `contact_name` | Client contact | picked contact's `name` |
| `contact_phone` | Contact phone | picked contact's `phone` |
| `contact_email` | Contact email | picked contact's `email` |

`swmsInstanceCreateV2Schema` gains `title_page: swmsTitlePageSchema`;
`createSwmsInstance` writes it to the new column.

## Prefill

Pure function `buildSwmsTitlePagePrefill(parent, client, site, contacts)` in
`src/lib/swms-title-page.ts` → `{ values: SwmsTitlePage, contacts: ContactOption[] }`.
Unit-tested; no DB access.

The job page (`src/app/(office)/jobs/[id]/page.tsx`) and project WHS page
(`src/app/(office)/projects/[id]/whs/page.tsx`) already load the parent; they
additionally select the client (`name, address`), site (`address, suburb,
state, postcode`) and the client's `contacts (id, name, role, phone, email)`,
call the builder, and pass `titlePagePrefill` into `SwmsInstancesSection` →
`AddSwmsDialog`.

## Issue dialog

New "Title page" section at the top of the template form (after the template
picker, before "Project-specific details"):

- Inputs for each field, pre-filled, all editable.
- Client contact: a `<Select>` of the client's contacts (`name — role`).
  Picking one fills name/phone/email; a "Type manually" option clears the
  pick and leaves the three inputs free. Default: the first contact if the
  client has exactly one, otherwise none picked.
- Reset (dialog close/reopen) restores the prefill, not blanks.

The existing "Work dates / hours" and "Client site contact" project-details
inputs are hidden in the issue dialog for new SWMS (they duplicate the title
page). Their keys stay in the schema so old instances still render them.

## PDF

`src/pdf/SwmsPdf.tsx`: when `titlePage` is present, render a cover page first
inside `DocShell` (company header as today): large SWMS title, a label/value
table of the eight fields (empty values omitted), version and issue date, then
a page break; Document control and the rest follow unchanged. When `null`,
output is identical to today.

`src/app/api/pdf/[type]/[id]/route.tsx` (`swmsPdf`) selects `title_page` and
passes it through (parsed with the zod schema; parse failure → treat as null).

## On-screen views

`SwmsFullView` (office) and the field SWMS page show the same fields as a
compact "Title page" block at the top when present. The external sign page
(`get_shared_doc` RPC) is left alone unless it already returns the full
instance row — check during planning; don't change the RPC just for this.

## Testing

- `tests/swms-title-page.test.ts`: prefill builder — site address vs client
  address fallback vs none; job vs project ref; date formatting with
  start only / both / none; zero, one, many contacts.
- Schema test: create schema accepts/requires `title_page`.
- PDF render test (pattern of `tests/swms-register-pdf.test.tsx`): renders
  with a title page and with `null`.
- Manual: issue a SWMS on a real job in dev, check dialog prefill and PDF
  cover; old SWMS PDF unchanged.
