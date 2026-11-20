# Field side job-first layout, and office Site days — design

**Date:** 2026-11-20 · **Status:** Draft for owner review · **Module:** Field PWA (`/field`) and office portal

## Problem

The field side is organised by activity. The bottom bar is My Day, Diary,
Safety, Photos, Maintenance, and the crew pick the job again inside each one.
A supervisor doing a normal day touches four screens and names the job on
each.

Two of those screens only offer work that is on the person's schedule. Check-in
is the strictest: it cannot be done without a schedule entry. The schedule is
not always filled in, and ECR is small enough that anyone may end up on any
job.

## Summary

Make the job the home. A new **Jobs** list shows every live job and project.
Opening one gives a **job screen** with tabs — Today, Pre-start, SWMS, Day
sheet, Diary, Photos, Docs — each wrapping a screen the portal already has,
with the job already chosen. **Check-in works on any live job**, scheduled or
not.

The layout idea comes from the Book Tabs prototype (handover reviewed
2026-11-20). Only the navigation is borrowed. The portal keeps its own forms,
timesheets, materials log, SWMS sign-on and PDFs, because those feed Job P&L,
daily client sign-offs and the ISO registers.

On the desktop side, a new **Site days** view gives the office one place to
see everything the crew recorded on a job on a day, correct it, and approve
it. Today those records sit on five different screens and start and finish
times cannot be corrected at all.

Two small database changes: migration 0078 (one column) and 0079 (audit
triggers on two existing tables). Everything else is screens and server
actions.

## Decisions (owner, 2026-11-20)

| Topic | Decision |
|---|---|
| Layout | Job first: open a job, then tabs. |
| Which jobs | Any live job or project is selectable, not only the person's schedule. "It doesn't always get put in and the org is small enough that it doesn't matter." |
| Live means | After quote acceptance / scheduling, before invoicing / close-out. |
| Finished, not invoiced | Stays selectable. |
| Office review | Everything the crew record must be easy to view on the desktop portal, and editable and approvable by admin there. |

## Assumed unless the owner says otherwise

These were shown in the mockups or proposed in chat and not objected to. Each
is easy to change before the build.

| Topic | Assumption |
|---|---|
| Tabs | Today, Pre-start, SWMS, Day sheet, Diary (projects only), Photos, Docs. |
| Bottom bar | My Day, Jobs, Safety, Maintenance. Diary and Photos move inside the job. |
| Switching jobs | One tap: "Switch to this job" checks out of the current job and into this one. |
| Unscheduled time | Tagged "Unscheduled" in the office. Nothing is blocked. |
| What "approve" means | **Approve day** approves the hours on that job for that day. Materials, plant and subbies are approved the way they are now, by releasing the daily sign-off. |
| Who can edit and approve | Admin, office and supervisor — the same three roles that approve timesheets today. Site days shows hours and quantities only, never dollars. |
| Editing approved hours | Changing the times on an approved entry clears its approval, so changed hours are always approved again. |
| Waste loads | A "Log waste load" link inside Day sheet, not a tab of its own. |
| Job documents | Crew see only documents the office has ticked "Show to crew". |
| Quote-stage jobs | Not in the Jobs list. A "Quick photo" link on My Day keeps today's wider picker, so photos on a quote inspection still work. |

## What "live" means

One shared definition, in a new `src/lib/live-work.ts`:

| | Live | Not live |
|---|---|---|
| Jobs | `scheduled`, `in_progress`, `completed` | `quote`, `lost`, `invoiced`, `paid` |
| Projects | `active`, `practical_completion`, `defects_liability` | `closed` |

Archived work is never live.

The photo, safety-form and waste pickers already offer every job that is not
invoiced, paid or lost — which includes quote-stage jobs. They are left as
they are. This build does not narrow them.

## Navigation

```
My Day ──┬─ scheduled job card ── Open job ─┐
         └─ Pick another job ── Jobs list ──┼── Job screen ── tabs
Jobs (bottom bar) ───────────── Jobs list ──┘
```

Bottom bar: **My Day · Jobs · Safety · Maintenance**. Jobs is highlighted on
the Jobs list and on every job screen. Safety keeps what is not tied to one
job: tickets, controlled documents, incidents, problem reports, and the full
form list.

## Jobs list — `/field/jobs`

- Search box filtering on job number, title, client name and site address.
  Filtering happens on the phone; the list is tens of rows, not hundreds.
- **Scheduled for you today** — today's schedule entries, with a "Checked in"
  chip on the one the person is clocked onto.
- **Live jobs and projects** — everything else live, newest number first, each
  with its status chip (Scheduled, In progress, Active, Practical completion,
  Defects).
- **Finished, not yet invoiced** — `completed` jobs, in a quieter group at the
  bottom.
- Each row shows number, title, and client or suburb. Tapping opens the job
  screen.

## Job screen — `/field/work/[kind]/[id]`

`kind` is `job` or `project`. A shared layout draws the header (back arrow,
number, title, status, **Switch job** button) and the tab strip. The strip
scrolls sideways on a phone. Each tab is its own page, so it loads only its
own data, the back button works, and a tab can be linked to directly.

| Tab | URL | Built from |
|---|---|---|
| Today | `/` | new |
| Pre-start | `/prestart` | existing safety forms and submission pages |
| SWMS | `/swms` | existing `FieldSwmsCard` and sign page |
| Day sheet | `/day` | existing `UsageClient` (materials, plant, subbies, work summary) |
| Diary | `/diary` | existing `DiaryForm` — projects only |
| Photos | `/photos` | existing `CaptureClient` |
| Docs | `/docs` | new |

A job or project that is not live can still be opened by its link, for looking
back. Its header shows its status and the Today tab offers no check-in.

### Today

- **Check-in card** — one of three states: checked in here (with elapsed time
  and Check out), checked in on another job (with Switch to this job), or not
  checked in (Check in).
- **Site card** — address, Navigate, site contact phone. Same data as the My
  Day card.
- **Note from the office** — today's schedule note, when there is one.
- **Today on this job** — a checklist. Each row shows a status and opens its
  tab:

| Row | Status comes from |
|---|---|
| Pre-start meeting | Today's `prestart_meeting` submission for this job: "Done 6:50 am" or "To do" |
| SWMS sign-on | Active SWMS on this job the person has not signed at the current version: "1 to sign", "All signed" or "None issued" |
| Day sheet | Count of today's `field_usage` rows: "3 logged" or "Nothing yet" |
| Diary (projects) | Today's `diaries` row: "Saved" or "Not started" |
| Photos | Count of today's photos on this job |

"Today" is the Brisbane calendar day, as everywhere else on the field side.

### Pre-start

- **Today's pre-start meeting.** Not done: a "Start pre-start meeting" button
  opening the existing form with this job preselected. Done: who submitted it,
  when, how many signed on, and a link to the existing submission page (which
  carries sign-on and Amend).
- **Earlier on this job** — the last 14 pre-start meetings, newest first.
- **Other forms for this job** — Take 5, toolbox talk, plant pre-start and the
  other active templates, each opening with this job preselected, followed by
  this job's ten most recent submissions.

Locking is unchanged. A submitted form cannot be edited. Its author can amend
it, which files a new linked submission and keeps the original. There is no
"unlock" — Book Tabs needed one because it overwrote the record; the portal
keeps both versions, which is the better audit trail.

When a form or submission was opened from a job, its Back link returns to that
job's Pre-start tab.

### SWMS

The active SWMS issued to this job, each with the person's own sign state and
a link to the existing read-and-sign page. Crew-wide counts ("3 of 4 signed"),
drawn in the mockup, are not in this build.

### Day sheet

- **Your hours** — the person's own timesheet entries on this job for the day:
  start, finish, total, and a running figure while checked in.
- **Used today** — the existing materials, plant and subbie log with its
  Today / Yesterday switch and work summary. No change to how it saves or to
  the daily client sign-off built from it.
- **Log waste load** — link to the existing waste form with this job
  preselected. The waste form currently preselects projects only; it gains
  the same for jobs.

The "Quick add" tick list drawn in the mockup is a follow-up (see below).

### Diary — projects only

The existing diary form for this project and day. The diary table belongs to
projects only, so jobs do not get this tab; a job's daily summary is the work
summary on its Day sheet.

### Photos

The existing capture screen with the job fixed, so there is no target picker.
It shows this job's recent photos and dockets as it does today.

### Docs

- **Job documents** — files on this job or project that the office has ticked
  "Show to crew" (the removal control plan, asbestos register, site plan).
  Opens through a one-hour link, like controlled documents do.
- **Company documents** — a link to the controlled documents on Safety.

On the office side, the job and project document lists get a "Show to crew"
tick beside the existing client-visible tick.

## Check-in on any job

Today the check-in form rejects anything without a schedule entry. The
database does not: `timesheet_entries.assignment_id` is nullable and the
insert rule only checks that the entry is the person's own.

- `checkInSchema` and `manualEntrySchema`: the schedule link becomes optional.
- `checkIn` requires exactly one of job or project, confirms it is live, and
  attaches today's schedule entry for that person and job when one exists.
- New `switchCheckIn`: closes the open entry, then opens one on the new job.
  If the second step fails the person is left checked out and told so.
- The one-open-entry rule stays.
- "Add manual time" on My Day offers any live job, scheduled ones first.
- Costing is untouched: entries carry the job or project exactly as now, so
  timesheets, Job P&L and daily sign-offs pick them up.
- The office timesheet report already tags an entry with no schedule link,
  under the label "Manual". That label is renamed "Unscheduled", which is what
  it will now mean. Older entries whose schedule row was later deleted carry
  the tag too.

## My Day changes

- Each scheduled card keeps one-tap Check in and gains **Open job**. The "Log
  materials & plant" button goes; that is now the Day sheet tab.
- New card: **Pick another job**, opening the Jobs list. With nothing
  scheduled, this becomes the main button on the empty state.
- New link: **Quick photo**, opening the existing photo screen.
- The pre-start banners stay as they are. The status chips drawn on the
  mockup's cards are left out, because the banners already do that job.

## Office side: Site days

### What is missing today

One job's records for one day are spread across the desktop portal:

| Record | Where the office sees it now | Gap |
|---|---|---|
| Hours | Reports → Timesheets, by person and week | Not by job. Start and finish times cannot be corrected. An entry left open because someone forgot to check out cannot be closed, and counts as zero hours. |
| Materials, plant, subbies | Only inside a daily sign-off, once a draft is built | The raw log is invisible until then. |
| Pre-starts and forms | WHS → Forms; a project's WHS tab | A job has no forms view of its own. |
| Photos, dockets | The job page; a project's Documents tab | Not grouped by day. |
| Diary | A project's Diary tab | Fine. |
| Waste loads | WHS → Environment | Not by job-day. |

### Three places to reach it

1. **Site days** in the office menu — `/site-days`. Pick a day (Today,
   Yesterday, or a date). One row per job or project with any field activity
   that day:

   | Column | Shows |
   |---|---|
   | Job | Number, title, client |
   | Crew | People on site, total hours |
   | Hours | "3 of 4 approved", or "Still checked in" when an entry is open |
   | Pre-start | Done with time, or Missing |
   | Logged | Count of materials, plant and subbie lines |
   | Photos | Count |
   | Sign-off | None, Draft, Released, Signed, Disputed |

   Rows needing attention sort to the top: an open check-in from a past day,
   hours with no pre-start, unapproved hours.

2. **The job page** gets a Site days section listing the last 14 days with
   activity. **A project** gets a Site days tab beside Diary and Sign-offs.

3. Every row opens the **day page**.

### Day page — `/site-days/[kind]/[id]/[date]`

Everything for one job on one day, on one screen, with previous and next
buttons that step between days that have activity. **Approve day** sits in the
header.

**Crew and hours**

- A row per timesheet entry: person, start, finish, hours, an Unscheduled tag
  where it applies, and an Approved tick.
- **Edit** start and finish. **Add** an entry for someone who never checked
  in. **Delete** a mistaken one.
- An open entry is flagged "Still checked in" with **Set finish time**.
- **Approve day** approves every closed entry on this job for this day. The
  per-entry tick stays for approving one at a time.
- Editing the times on an approved entry clears its approval.

**Pre-start and forms**

- The day's pre-start meeting: who submitted it, when, and the names signed
  on. A warning when there are hours but no pre-start.
- Any other forms filed that day. Each links to the existing form view.
- Forms stay unchangeable. A correction is an Amend, as now.

**SWMS**

For each person with hours that day: whether they have signed the current
version of each active SWMS on this job. Anyone who has not is named.

**Materials, plant and subbies**

- The crew's log as entered, with who logged each line, and the work summary.
- Before a sign-off exists for the day, the office can edit, add and delete
  lines here.
- Once a sign-off exists, this section is read-only and links to it. The
  sign-off screen is where figures the client sees are changed, so there is
  only ever one place to edit.
- **Build sign-off** when there is none; **Open sign-off** when there is.

**Diary** (projects) — that day's entry, with a link to edit it on the Diary
tab.

**Photos and dockets** — that day's thumbnails. Clicking opens the file.

**Waste loads** — that day's loads, each linking to its existing page.

### What approving does

- **Hours.** Uses the existing approved flag. Approval locks the person's
  hourly cost onto the entry, and Job P&L costs approved hours — unchanged.
  The Reports → Timesheets screen keeps working and shows the same ticks.
- **Materials, plant and subbies.** Approved by releasing the daily sign-off —
  unchanged.
- Changing hours after a sign-off was released marks that sign-off "Source
  changed" in the register, as it does today.

### Edit trail

Neither timesheets nor the materials log is audited today. Migration 0079 adds
the existing row-audit trigger (`audit_whs()`) to `timesheet_entries` and
`field_usage`, so every office change records who made it, when, and the
before and after. They appear in WHS → Audit log under two new labels.

## Data and permissions

**Migration 0079** — audit triggers, as above:

```sql
create trigger timesheet_entries_audit
  after insert or update or delete on timesheet_entries
  for each row execute function audit_whs();
create trigger field_usage_audit
  after insert or update or delete on field_usage
  for each row execute function audit_whs();
```

Confirm before applying that `audit_whs()` assumes nothing specific to the
WHS tables it is attached to today.

No policy changes for Site days. Admin, office and supervisor can already
update and delete timesheet entries and materials-log lines; field users
cannot approve hours (migration 0066).

**Migration 0078** (history row uses the timestamp-version convention):

```sql
alter table attachments
  add column field_visible boolean not null default false;
```

No policy changes. The office can already update attachments. Crew can already
read job and project attachments under migration 0019, so `field_visible` is a
display filter, not a security boundary: it keeps commercial paperwork off the
crew's screen, it does not make it unreadable.

Nothing else in the database changes beyond these two migrations. Jobs,
projects, sites, clients, schedule entries,
timesheets, form submissions, SWMS, materials log and attachments are all
already readable by the field role.

## Code layout

| File | Purpose |
|---|---|
| `src/lib/live-work.ts` | Live status lists, `isLive`, grouping and search for the Jobs list. Pure, unit tested. |
| `src/lib/field-work-queries.ts` | Server loaders: live work list, job header, Today statuses, SWMS for one job. |
| `src/app/field/jobs/page.tsx`, `jobs-list.tsx` | Jobs list and its search box. |
| `src/app/field/work/[kind]/[id]/layout.tsx` | Header and tab strip. |
| `src/app/field/work/[kind]/[id]/work-tabs.tsx` | Tab strip (client component). |
| `…/page.tsx`, `prestart/`, `swms/`, `day/`, `diary/`, `photos/`, `docs/` | One page per tab. |
| `src/app/field/actions.ts` | `checkIn` loosened, `switchCheckIn` added. |
| `src/app/field/field-tabs.tsx` | Four-item bottom bar. |
| `src/lib/site-days.ts` | Attention rules, day status, hours maths. Pure, unit tested. |
| `src/lib/site-days-queries.ts` | Server loaders: all jobs for a day; one job-day in full. |
| `src/app/(office)/site-days/page.tsx` | The day list. |
| `src/app/(office)/site-days/[kind]/[id]/[date]/page.tsx` | The day page, one small component per section. |
| `src/app/(office)/site-days/actions.ts` | Edit, add and delete a timesheet entry; approve day; edit materials-log lines. Reuses `approveTimesheetEntry`. |

Existing components gain small options and are otherwise untouched:
`CaptureClient` takes a fixed target, `fetchMyFieldSwms` takes an optional job
filter, the waste page accepts `?job=`, `AttachmentList` gets the crew tick.

Old addresses keep working: `/field/usage?job=…` and `/field/diary/[id]`
redirect to the matching tab, and `/field/diary` redirects to the Jobs list.

This repository's Next.js differs from the public documentation. Read the
layout, dynamic-segment and redirect guides under `node_modules/next/dist/docs/`
before writing the routes.

## Approaches considered

1. **One page per tab under a shared layout — chosen.** Each tab loads only
   what it shows, links and the back button behave, and existing screens drop
   in with little change.
2. **One page with `?tab=`.** Fewer files, but a single page owning seven data
   loads and seven branches.
3. **Port Book Tabs as its own module.** Rejected. Its tables store forms and
   timesheets as free text in numbered cells, which would sit beside the
   portal's real records and feed nothing.

## Not in this build

- Per-job chat.
- The "Quick add" tick list from the Daily Works sheet. It needs the item
  list, units and where each maps in the plant register or price list.
- Loading the Book Tabs pre-start checklist (7 stop-work checks, 25 site
  checks, hazard table) into the pre-start form template. That is a template
  change, not a layout change.
- Crew-wide SWMS sign counts.
- Saving a form as a draft.
- Working offline.
- The voice-and-photo diary draft of 2026-08-08; it would sit inside the
  Diary tab if built.

## Build order

Each step can ship on its own. The crew see no change until step 5.

1. `live-work.ts`, the Jobs list at `/field/jobs`, the job screen layout and
   the Today tab.
2. Check-in on any job, Switch to this job, the office "Unscheduled" tag.
3. Day sheet, Photos, Diary, SWMS and Pre-start tabs.
4. Migration 0078, the office "Show to crew" tick, the Docs tab.
5. Bottom bar, My Day changes, redirects.
6. Site days list and day page, read-only, with the job-page section and
   project tab.
7. Migration 0079, editing and adding hours, Approve day, editing the
   materials log.

Steps 6 and 7 use only records that already exist. They do not depend on
steps 1 to 5 and can be built first.

## Proof

- Unit tests for `live-work.ts` (status lists, grouping, search) and for the
  loosened check-in validation. Type check and the existing suite stay green.
- Live proof with a zz-prefixed job, cleaned up afterwards with the work-number
  counter rolled back:
  - A field user with nothing scheduled finds the job in the Jobs list and
    checks in.
  - They log a material, take a photo, and start a pre-start with the job
    already chosen.
  - They switch to a second job in one tap; the first entry closes.
  - The office timesheet report shows the entries as Unscheduled.
  - A ticked document appears in Docs; an unticked one does not.
  - An invoiced job is absent from the list.
  - Office: the zz job appears on Site days for the day with the right crew,
    hours and counts.
  - Office: correct a finish time, close an entry left open, add an entry for
    a second person, then Approve day; Reports → Timesheets shows the same
    ticks and Job P&L picks up the labour cost.
  - Office: edit a materials line, build the sign-off, and confirm the section
    turns read-only and links to it.
  - Each of those changes appears in the audit log with the right name.
  - A supervisor can do all of it and sees no dollar figures.

## Risks

- **Timesheet entries with no schedule link.** Checked in `src/lib`: the Job
  P&L and sign-off builders read timesheets by job, project and date and never
  by schedule entry. My Day does compare the open entry's schedule link to
  decide which card says "Currently checked in here", which is why `checkIn`
  attaches the schedule entry whenever one exists.
- **Two places to change a quantity.** Site days edits what the crew logged;
  the sign-off screen edits what the client sees. The rule in "Materials,
  plant and subbies" above keeps only one of them editable at a time.
- **Approval sets the labour cost.** Approving hours locks that person's
  hourly cost onto the entry (existing behaviour, migration 0066), and that is
  what Job P&L charges. Approve day is therefore a costing action, not only a
  tick.
- **Seven tabs on a phone.** The strip scrolls; the active tab is brought into
  view on load.
- **`field_visible` is not security.** Stated above; the office should not
  treat an unticked document as hidden from a determined user.
