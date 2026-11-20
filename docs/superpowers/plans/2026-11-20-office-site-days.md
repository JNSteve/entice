# Office Site Days Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the office one desktop screen per job per day showing everything the crew recorded, where admin, office and supervisors can correct hours and the materials log and approve the day.

**Architecture:** A pure library (`src/lib/site-days.ts`) owns the rules: hours maths, attention reasons, the materials lock and input validation. Server loaders (`src/lib/site-days-queries.ts`) read existing tables only. Two office routes render them: `/site-days` (all work for a day) and `/site-days/[kind]/[id]/[date]` (one job-day), with one small component per section. Server actions in `src/app/(office)/site-days/actions.ts` edit `timesheet_entries`, `field_usage` and `field_day_notes`; approval reuses `approveTimesheetEntry`, and "Build sign-off" calls the existing `buildSignoff`. Migration 0079 adds an audit trigger to the two edited tables.

**Tech Stack:** Next.js 16.2.9 App Router (server components, server actions, `revalidatePath`), React 19, Supabase (Postgres, RLS), zod 4, Base UI components under `src/components/ui`, lucide-react, sonner, vitest 4 + @testing-library/react (jsdom).

Spec: `docs/superpowers/specs/2026-11-20-field-job-first-design.md` — section "Office side: Site days", the Migration 0079 block, the Site days rows of "Code layout", and the office bullets under "Proof". This plan covers the spec's build steps 6 and 7.

## Global Constraints

- **AGENTS.md, verbatim:** "This is NOT the Next.js you know. This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices."
- Read these before writing any route or action:
  - `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md` (`params` is a `Promise`)
  - `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` (`searchParams` is a `Promise`)
  - `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`
  - `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md`
  - `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`
- Run everything from `C:\Users\nickj\Documents\Devman\nexvia`. Shell is PowerShell.
- Any npm or node command that touches the network (installs, `next dev`, anything that calls Supabase) needs this prefix: `$env:NODE_EXTRA_CA_CERTS = 'C:\Users\nickj\norton-ssl-root-ca.pem'; <command>`. `npx vitest run <file>` and `npx tsc --noEmit` do not touch the network and need no prefix.
- The database is production. Test records are zz-prefixed and cleaned up. Inserting a job consumes the work-number counter, which must be rolled back afterwards.
- Migrations are numbered files in `supabase/migrations/`. The history row uses a timestamp version: version `20261120091000`, name `0079_site_days_audit`. (`20261120090000` is taken by the field plan's `0078_attachment_field_visible`.)
- Do not apply a migration to the live database without the owner's go-ahead.
- Hours and quantities only, never dollars. No screen, query or audit row added by this plan may carry a rate or an amount (`timesheet_entries.cost_rate`, `profiles.hourly_cost`, any price).
- "Today" and every day boundary is the Brisbane calendar day, via `src/lib/tz.ts` (`todayAU`, `yesterdayAU`, `auLocalToInstant`). Never use the server's local clock for a date.
- Roles for every page and action here: `requireRole('admin', 'office', 'supervisor')`. Building a sign-off stays admin and office only (existing rule in `src/lib/signoff-actions.ts`).
- An entry with no schedule link (`assignment_id is null`) is labelled `Unscheduled`.
- Copy, verbatim: `Still checked in`; `Unscheduled`; `Approve day`; `Hours approved`; `Finish must be after start`; `This day has a sign-off — change the figures there`.
- Out of scope, owned by the separate field plan — do not touch or depend on: migration 0078, `src/lib/live-work.ts`, anything under `src/app/field/`, and the "Manual" badge in `src/app/(office)/reports/timesheets.tsx`.
- Work on a feature branch (`feat/office-site-days`), created at execution time with superpowers:using-git-worktrees. Do not push without the owner's go-ahead.
- Commits end with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Two things in the spec this plan changes, and why

1. **The audit trigger is not `audit_whs()`.** The spec says to attach the existing `audit_whs()` function. Read at `supabase/migrations/0030_swms_two.sql:65`, it would do two wrong things on `timesheet_entries`: (a) on update it logs every changed column, including `cost_rate`, which is stamped at approval — and `audit_log` is readable by supervisors, so the hourly cost would leak; (b) on insert and delete it records only `title/name/status/number/kind/label`, none of which a timesheet entry has, so a deleted entry would leave no record of what was deleted. Migration 0079 therefore adds a sibling function, `audit_site_day()`, with the same shape, that skips `cost_rate` and `updated_at` and stores the row on insert and delete. `audit_whs()` is left untouched.
2. **Steps 6 and 7 ship together.** The spec lists a read-only release (step 6) before editing (step 7). The day page's client components import the server actions directly, which is this codebase's convention, so the actions are built before the day page. Nothing here depends on migration 0079 to run; without it the edits work and are simply not audited.

One consequence of the spec's materials rule to know about: `/api/cron/notify` builds a draft sign-off at 6 am Brisbane for every job-day that had hours or usage (`buildYesterdayDrafts` in `src/lib/signoff-build.ts`). The spec makes the materials section read-only once a sign-off exists, so from 6 am the next morning a day's materials are edited in the sign-off, not on the day page. That is the spec as written; this plan implements it.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/site-days.ts` (create) | Pure rules: types, dates, hours maths, attention, materials lock, time and usage validation. |
| `tests/site-days.test.ts` (create) | Unit tests for the above. |
| `src/lib/site-days-queries.ts` (create) | Server loaders: `loadDayList`, `loadDayDetail`, `loadRecentDays`. |
| `supabase/migrations/0079_site_days_audit.sql` (create) | `audit_site_day()` and its two triggers. |
| `src/app/(office)/whs/audit/audit-table.tsx` (modify) | Two new entity labels. |
| `src/app/(office)/whs/audit/actions.ts` (modify) | Same two entity types in the export allow-list. |
| `src/app/(office)/site-days/actions.ts` (create) | Server actions: hours, approval, materials log, work summary. |
| `src/app/(office)/site-days/page.tsx` (create) | The day list. |
| `src/app/(office)/site-days/day-picker.tsx` (create) | Today / Yesterday / date control. |
| `src/app/(office)/office-shell.tsx` (modify) | "Site days" menu item. |
| `src/app/(office)/site-days/[kind]/[id]/[date]/page.tsx` (create) | The day page. |
| `…/[date]/approve-day-button.tsx` (create) | Approve day. |
| `…/[date]/crew-hours.tsx` (create) | Crew and hours section. |
| `…/[date]/materials-log.tsx` (create) | Materials, plant and subbies section, work summary, sign-off button. |
| `…/[date]/prestart-forms.tsx` (create) | Pre-start and forms section. |
| `…/[date]/swms-signon.tsx` (create) | SWMS section. |
| `…/[date]/diary-summary.tsx` (create) | Diary section (projects). |
| `…/[date]/photos-dockets.tsx` (create) | Photos and dockets section. |
| `…/[date]/waste-loads.tsx` (create) | Waste loads section. |
| `tests/site-days-crew-hours.test.tsx` (create) | Component test for the crew section. |
| `src/components/site-days/SiteDaysRecent.tsx` (create) | Last 14 days with activity for one job or project. |
| `src/app/(office)/jobs/[id]/page.tsx` (modify) | "Site days" section. |
| `src/app/(office)/projects/[id]/site-days/page.tsx` (create) | "Site days" project tab page. |
| `src/app/(office)/projects/[id]/project-tabs.tsx` (modify) | "Site days" tab. |

`…/[date]/` means `src/app/(office)/site-days/[kind]/[id]/[date]/`.

---

### Task 1: Pure rules library

**Files:**
- Create: `src/lib/site-days.ts`
- Test: `tests/site-days.test.ts`

**Interfaces:**
- Consumes: `auLocalToInstant` from `src/lib/tz.ts`.
- Produces (every later task imports these names):

```ts
export type WorkKind = 'job' | 'project'
export type DayRef = { kind: WorkKind; workId: string; date: string }
export type CrewEntry = { id: string; userId: string; name: string; startAt: string; endAt: string | null; approved: boolean; unscheduled: boolean }
export type UsageLine = { id: string; kind: 'material' | 'plant' | 'subbie'; description: string; qty: number | null; unit: string | null; company: string | null; headcount: number | null; hours: number | null; loggedBy: string | null }
export type HoursEntry = { userId: string; startAt: string; endAt: string | null; approved: boolean }
export type HoursSummary = { people: number; totalHours: number; closed: number; approved: number; open: number }
export type AttentionReason = 'open_checkin' | 'no_prestart' | 'unapproved'
export const ATTENTION_LABELS: Record<AttentionReason, string>
export function isWorkKind(v: string): v is WorkKind
export function isIsoDate(v: string): boolean
export function shiftDate(date: string, days: number): string
export function dayBoundsAU(date: string): { startIso: string; endIso: string }
export function timeOfDayAU(iso: string): string
export function entryHours(startAt: string, endAt: string | null): number
export function fmtHours(n: number): string
export function summariseHours(entries: readonly HoursEntry[]): HoursSummary
export function hoursLabel(s: HoursSummary): string
export function approveChip(s: HoursSummary): { text: string; done: boolean }
export function attentionReasons(f: { date: string; today: string; hours: HoursSummary; prestartDone: boolean }): AttentionReason[]
export function compareDayRows(a: { attention: AttentionReason[]; number: string }, b: { attention: AttentionReason[]; number: string }): number
export function materialsEditable(signoff: { status: string } | null): boolean
export function timesToInstants(date: string, start: string, end: string | null): { startIso: string; endIso: string | null } | { error: string }
export const usageLineSchema  // zod schema
export type UsageLineInput = z.infer<typeof usageLineSchema>
export function usageRowFields(v: UsageLineInput): { kind: UsageLine['kind']; description: string; qty: number | null; unit: string | null; company: string | null; headcount: number | null; hours: number | null }
export function describeUsage(u: Pick<UsageLine, 'kind' | 'description' | 'qty' | 'unit' | 'company' | 'headcount' | 'hours'>): { item: string; qty: string }
```

- [ ] **Step 1: Write the failing tests**

Create `tests/site-days.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  approveChip,
  attentionReasons,
  compareDayRows,
  dayBoundsAU,
  describeUsage,
  entryHours,
  fmtHours,
  hoursLabel,
  isIsoDate,
  isWorkKind,
  materialsEditable,
  shiftDate,
  summariseHours,
  timeOfDayAU,
  timesToInstants,
  usageLineSchema,
  usageRowFields,
  type AttentionReason,
  type HoursEntry,
} from '@/lib/site-days'

// Brisbane is UTC+10 all year: 20:42Z on the 19th = 06:42 on the 20th.
const sam: HoursEntry = { userId: 'u1', startAt: '2026-11-19T20:42:00Z', endAt: '2026-11-20T05:06:00Z', approved: true }
const jo: HoursEntry = { userId: 'u2', startAt: '2026-11-19T20:45:00Z', endAt: '2026-11-20T05:00:00Z', approved: false }
const ali: HoursEntry = { userId: 'u3', startAt: '2026-11-19T21:10:00Z', endAt: null, approved: false }

describe('dates', () => {
  it('recognises work kinds', () => {
    expect(isWorkKind('job')).toBe(true)
    expect(isWorkKind('project')).toBe(true)
    expect(isWorkKind('quote')).toBe(false)
  })

  it('accepts only real ISO dates', () => {
    expect(isIsoDate('2026-11-20')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('20-11-2026')).toBe(false)
    expect(isIsoDate('')).toBe(false)
  })

  it('shifts whole calendar days', () => {
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('bounds a Brisbane day in UTC', () => {
    expect(dayBoundsAU('2026-11-20')).toEqual({
      startIso: '2026-11-19T14:00:00.000Z',
      endIso: '2026-11-20T14:00:00.000Z',
    })
  })

  it('formats a Brisbane time of day', () => {
    expect(timeOfDayAU('2026-11-19T20:42:00Z')).toBe('06:42')
    expect(timeOfDayAU('2026-11-20T05:06:59Z')).toBe('15:06')
  })
})

describe('hours', () => {
  it('computes decimal hours, zero for open or negative', () => {
    expect(entryHours(sam.startAt, sam.endAt)).toBeCloseTo(8.4, 5)
    expect(entryHours(ali.startAt, null)).toBe(0)
    expect(entryHours('2026-11-20T05:00:00Z', '2026-11-20T04:00:00Z')).toBe(0)
  })

  it('formats hours to two decimals with a dash for none', () => {
    expect(fmtHours(8.4)).toBe('8.4')
    expect(fmtHours(8.333333)).toBe('8.33')
    expect(fmtHours(0)).toBe('—')
  })

  it('summarises a day', () => {
    const s = summariseHours([sam, jo, ali])
    expect(s.people).toBe(3)
    expect(s.closed).toBe(2)
    expect(s.approved).toBe(1)
    expect(s.open).toBe(1)
    expect(s.totalHours).toBeCloseTo(16.65, 5)
  })

  it('counts one person with two entries once', () => {
    const second: HoursEntry = { ...sam, startAt: '2026-11-20T05:30:00Z', endAt: '2026-11-20T06:30:00Z' }
    expect(summariseHours([sam, second]).people).toBe(1)
  })

  it('words the list column', () => {
    expect(hoursLabel(summariseHours([sam, jo, ali]))).toBe('Still checked in')
    expect(hoursLabel(summariseHours([sam, jo]))).toBe('1 of 2 approved')
    expect(hoursLabel(summariseHours([]))).toBe('No hours')
  })

  it('words the day-page chip', () => {
    expect(approveChip(summariseHours([sam, jo, ali]))).toEqual({ text: '2 of 3 hours to approve', done: false })
    expect(approveChip(summariseHours([sam]))).toEqual({ text: 'Hours approved', done: true })
    expect(approveChip(summariseHours([]))).toEqual({ text: 'No hours logged', done: true })
  })
})

describe('attention', () => {
  const hours = summariseHours([sam, jo, ali])

  it('flags an open check-in only on a past day', () => {
    expect(attentionReasons({ date: '2026-11-19', today: '2026-11-20', hours, prestartDone: true })).toContain('open_checkin')
    expect(attentionReasons({ date: '2026-11-20', today: '2026-11-20', hours, prestartDone: true })).not.toContain('open_checkin')
  })

  it('flags hours with no pre-start, and unapproved hours', () => {
    expect(attentionReasons({ date: '2026-11-20', today: '2026-11-20', hours, prestartDone: false })).toEqual(['no_prestart', 'unapproved'])
  })

  it('flags nothing for a day with no hours', () => {
    expect(attentionReasons({ date: '2026-11-19', today: '2026-11-20', hours: summariseHours([]), prestartDone: false })).toEqual([])
  })

  it('sorts attention first, then newest number', () => {
    const rows: { number: string; attention: AttentionReason[] }[] = [
      { number: 'J-26030', attention: [] },
      { number: 'J-26031', attention: [] },
      { number: 'J-26010', attention: ['unapproved'] },
    ]
    expect(rows.sort(compareDayRows).map((r) => r.number)).toEqual(['J-26010', 'J-26031', 'J-26030'])
  })
})

describe('materials lock', () => {
  it('is editable only while the day has no sign-off', () => {
    expect(materialsEditable(null)).toBe(true)
    expect(materialsEditable({ status: 'draft' })).toBe(false)
    expect(materialsEditable({ status: 'signed' })).toBe(false)
  })
})

describe('timesToInstants', () => {
  it('reads times as Brisbane wall-clock on the given day', () => {
    expect(timesToInstants('2026-11-20', '06:45', '15:00')).toEqual({
      startIso: '2026-11-19T20:45:00.000Z',
      endIso: '2026-11-20T05:00:00.000Z',
    })
  })

  it('allows an open finish', () => {
    expect(timesToInstants('2026-11-20', '06:45', null)).toEqual({
      startIso: '2026-11-19T20:45:00.000Z',
      endIso: null,
    })
  })

  it('rejects bad input', () => {
    expect(timesToInstants('2026-11-20', '15:00', '06:45')).toEqual({ error: 'Finish must be after start' })
    expect(timesToInstants('2026-11-20', '15:00', '15:00')).toEqual({ error: 'Finish must be after start' })
    expect(timesToInstants('2026-11-20', '', '15:00')).toEqual({ error: 'Enter a start time' })
    expect(timesToInstants('2026-11-20', '06:45', '24:00')).toEqual({ error: 'Enter a finish time' })
    expect(timesToInstants('2026-02-30', '06:45', '15:00')).toEqual({ error: 'Invalid date' })
  })
})

describe('usage lines', () => {
  it('requires a quantity for materials and plant', () => {
    const r = usageLineSchema.safeParse({ kind: 'material', description: 'Black plastic', qty: null })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.message).toBe('Enter a quantity')
  })

  it('requires company, headcount and hours for a subbie', () => {
    const r = usageLineSchema.safeParse({ kind: 'subbie', company: '', headcount: 2, hours: 4 })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.message).toBe('Enter the company name')
  })

  it('normalises a material row', () => {
    const v = usageLineSchema.parse({ kind: 'material', description: ' Black plastic ', qty: 2, unit: 'rolls' })
    expect(usageRowFields(v)).toEqual({
      kind: 'material', description: 'Black plastic', qty: 2, unit: 'rolls',
      company: null, headcount: null, hours: null,
    })
  })

  it('defaults plant to hours and copies a subbie company into the description', () => {
    const plant = usageLineSchema.parse({ kind: 'plant', description: 'NPU 1,500 CFM', qty: 8 })
    expect(usageRowFields(plant).unit).toBe('hrs')
    const subbie = usageLineSchema.parse({ kind: 'subbie', company: 'Scaffold crew', headcount: 2, hours: 4 })
    expect(usageRowFields(subbie)).toEqual({
      kind: 'subbie', description: 'Scaffold crew', qty: null, unit: null,
      company: 'Scaffold crew', headcount: 2, hours: 4,
    })
  })

  it('describes a line for display', () => {
    expect(describeUsage({ kind: 'material', description: 'Black plastic', qty: 2, unit: 'rolls', company: null, headcount: null, hours: null }))
      .toEqual({ item: 'Black plastic', qty: '2 rolls' })
    expect(describeUsage({ kind: 'subbie', description: 'Scaffold crew', qty: null, unit: null, company: 'Scaffold crew', headcount: 2, hours: 4 }))
      .toEqual({ item: 'Scaffold crew', qty: '2 people · 4 h' })
    expect(describeUsage({ kind: 'subbie', description: 'Sparky', qty: null, unit: null, company: 'Sparky', headcount: 1, hours: 3 }).qty)
      .toBe('1 person · 3 h')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/site-days.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/site-days"`.

- [ ] **Step 3: Write the library**

Create `src/lib/site-days.ts`:

```ts
// Office "Site days" — pure rules shared by the day list, the day page and
// the server actions. No I/O here (see src/lib/site-days-queries.ts).
//
// Hours and quantities only: nothing in this module carries a rate or amount.

import { z } from 'zod'
import { auLocalToInstant } from '@/lib/tz'

// ─── Types ───────────────────────────────────────────────────────────────────

export type WorkKind = 'job' | 'project'

/** One job or project on one Brisbane calendar day. */
export type DayRef = { kind: WorkKind; workId: string; date: string }

export type CrewEntry = {
  id: string
  userId: string
  name: string
  startAt: string
  endAt: string | null
  approved: boolean
  /** True when the entry has no schedule link (assignment_id is null). */
  unscheduled: boolean
}

export type UsageLine = {
  id: string
  kind: 'material' | 'plant' | 'subbie'
  description: string
  qty: number | null
  unit: string | null
  company: string | null
  headcount: number | null
  hours: number | null
  loggedBy: string | null
}

export type HoursEntry = {
  userId: string
  startAt: string
  endAt: string | null
  approved: boolean
}

export type HoursSummary = {
  people: number
  totalHours: number
  closed: number
  approved: number
  open: number
}

export type AttentionReason = 'open_checkin' | 'no_prestart' | 'unapproved'

export const ATTENTION_LABELS: Record<AttentionReason, string> = {
  open_checkin: 'Still checked in',
  no_prestart: 'No pre-start',
  unapproved: 'Hours to approve',
}

// ─── Dates ───────────────────────────────────────────────────────────────────

export function isWorkKind(v: string): v is WorkKind {
  return v === 'job' || v === 'project'
}

/** True for a real 'YYYY-MM-DD' calendar date. */
export function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** 'YYYY-MM-DD' shifted by whole days (pure calendar arithmetic). */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** UTC instants bounding a Brisbane calendar day: [startIso, endIso). */
export function dayBoundsAU(date: string): { startIso: string; endIso: string } {
  const start = new Date(`${date}T00:00:00+10:00`)
  return {
    startIso: start.toISOString(),
    endIso: new Date(start.getTime() + 86_400_000).toISOString(),
  }
}

/** "06:42" (24 hour) in Brisbane for an ISO instant. */
export function timeOfDayAU(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Australia/Brisbane',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

// ─── Hours ───────────────────────────────────────────────────────────────────

/** Decimal hours for a closed entry; 0 while still checked in. */
export function entryHours(startAt: string, endAt: string | null): number {
  if (!endAt) return 0
  return Math.max(0, (new Date(endAt).getTime() - new Date(startAt).getTime()) / 3_600_000)
}

export function fmtHours(n: number): string {
  return n > 0 ? String(Math.round(n * 100) / 100) : '—'
}

export function summariseHours(entries: readonly HoursEntry[]): HoursSummary {
  const people = new Set<string>()
  let totalHours = 0
  let closed = 0
  let approved = 0
  let open = 0
  for (const e of entries) {
    people.add(e.userId)
    if (e.endAt == null) {
      open++
      continue
    }
    closed++
    totalHours += entryHours(e.startAt, e.endAt)
    if (e.approved) approved++
  }
  return { people: people.size, totalHours, closed, approved, open }
}

/** Day-list column: "3 of 4 approved", "Still checked in" or "No hours". */
export function hoursLabel(s: HoursSummary): string {
  if (s.open > 0) return 'Still checked in'
  if (s.closed === 0) return 'No hours'
  return `${s.approved} of ${s.closed} approved`
}

/** Day-page header chip. */
export function approveChip(s: HoursSummary): { text: string; done: boolean } {
  const total = s.closed + s.open
  if (total === 0) return { text: 'No hours logged', done: true }
  const todo = total - s.approved
  if (todo === 0) return { text: 'Hours approved', done: true }
  return { text: `${todo} of ${total} hours to approve`, done: false }
}

// ─── Attention ───────────────────────────────────────────────────────────────

export function attentionReasons(f: {
  date: string
  today: string
  hours: HoursSummary
  prestartDone: boolean
}): AttentionReason[] {
  const out: AttentionReason[] = []
  if (f.hours.open > 0 && f.date < f.today) out.push('open_checkin')
  if (f.hours.closed + f.hours.open > 0 && !f.prestartDone) out.push('no_prestart')
  if (f.hours.closed > f.hours.approved) out.push('unapproved')
  return out
}

/** Rows needing attention first, then the newest work number. */
export function compareDayRows(
  a: { attention: AttentionReason[]; number: string },
  b: { attention: AttentionReason[]; number: string }
): number {
  if (a.attention.length !== b.attention.length) return b.attention.length - a.attention.length
  return b.number.localeCompare(a.number)
}

// ─── Materials lock ──────────────────────────────────────────────────────────

/**
 * The materials log is edited on the day page only while the day has no
 * sign-off at all. Once one exists (any status) the sign-off screen is the
 * single place to change the figures the client sees.
 */
export function materialsEditable(signoff: { status: string } | null): boolean {
  return signoff === null
}

// ─── Validation ──────────────────────────────────────────────────────────────

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * 'HH:MM' start and finish on a Brisbane day → UTC instants for storage.
 * A shift may not cross midnight: finish must be later the same day.
 */
export function timesToInstants(
  date: string,
  start: string,
  end: string | null
): { startIso: string; endIso: string | null } | { error: string } {
  if (!isIsoDate(date)) return { error: 'Invalid date' }
  if (!HHMM.test(start)) return { error: 'Enter a start time' }
  if (end !== null && !HHMM.test(end)) return { error: 'Enter a finish time' }
  if (end !== null && end <= start) return { error: 'Finish must be after start' }
  return {
    startIso: auLocalToInstant(`${date}T${start}`),
    endIso: end === null ? null : auLocalToInstant(`${date}T${end}`),
  }
}

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))

/** Same rules as the crew's own form (src/app/field/usage/actions.ts). */
export const usageLineSchema = z
  .object({
    kind: z.enum(['material', 'plant', 'subbie']),
    description: z.string().trim().max(300).optional().default(''),
    qty: z.number().min(0, 'Quantity can’t be negative').optional().nullable(),
    unit: optText(20),
    company: optText(200),
    headcount: z.number().int().min(1).max(500).optional().nullable(),
    hours: z.number().min(0).max(24, 'Hours must be 24 or less').optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'subbie') {
      if (!v.company) ctx.addIssue({ code: 'custom', message: 'Enter the company name' })
      if (v.headcount == null) ctx.addIssue({ code: 'custom', message: 'Enter how many people' })
      if (v.hours == null) ctx.addIssue({ code: 'custom', message: 'Enter the hours' })
    } else {
      if (!v.description) ctx.addIssue({ code: 'custom', message: 'Enter what was used' })
      if (v.qty == null || Number.isNaN(v.qty)) {
        ctx.addIssue({
          code: 'custom',
          message: v.kind === 'plant' ? 'Enter the hours' : 'Enter a quantity',
        })
      }
    }
  })

export type UsageLineInput = z.infer<typeof usageLineSchema>

/**
 * Column values normalised so field_usage's check constraints hold. Leaves
 * the crew's quote-line / price-list / plant-register links untouched.
 */
export function usageRowFields(v: UsageLineInput): {
  kind: UsageLine['kind']
  description: string
  qty: number | null
  unit: string | null
  company: string | null
  headcount: number | null
  hours: number | null
} {
  if (v.kind === 'subbie') {
    return {
      kind: v.kind,
      description: v.company!,
      qty: null,
      unit: null,
      company: v.company,
      headcount: v.headcount ?? null,
      hours: v.hours ?? null,
    }
  }
  return {
    kind: v.kind,
    description: v.description,
    qty: v.qty ?? null,
    unit: v.kind === 'plant' ? (v.unit ?? 'hrs') : v.unit,
    company: null,
    headcount: null,
    hours: null,
  }
}

export function describeUsage(
  u: Pick<UsageLine, 'kind' | 'description' | 'qty' | 'unit' | 'company' | 'headcount' | 'hours'>
): { item: string; qty: string } {
  if (u.kind === 'subbie') {
    const people = u.headcount ?? 0
    return {
      item: u.company ?? u.description,
      qty: `${people} ${people === 1 ? 'person' : 'people'} · ${u.hours ?? 0} h`,
    }
  }
  return { item: u.description, qty: `${u.qty ?? 0} ${u.unit ?? ''}`.trim() }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/site-days.test.ts`
Expected: PASS — `Test Files  1 passed (1)`, all tests green.

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/site-days.ts tests/site-days.test.ts
git commit -m "feat(site-days): pure rules for hours, attention and the materials lock" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 2: Server loaders

**Files:**
- Create: `src/lib/site-days-queries.ts`

**Interfaces:**
- Consumes from Task 1: `WorkKind`, `CrewEntry`, `UsageLine`, `HoursEntry`, `HoursSummary`, `AttentionReason`, `attentionReasons`, `compareDayRows`, `dayBoundsAU`, `summariseHours`.
- Consumes existing: `fetchAttachmentsWithUrls(supabase, parentType, parentId): Promise<AttachmentRow[]>` from `src/lib/attachment-queries.ts`; `FORM_KIND_LABELS` from `src/lib/form-kinds.ts`; `todayAU` from `src/lib/tz.ts`.
- Produces:

```ts
export type DayListRow = {
  kind: WorkKind; id: string; number: string; title: string; client: string | null
  hours: HoursSummary
  prestartAt: string | null
  usageCount: number
  photoCount: number
  signoff: { id: string; status: string } | null
  attention: AttentionReason[]
}
export type RecentDay = { date: string; hours: HoursSummary; usageCount: number; signoff: { id: string; status: string } | null }
export type DayDetail = {
  work: { kind: WorkKind; id: string; number: string; title: string; client: string | null }
  date: string
  entries: CrewEntry[]
  people: { id: string; name: string }[]
  prestart: { id: string; submittedAt: string; submittedBy: string; signons: string[] } | null
  otherForms: { id: string; name: string; kindLabel: string; submittedAt: string; submittedBy: string }[]
  swms: { id: string; title: string; version: number; unsigned: string[] }[]
  usage: UsageLine[]
  summary: string
  signoff: { id: string; status: string; version: number } | null
  diary: { weather: string | null; workPerformed: string | null; delays: string | null } | null
  files: { id: string; kind: 'photo' | 'docket'; filename: string; signedUrl: string | null }[]
  wasteLoads: { id: string; number: string; classification: string; qty: number; unit: string }[]
  prevDate: string | null
  nextDate: string | null
}
export async function loadDayList(sb: SupabaseClient, date: string): Promise<DayListRow[]>
export async function loadRecentDays(sb: SupabaseClient, kind: WorkKind, id: string, limit?: number): Promise<RecentDay[]>
export async function loadDayDetail(sb: SupabaseClient, kind: WorkKind, id: string, date: string): Promise<DayDetail | null>
```

These loaders are I/O only and have no unit test; every rule they apply is tested in Task 1. They are exercised by the pages in Tasks 5 to 7 and the live proof in Task 8.

- [ ] **Step 1: Write the loaders**

Create `src/lib/site-days-queries.ts`:

```ts
// Office "Site days" — server loaders. They take the caller's Supabase client
// so RLS applies; admin, office and supervisor can read every table used.
//
// Server-only. Client components import their row types from
// src/lib/site-days.ts, never from this file.
//
// No money: timesheet_entries.cost_rate is never selected here.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAttachmentsWithUrls } from '@/lib/attachment-queries'
import { FORM_KIND_LABELS } from '@/lib/form-kinds'
import { todayAU } from '@/lib/tz'
import type { FormTemplateKind } from '@/lib/zod'
import {
  attentionReasons,
  compareDayRows,
  dayBoundsAU,
  summariseHours,
  type AttentionReason,
  type CrewEntry,
  type HoursEntry,
  type HoursSummary,
  type UsageLine,
  type WorkKind,
} from '@/lib/site-days'

// ─── Shared helpers ──────────────────────────────────────────────────────────

type ParentCols = { job_id: string | null; project_id: string | null }

const parentColumn = (kind: WorkKind) => (kind === 'job' ? 'job_id' : 'project_id')

function workKey(r: ParentCols): string | null {
  if (r.job_id) return `job:${r.job_id}`
  if (r.project_id) return `project:${r.project_id}`
  return null
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null
  return rel ?? null
}

type SignoffRef = { id: string; status: string }

// ─── Day list ────────────────────────────────────────────────────────────────

export type DayListRow = {
  kind: WorkKind
  id: string
  number: string
  title: string
  client: string | null
  hours: HoursSummary
  /** ISO instant of the day's pre-start meeting; null when there is none. */
  prestartAt: string | null
  usageCount: number
  photoCount: number
  signoff: SignoffRef | null
  attention: AttentionReason[]
}

type Acc = {
  kind: WorkKind
  id: string
  entries: HoursEntry[]
  prestartAt: string | null
  usageCount: number
  photoCount: number
  signoff: SignoffRef | null
}

/**
 * Every job and project with any field activity on `date`: hours, materials
 * log, a form, a photo or docket, a waste load, or a diary entry.
 */
export async function loadDayList(sb: SupabaseClient, date: string): Promise<DayListRow[]> {
  const { startIso, endIso } = dayBoundsAU(date)

  const [entries, usage, forms, files, signoffs, waste, diaries] = await Promise.all([
    sb
      .from('timesheet_entries')
      .select('user_id, job_id, project_id, start_at, end_at, approved')
      .eq('date', date),
    sb.from('field_usage').select('job_id, project_id').eq('date', date),
    sb
      .from('form_submissions')
      .select('kind, job_id, project_id, submitted_at')
      .gte('submitted_at', startIso)
      .lt('submitted_at', endIso)
      .order('submitted_at'),
    sb
      .from('attachments')
      .select('parent_type, parent_id')
      .in('parent_type', ['job', 'project'])
      .in('kind', ['photo', 'docket'])
      .gte('created_at', startIso)
      .lt('created_at', endIso),
    sb
      .from('daily_signoffs')
      .select('id, job_id, project_id, status, version')
      .eq('date', date)
      .order('version', { ascending: true }),
    sb.from('waste_loads').select('job_id, project_id').eq('date', date),
    sb.from('diaries').select('project_id').eq('date', date),
  ])

  const acc = new Map<string, Acc>()
  const touch = (r: ParentCols): Acc | null => {
    const key = workKey(r)
    if (!key) return null
    let a = acc.get(key)
    if (!a) {
      a = {
        kind: r.job_id ? 'job' : 'project',
        id: (r.job_id ?? r.project_id) as string,
        entries: [],
        prestartAt: null,
        usageCount: 0,
        photoCount: 0,
        signoff: null,
      }
      acc.set(key, a)
    }
    return a
  }

  for (const e of entries.data ?? []) {
    touch(e as ParentCols)?.entries.push({
      userId: e.user_id as string,
      startAt: e.start_at as string,
      endAt: (e.end_at as string | null) ?? null,
      approved: Boolean(e.approved),
    })
  }
  for (const u of usage.data ?? []) {
    const a = touch(u as ParentCols)
    if (a) a.usageCount++
  }
  for (const f of forms.data ?? []) {
    const a = touch(f as ParentCols)
    // Ordered by time, so the last pre-start meeting of the day wins.
    if (a && f.kind === 'prestart_meeting') a.prestartAt = f.submitted_at as string
  }
  for (const f of files.data ?? []) {
    const parent: ParentCols =
      f.parent_type === 'job'
        ? { job_id: f.parent_id as string, project_id: null }
        : { job_id: null, project_id: f.parent_id as string }
    const a = touch(parent)
    if (a) a.photoCount++
  }
  for (const s of signoffs.data ?? []) {
    const a = touch(s as ParentCols)
    // Ordered by version ascending, so the latest version wins.
    if (a) a.signoff = { id: s.id as string, status: s.status as string }
  }
  for (const w of waste.data ?? []) touch(w as ParentCols)
  for (const d of diaries.data ?? []) touch({ job_id: null, project_id: d.project_id as string })

  const jobIds = [...acc.values()].filter((a) => a.kind === 'job').map((a) => a.id)
  const projectIds = [...acc.values()].filter((a) => a.kind === 'project').map((a) => a.id)

  const [jobs, projects] = await Promise.all([
    jobIds.length > 0
      ? sb.from('jobs').select('id, number, title, clients(name)').in('id', jobIds)
      : Promise.resolve({ data: [] as never[] }),
    projectIds.length > 0
      ? sb.from('projects').select('id, number, name, clients(name)').in('id', projectIds)
      : Promise.resolve({ data: [] as never[] }),
  ])

  const names = new Map<string, { number: string; title: string; client: string | null }>()
  for (const j of jobs.data ?? []) {
    names.set(`job:${j.id}`, {
      number: j.number as string,
      title: j.title as string,
      client: one(j.clients as unknown as { name: string } | { name: string }[] | null)?.name ?? null,
    })
  }
  for (const p of projects.data ?? []) {
    names.set(`project:${p.id}`, {
      number: p.number as string,
      title: p.name as string,
      client: one(p.clients as unknown as { name: string } | { name: string }[] | null)?.name ?? null,
    })
  }

  const today = todayAU()
  const rows: DayListRow[] = []
  for (const [key, a] of acc) {
    const name = names.get(key)
    if (!name) continue // the job or project no longer exists
    const hours = summariseHours(a.entries)
    rows.push({
      kind: a.kind,
      id: a.id,
      number: name.number,
      title: name.title,
      client: name.client,
      hours,
      prestartAt: a.prestartAt,
      usageCount: a.usageCount,
      photoCount: a.photoCount,
      signoff: a.signoff,
      attention: attentionReasons({ date, today, hours, prestartDone: a.prestartAt !== null }),
    })
  }
  return rows.sort(compareDayRows)
}

// ─── Recent days for one job or project ──────────────────────────────────────

export type RecentDay = {
  date: string
  hours: HoursSummary
  usageCount: number
  signoff: SignoffRef | null
}

/** The most recent days on which this work had hours or a materials-log line. */
export async function loadRecentDays(
  sb: SupabaseClient,
  kind: WorkKind,
  id: string,
  limit = 14
): Promise<RecentDay[]> {
  const col = parentColumn(kind)
  const [entries, usage, signoffs] = await Promise.all([
    sb
      .from('timesheet_entries')
      .select('date, user_id, start_at, end_at, approved')
      .eq(col, id)
      .order('date', { ascending: false })
      .limit(1000),
    sb
      .from('field_usage')
      .select('date')
      .eq(col, id)
      .order('date', { ascending: false })
      .limit(1000),
    sb
      .from('daily_signoffs')
      .select('id, date, status, version')
      .eq(col, id)
      .order('version', { ascending: true }),
  ])

  const byDate = new Map<string, { entries: HoursEntry[]; usageCount: number }>()
  const day = (date: string) => {
    let d = byDate.get(date)
    if (!d) {
      d = { entries: [], usageCount: 0 }
      byDate.set(date, d)
    }
    return d
  }
  for (const e of entries.data ?? []) {
    day(e.date as string).entries.push({
      userId: e.user_id as string,
      startAt: e.start_at as string,
      endAt: (e.end_at as string | null) ?? null,
      approved: Boolean(e.approved),
    })
  }
  for (const u of usage.data ?? []) day(u.date as string).usageCount++

  const signoffByDate = new Map<string, SignoffRef>()
  for (const s of signoffs.data ?? []) {
    signoffByDate.set(s.date as string, { id: s.id as string, status: s.status as string })
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, limit)
    .map(([date, d]) => ({
      date,
      hours: summariseHours(d.entries),
      usageCount: d.usageCount,
      signoff: signoffByDate.get(date) ?? null,
    }))
}

// ─── One job-day in full ─────────────────────────────────────────────────────

export type DayDetail = {
  work: { kind: WorkKind; id: string; number: string; title: string; client: string | null }
  date: string
  entries: CrewEntry[]
  /** Active people, for the "Add entry" picker. */
  people: { id: string; name: string }[]
  prestart: { id: string; submittedAt: string; submittedBy: string; signons: string[] } | null
  otherForms: { id: string; name: string; kindLabel: string; submittedAt: string; submittedBy: string }[]
  swms: { id: string; title: string; version: number; unsigned: string[] }[]
  usage: UsageLine[]
  summary: string
  signoff: { id: string; status: string; version: number } | null
  diary: { weather: string | null; workPerformed: string | null; delays: string | null } | null
  files: { id: string; kind: 'photo' | 'docket'; filename: string; signedUrl: string | null }[]
  wasteLoads: { id: string; number: string; classification: string; qty: number; unit: string }[]
  /** Nearest earlier / later day with hours or a materials-log line. */
  prevDate: string | null
  nextDate: string | null
}

type NameRel = { full_name: string } | { full_name: string }[] | null

export async function loadDayDetail(
  sb: SupabaseClient,
  kind: WorkKind,
  id: string,
  date: string
): Promise<DayDetail | null> {
  const col = parentColumn(kind)
  const { startIso, endIso } = dayBoundsAU(date)

  const workQuery =
    kind === 'job'
      ? sb.from('jobs').select('id, number, title, clients(name)').eq('id', id).maybeSingle()
      : sb.from('projects').select('id, number, name, clients(name)').eq('id', id).maybeSingle()

  const [
    work,
    entries,
    people,
    forms,
    swmsInstances,
    usage,
    note,
    signoff,
    diary,
    attachments,
    waste,
    entryDates,
    usageDates,
  ] = await Promise.all([
    workQuery,
    sb
      .from('timesheet_entries')
      .select(
        'id, user_id, start_at, end_at, approved, assignment_id, profiles!timesheet_entries_user_id_fkey(full_name)'
      )
      .eq(col, id)
      .eq('date', date)
      .order('start_at'),
    sb.from('profiles').select('id, full_name').eq('active', true).order('full_name'),
    sb
      .from('form_submissions')
      .select(
        `id, kind, submitted_at, amends,
         form_templates(name),
         profiles!form_submissions_submitted_by_fkey(full_name),
         form_signons(name)`
      )
      .eq(col, id)
      .gte('submitted_at', startIso)
      .lt('submitted_at', endIso)
      .order('submitted_at'),
    sb
      .from('swms_instances')
      .select('id, title, version')
      .eq(col, id)
      .eq('status', 'active')
      .order('title'),
    sb
      .from('field_usage')
      .select(
        'id, kind, description, qty, unit, company, headcount, hours, created_at, profiles!field_usage_user_id_fkey(full_name)'
      )
      .eq(col, id)
      .eq('date', date)
      .order('created_at')
      .order('id'),
    sb.from('field_day_notes').select('summary').eq(col, id).eq('date', date).maybeSingle(),
    sb
      .from('daily_signoffs')
      .select('id, status, version')
      .eq(col, id)
      .eq('date', date)
      .order('version', { ascending: false })
      .limit(1),
    kind === 'project'
      ? sb
          .from('diaries')
          .select('weather, work_performed, delays')
          .eq('project_id', id)
          .eq('date', date)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    fetchAttachmentsWithUrls(sb, kind, id),
    sb
      .from('waste_loads')
      .select('id, number, classification, qty, unit')
      .eq(col, id)
      .eq('date', date)
      .order('created_at'),
    sb.from('timesheet_entries').select('date').eq(col, id).limit(2000),
    sb.from('field_usage').select('date').eq(col, id).limit(2000),
  ])

  if (!work.data) return null
  const w = work.data as { id: string; number: string; title?: string; name?: string; clients: unknown }

  const crew: CrewEntry[] = (entries.data ?? []).map((e) => ({
    id: e.id as string,
    userId: e.user_id as string,
    name: one(e.profiles as unknown as NameRel)?.full_name ?? 'Unknown',
    startAt: e.start_at as string,
    endAt: (e.end_at as string | null) ?? null,
    approved: Boolean(e.approved),
    unscheduled: e.assignment_id == null,
  }))

  // A submission that a later one amends is hidden; the amendment stands.
  const formRows = forms.data ?? []
  const amended = new Set(formRows.map((f) => f.amends as string | null).filter(Boolean) as string[])
  const visible = formRows.filter((f) => !amended.has(f.id as string))
  const shapeForm = (f: (typeof formRows)[number]) => ({
    id: f.id as string,
    name: one(f.form_templates as unknown as { name: string } | { name: string }[] | null)?.name ?? 'Form',
    kindLabel: FORM_KIND_LABELS[f.kind as FormTemplateKind] ?? (f.kind as string),
    submittedAt: f.submitted_at as string,
    submittedBy: one(f.profiles as unknown as NameRel)?.full_name ?? 'Unknown',
  })
  const prestartRow = visible.filter((f) => f.kind === 'prestart_meeting').at(-1) ?? null
  const prestart = prestartRow
    ? {
        id: prestartRow.id as string,
        submittedAt: prestartRow.submitted_at as string,
        submittedBy: shapeForm(prestartRow).submittedBy,
        signons: ((prestartRow.form_signons as unknown as { name: string }[] | null) ?? []).map(
          (s) => s.name
        ),
      }
    : null
  const otherForms = visible.filter((f) => f.id !== prestartRow?.id).map(shapeForm)

  // SWMS: who of the day's crew has not signed the current version.
  const instances = (swmsInstances.data ?? []) as { id: string; title: string; version: number }[]
  const { data: signatures } =
    instances.length > 0
      ? await sb
          .from('swms_signatures')
          .select('swms_instance_id, user_id, version')
          .in(
            'swms_instance_id',
            instances.map((i) => i.id)
          )
      : { data: [] as never[] }
  const signedVersion = new Map<string, number>()
  for (const s of signatures ?? []) {
    if (!s.user_id) continue // external signer
    const key = `${s.swms_instance_id}:${s.user_id}`
    const v = Number(s.version)
    if ((signedVersion.get(key) ?? 0) < v) signedVersion.set(key, v)
  }
  const crewPeople = new Map<string, string>()
  for (const e of crew) crewPeople.set(e.userId, e.name)
  const swms = instances.map((i) => ({
    id: i.id,
    title: i.title,
    version: Number(i.version),
    unsigned: [...crewPeople.entries()]
      .filter(([userId]) => (signedVersion.get(`${i.id}:${userId}`) ?? 0) < Number(i.version))
      .map(([, name]) => name)
      .sort(),
  }))

  const usageLines: UsageLine[] = (usage.data ?? []).map((u) => ({
    id: u.id as string,
    kind: u.kind as UsageLine['kind'],
    description: u.description as string,
    qty: u.qty === null ? null : Number(u.qty),
    unit: (u.unit as string | null) ?? null,
    company: (u.company as string | null) ?? null,
    headcount: u.headcount === null ? null : Number(u.headcount),
    hours: u.hours === null ? null : Number(u.hours),
    loggedBy: one(u.profiles as unknown as NameRel)?.full_name ?? null,
  }))

  const latest = (signoff.data ?? [])[0] as { id: string; status: string; version: number } | undefined
  const d = diary.data as { weather: string | null; work_performed: string | null; delays: string | null } | null

  // created_at comes back as '…+00:00', startIso as '…Z' — compare instants,
  // never the strings.
  const startMs = new Date(startIso).getTime()
  const endMs = new Date(endIso).getTime()
  const files = attachments
    .filter((a) => {
      if (a.kind !== 'photo' && a.kind !== 'docket') return false
      const t = new Date(a.created_at).getTime()
      return t >= startMs && t < endMs
    })
    .map((a) => ({
      id: a.id,
      kind: a.kind as 'photo' | 'docket',
      filename: a.filename,
      signedUrl: a.signedUrl,
    }))

  const activity = [
    ...new Set([
      ...(entryDates.data ?? []).map((r) => r.date as string),
      ...(usageDates.data ?? []).map((r) => r.date as string),
    ]),
  ].sort()
  const prevDate = activity.filter((x) => x < date).at(-1) ?? null
  const nextDate = activity.find((x) => x > date) ?? null

  return {
    work: {
      kind,
      id: w.id,
      number: w.number,
      title: (w.title ?? w.name ?? '') as string,
      client: one(w.clients as { name: string } | { name: string }[] | null)?.name ?? null,
    },
    date,
    entries: crew,
    people: (people.data ?? []).map((p) => ({ id: p.id as string, name: p.full_name as string })),
    prestart,
    otherForms,
    swms,
    usage: usageLines,
    summary: ((note.data as { summary: string } | null)?.summary ?? '').trim(),
    signoff: latest ? { id: latest.id, status: latest.status, version: Number(latest.version) } : null,
    diary: d ? { weather: d.weather, workPerformed: d.work_performed, delays: d.delays } : null,
    files,
    wasteLoads: (waste.data ?? []).map((l) => ({
      id: l.id as string,
      number: l.number as string,
      classification: l.classification as string,
      qty: Number(l.qty),
      unit: l.unit as string,
    })),
    prevDate,
    nextDate,
  }
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 3: Confirm no money column is selected**

Run: `Select-String -Path src/lib/site-days-queries.ts -Pattern 'cost_rate|hourly_cost|unit_sell|contract_price|amount'`
Expected: one match only — the header comment line that says `cost_rate is never selected here`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/site-days-queries.ts
git commit -m "feat(site-days): server loaders for the day list and day page" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 3: Audit trigger migration and audit-log labels

**Files:**
- Create: `supabase/migrations/0079_site_days_audit.sql`
- Modify: `src/app/(office)/whs/audit/audit-table.tsx:34-45`
- Modify: `src/app/(office)/whs/audit/actions.ts:14-25`

**Interfaces:**
- Consumes: `audit_log` table (`supabase/migrations/0010_whs.sql:145`), columns `actor_id, actor_name, entity_type, entity_id, project_id, action, detail`.
- Produces: audit rows with `entity_type` `'timesheet_entries'` or `'field_usage'`. Insert and delete rows carry `detail.summary` (shown by `summariseDetail` in `src/components/AuditHistory.tsx`) and `detail.row`. Update rows carry `detail.changed` in the same `{col: {from, to}}` shape `audit_whs()` writes.

**This task writes the migration file only. It does not apply it.** Applying is Task 9, after the owner says go.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0079_site_days_audit.sql`:

```sql
-- 0079: edit trail for the office "Site days" view.
--
-- timesheet_entries and field_usage were not audited. The office can now
-- correct both from /site-days, so every change records who, when, and the
-- before and after.
--
-- A sibling of audit_whs() (0030), not audit_whs() itself, for two reasons:
--   * audit_whs() diffs every column. On timesheet_entries that would log
--     cost_rate (the hourly cost stamped at approval, 0066) into audit_log,
--     which supervisors can read. Money must not reach them.
--   * audit_whs() summarises INSERT / DELETE from title / name / status /
--     number / kind / label. A timesheet entry has none of those, so a
--     deleted entry would leave no record of what was deleted.
--
-- Spec: docs/superpowers/specs/2026-11-20-field-job-first-design.md

create or replace function audit_site_day() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_row jsonb;
  v_old jsonb;
  v_changed jsonb := '{}'::jsonb;
  v_detail jsonb;
  v_summary text;
  k text;
begin
  select full_name into v_actor_name from profiles where id = v_actor;
  v_actor_name := coalesce(v_actor_name, 'system');

  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;
  -- Never carry the cost rate or bookkeeping timestamps into the log.
  v_row := v_row - 'cost_rate' - 'updated_at';

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - 'cost_rate' - 'updated_at';
    for k in select jsonb_object_keys(v_row) loop
      if v_old -> k is distinct from v_row -> k then
        v_changed := v_changed
          || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_row -> k));
      end if;
    end loop;
    if v_changed = '{}'::jsonb then
      return null;  -- no effective change; skip the noise
    end if;
    v_detail := jsonb_build_object('changed', v_changed);
  else
    if tg_table_name = 'timesheet_entries' then
      v_summary := format(
        '%s %s to %s',
        v_row ->> 'date',
        to_char((v_row ->> 'start_at')::timestamptz at time zone 'Australia/Brisbane', 'HH24:MI'),
        coalesce(
          to_char((v_row ->> 'end_at')::timestamptz at time zone 'Australia/Brisbane', 'HH24:MI'),
          'still checked in'));
    else
      v_summary := format(
        '%s %s: %s',
        v_row ->> 'date', v_row ->> 'kind', v_row ->> 'description');
    end if;
    v_detail := jsonb_build_object('summary', v_summary, 'row', v_row);
  end if;

  insert into audit_log (actor_id, actor_name, entity_type, entity_id, project_id, action, detail)
  values (v_actor, v_actor_name, tg_table_name, (v_row ->> 'id')::uuid,
          nullif(v_row ->> 'project_id', '')::uuid, lower(tg_op), v_detail);
  return null;
end $$;

revoke execute on function audit_site_day() from anon, authenticated, public;

create trigger timesheet_entries_audit
  after insert or update or delete on timesheet_entries
  for each row execute function audit_site_day();

create trigger field_usage_audit
  after insert or update or delete on field_usage
  for each row execute function audit_site_day();
```

- [ ] **Step 2: Check the migration against the tables it reads**

Confirm by reading, not by running:

- `supabase/migrations/0001_schema.sql:312` — `timesheet_entries` has `id`, `date`, `start_at`, `end_at`, `project_id`. All five are used above.
- `supabase/migrations/0068_daily_signoffs.sql:20` — `field_usage` has `id`, `date`, `kind`, `description`, `project_id`, `updated_at`. All are used above.
- `supabase/migrations/0066_job_pnl.sql:61` — `cost_rate` is the only money column on either table.

Expected: every column named in the function exists; nothing else on either table holds money.

- [ ] **Step 3: Add the two labels**

In `src/app/(office)/whs/audit/audit-table.tsx`, replace the `ENTITY_TYPE_LABELS` map:

```ts
export const ENTITY_TYPE_LABELS: Record<string, string> = {
  swms_instances: 'SWMS',
  swms_signatures: 'SWMS signature',
  hold_points: 'Hold point',
  form_templates: 'Form template',
  form_submissions: 'Form submission',
  form_signons: 'Form sign-on',
  incidents: 'Incident',
  corrective_actions: 'Corrective action',
  subbie_swms: 'Subbie SWMS',
  share_links: 'Share link',
  timesheet_entries: 'Timesheet entry',
  field_usage: 'Materials log line',
}
```

In `src/app/(office)/whs/audit/actions.ts`, replace the `ENTITY_TYPES` set:

```ts
const ENTITY_TYPES = new Set([
  'swms_instances',
  'swms_signatures',
  'hold_points',
  'form_templates',
  'form_submissions',
  'form_signons',
  'incidents',
  'corrective_actions',
  'subbie_swms',
  'share_links',
  'timesheet_entries',
  'field_usage',
])
```

- [ ] **Step 4: Type check and run the existing suite**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0.

Run: `npx vitest run`
Expected: every test file passes (the count grows by one file from Task 1; nothing else changes).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0079_site_days_audit.sql "src/app/(office)/whs/audit/audit-table.tsx" "src/app/(office)/whs/audit/actions.ts"
git commit -m "feat(site-days): audit trigger for timesheets and the materials log" -m "Migration 0079 is NOT applied by this commit." -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 4: Server actions

**Files:**
- Create: `src/app/(office)/site-days/actions.ts`

**Interfaces:**
- Consumes from Task 1: `DayRef`, `WorkKind`, `isIsoDate`, `isWorkKind`, `timeOfDayAU`, `timesToInstants`, `usageLineSchema`, `usageRowFields`.
- Consumes existing: `approveTimesheetEntry(entryId: string, approved: boolean): Promise<{ error?: string }>` from `src/app/(office)/reports/actions.ts`; `requireRole` from `src/lib/auth.ts`; `createClient` from `src/lib/supabase/server`.
- Produces (all return `Promise<{ error?: string }>`):

```ts
export async function setEntryApproved(ref: DayRef, entryId: string, approved: boolean)
export async function updateEntryTimes(ref: DayRef, entryId: string, start: string, end: string | null)
export async function addTimesheetEntry(ref: DayRef, userId: string, start: string, end: string)
export async function deleteTimesheetEntry(ref: DayRef, entryId: string)
export async function approveDay(ref: DayRef)
export async function addUsageLine(ref: DayRef, input: unknown)
export async function updateUsageLine(ref: DayRef, lineId: string, input: unknown)
export async function deleteUsageLine(ref: DayRef, lineId: string)
export async function saveWorkSummary(ref: DayRef, summary: string)
```

`start` and `end` are `'HH:MM'` Brisbane wall-clock strings on `ref.date`.

Database facts these actions rely on, all already true:

- `timesheet_entries` update and delete: allowed for admin, office and supervisor (`supabase/migrations/0003_rls.sql:239-246`). Insert: allowed for the same roles on anyone's behalf (`0003_rls.sql:233`).
- Setting `approved` false makes the `timesheet_entries_cost_rate` trigger clear `cost_rate`; approving again re-stamps it (`0066_job_pnl.sql:73`). A supervisor may change `approved`; only the `field` role is refused.
- `field_usage` insert, update and delete, and `field_day_notes` insert and update: allowed for admin, office and supervisor on any date (`0068_daily_signoffs.sql:66-122`).

- [ ] **Step 1: Write the actions**

Create `src/app/(office)/site-days/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { approveTimesheetEntry } from '@/app/(office)/reports/actions'
import {
  isIsoDate,
  isWorkKind,
  timeOfDayAU,
  timesToInstants,
  usageLineSchema,
  usageRowFields,
  type DayRef,
  type WorkKind,
} from '@/lib/site-days'

/**
 * Office corrections to what the crew recorded on one job on one day.
 * Admin, office and supervisor. Hours and quantities only.
 */

type Result = { error?: string }
type Supabase = Awaited<ReturnType<typeof createClient>>

const ID = z.guid()
const LOCKED = 'This day has a sign-off — change the figures there'

const parentColumn = (kind: WorkKind) => (kind === 'job' ? 'job_id' : 'project_id')

function parseRef(ref: DayRef): DayRef | null {
  if (!ref || typeof ref !== 'object') return null
  if (!isWorkKind(String(ref.kind))) return null
  if (!ID.safeParse(ref.workId).success) return null
  if (typeof ref.date !== 'string' || !isIsoDate(ref.date)) return null
  return { kind: ref.kind, workId: ref.workId, date: ref.date }
}

function revalidateDay(ref: DayRef) {
  revalidatePath('/site-days')
  revalidatePath(`/site-days/${ref.kind}/${ref.workId}/${ref.date}`)
  revalidatePath('/reports')
  revalidatePath(ref.kind === 'job' ? `/jobs/${ref.workId}` : `/projects/${ref.workId}/site-days`)
}

type EntryRow = { id: string; start_at: string; end_at: string | null; approved: boolean }

/** The entry, only if it belongs to this job-day. */
async function entryOnDay(supabase: Supabase, ref: DayRef, entryId: string): Promise<EntryRow | null> {
  const { data } = await supabase
    .from('timesheet_entries')
    .select('id, start_at, end_at, approved')
    .eq('id', entryId)
    .eq(parentColumn(ref.kind), ref.workId)
    .eq('date', ref.date)
    .maybeSingle()
  return (data as EntryRow | null) ?? null
}

async function dayHasSignoff(supabase: Supabase, ref: DayRef): Promise<boolean> {
  const { data } = await supabase
    .from('daily_signoffs')
    .select('id')
    .eq(parentColumn(ref.kind), ref.workId)
    .eq('date', ref.date)
    .limit(1)
  return (data ?? []).length > 0
}

// ─── Hours ───────────────────────────────────────────────────────────────────

export async function setEntryApproved(
  ref: DayRef,
  entryId: string,
  approved: boolean
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')
  const day = parseRef(ref)
  if (!day) return { error: 'Day not found' }
  if (!ID.safeParse(entryId).success) return { error: 'Entry not found' }

  const supabase = await createClient()
  const entry = await entryOnDay(supabase, day, entryId)
  if (!entry) return { error: 'Entry not found' }
  if (approved && entry.end_at === null) return { error: 'Set a finish time first' }

  const result = await approveTimesheetEntry(entryId, approved === true)
  if (result.error) return result
  revalidateDay(day)
  return {}
}

export async function updateEntryTimes(
  ref: DayRef,
  entryId: string,
  start: string,
  end: string | null
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')
  const day = parseRef(ref)
  if (!day) return { error: 'Day not found' }
  if (!ID.safeParse(entryId).success) return { error: 'Entry not found' }

  const times = timesToInstants(day.date, start, end)
  if ('error' in times) return { error: times.error }

  const supabase = await createClient()
  const entry = await entryOnDay(supabase, day, entryId)
  if (!entry) return { error: 'Entry not found' }
  if (entry.end_at !== null && end === null) return { error: 'Enter a finish time' }

  // Compare at minute precision so re-saving an untouched row changes nothing
  // (stored instants carry seconds; the form does not).
  const startChanged = timeOfDayAU(entry.start_at) !== start
  const endChanged = (entry.end_at === null ? null : timeOfDayAU(entry.end_at)) !== end
  if (!startChanged && !endChanged) return {}

  const patch: Record<string, unknown> = {}
  if (startChanged) patch.start_at = times.startIso
  if (endChanged) patch.end_at = times.endIso
  // Changed hours are always approved again.
  if (entry.approved) {
    patch.approved = false
    patch.approved_by = null
  }

  const { error } = await supabase.from('timesheet_entries').update(patch).eq('id', entryId)
  if (error) return { error: error.message }
  revalidateDay(day)
  return {}
}

export async function addTimesheetEntry(
  ref: DayRef,
  userId: string,
  start: string,
  end: string
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')
  const day = parseRef(ref)
  if (!day) return { error: 'Day not found' }
  if (!ID.safeParse(userId).success) return { error: 'Pick a person' }

  const times = timesToInstants(day.date, start, end)
  if ('error' in times) return { error: times.error }
  if (times.endIso === null) return { error: 'Enter a finish time' }

  const supabase = await createClient()
  const col = parentColumn(day.kind)

  // Link the schedule entry when the person was scheduled here that day, so
  // the entry is not tagged Unscheduled by mistake.
  const { data: assignment } = await supabase
    .from('assignments')
    .select('id')
    .eq('user_id', userId)
    .eq('date', day.date)
    .eq(col, day.workId)
    .limit(1)
    .maybeSingle()

  const { error } = await supabase.from('timesheet_entries').insert({
    user_id: userId,
    assignment_id: (assignment?.id as string | undefined) ?? null,
    [col]: day.workId,
    date: day.date,
    start_at: times.startIso,
    end_at: times.endIso,
    approved: false,
  })
  if (error) return { error: error.message }
  revalidateDay(day)
  return {}
}

export async function deleteTimesheetEntry(ref: DayRef, entryId: string): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')
  const day = parseRef(ref)
  if (!day) return { error: 'Day not found' }
  if (!ID.safeParse(entryId).success) return { error: 'Entry not found' }

  const supabase = await createClient()
  const entry = await entryOnDay(supabase, day, entryId)
  if (!entry) return { error: 'Entry not found' }

  const { error } = await supabase.from('timesheet_entries').delete().eq('id', entryId)
  if (error) return { error: error.message }
  revalidateDay(day)
  return {}
}

/** Approve every closed entry on this job for this day. */
export async function approveDay(ref: DayRef): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const day = parseRef(ref)
  if (!day) return { error: 'Day not found' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('timesheet_entries')
    .update({ approved: true, approved_by: profile.id })
    .eq(parentColumn(day.kind), day.workId)
    .eq('date', day.date)
    .eq('approved', false)
    .not('end_at', 'is', null)
  if (error) return { error: error.message }
  revalidateDay(day)
  return {}
}

// ─── Materials, plant and subbies ────────────────────────────────────────────

export async function addUsageLine(ref: DayRef, input: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const day = parseRef(ref)
  if (!day) return { error: 'Day not found' }
  const parsed = usageLineSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid line' }

  const supabase = await createClient()
  if (await dayHasSignoff(supabase, day)) return { error: LOCKED }

  const { error } = await supabase.from('field_usage').insert({
    [parentColumn(day.kind)]: day.workId,
    date: day.date,
    user_id: profile.id,
    ...usageRowFields(parsed.data),
  })
  if (error) return { error: error.message }
  revalidateDay(day)
  return {}
}

export async function updateUsageLine(ref: DayRef, lineId: string, input: unknown): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')
  const day = parseRef(ref)
  if (!day) return { error: 'Day not found' }
  if (!ID.safeParse(lineId).success) return { error: 'Line not found' }
  const parsed = usageLineSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid line' }

  const supabase = await createClient()
  if (await dayHasSignoff(supabase, day)) return { error: LOCKED }

  const { data: line } = await supabase
    .from('field_usage')
    .select('id, kind')
    .eq('id', lineId)
    .eq(parentColumn(day.kind), day.workId)
    .eq('date', day.date)
    .maybeSingle()
  if (!line) return { error: 'Line not found' }
  if (line.kind !== parsed.data.kind) return { error: 'A line cannot change type — delete it and add a new one' }

  const { error } = await supabase
    .from('field_usage')
    .update(usageRowFields(parsed.data))
    .eq('id', lineId)
  if (error) return { error: error.message }
  revalidateDay(day)
  return {}
}

export async function deleteUsageLine(ref: DayRef, lineId: string): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')
  const day = parseRef(ref)
  if (!day) return { error: 'Day not found' }
  if (!ID.safeParse(lineId).success) return { error: 'Line not found' }

  const supabase = await createClient()
  if (await dayHasSignoff(supabase, day)) return { error: LOCKED }

  const { data, error } = await supabase
    .from('field_usage')
    .delete()
    .eq('id', lineId)
    .eq(parentColumn(day.kind), day.workId)
    .eq('date', day.date)
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'Line not found' }
  revalidateDay(day)
  return {}
}

const summarySchema = z.string().max(4000, 'Keep it under 4000 characters')

export async function saveWorkSummary(ref: DayRef, summary: string): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const day = parseRef(ref)
  if (!day) return { error: 'Day not found' }
  const parsed = summarySchema.safeParse(summary)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid summary' }

  const supabase = await createClient()
  if (await dayHasSignoff(supabase, day)) return { error: LOCKED }

  const col = parentColumn(day.kind)
  const { error } = await supabase.from('field_day_notes').upsert(
    {
      [col]: day.workId,
      date: day.date,
      summary: parsed.data.trim(),
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: `${col},date` }
  )
  if (error) return { error: error.message }
  revalidateDay(day)
  return {}
}
```

Note: `usageRowFields` deliberately leaves `quote_line_id`, `rate_item_id` and `plant_id` out of the update, so a line the crew picked from the quote or the plant register keeps that link when the office corrects its quantity.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 3: Confirm every exported function is guarded**

Run: `Select-String -Path "src/app/(office)/site-days/actions.ts" -Pattern "^export async function|requireRole\('admin', 'office', 'supervisor'\)"`
Expected: nine `export async function` lines and nine `requireRole('admin', 'office', 'supervisor')` lines, alternating — each export is followed by its guard.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(office)/site-days/actions.ts"
git commit -m "feat(site-days): office actions for hours, approval and the materials log" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 5: Day list page and menu item

**Files:**
- Create: `src/app/(office)/site-days/day-picker.tsx`
- Create: `src/app/(office)/site-days/page.tsx`
- Modify: `src/app/(office)/office-shell.tsx:6-26` (icon import) and `:62-77` (`NAV_ITEMS`)

**Interfaces:**
- Consumes from Task 1: `ATTENTION_LABELS`, `fmtHours`, `hoursLabel`, `isIsoDate`, `timeOfDayAU`.
- Consumes from Task 2: `loadDayList(sb, date): Promise<DayListRow[]>`.
- Consumes existing: `PageHeader({ title, description?, actions? })`, `SignoffStatusBadge({ status })`, `fmtDate`, `todayAU`, `yesterdayAU`.
- Produces: the route `/site-days?date=YYYY-MM-DD`; each row links to `/site-days/{kind}/{id}/{date}`.

- [ ] **Step 1: Write the day picker**

Create `src/app/(office)/site-days/day-picker.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function DayPicker({
  date,
  today,
  yesterday,
}: {
  date: string
  today: string
  yesterday: string
}) {
  const router = useRouter()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant={date === today ? 'default' : 'outline'}
        size="sm"
        render={<Link href="/site-days" />}
      >
        Today
      </Button>
      <Button
        variant={date === yesterday ? 'default' : 'outline'}
        size="sm"
        render={<Link href={`/site-days?date=${yesterday}`} />}
      >
        Yesterday
      </Button>
      <Input
        type="date"
        value={date}
        max={today}
        onChange={(e) => {
          if (e.target.value) router.push(`/site-days?date=${e.target.value}`)
        }}
        className="w-auto"
        aria-label="Day"
      />
    </div>
  )
}
```

- [ ] **Step 2: Write the list page**

Create `src/app/(office)/site-days/page.tsx`:

```tsx
import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SignoffStatusBadge } from '@/components/signoffs/SignoffStatusBadge'
import { fmtDate } from '@/lib/format'
import { todayAU, yesterdayAU } from '@/lib/tz'
import { ATTENTION_LABELS, fmtHours, hoursLabel, isIsoDate, timeOfDayAU } from '@/lib/site-days'
import { loadDayList } from '@/lib/site-days-queries'
import { DayPicker } from './day-picker'

export default async function SiteDaysPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  await requireRole('admin', 'office', 'supervisor')

  const sp = await searchParams
  const today = todayAU()
  const date = sp.date && isIsoDate(sp.date) && sp.date <= today ? sp.date : today

  const supabase = await createClient()
  const rows = await loadDayList(supabase, date)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Site days"
        description={`What the crew recorded on ${fmtDate(date)}, job by job.`}
      />

      <DayPicker date={date} today={today} yesterday={yesterdayAU()} />

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing was recorded in the field on this day.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Crew</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Pre-start</TableHead>
                <TableHead className="text-right">Logged</TableHead>
                <TableHead className="text-right">Photos</TableHead>
                <TableHead>Sign-off</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const href = `/site-days/${r.kind}/${r.id}/${date}`
                const hasHours = r.hours.closed + r.hours.open > 0
                return (
                  <TableRow key={`${r.kind}:${r.id}`}>
                    <TableCell>
                      <Link href={href} className="font-medium hover:underline">
                        <span className="font-mono text-xs text-muted-foreground">{r.number}</span>{' '}
                        {r.title}
                      </Link>
                      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        {r.client && <span>{r.client}</span>}
                        {r.attention.map((a) => (
                          <Badge
                            key={a}
                            variant="outline"
                            className="border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                          >
                            {ATTENTION_LABELS[a]}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {hasHours
                        ? `${r.hours.people} · ${fmtHours(r.hours.totalHours)} h`
                        : '—'}
                    </TableCell>
                    <TableCell>{hoursLabel(r.hours)}</TableCell>
                    <TableCell>
                      {r.prestartAt
                        ? `Done ${timeOfDayAU(r.prestartAt)}`
                        : hasHours
                          ? 'Missing'
                          : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.usageCount || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.photoCount || '—'}</TableCell>
                    <TableCell>
                      {r.signoff ? (
                        <Link href={`/signoffs/${r.signoff.id}`}>
                          <SignoffStatusBadge status={r.signoff.status} />
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Add the menu item**

In `src/app/(office)/office-shell.tsx`, add `ClipboardListIcon` to the `lucide-react` import, keeping the list alphabetical:

```ts
import {
  BarChart3Icon,
  BriefcaseIcon,
  CalendarIcon,
  ChevronDownIcon,
  ClipboardListIcon,
  DollarSignIcon,
  FileSignatureIcon,
  FileTextIcon,
  FolderClosedIcon,
  FolderKanbanIcon,
  HardHatIcon,
  KeyRoundIcon,
  InboxIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TruckIcon,
  UsersIcon,
} from 'lucide-react'
```

In the same file, add one line to `NAV_ITEMS` between the Schedule and Sign-offs lines:

```ts
  { label: 'Schedule', href: '/schedule', icon: CalendarIcon },
  { label: 'Site days', href: '/site-days', icon: ClipboardListIcon, roles: ['admin', 'office', 'supervisor'] },
  { label: 'Sign-offs', href: '/signoffs', icon: FileSignatureIcon, roles: ['admin', 'office', 'supervisor'] },
```

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(office)/site-days/page.tsx" "src/app/(office)/site-days/day-picker.tsx" "src/app/(office)/office-shell.tsx"
git commit -m "feat(site-days): day list and office menu item" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 6: Crew and hours section

**Files:**
- Create: `src/app/(office)/site-days/[kind]/[id]/[date]/crew-hours.tsx`
- Create: `src/app/(office)/site-days/[kind]/[id]/[date]/approve-day-button.tsx`
- Test: `tests/site-days-crew-hours.test.tsx`

**Interfaces:**
- Consumes from Task 1: `CrewEntry`, `DayRef`, `entryHours`, `fmtHours`, `timeOfDayAU`.
- Consumes from Task 4: `setEntryApproved`, `updateEntryTimes`, `addTimesheetEntry`, `deleteTimesheetEntry`, `approveDay`.
- Produces:

```tsx
export function CrewHours(props: { dayRef: DayRef; rows: CrewEntry[]; people: { id: string; name: string }[] }): JSX.Element
export function ApproveDayButton(props: { dayRef: DayRef; todo: number }): JSX.Element
```

`todo` is the number of closed, unapproved entries; the button is disabled at zero.

- [ ] **Step 1: Write the failing test**

Create `tests/site-days-crew-hours.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import * as React from 'react'

const setEntryApproved = vi.fn(async (..._a: unknown[]) => ({}))
const updateEntryTimes = vi.fn(async (..._a: unknown[]) => ({}))
const addTimesheetEntry = vi.fn(async (..._a: unknown[]) => ({}))
const deleteTimesheetEntry = vi.fn(async (..._a: unknown[]) => ({}))
vi.mock('@/app/(office)/site-days/actions', () => ({
  setEntryApproved: (...a: unknown[]) => setEntryApproved(...a),
  updateEntryTimes: (...a: unknown[]) => updateEntryTimes(...a),
  addTimesheetEntry: (...a: unknown[]) => addTimesheetEntry(...a),
  deleteTimesheetEntry: (...a: unknown[]) => deleteTimesheetEntry(...a),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { CrewHours } from '@/app/(office)/site-days/[kind]/[id]/[date]/crew-hours'
import type { CrewEntry, DayRef } from '@/lib/site-days'

const dayRef: DayRef = { kind: 'job', workId: '11111111-1111-4111-8111-111111111111', date: '2026-11-20' }

// Brisbane is UTC+10: 20:42Z on the 19th = 06:42 on the 20th.
const rows: CrewEntry[] = [
  { id: 'e1', userId: 'u1', name: 'Sam', startAt: '2026-11-19T20:42:00Z', endAt: '2026-11-20T05:06:00Z', approved: true, unscheduled: false },
  { id: 'e2', userId: 'u2', name: 'Jo', startAt: '2026-11-19T20:45:00Z', endAt: '2026-11-20T05:00:00Z', approved: false, unscheduled: true },
  { id: 'e3', userId: 'u3', name: 'Ali', startAt: '2026-11-19T21:10:00Z', endAt: null, approved: false, unscheduled: false },
]
const people = [
  { id: 'u1', name: 'Sam' },
  { id: 'u4', name: 'Kim' },
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test('shows times, hours, the Unscheduled tag and an open entry', () => {
  render(<CrewHours dayRef={dayRef} rows={rows} people={people} />)
  expect(screen.getByText('06:42')).toBeTruthy()
  expect(screen.getByText('15:06')).toBeTruthy()
  expect(screen.getByText('8.4')).toBeTruthy()
  expect(screen.getByText('Unscheduled')).toBeTruthy()
  expect(screen.getByText('Still checked in')).toBeTruthy()
})

test('ticking Approved calls the action with the day and entry', async () => {
  const user = userEvent.setup()
  render(<CrewHours dayRef={dayRef} rows={rows} people={people} />)
  await user.click(screen.getByRole('checkbox', { name: 'Approve hours for Jo' }))
  expect(setEntryApproved).toHaveBeenCalledWith(dayRef, 'e2', true)
})

test('an open entry cannot be approved', () => {
  render(<CrewHours dayRef={dayRef} rows={rows} people={people} />)
  const box = screen.getByRole('checkbox', { name: 'Approve hours for Ali' })
  expect(box.getAttribute('aria-disabled') === 'true' || box.hasAttribute('disabled')).toBe(true)
})

test('editing times saves the new start and finish', async () => {
  const user = userEvent.setup()
  render(<CrewHours dayRef={dayRef} rows={rows} people={people} />)
  await user.click(screen.getByRole('button', { name: 'Edit hours for Jo' }))
  fireEvent.change(screen.getByLabelText('Finish time'), { target: { value: '15:10' } })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(updateEntryTimes).toHaveBeenCalledWith(dayRef, 'e2', '06:45', '15:10')
})

test('Set finish on an open entry opens the same editor', async () => {
  const user = userEvent.setup()
  render(<CrewHours dayRef={dayRef} rows={rows} people={people} />)
  await user.click(screen.getByRole('button', { name: 'Set finish' }))
  fireEvent.change(screen.getByLabelText('Finish time'), { target: { value: '15:30' } })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(updateEntryTimes).toHaveBeenCalledWith(dayRef, 'e3', '07:10', '15:30')
})

test('adding an entry sends the person and times', async () => {
  const user = userEvent.setup()
  render(<CrewHours dayRef={dayRef} rows={rows} people={people} />)
  await user.click(screen.getByRole('button', { name: 'Add entry' }))
  fireEvent.change(screen.getByLabelText('Person'), { target: { value: 'u4' } })
  fireEvent.change(screen.getByLabelText('New start time'), { target: { value: '07:00' } })
  fireEvent.change(screen.getByLabelText('New finish time'), { target: { value: '15:00' } })
  await user.click(screen.getByRole('button', { name: 'Add' }))
  expect(addTimesheetEntry).toHaveBeenCalledWith(dayRef, 'u4', '07:00', '15:00')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/site-days-crew-hours.test.tsx`
Expected: FAIL — `Failed to resolve import "@/app/(office)/site-days/[kind]/[id]/[date]/crew-hours"`.

- [ ] **Step 3: Write the crew section**

Create `src/app/(office)/site-days/[kind]/[id]/[date]/crew-hours.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { entryHours, fmtHours, timeOfDayAU, type CrewEntry, type DayRef } from '@/lib/site-days'
import {
  addTimesheetEntry,
  deleteTimesheetEntry,
  setEntryApproved,
  updateEntryTimes,
} from '@/app/(office)/site-days/actions'

type Result = { error?: string }

export function CrewHours({
  dayRef,
  rows,
  people,
}: {
  dayRef: DayRef
  rows: CrewEntry[]
  people: { id: string; name: string }[]
}) {
  const [pending, startTransition] = useTransition()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [adding, setAdding] = useState(false)
  const [newUser, setNewUser] = useState(people[0]?.id ?? '')
  const [newStart, setNewStart] = useState('')
  const [newEnd, setNewEnd] = useState('')

  function run(action: () => Promise<Result>, done?: () => void) {
    startTransition(async () => {
      const result = await action()
      if (result.error) {
        toast.error(result.error)
        return
      }
      done?.()
    })
  }

  function openEditor(row: CrewEntry) {
    setEditingId(row.id)
    setStart(timeOfDayAU(row.startAt))
    setEnd(row.endAt ? timeOfDayAU(row.endAt) : '')
  }

  function saveEdit(row: CrewEntry) {
    run(
      () => updateEntryTimes(dayRef, row.id, start, end === '' ? null : end),
      () => setEditingId(null)
    )
  }

  function remove(row: CrewEntry) {
    if (!confirm(`Delete this entry for ${row.name}?`)) return
    run(() => deleteTimesheetEntry(dayRef, row.id))
  }

  function add() {
    run(
      () => addTimesheetEntry(dayRef, newUser, newStart, newEnd),
      () => {
        setAdding(false)
        setNewStart('')
        setNewEnd('')
      }
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Crew and hours</h2>
        <Button variant="outline" size="sm" onClick={() => setAdding((v) => !v)} disabled={pending}>
          <PlusIcon />
          Add entry
        </Button>
      </div>

      {adding && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
          <label className="flex flex-col gap-1 text-xs font-medium">
            Person
            <select
              aria-label="Person"
              className="h-8 rounded-lg border bg-background px-2 text-sm"
              value={newUser}
              onChange={(e) => setNewUser(e.target.value)}
            >
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Start
            <Input
              type="time"
              aria-label="New start time"
              className="w-28"
              value={newStart}
              onChange={(e) => setNewStart(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Finish
            <Input
              type="time"
              aria-label="New finish time"
              className="w-28"
              value={newEnd}
              onChange={(e) => setNewEnd(e.target.value)}
            />
          </label>
          <Button size="sm" onClick={add} disabled={pending}>
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody checked in on this job on this day.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>Finish</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead />
                <TableHead>Approved</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const editing = editingId === row.id
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="tabular-nums">
                      {editing ? (
                        <Input
                          type="time"
                          aria-label="Start time"
                          className="w-28"
                          value={start}
                          onChange={(e) => setStart(e.target.value)}
                        />
                      ) : (
                        timeOfDayAU(row.startAt)
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {editing ? (
                        <Input
                          type="time"
                          aria-label="Finish time"
                          className="w-28"
                          value={end}
                          onChange={(e) => setEnd(e.target.value)}
                        />
                      ) : row.endAt ? (
                        timeOfDayAU(row.endAt)
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                        >
                          Still checked in
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtHours(entryHours(row.startAt, row.endAt))}
                    </TableCell>
                    <TableCell>
                      {row.unscheduled && <Badge variant="outline">Unscheduled</Badge>}
                    </TableCell>
                    <TableCell>
                      <Checkbox
                        checked={row.approved}
                        disabled={pending || row.endAt == null}
                        onCheckedChange={(checked) =>
                          run(() => setEntryApproved(dayRef, row.id, checked === true))
                        }
                        aria-label={`Approve hours for ${row.name}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {editing ? (
                        <span className="inline-flex gap-1">
                          <Button size="sm" onClick={() => saveEdit(row)} disabled={pending}>
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                            disabled={pending}
                          >
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-1">
                          {row.endAt == null && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEditor(row)}
                              disabled={pending}
                            >
                              Set finish
                            </Button>
                          )}
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => openEditor(row)}
                            disabled={pending}
                            aria-label={`Edit hours for ${row.name}`}
                          >
                            <PencilIcon />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => remove(row)}
                            disabled={pending}
                            aria-label={`Delete entry for ${row.name}`}
                          >
                            <Trash2Icon />
                          </Button>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Changing the times on an approved entry clears its tick, so changed hours are approved again.
      </p>
    </section>
  )
}
```

- [ ] **Step 4: Write the Approve day button**

Create `src/app/(office)/site-days/[kind]/[id]/[date]/approve-day-button.tsx`:

```tsx
'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { CheckCheckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DayRef } from '@/lib/site-days'
import { approveDay } from '@/app/(office)/site-days/actions'

export function ApproveDayButton({ dayRef, todo }: { dayRef: DayRef; todo: number }) {
  const [pending, startTransition] = useTransition()

  function onClick() {
    startTransition(async () => {
      const result = await approveDay(dayRef)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Hours approved')
    })
  }

  return (
    <Button onClick={onClick} disabled={pending || todo === 0}>
      <CheckCheckIcon />
      {pending ? 'Approving…' : 'Approve day'}
    </Button>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/site-days-crew-hours.test.tsx`
Expected: PASS — `Test Files  1 passed (1)`, 6 tests.

If the "an open entry cannot be approved" test fails because the Base UI checkbox marks a disabled box with `data-disabled` only, change that test's assertion to `expect(box.hasAttribute('data-disabled') || box.getAttribute('aria-disabled') === 'true' || box.hasAttribute('disabled')).toBe(true)` and re-run. Do not change the component.

- [ ] **Step 6: Type check**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(office)/site-days/[kind]/[id]/[date]/crew-hours.tsx" "src/app/(office)/site-days/[kind]/[id]/[date]/approve-day-button.tsx" tests/site-days-crew-hours.test.tsx
git commit -m "feat(site-days): crew and hours section with edit, add and approve" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 7: Day page and the remaining sections

**Files:**
- Create: `src/app/(office)/site-days/[kind]/[id]/[date]/materials-log.tsx`
- Create: `src/app/(office)/site-days/[kind]/[id]/[date]/prestart-forms.tsx`
- Create: `src/app/(office)/site-days/[kind]/[id]/[date]/swms-signon.tsx`
- Create: `src/app/(office)/site-days/[kind]/[id]/[date]/diary-summary.tsx`
- Create: `src/app/(office)/site-days/[kind]/[id]/[date]/photos-dockets.tsx`
- Create: `src/app/(office)/site-days/[kind]/[id]/[date]/waste-loads.tsx`
- Create: `src/app/(office)/site-days/[kind]/[id]/[date]/page.tsx`

**Interfaces:**
- Consumes from Task 1: `DayRef`, `UsageLine`, `approveChip`, `describeUsage`, `isIsoDate`, `isWorkKind`, `materialsEditable`, `summariseHours`, `timeOfDayAU`.
- Consumes from Task 2: `loadDayDetail`, `DayDetail`.
- Consumes from Task 4: `addUsageLine`, `updateUsageLine`, `deleteUsageLine`, `saveWorkSummary`.
- Consumes from Task 6: `CrewHours`, `ApproveDayButton`.
- Consumes existing: `buildSignoff(kind: string, id: string, date: string): Promise<{ error?: string; id?: string }>` from `src/lib/signoff-actions.ts` (admin and office only — do not reimplement it); `SignoffStatusBadge`; `PageHeader`; `fmtDate`; `WASTE_CLASSIFICATION_LABELS`, `WASTE_UNIT_LABELS`, `WasteClassification`, `WasteUnitKey` from `src/lib/zod.ts`.
- Produces: the route `/site-days/[kind]/[id]/[date]`.

Existing office destinations these sections link to: a form opens at `/whs/forms?highlight={submissionId}`; a waste load at `/whs/env/loads/{id}`; a project's diary at `/projects/{id}/diary`; a job's photos at `/jobs/{id}#photos`; a project's documents at `/projects/{id}/documents`; a sign-off at `/signoffs/{id}`.

- [ ] **Step 1: Write the materials section**

Create `src/app/(office)/site-days/[kind]/[id]/[date]/materials-log.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SignoffStatusBadge } from '@/components/signoffs/SignoffStatusBadge'
import { buildSignoff } from '@/lib/signoff-actions'
import { describeUsage, materialsEditable, type DayRef, type UsageLine } from '@/lib/site-days'
import {
  addUsageLine,
  deleteUsageLine,
  saveWorkSummary,
  updateUsageLine,
} from '@/app/(office)/site-days/actions'

type Result = { error?: string }
type Kind = UsageLine['kind']

const KIND_LABELS: Record<Kind, string> = {
  material: 'Material',
  plant: 'Plant',
  subbie: 'Subbie',
}

type Draft = {
  kind: Kind
  description: string
  qty: string
  unit: string
  company: string
  headcount: string
  hours: string
}

const EMPTY: Draft = {
  kind: 'material',
  description: '',
  qty: '',
  unit: '',
  company: '',
  headcount: '',
  hours: '',
}

const num = (s: string): number | null => (s.trim() === '' ? null : Number(s))
const text = (n: number | null): string => (n === null ? '' : String(n))

function toInput(d: Draft) {
  return {
    kind: d.kind,
    description: d.description,
    qty: num(d.qty),
    unit: d.unit.trim() || null,
    company: d.company.trim() || null,
    headcount: num(d.headcount),
    hours: num(d.hours),
  }
}

function fromLine(l: UsageLine): Draft {
  return {
    kind: l.kind,
    description: l.description,
    qty: text(l.qty),
    unit: l.unit ?? '',
    company: l.company ?? '',
    headcount: text(l.headcount),
    hours: text(l.hours),
  }
}

/** The fields for one line; the type is fixed when editing. */
function LineFields({
  draft,
  onChange,
  lockKind,
}: {
  draft: Draft
  onChange: (d: Draft) => void
  lockKind: boolean
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs font-medium">
        Type
        <select
          aria-label="Line type"
          className="h-8 rounded-lg border bg-background px-2 text-sm"
          value={draft.kind}
          disabled={lockKind}
          onChange={(e) => set({ kind: e.target.value as Kind })}
        >
          <option value="material">Material</option>
          <option value="plant">Plant</option>
          <option value="subbie">Subbie</option>
        </select>
      </label>
      {draft.kind === 'subbie' ? (
        <>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Company
            <Input
              aria-label="Company"
              className="w-52"
              value={draft.company}
              onChange={(e) => set({ company: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            People
            <Input
              type="number"
              min={1}
              step={1}
              aria-label="People"
              className="w-20"
              value={draft.headcount}
              onChange={(e) => set({ headcount: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Hours
            <Input
              type="number"
              min={0}
              step="0.25"
              aria-label="Hours"
              className="w-20"
              value={draft.hours}
              onChange={(e) => set({ hours: e.target.value })}
            />
          </label>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Item
            <Input
              aria-label="Item"
              className="w-64"
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            {draft.kind === 'plant' ? 'Hours' : 'Qty'}
            <Input
              type="number"
              min={0}
              step="any"
              aria-label="Quantity"
              className="w-24"
              value={draft.qty}
              onChange={(e) => set({ qty: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Unit
            <Input
              aria-label="Unit"
              className="w-20"
              placeholder={draft.kind === 'plant' ? 'hrs' : ''}
              value={draft.unit}
              onChange={(e) => set({ unit: e.target.value })}
            />
          </label>
        </>
      )}
    </div>
  )
}

export function MaterialsLog({
  dayRef,
  lines,
  summary,
  signoff,
  canBuild,
}: {
  dayRef: DayRef
  lines: UsageLine[]
  summary: string
  signoff: { id: string; status: string } | null
  /** Admin and office only — the existing sign-off rule. */
  canBuild: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [adding, setAdding] = useState(false)
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY)
  const [summaryText, setSummaryText] = useState(summary)

  const editable = materialsEditable(signoff)

  function run(action: () => Promise<Result>, done?: () => void) {
    startTransition(async () => {
      const result = await action()
      if (result.error) {
        toast.error(result.error)
        return
      }
      done?.()
    })
  }

  function build() {
    startTransition(async () => {
      const result = await buildSignoff(dayRef.kind, dayRef.workId, dayRef.date)
      if (result.error || !result.id) {
        toast.error(result.error ?? 'Could not build the sign-off')
        return
      }
      router.push(`/signoffs/${result.id}`)
    })
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Materials, plant and subbies</h2>
        <div className="flex flex-wrap items-center gap-2">
          {signoff ? (
            <>
              <SignoffStatusBadge status={signoff.status} />
              <Button variant="outline" size="sm" render={<Link href={`/signoffs/${signoff.id}`} />}>
                Open sign-off
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAdding((v) => !v)}
                disabled={pending}
              >
                <PlusIcon />
                Add line
              </Button>
              {canBuild && (
                <Button variant="outline" size="sm" onClick={build} disabled={pending}>
                  Build sign-off
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {!editable && (
        <p className="text-sm text-muted-foreground">
          This day has a sign-off, so the log is read-only here. Change the figures in the sign-off.
        </p>
      )}

      {editable && adding && (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <LineFields draft={newDraft} onChange={setNewDraft} lockKind={false} />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  () => addUsageLine(dayRef, toInput(newDraft)),
                  () => {
                    setAdding(false)
                    setNewDraft(EMPTY)
                  }
                )
              }
            >
              Add
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing was logged on this day.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Logged by</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => {
                const shown = describeUsage(line)
                if (editable && editingId === line.id) {
                  return (
                    <TableRow key={line.id}>
                      <TableCell colSpan={5}>
                        <div className="flex flex-col gap-2">
                          <LineFields draft={draft} onChange={setDraft} lockKind />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              disabled={pending}
                              onClick={() =>
                                run(
                                  () => updateUsageLine(dayRef, line.id, toInput(draft)),
                                  () => setEditingId(null)
                                )
                              }
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() => setEditingId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                }
                return (
                  <TableRow key={line.id}>
                    <TableCell>
                      <Badge variant="outline">{KIND_LABELS[line.kind]}</Badge>
                    </TableCell>
                    <TableCell>{shown.item}</TableCell>
                    <TableCell className="tabular-nums">{shown.qty}</TableCell>
                    <TableCell className="text-muted-foreground">{line.loggedBy ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      {editable && (
                        <span className="inline-flex gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            disabled={pending}
                            aria-label={`Edit ${shown.item}`}
                            onClick={() => {
                              setDraft(fromLine(line))
                              setEditingId(line.id)
                            }}
                          >
                            <PencilIcon />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            disabled={pending}
                            aria-label={`Delete ${shown.item}`}
                            onClick={() => {
                              if (!confirm(`Delete ${shown.item}?`)) return
                              run(() => deleteUsageLine(dayRef, line.id))
                            }}
                          >
                            <Trash2Icon />
                          </Button>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Work summary</h3>
        {editable ? (
          <>
            <Textarea
              aria-label="Work summary"
              rows={3}
              maxLength={4000}
              value={summaryText}
              onChange={(e) => setSummaryText(e.target.value)}
            />
            <div>
              <Button
                size="sm"
                variant="outline"
                disabled={pending || summaryText.trim() === summary}
                onClick={() =>
                  run(
                    () => saveWorkSummary(dayRef, summaryText),
                    () => toast.success('Summary saved')
                  )
                }
              >
                Save summary
              </Button>
            </div>
          </>
        ) : (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {summary || 'No summary was written.'}
          </p>
        )}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Write the pre-start and forms section**

Create `src/app/(office)/site-days/[kind]/[id]/[date]/prestart-forms.tsx`:

```tsx
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { timeOfDayAU } from '@/lib/site-days'
import type { DayDetail } from '@/lib/site-days-queries'

export function PrestartForms({
  hasHours,
  prestart,
  otherForms,
}: {
  hasHours: boolean
  prestart: DayDetail['prestart']
  otherForms: DayDetail['otherForms']
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Pre-start and forms</h2>
        {prestart ? (
          <Badge
            variant="outline"
            className="border-green-200 bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
          >
            Pre-start done {timeOfDayAU(prestart.submittedAt)}
          </Badge>
        ) : hasHours ? (
          <Badge
            variant="outline"
            className="border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
          >
            No pre-start
          </Badge>
        ) : null}
      </div>

      {prestart ? (
        <div className="text-sm">
          <p>
            Submitted by {prestart.submittedBy}.{' '}
            <Link href={`/whs/forms?highlight=${prestart.id}`} className="underline underline-offset-2">
              Open form
            </Link>
          </p>
          <p className="text-muted-foreground">
            {prestart.signons.length > 0
              ? `Signed on: ${prestart.signons.join(', ')}`
              : 'Nobody has signed on.'}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {hasHours
            ? 'Hours were recorded on this day but no pre-start meeting was filed.'
            : 'No pre-start meeting was filed.'}
        </p>
      )}

      {otherForms.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border text-sm">
          {otherForms.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span>
                {f.name} <span className="text-muted-foreground">· {f.kindLabel}</span>
              </span>
              <span className="flex items-center gap-3 text-muted-foreground">
                {f.submittedBy} · {timeOfDayAU(f.submittedAt)}
                <Link
                  href={`/whs/forms?highlight=${f.id}`}
                  className="text-foreground underline underline-offset-2"
                >
                  Open
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        A submitted form cannot be changed. Its author corrects it with Amend, which keeps the original.
      </p>
    </section>
  )
}
```

- [ ] **Step 3: Write the SWMS section**

Create `src/app/(office)/site-days/[kind]/[id]/[date]/swms-signon.tsx`:

```tsx
import type { DayDetail } from '@/lib/site-days-queries'

export function SwmsSignon({
  swms,
  crewCount,
}: {
  swms: DayDetail['swms']
  crewCount: number
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">SWMS</h2>
      {swms.length === 0 ? (
        <p className="text-sm text-muted-foreground">No SWMS is active on this work.</p>
      ) : crewCount === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody has hours on this day, so there is no crew to check.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border text-sm">
          {swms.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                {s.title} <span className="text-muted-foreground">· v{s.version}</span>
              </span>
              {s.unsigned.length === 0 ? (
                <span className="text-green-700 dark:text-green-300">All signed</span>
              ) : (
                <span className="text-amber-700 dark:text-amber-300">
                  Not signed: {s.unsigned.join(', ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Write the diary section**

Create `src/app/(office)/site-days/[kind]/[id]/[date]/diary-summary.tsx`:

```tsx
import Link from 'next/link'
import type { DayDetail } from '@/lib/site-days-queries'

export function DiarySummary({
  projectId,
  diary,
}: {
  projectId: string
  diary: DayDetail['diary']
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Diary</h2>
        <Link href={`/projects/${projectId}/diary`} className="text-sm underline underline-offset-2">
          Open the diary
        </Link>
      </div>
      {diary ? (
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Weather</dt>
          <dd>{diary.weather || '—'}</dd>
          <dt className="text-muted-foreground">Work performed</dt>
          <dd className="whitespace-pre-wrap">{diary.workPerformed || '—'}</dd>
          <dt className="text-muted-foreground">Delays</dt>
          <dd className="whitespace-pre-wrap">{diary.delays || '—'}</dd>
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">No diary entry for this day.</p>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Write the photos and dockets section**

Create `src/app/(office)/site-days/[kind]/[id]/[date]/photos-dockets.tsx`:

```tsx
import Link from 'next/link'
import type { DayDetail } from '@/lib/site-days-queries'

export function PhotosDockets({
  files,
  allHref,
}: {
  files: DayDetail['files']
  /** Where the full set lives: the job's Photos section or the project's Documents tab. */
  allHref: string
}) {
  const photos = files.filter((f) => f.kind === 'photo')
  const dockets = files.filter((f) => f.kind === 'docket')
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Photos and dockets</h2>
        <Link href={allHref} className="text-sm underline underline-offset-2">
          All photos
        </Link>
      </div>
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing was uploaded on this day.</p>
      ) : (
        <>
          {photos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {photos.map((p) =>
                p.signedUrl ? (
                  <a key={p.id} href={p.signedUrl} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.signedUrl}
                      alt={p.filename}
                      className="size-20 rounded-md border object-cover"
                    />
                  </a>
                ) : (
                  <span
                    key={p.id}
                    className="flex size-20 items-center justify-center rounded-md border text-xs text-muted-foreground"
                  >
                    {p.filename}
                  </span>
                )
              )}
            </div>
          )}
          {dockets.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {dockets.map((d) => (
                <li key={d.id}>
                  {d.signedUrl ? (
                    <a
                      href={d.signedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2"
                    >
                      Docket: {d.filename}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">Docket: {d.filename}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 6: Write the waste loads section**

Create `src/app/(office)/site-days/[kind]/[id]/[date]/waste-loads.tsx`:

```tsx
import Link from 'next/link'
import {
  WASTE_CLASSIFICATION_LABELS,
  WASTE_UNIT_LABELS,
  type WasteClassification,
  type WasteUnitKey,
} from '@/lib/zod'
import type { DayDetail } from '@/lib/site-days-queries'

export function WasteLoads({ loads }: { loads: DayDetail['wasteLoads'] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Waste loads</h2>
      {loads.length === 0 ? (
        <p className="text-sm text-muted-foreground">No waste loads were logged on this day.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border text-sm">
          {loads.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span>
                <span className="font-mono text-xs text-muted-foreground">{l.number}</span>{' '}
                {WASTE_CLASSIFICATION_LABELS[l.classification as WasteClassification] ?? l.classification}
                {' · '}
                {l.qty} {WASTE_UNIT_LABELS[l.unit as WasteUnitKey] ?? l.unit}
              </span>
              <Link href={`/whs/env/loads/${l.id}`} className="underline underline-offset-2">
                Open load
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 7: Write the day page**

Create `src/app/(office)/site-days/[kind]/[id]/[date]/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { fmtDate } from '@/lib/format'
import {
  approveChip,
  isIsoDate,
  isWorkKind,
  summariseHours,
  type DayRef,
} from '@/lib/site-days'
import { loadDayDetail } from '@/lib/site-days-queries'
import { ApproveDayButton } from './approve-day-button'
import { CrewHours } from './crew-hours'
import { DiarySummary } from './diary-summary'
import { MaterialsLog } from './materials-log'
import { PhotosDockets } from './photos-dockets'
import { PrestartForms } from './prestart-forms'
import { SwmsSignon } from './swms-signon'
import { WasteLoads } from './waste-loads'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function SiteDayPage({
  params,
}: {
  params: Promise<{ kind: string; id: string; date: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const { kind, id, date } = await params
  if (!isWorkKind(kind) || !UUID_RE.test(id) || !isIsoDate(date)) notFound()

  const supabase = await createClient()
  const day = await loadDayDetail(supabase, kind, id, date)
  if (!day) notFound()

  const dayRef: DayRef = { kind, workId: id, date }
  const hours = summariseHours(
    day.entries.map((e) => ({
      userId: e.userId,
      startAt: e.startAt,
      endAt: e.endAt,
      approved: e.approved,
    }))
  )
  const chip = approveChip(hours)
  const todo = hours.closed - hours.approved
  const crewCount = hours.people
  const workHref = kind === 'job' ? `/jobs/${id}` : `/projects/${id}`
  const photosHref = kind === 'job' ? `/jobs/${id}#photos` : `/projects/${id}/documents`
  const canBuild = profile.role === 'admin' || profile.role === 'office'
  const dayHref = (d: string) => `/site-days/${kind}/${id}/${d}`

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <PageHeader
          title={`${day.work.number} — ${day.work.title}`}
          description={`Site day · ${fmtDate(date)}${day.work.client ? ` · ${day.work.client}` : ''}`}
          actions={<ApproveDayButton dayRef={dayRef} todo={todo} />}
        />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button variant="outline" size="sm" render={<Link href={`/site-days?date=${date}`} />}>
            All jobs this day
          </Button>
          <Button variant="outline" size="sm" render={<Link href={workHref} />}>
            Open {kind}
          </Button>
          {day.prevDate && (
            <Button variant="outline" size="sm" render={<Link href={dayHref(day.prevDate)} />}>
              <ChevronLeftIcon />
              {fmtDate(day.prevDate)}
            </Button>
          )}
          {day.nextDate && (
            <Button variant="outline" size="sm" render={<Link href={dayHref(day.nextDate)} />}>
              {fmtDate(day.nextDate)}
              <ChevronRightIcon />
            </Button>
          )}
          <Badge
            variant="outline"
            className={
              chip.done
                ? 'border-green-200 bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
                : 'border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
            }
          >
            {chip.text}
          </Badge>
        </div>
      </div>

      <div className="border-t" />
      <CrewHours dayRef={dayRef} rows={day.entries} people={day.people} />

      <div className="border-t" />
      <PrestartForms
        hasHours={hours.closed + hours.open > 0}
        prestart={day.prestart}
        otherForms={day.otherForms}
      />

      <div className="border-t" />
      <SwmsSignon swms={day.swms} crewCount={crewCount} />

      <div className="border-t" />
      <MaterialsLog
        dayRef={dayRef}
        lines={day.usage}
        summary={day.summary}
        signoff={day.signoff ? { id: day.signoff.id, status: day.signoff.status } : null}
        canBuild={canBuild}
      />

      {kind === 'project' && (
        <>
          <div className="border-t" />
          <DiarySummary projectId={id} diary={day.diary} />
        </>
      )}

      <div className="border-t" />
      <PhotosDockets files={day.files} allHref={photosHref} />

      <div className="border-t" />
      <WasteLoads loads={day.wasteLoads} />
    </div>
  )
}
```

- [ ] **Step 8: Type check and run the suite**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0.

Run: `npx vitest run`
Expected: every test file passes.

- [ ] **Step 9: Lint the new files**

Run: `npx eslint "src/app/(office)/site-days" src/lib/site-days.ts src/lib/site-days-queries.ts`
Expected: no output, exit code 0.

- [ ] **Step 10: Confirm no dollars reach the screen**

Run: `Get-ChildItem -Recurse "src/app/(office)/site-days" -Include *.tsx,*.ts | Select-String -Pattern 'cost_rate|hourly_cost|aud\(|contract_price|unit_sell'`
Expected: no matches.

- [ ] **Step 11: Commit**

```bash
git add "src/app/(office)/site-days/[kind]"
git commit -m "feat(site-days): day page with pre-start, SWMS, materials, diary, photos and waste" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 8: Entry points on the job page and the project tabs

**Files:**
- Create: `src/components/site-days/SiteDaysRecent.tsx`
- Modify: `src/app/(office)/jobs/[id]/page.tsx` (import near line 13; section before the `{/* Daily sign-offs */}` comment near line 375)
- Create: `src/app/(office)/projects/[id]/site-days/page.tsx`
- Modify: `src/app/(office)/projects/[id]/project-tabs.tsx:27-28`

**Interfaces:**
- Consumes from Task 1: `WorkKind`, `fmtHours`, `hoursLabel`.
- Consumes from Task 2: `loadRecentDays(sb, kind, id, limit?): Promise<RecentDay[]>`.
- Produces: `export async function SiteDaysRecent(props: { kind: WorkKind; workId: string }): Promise<JSX.Element>` — an async server component, used the same way as `SignoffRegister`.

- [ ] **Step 1: Write the shared recent-days table**

Create `src/components/site-days/SiteDaysRecent.tsx`:

```tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SignoffStatusBadge } from '@/components/signoffs/SignoffStatusBadge'
import { fmtDate } from '@/lib/format'
import { fmtHours, hoursLabel, type WorkKind } from '@/lib/site-days'
import { loadRecentDays } from '@/lib/site-days-queries'

/** The last 14 days on which this job or project had hours or a materials-log line. */
export async function SiteDaysRecent({ kind, workId }: { kind: WorkKind; workId: string }) {
  const supabase = await createClient()
  const days = await loadRecentDays(supabase, kind, workId, 14)

  if (days.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing has been recorded in the field on this {kind} yet.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Day</TableHead>
            <TableHead>Crew</TableHead>
            <TableHead>Hours</TableHead>
            <TableHead className="text-right">Logged</TableHead>
            <TableHead>Sign-off</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {days.map((d) => {
            const href = `/site-days/${kind}/${workId}/${d.date}`
            const hasHours = d.hours.closed + d.hours.open > 0
            return (
              <TableRow key={d.date}>
                <TableCell>
                  <Link href={href} className="font-medium hover:underline">
                    {fmtDate(d.date)}
                  </Link>
                </TableCell>
                <TableCell className="tabular-nums">
                  {hasHours ? `${d.hours.people} · ${fmtHours(d.hours.totalHours)} h` : '—'}
                </TableCell>
                <TableCell>{hoursLabel(d.hours)}</TableCell>
                <TableCell className="text-right tabular-nums">{d.usageCount || '—'}</TableCell>
                <TableCell>
                  {d.signoff ? (
                    <SignoffStatusBadge status={d.signoff.status} />
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Link href={href} className="text-sm hover:underline">
                    Open
                  </Link>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
```

- [ ] **Step 2: Add the section to the job page**

In `src/app/(office)/jobs/[id]/page.tsx`, add this import directly under the existing `SignoffRegister` import:

```ts
import { SiteDaysRecent } from '@/components/site-days/SiteDaysRecent'
```

In the same file, find this block:

```tsx
      <div className="border-t" />

      {/* Daily sign-offs */}
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Daily sign-offs</h2>
```

and replace it with:

```tsx
      <div className="border-t" />

      {/* Site days — what the crew recorded, by day */}
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Site days</h2>
        <SiteDaysRecent kind="job" workId={job.id} />
      </section>

      <div className="border-t" />

      {/* Daily sign-offs */}
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Daily sign-offs</h2>
```

- [ ] **Step 3: Add the project tab page**

Create `src/app/(office)/projects/[id]/site-days/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { SiteDaysRecent } from '@/components/site-days/SiteDaysRecent'

export default async function ProjectSiteDaysPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('admin', 'office', 'supervisor')
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase.from('projects').select('id').eq('id', id).maybeSingle()
  if (!project) notFound()

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">Site days</h2>
      <SiteDaysRecent kind="project" workId={id} />
    </section>
  )
}
```

- [ ] **Step 4: Add the tab**

In `src/app/(office)/projects/[id]/project-tabs.tsx`, replace these two lines of `TABS`:

```ts
  { label: 'Diary', suffix: '/diary' },
  { label: 'Sign-offs', suffix: '/signoffs' },
```

with:

```ts
  { label: 'Diary', suffix: '/diary' },
  { label: 'Site days', suffix: '/site-days' },
  { label: 'Sign-offs', suffix: '/signoffs' },
```

- [ ] **Step 5: Type check, test, lint**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0.

Run: `npx vitest run`
Expected: every test file passes.

Run: `npx eslint src/components/site-days "src/app/(office)/projects/[id]/site-days" "src/app/(office)/projects/[id]/project-tabs.tsx" "src/app/(office)/jobs/[id]/page.tsx"`
Expected: no new errors (the job page may carry pre-existing warnings; none may come from the lines added here).

- [ ] **Step 6: Commit**

```bash
git add src/components/site-days "src/app/(office)/jobs/[id]/page.tsx" "src/app/(office)/projects/[id]/site-days" "src/app/(office)/projects/[id]/project-tabs.tsx"
git commit -m "feat(site-days): job page section and project tab" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 9: Apply the migration and prove it live

**Files:** none created. This task changes production data and is gated on the owner.

**Interfaces:**
- Consumes: everything above.
- Produces: evidence that each office bullet under "Proof" in the spec holds, and a clean database afterwards.

The local test logins (an admin, a supervisor and two field users) and the Supabase project are recorded in the project memory file `entice-project-state.md`. Do not write passwords into this plan, a commit or a chat message.

- [ ] **Step 1: Stop and ask the owner**

Ask the owner, in these words: "The Site days code is built. It needs migration 0079 (an audit trigger on timesheets and the materials log) applied to the live database, and a short test on a zz job that I will delete afterwards. OK to apply 0079 and run the test?"

Do not continue until the owner says yes. If the owner says no to the migration but yes to the test, skip Step 2 and the audit checks in Step 7, and say so in the report.

- [ ] **Step 2: Apply migration 0079**

Apply the contents of `supabase/migrations/0079_site_days_audit.sql` through the `ecr-portal` database tool's SQL call (call its `help` tool first; it documents the guardrails), as one statement batch.

Then look at the most recent history row to copy its shape:

```sql
select * from supabase_migrations.schema_migrations order by version desc limit 1;
```

Insert the history row with the same columns that row uses, with version `20261120091000` and name `0079_site_days_audit`.

Verify:

```sql
select tgname, tgrelid::regclass from pg_trigger
where tgname in ('timesheet_entries_audit', 'field_usage_audit');
```

Expected: two rows, one per table.

- [ ] **Step 3: Record the work-number counter**

```sql
select key, next_value from sequences where key like 'work_number%';
```

Write down the `key` and `next_value` returned. The zz job created next consumes one number; Step 9 puts it back.

- [ ] **Step 4: Start the app**

Run in a terminal, in the worktree:

```bash
$env:NODE_EXTRA_CA_CERTS = 'C:\Users\nickj\norton-ssl-root-ca.pem'; npx next dev -p 3100
```

Expected: `Ready` and `http://localhost:3100`. If pages 404 as HTML, delete `.next/dev` and restart.

- [ ] **Step 5: Seed a zz job-day using today's screens**

Signed in as the admin at `http://localhost:3100`:

1. Jobs → New job. Title `zz Site days proof`. Any client. Save, then use the status actions to schedule it for today.
2. Schedule → assign one field user to that job for today.

Signed in as that field user at `http://localhost:3100/field`:

3. My Day → Check in on the zz job. Leave it checked in (this is the open entry).
4. On the job card, Log materials & plant → add one material (`zz plastic`, qty 2, unit `rolls`) and one subbie (`zz Scaffold`, 2 people, 4 hours). Write a work summary `zz summary`.
5. Safety → the pre-start meeting form → pick the zz job → submit.

The browser pane suppresses `confirm()`. Before any delete click in the steps below, run `window.confirm = () => true` in the page.

- [ ] **Step 6: Prove the office bullets**

Signed in as the admin. Tick each as it is seen.

1. **The day list.** Open Site days. The zz job is listed for today with crew `1`, Hours `Still checked in`, Pre-start `Done HH:MM`, Logged `2`, Sign-off `None`.
2. **Close the open entry.** Open the zz row. In Crew and hours press Set finish, enter a finish time later than the start, Save. The row now shows a finish time and hours; the Still checked in badge is gone.
3. **Correct a finish time.** Press the pencil on the same row, move the finish by ten minutes, Save. Hours change accordingly.
4. **Add an entry for a second person.** Add entry → pick the supervisor → start `07:00`, finish `15:00` → Add. A second row appears tagged `Unscheduled`.
5. **Approve day.** Press Approve day. Both ticks are on and the chip reads `Hours approved`.
6. **Reports agree.** Reports → Timesheets, this week: both people show the same entries with Approved ticked.
7. **Job P&L picked up the labour.** Open the zz job page as admin → Costs & P&L: the labour line reflects the approved hours. If the test users have no hourly cost set in Settings, the cost shows as zero; confirm instead with `select approved, cost_rate is not null as rated from timesheet_entries where job_id = :job` that both rows are approved. (The P&L panel is the existing admin-only screen; it is the only place a dollar figure appears, and it is not part of Site days.)
8. **Editing approved hours clears the tick.** Back on the day page, change the supervisor's finish to `15:30`, Save. That row's tick is off and the chip reads `1 of 2 hours to approve`. Approve day again.
9. **Edit a materials line.** In Materials, plant and subbies press the pencil on `zz plastic`, change qty to 3, Save. The row reads `3 rolls`.
10. **Build the sign-off and see the lock.** Press Build sign-off. The sign-off page opens with the hours and both lines. Go back to the day page: the section shows the Draft badge and Open sign-off, has no pencils, and says the log is read-only.
11. **The job page.** Open the zz job page: the Site days section lists today with a link to the day page.

- [ ] **Step 7: Prove the edit trail**

Signed in as the admin, WHS → Audit log, filter Type to `Timesheet entry`, then `Materials log line`.

Expected for today, each with the right actor name:

- Timesheet entry: an `insert` for the field user's check-in (summary like `2026-11-20 06:42 to still checked in`), `update` rows for the finish time set and corrected, an `insert` by the admin for the supervisor's entry, and `update` rows for each approval and the un-approval.
- Materials log line: `insert` rows by the field user and an `update` by the admin showing `qty: 2 → 3`.

Then confirm no money was logged:

```sql
select count(*) from audit_log
where entity_type in ('timesheet_entries', 'field_usage')
  and detail::text ilike '%cost_rate%';
```

Expected: `0`.

- [ ] **Step 8: Prove a supervisor can do it and sees no dollars**

Sign out, sign in as the supervisor. Open Site days → the zz day page.

Expected: the page loads; every section is present; no dollar figure appears anywhere on `/site-days` or the day page; Build sign-off is not offered (a sign-off exists, so Open sign-off shows instead). Untick and re-tick one Approved box: it saves.

- [ ] **Step 9: Clean up**

Signed in as the admin:

1. Open the zz sign-off → Delete draft.
2. On the day page, delete both timesheet entries (the materials section is editable again once the draft is gone) and both materials lines; clear the work summary and Save summary.
3. Delete the pre-start submission, the schedule assignment and the zz job through the database tool, in this order, replacing `:job` with the zz job's id:

```sql
delete from form_submissions where job_id = :job;
delete from field_day_notes where job_id = :job;
delete from field_usage where job_id = :job;
delete from timesheet_entries where job_id = :job;
delete from assignments where job_id = :job;
delete from jobs where id = :job and title = 'zz Site days proof';
```

4. Put the counter back to the value recorded in Step 3:

```sql
update sequences set next_value = <recorded next_value> where key = '<recorded key>';
```

5. Verify nothing is left:

```sql
select count(*) from jobs where title like 'zz %';
```

Expected: `0`.

The `audit_log` rows for the zz records stay. The log is append-only by design and they are harmless.

- [ ] **Step 10: Report**

Tell the owner, in plain words: which of the eleven checks in Step 6 passed, what the audit log showed, that the supervisor check passed, that the zz records are gone and the counter is back to its recorded value, and that nothing has been pushed. Ask whether to push the branch.

---

## Self-Review

**Spec coverage** — each requirement in "Office side: Site days" and where it is built:

| Spec requirement | Task |
|---|---|
| `/site-days` day list, day picker, one row per job with activity | 2, 5 |
| Columns Job, Crew, Hours, Pre-start, Logged, Photos, Sign-off | 5 |
| Attention rows first (open check-in from a past day, hours with no pre-start, unapproved hours) | 1, 2, 5 |
| Site days in the office menu | 5 |
| Job page section, last 14 days with activity | 2, 8 |
| Project tab beside Diary and Sign-offs | 8 |
| Day page with previous / next between days with activity | 2, 7 |
| Approve day in the header | 4, 6, 7 |
| Crew and hours: row per entry, Unscheduled tag, Approved tick | 6 |
| Edit start and finish, add an entry, delete one | 4, 6 |
| Open entry flagged "Still checked in" with Set finish time | 6 |
| Editing an approved entry clears its approval | 4 |
| Pre-start: who, when, names signed on, warning when hours but no pre-start | 2, 7 |
| Other forms that day, linking to the existing form view; forms stay unchangeable | 2, 7 |
| SWMS: each person with hours, whether they signed the current version | 2, 7 |
| Materials log as entered, with who logged each line, and the work summary | 2, 7 |
| Editable before a sign-off exists; read-only with a link after | 1, 4, 7 |
| Build sign-off / Open sign-off, reusing the existing build | 7 |
| Diary (projects), with a link to the Diary tab | 2, 7 |
| Photos and dockets for the day | 2, 7 |
| Waste loads for the day, linking to the existing page | 2, 7 |
| Hours approval uses the existing flag; Reports → Timesheets keeps working | 4 (reuses `approveTimesheetEntry`), 9 |
| Edit trail on `timesheet_entries` and `field_usage`; two new audit labels | 3 |
| Admin, office and supervisor; no dollars | 4, 5, 7 (guards and grep checks), 9 |
| Office bullets under Proof | 9 |

Not built here, by design: the "Source changed" badge already exists in `SignoffRegister` and needs no change; migration 0078 and everything under `/field` belong to the field plan.

**Placeholder scan** — no step says TBD, "add validation", or "similar to". Every code step shows its code. Two steps contain a conditional instruction rather than a guess (Task 6 Step 5 on the checkbox's disabled attribute; Task 9 Step 2 on the history row's columns), each with the exact fallback to apply.

**Type consistency** — names checked across tasks: `DayRef { kind, workId, date }` is used identically by the actions (Task 4), `CrewHours` and `ApproveDayButton` (Task 6), `MaterialsLog` and the page (Task 7). `CrewEntry` and `UsageLine` are defined once in Task 1 and produced by `loadDayDetail` in Task 2. Action names `setEntryApproved`, `updateEntryTimes`, `addTimesheetEntry`, `deleteTimesheetEntry`, `approveDay`, `addUsageLine`, `updateUsageLine`, `deleteUsageLine`, `saveWorkSummary` match between Task 4, the component imports, and the test mock in Task 6. `loadDayList`, `loadRecentDays`, `loadDayDetail` match between Task 2 and Tasks 5, 7, 8.

**Known limits, stated so nobody is surprised:**

- A shift that crosses midnight cannot be entered or corrected here (`timesToInstants` requires the finish to be later the same day).
- Previous and next step between days that have hours or a materials-log line; a day with only a photo or a form is reachable from the day list, not from those buttons.
- The day page loads all of the job's photo and docket rows to pick out one day's, by reusing `fetchAttachmentsWithUrls`. Fine at today's volumes; narrow it if a job passes a few hundred files.
- For a project, the work summary edited here is `field_day_notes.summary`. The sign-off uses the diary's "work performed" when the project has a diary entry that day, and this summary only when it does not (existing rule in `loadSnapshotSource`).
