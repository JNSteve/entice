# Field Job-First Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the job the home of the field side: a Jobs list of every live job and project, a job screen with tabs wrapping the existing field screens, and check-in on any live job whether scheduled or not.

**Architecture:** One pure module (`src/lib/live-work.ts`) owns the definition of "live" and the list logic; a second (`src/lib/field-today.ts`) owns the Today checklist wording and hours maths. Thin server loaders in `src/lib/field-work-queries.ts` feed a nested route, `/field/work/[kind]/[id]`, whose layout draws the header and tab strip and whose child pages each reuse an existing client component (`UsageClient`, `DiaryForm`, `CaptureClient`, `FieldSwmsCard`). The old addresses become redirects.

**Tech Stack:** Next.js 16.2.9 App Router (server components, server actions), React 19.2.4, Supabase (Postgres + RLS + storage), Tailwind, base-ui buttons (`render={<Link … />}`), zod, lucide-react, sonner, vitest 4.

**Spec:** `docs/superpowers/specs/2026-11-20-field-job-first-design.md` — build steps 1 to 5. Steps 6 and 7 (office Site days) are a separate plan: `docs/superpowers/plans/2026-11-20-office-site-days.md`.

## Global Constraints

- **AGENTS.md:** "This is NOT the Next.js you know. This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices." Before any route work read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md`, `dynamic-routes.md`, `page.md`, and `01-app/03-api-reference/04-functions/redirect.md`, `revalidatePath.md`, `use-pathname.md`. In this version `params` and `searchParams` are Promises and must be awaited (see any existing page under `src/app/field/`).
- **Live means:** jobs `scheduled`, `in_progress`, `completed`; projects `active`, `practical_completion`, `defects_liability`; never archived. Not live: `quote`, `lost`, `invoiced`, `paid`, `closed`.
- **Do not narrow the existing pickers.** The photo, safety-form and waste pickers keep their current, wider job filter.
- **Job and project numbers already carry their prefix** (`RJ26018`, `RP26020`, older `P-0014`). New code prints `number` as stored. Never prepend `J-` or `P-`.
- **Brisbane calendar day.** All "today" logic goes through `todayAU()` / `dateAU()` / `yesterdayAU()` / `auLocalToInstant()` in `src/lib/tz.ts`. Never derive a date from the server clock.
- **The database is production.** Any test record's title starts with `zz` and is deleted afterwards. Inserting a job consumes the work-number counter; roll it back after a test.
- **Migrations** are numbered files in `supabase/migrations/`. The next free number is `0078`. The history row uses a timestamp version (for example `20261120090000`, name `0078_attachment_field_visible`). Do not apply a migration to the live database without the owner's go-ahead.
- **This machine:** any command that reaches the network (dev server, `npm install`) needs the prefix `$env:NODE_EXTRA_CA_CERTS = 'C:\Users\nickj\norton-ssl-root-ca.pem';` in PowerShell. Unit tests and `tsc` do not.
- **Commands:** one test file `npx vitest run tests/<file>`; whole suite `npm test`; types `npx tsc --noEmit`; lint `npx eslint <paths>`.
- **Tests live in `tests/`**, import from `@/lib/...`, and use `describe / it / expect` from `vitest` (see `tests/job-records.test.ts`).
- **Commits:** one per task, on a feature branch (`feat/field-job-first`), never on `main`. End each message with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/live-work.ts` | new | Live status lists, kind parsing, tab list and links, Jobs-list grouping and search. Pure. |
| `tests/live-work.test.ts` | new | Unit tests for the above. |
| `src/lib/field-today.ts` | new | Today checklist rows, Brisbane time label, hours maths. Pure. |
| `tests/field-today.test.ts` | new | Unit tests for the above. |
| `src/lib/field-work-queries.ts` | new | Server loaders: live work, scheduled keys, open entry, job header, Today status. |
| `src/app/field/jobs/page.tsx`, `jobs-list.tsx` | new | Jobs list and its search box. |
| `src/app/field/work/[kind]/[id]/layout.tsx` | new | Header and tab strip. |
| `src/app/field/work/[kind]/[id]/work-tabs.tsx` | new | Tab strip (client). |
| `src/app/field/work/[kind]/[id]/page.tsx` | new | Today tab. |
| `src/app/field/work/[kind]/[id]/check-in-card.tsx` | new | Check in / check out / switch (client). |
| `src/app/field/work/[kind]/[id]/{prestart,swms,day,diary,photos,docs}/page.tsx` | new | One page per tab. |
| `src/app/field/use-elapsed.ts` | new | The elapsed-time hook, moved out of `my-day-client.tsx`. |
| `src/lib/zod.ts` | modify | `checkInSchema`, `manualEntrySchema` lose the required schedule link. |
| `tests/check-in-schema.test.ts` | new | Unit tests for the two schemas. |
| `src/app/field/actions.ts` | modify | `checkIn` on any live job, new `switchCheckIn`, manual entry fixed to Brisbane time. |
| `src/app/field/usage/page.tsx`, `diary/page.tsx`, `diary/[projectId]/page.tsx` | modify | Become redirects. |
| `src/app/field/usage/actions.ts`, `diary/[projectId]/actions.ts`, `(office)/projects/[id]/diary/actions.ts` | modify | Revalidate the new addresses. |
| `src/app/field/photo/capture-client.tsx` | modify | Optional fixed target. |
| `src/lib/swms-queries.ts` | modify | `fetchMyFieldSwms` takes an optional job filter. |
| `src/app/field/waste/page.tsx`, `waste-form.tsx` | modify | Accept `?job=`. |
| `src/app/field/safety/new/[templateId]/page.tsx`, `safety/submission/[id]/page.tsx` | modify | Back links return to the job. |
| `supabase/migrations/0078_attachment_field_visible.sql` | new | `attachments.field_visible`. |
| `src/lib/attachment-queries.ts`, `src/lib/attachments.ts`, `src/components/AttachmentList.tsx` | modify | Carry and toggle `field_visible`. |
| `src/app/(office)/jobs/[id]/page.tsx`, `(office)/projects/[id]/documents/page.tsx` | modify | Pass `canCrew`. |
| `src/app/(office)/reports/timesheets.tsx` | modify | Badge text "Manual" becomes "Unscheduled". |
| `src/app/field/field-tabs.tsx`, `page.tsx`, `my-day-client.tsx` | modify | Four-item bar and My Day changes. |

---

### Task 1: The definition of "live" and the Jobs-list logic

**Files:**
- Create: `src/lib/live-work.ts`
- Test: `tests/live-work.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `WorkKind`, `WorkTab`, `LiveWorkRow`, `LiveWorkGroups`, `LIVE_JOB_STATUSES`, `LIVE_PROJECT_STATUSES`, `WORK_STATUS_LABELS`, `isLiveWork(kind, status, archived)`, `parseWorkKind(value)`, `workKey(kind, id)`, `workHref(kind, id, tab?)`, `workTabs(kind)`, `groupLiveWork(rows, scheduledKeys)`, `searchLiveWork(rows, query)`.

- [ ] **Step 1: Write the failing test**

Create `tests/live-work.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  groupLiveWork,
  isLiveWork,
  parseWorkKind,
  searchLiveWork,
  workHref,
  workKey,
  workTabs,
  type LiveWorkRow,
} from '@/lib/live-work'

const row = (over: Partial<LiveWorkRow>): LiveWorkRow => ({
  kind: 'job',
  id: 'a',
  number: 'RJ26001',
  title: 'Eaves removal',
  status: 'in_progress',
  client: 'Acme Strata',
  site: 'Depot, Tomago',
  ...over,
})

describe('isLiveWork', () => {
  it('jobs are live from scheduled through completed', () => {
    for (const s of ['scheduled', 'in_progress', 'completed']) {
      expect(isLiveWork('job', s, false)).toBe(true)
    }
  })

  it('jobs are not live before acceptance or after invoicing', () => {
    for (const s of ['quote', 'lost', 'invoiced', 'paid']) {
      expect(isLiveWork('job', s, false)).toBe(false)
    }
  })

  it('projects are live until closed', () => {
    for (const s of ['active', 'practical_completion', 'defects_liability']) {
      expect(isLiveWork('project', s, false)).toBe(true)
    }
    expect(isLiveWork('project', 'closed', false)).toBe(false)
  })

  it('archived work is never live', () => {
    expect(isLiveWork('job', 'in_progress', true)).toBe(false)
    expect(isLiveWork('project', 'active', true)).toBe(false)
  })

  it('a job status is not valid for a project', () => {
    expect(isLiveWork('project', 'in_progress', false)).toBe(false)
  })
})

describe('parseWorkKind', () => {
  it('accepts only job and project', () => {
    expect(parseWorkKind('job')).toBe('job')
    expect(parseWorkKind('project')).toBe('project')
    expect(parseWorkKind('quote')).toBeNull()
    expect(parseWorkKind(undefined)).toBeNull()
  })
})

describe('workHref and workTabs', () => {
  it('builds the job screen address, with and without a tab', () => {
    expect(workHref('job', 'abc')).toBe('/field/work/job/abc')
    expect(workHref('project', 'abc', 'day')).toBe('/field/work/project/abc/day')
  })

  it('projects get a Diary tab and jobs do not', () => {
    expect(workTabs('project').map((t) => t.tab)).toEqual([
      '', 'prestart', 'swms', 'day', 'diary', 'photos', 'docs',
    ])
    expect(workTabs('job').map((t) => t.tab)).toEqual([
      '', 'prestart', 'swms', 'day', 'photos', 'docs',
    ])
  })
})

describe('groupLiveWork', () => {
  const rows = [
    row({ id: 'j1', number: 'RJ26001' }),
    row({ id: 'j2', number: 'RJ26010', status: 'completed' }),
    row({ id: 'j3', number: 'RJ26005', status: 'scheduled' }),
    row({ kind: 'project', id: 'p1', number: 'RP26020', status: 'active' }),
  ]

  it('puts scheduled work first, finished jobs last, the rest in the middle', () => {
    const g = groupLiveWork(rows, new Set([workKey('job', 'j3')]))
    expect(g.scheduled.map((r) => r.id)).toEqual(['j3'])
    expect(g.live.map((r) => r.id)).toEqual(['p1', 'j1'])
    expect(g.finished.map((r) => r.id)).toEqual(['j2'])
  })

  it('a finished job that is scheduled today stays in the scheduled group', () => {
    const g = groupLiveWork(rows, new Set([workKey('job', 'j2')]))
    expect(g.scheduled.map((r) => r.id)).toEqual(['j2'])
    expect(g.finished).toEqual([])
  })

  it('a job and a project sharing an id are not confused', () => {
    const shared = [row({ id: 'x' }), row({ kind: 'project', id: 'x', status: 'active' })]
    const g = groupLiveWork(shared, new Set([workKey('project', 'x')]))
    expect(g.scheduled.map((r) => r.kind)).toEqual(['project'])
    expect(g.live.map((r) => r.kind)).toEqual(['job'])
  })

  it('sorts each group newest number first', () => {
    const g = groupLiveWork(rows, new Set())
    expect(g.live.map((r) => r.number)).toEqual(['RP26020', 'RJ26005', 'RJ26001'])
  })
})

describe('searchLiveWork', () => {
  const rows = [
    row({ id: 'j1', number: 'RJ26001', title: 'Eaves removal', client: 'Acme Strata', site: 'Depot, Tomago' }),
    row({ id: 'j2', number: 'RJ26002', title: 'Vinyl floor strip', client: null, site: null }),
  ]

  it('returns everything for a blank query', () => {
    expect(searchLiveWork(rows, '   ')).toHaveLength(2)
  })

  it('matches number, title, client and site, ignoring case', () => {
    expect(searchLiveWork(rows, 'rj26002').map((r) => r.id)).toEqual(['j2'])
    expect(searchLiveWork(rows, 'EAVES').map((r) => r.id)).toEqual(['j1'])
    expect(searchLiveWork(rows, 'acme').map((r) => r.id)).toEqual(['j1'])
    expect(searchLiveWork(rows, 'tomago').map((r) => r.id)).toEqual(['j1'])
  })

  it('copes with a missing client and site', () => {
    expect(searchLiveWork(rows, 'strata').map((r) => r.id)).toEqual(['j1'])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/live-work.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/live-work"`.

- [ ] **Step 3: Write the module**

Create `src/lib/live-work.ts`:

```ts
// The field side's definition of "live" work, and the pure list logic behind
// the Jobs list. No Supabase and no React in here — it is unit tested.

export type WorkKind = 'job' | 'project'

/** After quote acceptance / scheduling, before invoicing. */
export const LIVE_JOB_STATUSES = ['scheduled', 'in_progress', 'completed'] as const

/** Everything short of closed. */
export const LIVE_PROJECT_STATUSES = [
  'active',
  'practical_completion',
  'defects_liability',
] as const

export const WORK_STATUS_LABELS: Record<string, string> = {
  quote: 'Quote',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Finished',
  invoiced: 'Invoiced',
  paid: 'Paid',
  lost: 'Lost',
  active: 'Active',
  practical_completion: 'Practical completion',
  defects_liability: 'Defects',
  closed: 'Closed',
}

export function isLiveWork(kind: WorkKind, status: string, archived: boolean): boolean {
  if (archived) return false
  const list: readonly string[] =
    kind === 'job' ? LIVE_JOB_STATUSES : LIVE_PROJECT_STATUSES
  return list.includes(status)
}

export function parseWorkKind(value: string | undefined): WorkKind | null {
  return value === 'job' || value === 'project' ? value : null
}

/** Jobs and projects are separate tables, so an id alone is not a key. */
export function workKey(kind: WorkKind, id: string): string {
  return `${kind}:${id}`
}

/** Path suffix below /field/work/[kind]/[id] ('' = Today). */
export type WorkTab = '' | 'prestart' | 'swms' | 'day' | 'diary' | 'photos' | 'docs'

export function workHref(kind: WorkKind, id: string, tab: WorkTab = ''): string {
  return `/field/work/${kind}/${id}${tab ? `/${tab}` : ''}`
}

const ALL_TABS: { tab: WorkTab; label: string }[] = [
  { tab: '', label: 'Today' },
  { tab: 'prestart', label: 'Pre-start' },
  { tab: 'swms', label: 'SWMS' },
  { tab: 'day', label: 'Day sheet' },
  { tab: 'diary', label: 'Diary' },
  { tab: 'photos', label: 'Photos' },
  { tab: 'docs', label: 'Docs' },
]

/** The diary table belongs to projects only, so jobs have no Diary tab. */
export function workTabs(kind: WorkKind): { tab: WorkTab; label: string }[] {
  return kind === 'project' ? ALL_TABS : ALL_TABS.filter((t) => t.tab !== 'diary')
}

export interface LiveWorkRow {
  kind: WorkKind
  id: string
  /** As stored — already carries its prefix (RJ26018, RP26020). */
  number: string
  title: string
  status: string
  client: string | null
  site: string | null
}

export interface LiveWorkGroups {
  scheduled: LiveWorkRow[]
  live: LiveWorkRow[]
  finished: LiveWorkRow[]
}

const newestFirst = (a: LiveWorkRow, b: LiveWorkRow) =>
  b.number.localeCompare(a.number, 'en', { numeric: true })

/**
 * Splits live work into the three Jobs-list groups. Work scheduled for the
 * person today always goes in `scheduled`, whatever its status.
 */
export function groupLiveWork(
  rows: LiveWorkRow[],
  scheduledKeys: ReadonlySet<string>
): LiveWorkGroups {
  const groups: LiveWorkGroups = { scheduled: [], live: [], finished: [] }
  for (const r of rows) {
    if (scheduledKeys.has(workKey(r.kind, r.id))) groups.scheduled.push(r)
    else if (r.kind === 'job' && r.status === 'completed') groups.finished.push(r)
    else groups.live.push(r)
  }
  groups.scheduled.sort(newestFirst)
  groups.live.sort(newestFirst)
  groups.finished.sort(newestFirst)
  return groups
}

/** Case-insensitive match on number, title, client and site. */
export function searchLiveWork(rows: LiveWorkRow[], query: string): LiveWorkRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((r) =>
    [r.number, r.title, r.client, r.site].some((v) => v?.toLowerCase().includes(q))
  )
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/live-work.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/live-work.ts tests/live-work.test.ts
git commit -m "feat(field): shared definition of live work and jobs-list logic"
```

---

### Task 2: Today checklist wording and hours maths

**Files:**
- Create: `src/lib/field-today.ts`
- Test: `tests/field-today.test.ts`

**Interfaces:**
- Consumes: `WorkTab` from `@/lib/live-work`.
- Produces: `TodayStatus`, `TodayRow`, `fmtTimeAU(iso)`, `todayRows(status)`, `hoursBetween(startIso, endIso, now)`, `fmtDuration(hours)`.

- [ ] **Step 1: Write the failing test**

Create `tests/field-today.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  fmtDuration,
  fmtTimeAU,
  hoursBetween,
  todayRows,
  type TodayStatus,
} from '@/lib/field-today'

const base: TodayStatus = {
  prestartSubmittedAt: null,
  swmsTotal: 0,
  swmsToSign: 0,
  usageCount: 0,
  diarySaved: null,
  photoCount: 0,
}

const chip = (s: TodayStatus, key: string) => todayRows(s).find((r) => r.key === key)

describe('fmtTimeAU', () => {
  it('shows Brisbane wall-clock time for a UTC instant', () => {
    // 20:50 UTC on the 19th is 6:50 am on the 20th in Brisbane (+10, no DST).
    expect(fmtTimeAU('2026-11-19T20:50:00Z')).toBe('6:50 am')
    expect(fmtTimeAU('2026-11-20T05:05:00Z')).toBe('3:05 pm')
  })
})

describe('todayRows', () => {
  it('a job has no Diary row', () => {
    expect(todayRows(base).map((r) => r.key)).toEqual(['prestart', 'swms', 'day', 'photos'])
  })

  it('a project has a Diary row between Day sheet and Photos', () => {
    expect(todayRows({ ...base, diarySaved: false }).map((r) => r.key)).toEqual([
      'prestart', 'swms', 'day', 'diary', 'photos',
    ])
  })

  it('pre-start is a warning until it is done', () => {
    expect(chip(base, 'prestart')).toMatchObject({ chip: 'To do', tone: 'warn', tab: 'prestart' })
    expect(chip({ ...base, prestartSubmittedAt: '2026-11-19T20:50:00Z' }, 'prestart')).toMatchObject({
      chip: 'Done 6:50 am',
      tone: 'ok',
    })
  })

  it('SWMS reads none issued, n to sign, or all signed', () => {
    expect(chip(base, 'swms')).toMatchObject({ chip: 'None issued', tone: 'neutral' })
    expect(chip({ ...base, swmsTotal: 2, swmsToSign: 1 }, 'swms')).toMatchObject({
      chip: '1 to sign',
      tone: 'warn',
    })
    expect(chip({ ...base, swmsTotal: 2, swmsToSign: 0 }, 'swms')).toMatchObject({
      chip: 'All signed',
      tone: 'ok',
    })
  })

  it('day sheet and photos count what is there', () => {
    expect(chip(base, 'day')?.chip).toBe('Nothing yet')
    expect(chip({ ...base, usageCount: 3 }, 'day')?.chip).toBe('3 logged')
    expect(chip(base, 'photos')?.chip).toBe('None today')
    expect(chip({ ...base, photoCount: 6 }, 'photos')?.chip).toBe('6 today')
  })

  it('diary reads saved or not started', () => {
    expect(chip({ ...base, diarySaved: true }, 'diary')).toMatchObject({ chip: 'Saved', tone: 'ok' })
    expect(chip({ ...base, diarySaved: false }, 'diary')?.chip).toBe('Not started')
  })
})

describe('hoursBetween and fmtDuration', () => {
  const now = new Date('2026-11-20T00:00:00Z')

  it('a closed entry uses its own finish', () => {
    expect(hoursBetween('2026-11-19T20:00:00Z', '2026-11-19T22:30:00Z', now)).toBe(2.5)
  })

  it('an open entry runs to now', () => {
    expect(hoursBetween('2026-11-19T20:42:00Z', null, now)).toBeCloseTo(3.3, 5)
  })

  it('never goes negative', () => {
    expect(hoursBetween('2026-11-20T02:00:00Z', '2026-11-20T01:00:00Z', now)).toBe(0)
  })

  it('formats as hours and minutes', () => {
    expect(fmtDuration(3.3)).toBe('3 h 18 m')
    expect(fmtDuration(0)).toBe('0 h 00 m')
    expect(fmtDuration(8)).toBe('8 h 00 m')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/field-today.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/field-today"`.

- [ ] **Step 3: Write the module**

Create `src/lib/field-today.ts`:

```ts
// Wording for the job screen's Today checklist, and the hours maths behind
// "Your hours". Pure — unit tested.
import type { WorkTab } from '@/lib/live-work'

const TZ = 'Australia/Brisbane'

/** '6:50 am' — Brisbane wall-clock time for a stored UTC instant. */
export function fmtTimeAU(iso: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(new Date(iso))
    // ICU versions disagree on the space before am/pm (plain, NBSP, narrow NBSP).
    .replace(/[\u00a0\u202f]/g, ' ')
    .toLowerCase()
}

export interface TodayStatus {
  /** submitted_at of today's pre-start meeting on this work, or null. */
  prestartSubmittedAt: string | null
  /** Active SWMS issued to this work. */
  swmsTotal: number
  /** Of those, how many the person has not signed at the current version. */
  swmsToSign: number
  /** Today's materials / plant / subbie lines. */
  usageCount: number
  /** null for jobs — only projects keep a diary. */
  diarySaved: boolean | null
  photoCount: number
}

export interface TodayRow {
  key: 'prestart' | 'swms' | 'day' | 'diary' | 'photos'
  label: string
  tab: WorkTab
  chip: string
  tone: 'ok' | 'warn' | 'neutral'
}

export function todayRows(s: TodayStatus): TodayRow[] {
  const rows: TodayRow[] = [
    s.prestartSubmittedAt
      ? { key: 'prestart', label: 'Pre-start meeting', tab: 'prestart', chip: `Done ${fmtTimeAU(s.prestartSubmittedAt)}`, tone: 'ok' }
      : { key: 'prestart', label: 'Pre-start meeting', tab: 'prestart', chip: 'To do', tone: 'warn' },
    s.swmsTotal === 0
      ? { key: 'swms', label: 'SWMS sign-on', tab: 'swms', chip: 'None issued', tone: 'neutral' }
      : s.swmsToSign > 0
        ? { key: 'swms', label: 'SWMS sign-on', tab: 'swms', chip: `${s.swmsToSign} to sign`, tone: 'warn' }
        : { key: 'swms', label: 'SWMS sign-on', tab: 'swms', chip: 'All signed', tone: 'ok' },
    {
      key: 'day',
      label: 'Day sheet',
      tab: 'day',
      chip: s.usageCount > 0 ? `${s.usageCount} logged` : 'Nothing yet',
      tone: 'neutral',
    },
  ]
  if (s.diarySaved !== null) {
    rows.push(
      s.diarySaved
        ? { key: 'diary', label: 'Diary', tab: 'diary', chip: 'Saved', tone: 'ok' }
        : { key: 'diary', label: 'Diary', tab: 'diary', chip: 'Not started', tone: 'neutral' }
    )
  }
  rows.push({
    key: 'photos',
    label: 'Photos',
    tab: 'photos',
    chip: s.photoCount > 0 ? `${s.photoCount} today` : 'None today',
    tone: 'neutral',
  })
  return rows
}

/** Decimal hours from start to finish; an open entry (null finish) runs to `now`. */
export function hoursBetween(startIso: string, endIso: string | null, now: Date): number {
  const end = endIso ? new Date(endIso).getTime() : now.getTime()
  return Math.max(0, end - new Date(startIso).getTime()) / 3600000
}

/** '3 h 18 m' */
export function fmtDuration(hours: number): string {
  const mins = Math.round(hours * 60)
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} m`
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/field-today.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/field-today.ts tests/field-today.test.ts
git commit -m "feat(field): today checklist wording and hours maths"
```

---

### Task 3: Server loaders and the Jobs list

**Files:**
- Create: `src/lib/field-work-queries.ts`
- Create: `src/app/field/jobs/page.tsx`
- Create: `src/app/field/jobs/jobs-list.tsx`

**Interfaces:**
- Consumes: Task 1's `LiveWorkRow`, `WorkKind`, `LIVE_JOB_STATUSES`, `LIVE_PROJECT_STATUSES`, `WORK_STATUS_LABELS`, `isLiveWork`, `workKey`, `workHref`, `groupLiveWork`, `searchLiveWork`; Task 2's `TodayStatus`.
- Produces:
  - `fetchLiveWork(supabase): Promise<LiveWorkRow[]>`
  - `fetchScheduledKeys(supabase, userId, date): Promise<string[]>`
  - `fetchOpenEntry(supabase, userId): Promise<OpenWorkEntry | null>` where `OpenWorkEntry = { id: string; startAt: string; kind: WorkKind; workId: string; number: string; title: string }`
  - `fetchWorkHeader(supabase, kind, id): Promise<WorkHeader | null>` where `WorkHeader = { kind; id; number; title; status; live: boolean; siteLabel: string | null; contactPhone: string | null }`
  - `fetchTodayStatus(supabase, { kind, id, userId, today }): Promise<TodayStatus & { prestartSubmissionId: string | null; prestartTemplateId: string | null; note: string | null }>`
  - The page `/field/jobs`.

The loaders are thin wrappers over Supabase and are not unit tested; `tsc` and the page render check them. The codebase casts joined rows with `as unknown as`, and Supabase returns a joined row as an object or a one-element array, so every join goes through `one()`.

- [ ] **Step 1: Write the loaders**

Create `src/lib/field-work-queries.ts`:

```ts
// Server-side loaders for the field Jobs list and job screen. Use in Server
// Components and server actions only.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TodayStatus } from '@/lib/field-today'
import {
  LIVE_JOB_STATUSES,
  LIVE_PROJECT_STATUSES,
  isLiveWork,
  workKey,
  type LiveWorkRow,
  type WorkKind,
} from '@/lib/live-work'

/** Supabase returns a joined row as an object or a one-element array. */
function one<T>(rel: unknown): T | null {
  if (Array.isArray(rel)) return (rel[0] as T | undefined) ?? null
  return (rel as T | null) ?? null
}

type SiteRel = {
  name: string | null
  address?: string | null
  suburb: string | null
  state?: string | null
  postcode?: string | null
}

const WORK_COLUMN = { job: 'job_id', project: 'project_id' } as const

// ─── Jobs list ───────────────────────────────────────────────────────────────

export async function fetchLiveWork(supabase: SupabaseClient): Promise<LiveWorkRow[]> {
  const [{ data: jobs }, { data: projects }] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, number, title, status, clients:client_id ( name ), sites:site_id ( name, suburb )')
      .eq('archived', false)
      .in('status', [...LIVE_JOB_STATUSES]),
    supabase
      .from('projects')
      .select('id, number, name, status, clients:client_id ( name ), sites:site_id ( name, suburb )')
      .eq('archived', false)
      .in('status', [...LIVE_PROJECT_STATUSES]),
  ])

  const siteLabel = (rel: unknown) => {
    const s = one<SiteRel>(rel)
    return [s?.name, s?.suburb].filter(Boolean).join(', ') || null
  }

  return [
    ...(jobs ?? []).map((j) => ({
      kind: 'job' as const,
      id: j.id as string,
      number: j.number as string,
      title: j.title as string,
      status: j.status as string,
      client: one<{ name: string }>(j.clients)?.name ?? null,
      site: siteLabel(j.sites),
    })),
    ...(projects ?? []).map((p) => ({
      kind: 'project' as const,
      id: p.id as string,
      number: p.number as string,
      title: p.name as string,
      status: p.status as string,
      client: one<{ name: string }>(p.clients)?.name ?? null,
      site: siteLabel(p.sites),
    })),
  ]
}

/** workKey() of everything the person is scheduled on for `date`. */
export async function fetchScheduledKeys(
  supabase: SupabaseClient,
  userId: string,
  date: string
): Promise<string[]> {
  const { data } = await supabase
    .from('assignments')
    .select('job_id, project_id')
    .eq('user_id', userId)
    .eq('date', date)

  const keys = new Set<string>()
  for (const a of data ?? []) {
    if (a.job_id) keys.add(workKey('job', a.job_id as string))
    else if (a.project_id) keys.add(workKey('project', a.project_id as string))
  }
  return [...keys]
}

export interface OpenWorkEntry {
  id: string
  startAt: string
  kind: WorkKind
  workId: string
  number: string
  title: string
}

/** The person's open timesheet entry (no finish time), if any. */
export async function fetchOpenEntry(
  supabase: SupabaseClient,
  userId: string
): Promise<OpenWorkEntry | null> {
  const { data } = await supabase
    .from('timesheet_entries')
    .select(
      'id, start_at, job_id, project_id, jobs:job_id ( number, title ), projects:project_id ( number, name )'
    )
    .eq('user_id', userId)
    .is('end_at', null)
    .maybeSingle()
  if (!data) return null

  const job = one<{ number: string; title: string }>(data.jobs)
  const project = one<{ number: string; name: string }>(data.projects)
  if (data.job_id && job) {
    return {
      id: data.id as string,
      startAt: data.start_at as string,
      kind: 'job',
      workId: data.job_id as string,
      number: job.number,
      title: job.title,
    }
  }
  if (data.project_id && project) {
    return {
      id: data.id as string,
      startAt: data.start_at as string,
      kind: 'project',
      workId: data.project_id as string,
      number: project.number,
      title: project.name,
    }
  }
  return null
}

// ─── Job screen ──────────────────────────────────────────────────────────────

export interface WorkHeader {
  kind: WorkKind
  id: string
  number: string
  title: string
  status: string
  live: boolean
  /** Address then site name, comma separated — what Maps should search for. */
  siteLabel: string | null
  contactPhone: string | null
}

export async function fetchWorkHeader(
  supabase: SupabaseClient,
  kind: WorkKind,
  id: string
): Promise<WorkHeader | null> {
  const rels =
    'sites:site_id ( name, address, suburb, state, postcode ), clients:client_id ( contacts ( phone ) )'
  const { data } =
    kind === 'job'
      ? await supabase
          .from('jobs')
          .select(`id, number, title, status, archived, ${rels}`)
          .eq('id', id)
          .maybeSingle()
      : await supabase
          .from('projects')
          .select(`id, number, name, status, archived, ${rels}`)
          .eq('id', id)
          .maybeSingle()
  if (!data) return null

  const row = data as Record<string, unknown>
  const site = one<SiteRel>(row.sites)
  const client = one<{ contacts: { phone: string | null }[] | null }>(row.clients)
  const address = [site?.address, site?.suburb, site?.state, site?.postcode]
    .filter(Boolean)
    .join(' ')
  const status = row.status as string

  return {
    kind,
    id,
    number: row.number as string,
    title: (kind === 'job' ? row.title : row.name) as string,
    status,
    live: isLiveWork(kind, status, Boolean(row.archived)),
    siteLabel: [address, site?.name].filter(Boolean).join(', ') || null,
    contactPhone: client?.contacts?.[0]?.phone ?? null,
  }
}

export type TodayData = TodayStatus & {
  prestartSubmissionId: string | null
  prestartTemplateId: string | null
  /** Today's schedule note for this person on this work. */
  note: string | null
}

export async function fetchTodayStatus(
  supabase: SupabaseClient,
  args: { kind: WorkKind; id: string; userId: string; today: string }
): Promise<TodayData> {
  const { kind, id, userId, today } = args
  const col = WORK_COLUMN[kind]
  // Brisbane is fixed +10 — the AU day starts at T00:00:00+10:00.
  const dayStartIso = new Date(`${today}T00:00:00+10:00`).toISOString()

  const [template, meeting, swms, usage, diary, photos, assignment] = await Promise.all([
    supabase
      .from('form_templates')
      .select('id')
      .eq('kind', 'prestart_meeting')
      .eq('active', true)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('form_submissions')
      .select('id, submitted_at')
      .eq('kind', 'prestart_meeting')
      .eq(col, id)
      .gte('submitted_at', dayStartIso)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('swms_instances').select('id, version').eq('status', 'active').eq(col, id),
    supabase
      .from('field_usage')
      .select('id', { count: 'exact', head: true })
      .eq(col, id)
      .eq('date', today),
    kind === 'project'
      ? supabase.from('diaries').select('id').eq('project_id', id).eq('date', today).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('attachments')
      .select('id', { count: 'exact', head: true })
      .eq('parent_type', kind)
      .eq('parent_id', id)
      .eq('kind', 'photo')
      .gte('created_at', dayStartIso),
    supabase
      .from('assignments')
      .select('note')
      .eq('user_id', userId)
      .eq('date', today)
      .eq(col, id)
      .limit(1)
      .maybeSingle(),
  ])

  const instances = (swms.data ?? []) as { id: string; version: number }[]
  let swmsToSign = 0
  if (instances.length > 0) {
    const { data: sigs } = await supabase
      .from('swms_signatures')
      .select('swms_instance_id, version')
      .eq('user_id', userId)
      .in('swms_instance_id', instances.map((i) => i.id))
    const signed = new Map<string, number>()
    for (const s of sigs ?? []) {
      const key = s.swms_instance_id as string
      signed.set(key, Math.max(signed.get(key) ?? 0, Number(s.version)))
    }
    swmsToSign = instances.filter((i) => (signed.get(i.id) ?? 0) < Number(i.version)).length
  }

  return {
    prestartSubmittedAt: (meeting.data?.submitted_at as string | undefined) ?? null,
    prestartSubmissionId: (meeting.data?.id as string | undefined) ?? null,
    prestartTemplateId: (template.data?.id as string | undefined) ?? null,
    swmsTotal: instances.length,
    swmsToSign,
    usageCount: usage.count ?? 0,
    diarySaved: kind === 'project' ? Boolean(diary.data) : null,
    photoCount: photos.count ?? 0,
    note: (assignment.data?.note as string | null | undefined) ?? null,
  }
}
```

- [ ] **Step 2: Write the list component**

Create `src/app/field/jobs/jobs-list.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRightIcon } from 'lucide-react'
import {
  WORK_STATUS_LABELS,
  groupLiveWork,
  searchLiveWork,
  workHref,
  workKey,
  type LiveWorkRow,
} from '@/lib/live-work'

function Row({ row, checkedIn }: { row: LiveWorkRow; checkedIn: boolean }) {
  return (
    <Link
      href={workHref(row.kind, row.id)}
      className="flex items-center justify-between gap-3 px-4 py-3 transition-colors active:bg-muted"
    >
      <div className="flex min-w-0 flex-col">
        <span className="font-mono text-xs text-muted-foreground">{row.number}</span>
        <span className="truncate text-sm font-medium">{row.title}</span>
        {(row.client || row.site) && (
          <span className="truncate text-xs text-muted-foreground">
            {[row.client, row.site].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {checkedIn ? (
          <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
            Checked in
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {WORK_STATUS_LABELS[row.status] ?? row.status}
          </span>
        )}
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </div>
    </Link>
  )
}

function Group({
  title,
  rows,
  checkedInKey,
}: {
  title: string
  rows: LiveWorkRow[]
  checkedInKey: string | null
}) {
  if (rows.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title} · {rows.length}
      </h2>
      <div className="flex flex-col divide-y rounded-xl border">
        {rows.map((r) => (
          <Row
            key={workKey(r.kind, r.id)}
            row={r}
            checkedIn={checkedInKey === workKey(r.kind, r.id)}
          />
        ))}
      </div>
    </section>
  )
}

export function JobsList({
  rows,
  scheduledKeys,
  checkedInKey,
}: {
  rows: LiveWorkRow[]
  scheduledKeys: string[]
  checkedInKey: string | null
}) {
  const [query, setQuery] = useState('')
  const groups = groupLiveWork(searchLiveWork(rows, query), new Set(scheduledKeys))
  const nothing =
    groups.scheduled.length + groups.live.length + groups.finished.length === 0

  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Job number, client or address"
        aria-label="Search jobs"
        className="w-full rounded-lg border bg-background px-3 py-2.5 text-base md:text-sm"
      />

      {nothing ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {rows.length === 0
            ? 'No live jobs or projects right now.'
            : 'Nothing matches that search.'}
        </p>
      ) : (
        <>
          <Group title="Scheduled for you today" rows={groups.scheduled} checkedInKey={checkedInKey} />
          <Group title="Live jobs and projects" rows={groups.live} checkedInKey={checkedInKey} />
          <Group title="Finished, not yet invoiced" rows={groups.finished} checkedInKey={checkedInKey} />
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Quotes, invoiced and closed work don&apos;t appear here.
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Write the page**

Create `src/app/field/jobs/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU } from '@/lib/tz'
import { workKey } from '@/lib/live-work'
import {
  fetchLiveWork,
  fetchOpenEntry,
  fetchScheduledKeys,
} from '@/lib/field-work-queries'
import { JobsList } from './jobs-list'

export default async function FieldJobsPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()
  const [rows, scheduledKeys, open] = await Promise.all([
    fetchLiveWork(supabase),
    fetchScheduledKeys(supabase, profile.id, todayAU()),
    fetchOpenEntry(supabase, profile.id),
  ])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">Jobs</h1>
        <p className="text-sm text-muted-foreground">Every live job and project.</p>
      </div>
      <JobsList
        rows={rows}
        scheduledKeys={scheduledKeys}
        checkedInKey={open ? workKey(open.kind, open.workId) : null}
      />
    </div>
  )
}
```

- [ ] **Step 4: Type check and lint**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

Run: `npx eslint src/lib/field-work-queries.ts src/app/field/jobs`
Expected: no errors.

- [ ] **Step 5: Look at it**

Start the dev server (PowerShell, from the repo or worktree root):

```
$env:NODE_EXTRA_CA_CERTS = 'C:\Users\nickj\norton-ssl-root-ca.pem'; npx next dev -p 3020
```

Sign in with a field-role login (the seeded one is `field1@entice.local`; ask the owner for the password rather than writing it anywhere) and open `http://localhost:3020/field/jobs`.
Expected: the heading "Jobs", a search box, and one row — project `RP26020` under "Live jobs and projects" (on 2026-11-20 it is the only live work; every job in the database is invoiced or paid). Typing `zzz` in the search shows "Nothing matches that search." The row links to `/field/work/project/<id>`, which is a 404 until Task 4.

- [ ] **Step 6: Commit**

```bash
git add src/lib/field-work-queries.ts src/app/field/jobs
git commit -m "feat(field): jobs list of every live job and project"
```

---

### Task 4: Job screen shell and the Today tab

**Files:**
- Create: `src/app/field/work/[kind]/[id]/layout.tsx`
- Create: `src/app/field/work/[kind]/[id]/work-tabs.tsx`
- Create: `src/app/field/work/[kind]/[id]/page.tsx`

**Interfaces:**
- Consumes: `parseWorkKind`, `workHref`, `workTabs`, `WORK_STATUS_LABELS`, `WorkKind` (Task 1); `todayRows` (Task 2); `fetchWorkHeader`, `fetchTodayStatus` (Task 3).
- Produces: the route `/field/work/[kind]/[id]` with its header and tab strip. Later tasks add child pages beside `page.tsx` and a check-in card above the site card.

Read first: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md` and `dynamic-routes.md`. An existing layout with awaited params to copy the shape from: `src/app/(office)/projects/[id]/layout.tsx`.

- [ ] **Step 1: Write the tab strip**

Create `src/app/field/work/[kind]/[id]/work-tabs.tsx`:

```tsx
'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { workHref, workTabs, type WorkKind } from '@/lib/live-work'

export function WorkTabs({ kind, id }: { kind: WorkKind; id: string }) {
  const pathname = usePathname()
  const activeRef = useRef<HTMLAnchorElement>(null)
  const base = workHref(kind, id)

  // Seven tabs do not fit a phone; keep the active one in view.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [pathname])

  return (
    <nav className="-mx-4 flex gap-1 overflow-x-auto border-b px-4 [scrollbar-width:none]">
      {workTabs(kind).map((t) => {
        const href = workHref(kind, id, t.tab)
        const active =
          t.tab === ''
            ? pathname === base
            : pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={t.tab}
            href={href}
            ref={active ? activeRef : undefined}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
              active
                ? 'border-primary font-semibold text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 2: Write the layout**

Create `src/app/field/work/[kind]/[id]/layout.tsx`:

```tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeftIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { WORK_STATUS_LABELS, parseWorkKind } from '@/lib/live-work'
import { fetchWorkHeader } from '@/lib/field-work-queries'
import { WorkTabs } from './work-tabs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function WorkLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ kind: string; id: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { kind: rawKind, id } = await params
  const kind = parseWorkKind(rawKind)
  if (!kind || !UUID_RE.test(id)) notFound()

  const supabase = await createClient()
  const header = await fetchWorkHeader(supabase, kind, id)
  if (!header) notFound()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Link
            href="/field/jobs"
            aria-label="Back to jobs"
            className="mt-1 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
          </Link>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{header.number}</span> ·{' '}
              {WORK_STATUS_LABELS[header.status] ?? header.status}
            </p>
            <h1 className="truncate text-lg font-bold leading-tight">{header.title}</h1>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          render={<Link href="/field/jobs" />}
        >
          Switch job
        </Button>
      </div>

      <WorkTabs kind={kind} id={id} />

      {children}
    </div>
  )
}
```

- [ ] **Step 3: Write the Today tab**

Create `src/app/field/work/[kind]/[id]/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  CameraIcon,
  ChevronRightIcon,
  FileCheckIcon,
  MapPinIcon,
  NotebookPenIcon,
  PackageIcon,
  PhoneIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU } from '@/lib/tz'
import { cn } from '@/lib/utils'
import { parseWorkKind, workHref } from '@/lib/live-work'
import { todayRows, type TodayRow } from '@/lib/field-today'
import { fetchTodayStatus, fetchWorkHeader } from '@/lib/field-work-queries'

const ROW_ICONS: Record<TodayRow['key'], React.ComponentType<{ className?: string }>> = {
  prestart: ShieldCheckIcon,
  swms: FileCheckIcon,
  day: PackageIcon,
  diary: NotebookPenIcon,
  photos: CameraIcon,
}

const TONE_CLASS: Record<TodayRow['tone'], string> = {
  ok: 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300',
  warn: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  neutral: 'border-transparent bg-muted text-muted-foreground',
}

export default async function WorkTodayPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { kind: rawKind, id } = await params
  const kind = parseWorkKind(rawKind)
  if (!kind) notFound()

  const supabase = await createClient()
  const [header, status] = await Promise.all([
    fetchWorkHeader(supabase, kind, id),
    fetchTodayStatus(supabase, { kind, id, userId: profile.id, today: todayAU() }),
  ])
  if (!header) notFound()

  const mapsUrl = header.siteLabel
    ? `https://maps.google.com/?q=${encodeURIComponent(header.siteLabel)}`
    : null

  return (
    <div className="flex flex-col gap-4">
      {(header.siteLabel || header.contactPhone) && (
        <div className="flex flex-col gap-2 rounded-xl border px-4 py-3">
          {header.siteLabel && (
            <div className="flex items-start gap-1.5">
              <MapPinIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm">{header.siteLabel}</p>
                {mapsUrl && (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Navigate
                  </a>
                )}
              </div>
            </div>
          )}
          {header.contactPhone && (
            <a
              href={`tel:${header.contactPhone}`}
              className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              <PhoneIcon className="size-3.5 shrink-0" />
              {header.contactPhone}
            </a>
          )}
        </div>
      )}

      {status.note && (
        <div className="rounded-xl border px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Note from the office
          </p>
          <p className="text-sm">{status.note}</p>
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Today on this job
        </h2>
        <div className="flex flex-col divide-y rounded-xl border">
          {todayRows(status).map((row) => {
            const Icon = ROW_ICONS[row.key]
            return (
              <Link
                key={row.key}
                href={workHref(kind, id, row.tab)}
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors active:bg-muted"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  {row.label}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-xs font-medium',
                      TONE_CLASS[row.tone]
                    )}
                  >
                    {row.chip}
                  </span>
                  <ChevronRightIcon className="size-4 text-muted-foreground" />
                </span>
              </Link>
            )
          })}
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Type check and lint**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

Run: `npx eslint "src/app/field/work"`
Expected: no errors.

- [ ] **Step 5: Look at it**

With the dev server running, open `/field/jobs`, tap `RP26020`.
Expected: header with the number, "Active" and the title; a Switch job button; seven tabs with Today underlined; the site card; five checklist rows (Pre-start meeting, SWMS sign-on, Day sheet, Diary, Photos) each with a chip. Each row and each tab other than Today leads to a 404 until its task lands. Open `/field/work/quote/123` — expected: 404.

- [ ] **Step 6: Commit**

```bash
git add "src/app/field/work"
git commit -m "feat(field): job screen shell with tab strip and today checklist"
```

---

### Task 5: Check-in on any live job, and switching

**Files:**
- Modify: `src/lib/zod.ts` (the two schemas at lines 1126–1150 — find them by name)
- Test: `tests/check-in-schema.test.ts`
- Modify: `src/app/field/actions.ts`
- Create: `src/app/field/use-elapsed.ts`
- Create: `src/app/field/work/[kind]/[id]/check-in-card.tsx`
- Modify: `src/app/field/work/[kind]/[id]/page.tsx`
- Modify: `src/app/field/my-day-client.tsx` (use the moved hook; stop sending the schedule id)
- Modify: `src/app/(office)/reports/timesheets.tsx:256-263`

**Interfaces:**
- Consumes: `isLiveWork`, `WorkKind`, `workKey` (Task 1); `fetchOpenEntry` (Task 3); `todayAU`, `yesterdayAU`, `auLocalToInstant` from `@/lib/tz`.
- Produces:
  - `checkInSchema` — `{ job_id: uuid | null, project_id: uuid | null }`, exactly one set.
  - `manualEntrySchema` — `{ job_id, project_id, date, start_time, end_time }`, exactly one target, finish after start.
  - `checkIn(data: unknown): Promise<{ error?: string }>`
  - `switchCheckIn(data: unknown): Promise<{ error?: string }>`
  - `useElapsed(startAt: string | null): string`
  - `<CheckInCard kind id live state startAt elsewhere />`

Background: `timesheet_entries.assignment_id` is nullable and the insert policy only checks the row is the person's own, so only the form schema stood in the way. `createManualEntry` currently parses times with `new Date('YYYY-MM-DDTHH:MM:00')`, which is server-local time — ten hours out on a UTC host — so this task routes it through `auLocalToInstant`.

- [ ] **Step 1: Write the failing schema test**

Create `tests/check-in-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { checkInSchema, manualEntrySchema } from '@/lib/zod'

const JOB = '11111111-1111-4111-8111-111111111111'
const PROJECT = '22222222-2222-4222-8222-222222222222'

describe('checkInSchema', () => {
  it('accepts a job with no schedule link', () => {
    expect(checkInSchema.safeParse({ job_id: JOB, project_id: null }).success).toBe(true)
  })

  it('accepts a project with no schedule link', () => {
    expect(checkInSchema.safeParse({ job_id: null, project_id: PROJECT }).success).toBe(true)
  })

  it('rejects neither and both', () => {
    expect(checkInSchema.safeParse({ job_id: null, project_id: null }).success).toBe(false)
    expect(checkInSchema.safeParse({ job_id: JOB, project_id: PROJECT }).success).toBe(false)
  })

  it('ignores a schedule id sent by an older client', () => {
    const parsed = checkInSchema.safeParse({ job_id: JOB, project_id: null, assignment_id: PROJECT })
    expect(parsed.success).toBe(true)
    expect(parsed.success && 'assignment_id' in parsed.data).toBe(false)
  })
})

describe('manualEntrySchema', () => {
  const ok = { job_id: JOB, project_id: null, date: '2026-11-20', start_time: '07:00', end_time: '15:30' }

  it('accepts a job, a date and a finish after the start', () => {
    expect(manualEntrySchema.safeParse(ok).success).toBe(true)
  })

  it('rejects a finish at or before the start', () => {
    expect(manualEntrySchema.safeParse({ ...ok, end_time: '07:00' }).success).toBe(false)
    expect(manualEntrySchema.safeParse({ ...ok, end_time: '06:00' }).success).toBe(false)
  })

  it('rejects no target', () => {
    expect(manualEntrySchema.safeParse({ ...ok, job_id: null }).success).toBe(false)
  })

  it('rejects a malformed time', () => {
    expect(manualEntrySchema.safeParse({ ...ok, start_time: '7am' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/check-in-schema.test.ts`
Expected: FAIL — "accepts a job with no schedule link" fails because `assignment_id` is required.

- [ ] **Step 3: Loosen the schemas**

In `src/lib/zod.ts` replace everything from the line `export const checkInSchema = z.object({` down to the closing `)` of the `manualEntrySchema` statement — that span includes the existing `export type CheckInInput` line, which the block below restates — with the block below. Leave any `export type ManualEntryInput` line that follows it in place.

```ts
const exactlyOneWork = (d: { job_id: string | null; project_id: string | null }) =>
  (d.job_id ? 1 : 0) + (d.project_id ? 1 : 0) === 1

// Check-in is allowed on any live job or project, scheduled or not. The
// server looks up the schedule entry itself (see src/app/field/actions.ts).
export const checkInSchema = z
  .object({
    job_id: z.uuid().nullable(),
    project_id: z.uuid().nullable(),
  })
  .refine(exactlyOneWork, { message: 'Pick one job or project' })

export type CheckInInput = z.infer<typeof checkInSchema>

export const manualEntrySchema = z
  .object({
    job_id: z.uuid().nullable(),
    project_id: z.uuid().nullable(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date is required'),
    start_time: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time (HH:MM)'),
    end_time: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time (HH:MM)'),
  })
  .refine(exactlyOneWork, { message: 'Pick one job or project' })
  .refine(
    (d) => {
      const [sh, sm] = d.start_time.split(':').map(Number)
      const [eh, em] = d.end_time.split(':').map(Number)
      return eh * 60 + em > sh * 60 + sm
    },
    { message: 'End time must be after start time', path: ['end_time'] }
  )
```

If the existing `manualEntrySchema` refine carries a different message or path, keep the existing wording.

- [ ] **Step 4: Run the schema test and watch it pass**

Run: `npx vitest run tests/check-in-schema.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Rewrite the actions**

Replace the whole of `src/app/field/actions.ts` with:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { checkInSchema, manualEntrySchema } from '@/lib/zod'
import { isLiveWork, type WorkKind } from '@/lib/live-work'
import { auLocalToInstant, todayAU, yesterdayAU } from '@/lib/tz'

type Result = { error?: string }
type Work = { kind: WorkKind; id: string }

const WORK_COLUMN = { job: 'job_id', project: 'project_id' } as const

function workOf(v: { job_id: string | null; project_id: string | null }): Work {
  return v.job_id
    ? { kind: 'job', id: v.job_id }
    : { kind: 'project', id: v.project_id as string }
}

/** Refuses hours against work that is not live (quote, invoiced, closed, archived). */
async function liveWorkError(supabase: SupabaseClient, work: Work): Promise<string | null> {
  const { data } = await supabase
    .from(work.kind === 'job' ? 'jobs' : 'projects')
    .select('status, archived')
    .eq('id', work.id)
    .maybeSingle()
  if (!data) return 'That job could not be found.'
  if (!isLiveWork(work.kind, data.status as string, Boolean(data.archived))) {
    return 'That job is closed — hours can no longer be logged against it.'
  }
  return null
}

/** The person's schedule entry for this work on this day, when there is one. */
async function findAssignmentId(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  work: Work
): Promise<string | null> {
  const { data } = await supabase
    .from('assignments')
    .select('id')
    .eq('user_id', userId)
    .eq('date', date)
    .eq(WORK_COLUMN[work.kind], work.id)
    .limit(1)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

async function openEntry(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from('timesheet_entries')
    .select('id, job_id, project_id')
    .eq('user_id', userId)
    .is('end_at', null)
    .maybeSingle()
  return data
}

async function insertOpenEntry(
  supabase: SupabaseClient,
  userId: string,
  work: Work
): Promise<string | null> {
  const today = todayAU()
  const { error } = await supabase.from('timesheet_entries').insert({
    user_id: userId,
    assignment_id: await findAssignmentId(supabase, userId, today, work),
    job_id: work.kind === 'job' ? work.id : null,
    project_id: work.kind === 'project' ? work.id : null,
    date: today,
    start_at: new Date().toISOString(),
    approved: false,
  })
  return error ? error.message : null
}

// ─── Check in ────────────────────────────────────────────────────────────────

/**
 * Opens a timesheet entry on any live job or project, scheduled or not.
 * Rejects if the person already has an open entry.
 */
export async function checkIn(data: unknown): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const parsed = checkInSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }
  const work = workOf(parsed.data)

  const supabase = await createClient()
  const notLive = await liveWorkError(supabase, work)
  if (notLive) return { error: notLive }

  if (await openEntry(supabase, profile.id)) {
    return { error: 'You are already checked in. Check out first.' }
  }

  const failed = await insertOpenEntry(supabase, profile.id, work)
  if (failed) return { error: failed }

  revalidatePath('/field', 'layout')
  return {}
}

// ─── Switch job ──────────────────────────────────────────────────────────────

/**
 * Checks out of the current job (if any) and into this one. The two writes
 * are not one transaction: if the second fails the person is left checked
 * out, and the message says so.
 */
export async function switchCheckIn(data: unknown): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const parsed = checkInSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }
  const work = workOf(parsed.data)

  const supabase = await createClient()
  const notLive = await liveWorkError(supabase, work)
  if (notLive) return { error: notLive }

  const open = await openEntry(supabase, profile.id)
  if (open) {
    if (open[WORK_COLUMN[work.kind]] === work.id) {
      return { error: 'You are already checked in here.' }
    }
    const { error } = await supabase
      .from('timesheet_entries')
      .update({ end_at: new Date().toISOString() })
      .eq('id', open.id)
      .eq('user_id', profile.id)
    if (error) return { error: error.message }
  }

  const failed = await insertOpenEntry(supabase, profile.id, work)
  revalidatePath('/field', 'layout')
  if (failed) {
    return {
      error: open
        ? `You were checked out of the other job, but check-in here failed. Try again. (${failed})`
        : failed,
    }
  }
  return {}
}

// ─── Check out ───────────────────────────────────────────────────────────────

/** Closes the current user's open entry. */
export async function checkOut(): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()
  const open = await openEntry(supabase, profile.id)
  if (!open) return { error: 'No open timesheet entry found.' }

  const { error } = await supabase
    .from('timesheet_entries')
    .update({ end_at: new Date().toISOString() })
    .eq('id', open.id)
    .eq('user_id', profile.id)
  if (error) return { error: error.message }

  revalidatePath('/field', 'layout')
  return {}
}

// ─── Manual entry ────────────────────────────────────────────────────────────

/**
 * Inserts a closed entry with explicit Brisbane start and finish times, for
 * today or yesterday, on any live job or project.
 */
export async function createManualEntry(data: unknown): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const parsed = manualEntrySchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }
  const { date, start_time, end_time } = parsed.data
  if (date !== todayAU() && date !== yesterdayAU()) {
    return { error: 'Manual time can only be added for today or yesterday.' }
  }
  const work = workOf(parsed.data)

  const supabase = await createClient()
  const notLive = await liveWorkError(supabase, work)
  if (notLive) return { error: notLive }

  const { error } = await supabase.from('timesheet_entries').insert({
    user_id: profile.id,
    assignment_id: await findAssignmentId(supabase, profile.id, date, work),
    job_id: work.kind === 'job' ? work.id : null,
    project_id: work.kind === 'project' ? work.id : null,
    date,
    // Brisbane wall-clock → UTC instant. Never new Date('…T07:00:00') here:
    // that reads the server's own zone.
    start_at: auLocalToInstant(`${date}T${start_time}`),
    end_at: auLocalToInstant(`${date}T${end_time}`),
    approved: false,
  })
  if (error) return { error: error.message }

  revalidatePath('/field', 'layout')
  return {}
}
```

- [ ] **Step 6: Move the elapsed-time hook**

Create `src/app/field/use-elapsed.ts`:

```ts
'use client'

import { useEffect, useRef, useState } from 'react'

/** '3h 18m 04s' since `startAt`, ticking every second; '' when there is no start. */
export function useElapsed(startAt: string | null): string {
  const [elapsed, setElapsed] = useState('')
  const interval = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!startAt) return

    function tick() {
      const start = new Date(startAt!).getTime()
      const diff = Math.max(0, Date.now() - start)
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setElapsed(`${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`)
    }

    tick()
    interval.current = setInterval(tick, 1000)
    return () => {
      if (interval.current) clearInterval(interval.current)
    }
  }, [startAt])

  return elapsed
}
```

In `src/app/field/my-day-client.tsx`:

1. Delete the whole `// ─── Elapsed timer ───` block (the comment line and the `function useElapsed(...) { … }` that follows it).
2. Change the React import to `import React, { useState, useTransition } from 'react'`.
3. Add `import { useElapsed } from './use-elapsed'` beside the `./actions` import.
4. In `AssignmentCardItem.handleCheckIn`, replace the `checkIn({ … })` argument with:

```ts
      const result = await checkIn({
        job_id: assignment.job_id,
        project_id: assignment.project_id,
      })
```

5. In `ManualEntrySection.handleSubmit`, replace the `createManualEntry({ … })` argument with:

```ts
      const result = await createManualEntry({
        job_id: a.job_id,
        project_id: a.project_id,
        date: today,
        start_time: startTime,
        end_time: endTime,
      })
```

- [ ] **Step 7: Write the check-in card**

Create `src/app/field/work/[kind]/[id]/check-in-card.tsx`:

```tsx
'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { LogInIcon, LogOutIcon, RepeatIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { WorkKind } from '@/lib/live-work'
import { fmtTimeAU } from '@/lib/field-today'
import { checkIn, checkOut, switchCheckIn } from '../../../actions'
import { useElapsed } from '../../../use-elapsed'

export function CheckInCard({
  kind,
  id,
  live,
  state,
  startAt,
  elsewhere,
}: {
  kind: WorkKind
  id: string
  /** False for work that is no longer live — no check-in is offered. */
  live: boolean
  state: 'here' | 'elsewhere' | 'none'
  /** Start of the open entry, when there is one. */
  startAt: string | null
  /** 'RJ26031 — Friable removal' when checked in on another job. */
  elsewhere: string | null
}) {
  const [pending, startTransition] = useTransition()
  const elapsed = useElapsed(state === 'here' ? startAt : null)
  const target = {
    job_id: kind === 'job' ? id : null,
    project_id: kind === 'project' ? id : null,
  }

  function run(action: () => Promise<{ error?: string }>, done: string) {
    startTransition(async () => {
      const result = await action()
      if (result.error) toast.error(result.error)
      else toast.success(done)
    })
  }

  if (state === 'here' && startAt) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-semibold text-green-700 dark:text-green-400">
            Checked in {fmtTimeAU(startAt)}
          </p>
          <p className="font-mono text-xs tabular-nums text-muted-foreground">{elapsed}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 border-green-500/40 text-green-700 hover:bg-green-500/10 dark:text-green-400"
          onClick={() => run(checkOut, 'Checked out')}
          disabled={pending}
        >
          <LogOutIcon className="mr-1 size-3.5" />
          {pending ? 'Checking out…' : 'Check out'}
        </Button>
      </div>
    )
  }

  if (!live) {
    return (
      <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
        This job is closed — hours can no longer be logged against it.
      </p>
    )
  }

  if (state === 'elsewhere') {
    return (
      <div className="flex flex-col gap-2 rounded-xl border px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Not checked in here</p>
          <p className="truncate text-xs text-muted-foreground">
            You&apos;re on {elsewhere}
            {startAt ? ` since ${fmtTimeAU(startAt)}` : ''}
          </p>
        </div>
        <Button
          className="w-full"
          onClick={() => run(() => switchCheckIn(target), 'Switched to this job')}
          disabled={pending}
        >
          <RepeatIcon className="mr-1 size-3.5" />
          {pending ? 'Switching…' : 'Switch to this job'}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border px-4 py-3">
      <p className="text-sm font-semibold">Not checked in</p>
      <Button
        className="w-full"
        onClick={() => run(() => checkIn(target), 'Checked in')}
        disabled={pending}
      >
        <LogInIcon className="mr-1 size-3.5" />
        {pending ? 'Checking in…' : 'Check in'}
      </Button>
    </div>
  )
}
```

- [ ] **Step 8: Put the card on the Today tab**

In `src/app/field/work/[kind]/[id]/page.tsx`:

1. Add to the imports:

```tsx
import { fetchOpenEntry, fetchTodayStatus, fetchWorkHeader } from '@/lib/field-work-queries'
import { CheckInCard } from './check-in-card'
```

(replacing the existing `fetchTodayStatus, fetchWorkHeader` import line).

2. Replace the `Promise.all` block with:

```tsx
  const [header, status, open] = await Promise.all([
    fetchWorkHeader(supabase, kind, id),
    fetchTodayStatus(supabase, { kind, id, userId: profile.id, today: todayAU() }),
    fetchOpenEntry(supabase, profile.id),
  ])
  if (!header) notFound()

  const here = open?.kind === kind && open.workId === id
```

(and delete the old `if (!header) notFound()` line that followed the old block).

3. Make this the first child of the outer `<div className="flex flex-col gap-4">`:

```tsx
      <CheckInCard
        kind={kind}
        id={id}
        live={header.live}
        state={here ? 'here' : open ? 'elsewhere' : 'none'}
        startAt={open?.startAt ?? null}
        elsewhere={open && !here ? `${open.number} — ${open.title}` : null}
      />
```

- [ ] **Step 9: Rename the office badge**

In `src/app/(office)/reports/timesheets.tsx`, change the badge text `Manual` to `Unscheduled` and the field comment above `manual: boolean` to:

```ts
  /** True when the entry has no schedule link — checked in off-schedule. */
```

Leave the property name `manual` alone; `reports/page.tsx` sets it.

- [ ] **Step 10: Verify**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

Run: `npm test`
Expected: all tests pass (the suite was green before; three new files added so far).

Run: `npx eslint src/app/field "src/app/(office)/reports/timesheets.tsx" src/lib/zod.ts`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add src/lib/zod.ts tests/check-in-schema.test.ts src/app/field "src/app/(office)/reports/timesheets.tsx"
git commit -m "feat(field): check in on any live job, with one-tap switch"
```

---

### Task 6: Day sheet tab

**Files:**
- Create: `src/app/field/work/[kind]/[id]/day/page.tsx`
- Modify: `src/app/field/usage/page.tsx` (becomes a redirect)
- Modify: `src/app/field/usage/actions.ts` (four `revalidatePath` calls)
- Modify: `src/app/field/waste/page.tsx`, `src/app/field/waste/waste-form.tsx`

**Interfaces:**
- Consumes: `UsageClient`, `PlantOption`, `ScopeLine`, `UsageRow` from `@/app/field/usage/usage-client` (unchanged; props `jobId, projectId, date, dateLabel, scope, plant, rows, summary, currentUserId`); `hoursBetween`, `fmtDuration`, `fmtTimeAU` (Task 2); `parseWorkKind`, `workHref` (Task 1).
- Produces: `/field/work/[kind]/[id]/day`, with `?date=<yesterday>`; `/field/waste?job=<id>`.

- [ ] **Step 1: Write the Day sheet page**

Create `src/app/field/work/[kind]/[id]/day/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronRightIcon, TruckIcon } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU, yesterdayAU } from '@/lib/tz'
import { parseWorkKind, workHref } from '@/lib/live-work'
import { fmtDuration, fmtTimeAU, hoursBetween } from '@/lib/field-today'
import {
  UsageClient,
  type PlantOption,
  type ScopeLine,
  type UsageRow,
} from '@/app/field/usage/usage-client'

export default async function WorkDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>
  searchParams: Promise<{ date?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { kind: rawKind, id } = await params
  const kind = parseWorkKind(rawKind)
  if (!kind) notFound()
  const sp = await searchParams

  const jobId = kind === 'job' ? id : null
  const projectId = kind === 'project' ? id : null
  const col = kind === 'job' ? 'job_id' : 'project_id'

  const today = todayAU()
  const yesterday = yesterdayAU()
  const date = sp.date === yesterday ? yesterday : today

  const supabase = await createClient()

  const [{ data: options }, { data: usageRows }, { data: note }, { data: hourRows }] =
    await Promise.all([
      supabase.rpc('field_usage_options', { p_job: jobId, p_project: projectId }),
      supabase
        .from('field_usage')
        .select(
          'id, user_id, kind, description, qty, unit, company, headcount, hours, notes, quote_line_id, rate_item_id, plant_id, created_at, profiles!field_usage_user_id_fkey(full_name)'
        )
        .eq('date', date)
        .eq(col, id)
        .order('created_at', { ascending: true }),
      supabase.from('field_day_notes').select('summary').eq('date', date).eq(col, id).maybeSingle(),
      supabase
        .from('timesheet_entries')
        .select('id, start_at, end_at')
        .eq('user_id', profile.id)
        .eq('date', date)
        .eq(col, id)
        .order('start_at'),
    ])

  const opts = (options ?? {}) as { scope?: ScopeLine[]; plant?: PlantOption[] }

  const rows: UsageRow[] = (usageRows ?? []).map((r) => {
    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
    return {
      id: r.id as string,
      user_id: r.user_id as string,
      kind: r.kind as UsageRow['kind'],
      description: r.description as string,
      qty: r.qty == null ? null : Number(r.qty),
      unit: (r.unit as string | null) ?? null,
      company: (r.company as string | null) ?? null,
      headcount: r.headcount == null ? null : Number(r.headcount),
      hours: r.hours == null ? null : Number(r.hours),
      notes: (r.notes as string | null) ?? null,
      quote_line_id: (r.quote_line_id as string | null) ?? null,
      rate_item_id: (r.rate_item_id as string | null) ?? null,
      plant_id: (r.plant_id as string | null) ?? null,
      created_at: r.created_at as string,
      logged_by: (p as { full_name?: string } | null)?.full_name ?? null,
    }
  })

  const now = new Date()
  const hours = (hourRows ?? []).map((h) => ({
    id: h.id as string,
    start: h.start_at as string,
    end: (h.end_at as string | null) ?? null,
    hours: hoursBetween(h.start_at as string, (h.end_at as string | null) ?? null, now),
  }))
  const totalHours = hours.reduce((sum, h) => sum + h.hours, 0)
  const base = workHref(kind, id, 'day')

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-1 rounded-lg border p-1">
        <Link
          href={base}
          className={`rounded-md px-3 py-1.5 text-center text-sm font-medium ${
            date === today ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
          }`}
        >
          Today
        </Link>
        <Link
          href={`${base}?date=${yesterday}`}
          className={`rounded-md px-3 py-1.5 text-center text-sm font-medium ${
            date === yesterday ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
          }`}
        >
          Yesterday
        </Link>
      </div>

      <section className="flex flex-col gap-1 rounded-xl border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Your hours</h2>
          <span className="text-sm font-medium tabular-nums">
            {hours.length > 0 ? fmtDuration(totalHours) : '—'}
          </span>
        </div>
        {hours.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No time on this job {date === today ? 'today' : 'yesterday'}. Check in on the
            Today tab.
          </p>
        ) : (
          hours.map((h) => (
            <p key={h.id} className="text-xs tabular-nums text-muted-foreground">
              {fmtTimeAU(h.start)} – {h.end ? fmtTimeAU(h.end) : 'now'} · {fmtDuration(h.hours)}
            </p>
          ))
        )}
      </section>

      <UsageClient
        key={date}
        jobId={jobId}
        projectId={projectId}
        date={date}
        dateLabel={date === today ? 'today' : 'yesterday'}
        scope={opts.scope ?? []}
        plant={opts.plant ?? []}
        rows={rows}
        summary={(note?.summary as string | undefined) ?? ''}
        currentUserId={profile.id}
      />

      <Link
        href={`/field/waste?${kind}=${id}`}
        className="flex items-center gap-3 rounded-xl border p-4 transition-colors hover:bg-muted/50 active:bg-muted"
      >
        <TruckIcon className="size-6 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold">Log waste load</span>
          <span className="text-xs text-muted-foreground">
            Waste or spoil leaving site — photograph the docket
          </span>
        </div>
        <ChevronRightIcon className="ml-auto size-4 shrink-0 text-muted-foreground" />
      </Link>
    </div>
  )
}
```

- [ ] **Step 2: Turn the old address into a redirect**

Replace the whole of `src/app/field/usage/page.tsx` with:

```tsx
import { redirect } from 'next/navigation'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The materials and plant log now lives on the job screen's Day sheet tab.
// Old links (bookmarks, the pre-redesign My Day button) land here.
export default async function FieldUsageRedirect({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; project?: string; date?: string }>
}) {
  const sp = await searchParams
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? `?date=${sp.date}` : ''
  if (sp.job && UUID_RE.test(sp.job)) redirect(`/field/work/job/${sp.job}/day${date}`)
  if (sp.project && UUID_RE.test(sp.project)) {
    redirect(`/field/work/project/${sp.project}/day${date}`)
  }
  redirect('/field/jobs')
}
```

`usage-client.tsx` and `actions.ts` stay in `src/app/field/usage/`.

- [ ] **Step 3: Revalidate the new address after a save**

In `src/app/field/usage/actions.ts`, replace every `revalidatePath('/field/usage')` (four of them) with:

```ts
  revalidatePath('/field', 'layout')
```

- [ ] **Step 4: Let the waste form preselect a job**

In `src/app/field/waste/page.tsx`:

1. Change the `searchParams` type to `Promise<{ project?: string; job?: string }>`.
2. After the `defaultProjectId` line add:

```ts
  const defaultJobId =
    !defaultProjectId && sp.job && jobs.some((j) => j.id === sp.job) ? sp.job : null
```

3. Replace the "Back" link's `href="/field/safety"` and its label `Safety` with:

```tsx
          href={
            defaultProjectId
              ? `/field/work/project/${defaultProjectId}/day`
              : defaultJobId
                ? `/field/work/job/${defaultJobId}/day`
                : '/field/safety'
          }
```

and the label text with `{defaultProjectId || defaultJobId ? 'Day sheet' : 'Safety'}`.

4. Pass the new prop: `<FieldWasteForm … defaultProjectId={defaultProjectId} defaultJobId={defaultJobId} />`.

In `src/app/field/waste/waste-form.tsx`:

1. Add `defaultJobId` to the destructured props and `defaultJobId: string | null` to the props type, beside `defaultProjectId`.
2. Change the initial state line `job_id: '',` to `job_id: defaultProjectId ? '' : (defaultJobId ?? ''),`.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

Run: `npx eslint "src/app/field/work" src/app/field/usage src/app/field/waste`
Expected: no errors.

With the dev server running: open the Day sheet tab on `RP26020`. Expected: Today / Yesterday switch, "Your hours", the existing materials log, a "Log waste load" link that opens the waste form with the project already chosen and a "Day sheet" back link. Open `/field/usage?project=<that id>` — expected: lands on the Day sheet tab.

- [ ] **Step 6: Commit**

```bash
git add "src/app/field/work" src/app/field/usage src/app/field/waste
git commit -m "feat(field): day sheet tab with own hours, materials log and waste link"
```

---

### Task 7: Photos and Diary tabs

**Files:**
- Modify: `src/app/field/photo/capture-client.tsx`
- Create: `src/app/field/work/[kind]/[id]/photos/page.tsx`
- Create: `src/app/field/work/[kind]/[id]/diary/page.tsx`
- Modify: `src/app/field/diary/[projectId]/page.tsx` (becomes a redirect)
- Modify: `src/app/field/diary/[projectId]/actions.ts:18`
- Modify: `src/app/(office)/projects/[id]/diary/actions.ts:104`

**Interfaces:**
- Consumes: `CaptureClient`, `CaptureTarget` from `@/app/field/photo/capture-client`; `DiaryForm` and its types from `@/app/field/diary/[projectId]/diary-form` (props `projectId, date, diary, labour, plant, photos, plantOptions, suggestions`); `fetchAttachmentsWithUrls` from `@/lib/attachment-queries`; `fetchWorkHeader` (Task 3).
- Produces: `CaptureClient` prop `fixedTarget?: CaptureTarget`; the two tab pages.

- [ ] **Step 1: Give the capture screen a fixed target**

In `src/app/field/photo/capture-client.tsx`:

1. Add to `CaptureClientProps`:

```ts
  /** Set on the job screen: capture against this target and hide the picker. */
  fixedTarget?: CaptureTarget
```

2. Add `fixedTarget` to the destructured props of `CaptureClient`.
3. Change the initial selected target from `recentTargets[0] ?? null` to:

```ts
    fixedTarget ?? recentTargets[0] ?? null
```

4. Wrap the picker in the returned JSX:

```tsx
      {/* Target picker — not shown when the job screen fixes the target */}
      {!fixedTarget && (
        <TargetPicker
          recentTargets={recentTargets}
          allTargets={allTargets}
          selected={selectedTarget}
          onSelect={handleTargetSelect}
        />
      )}
```

Nothing else changes: the mount effect already loads the selected target's recent uploads.

- [ ] **Step 2: Write the Photos tab**

Create `src/app/field/work/[kind]/[id]/photos/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU } from '@/lib/tz'
import { parseWorkKind } from '@/lib/live-work'
import { fetchWorkHeader } from '@/lib/field-work-queries'
import { CaptureClient } from '@/app/field/photo/capture-client'

export default async function WorkPhotosPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { kind: rawKind, id } = await params
  const kind = parseWorkKind(rawKind)
  if (!kind) notFound()

  const supabase = await createClient()
  const header = await fetchWorkHeader(supabase, kind, id)
  if (!header) notFound()

  return (
    <CaptureClient
      recentTargets={[]}
      allTargets={[]}
      today={todayAU()}
      fixedTarget={{ id, type: kind, number: header.number, label: header.title }}
    />
  )
}
```

- [ ] **Step 3: Write the Diary tab**

Create `src/app/field/work/[kind]/[id]/diary/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAttachmentsWithUrls } from '@/lib/attachment-queries'
import { todayAU, yesterdayAU } from '@/lib/tz'
import { parseWorkKind, workHref } from '@/lib/live-work'
import {
  DiaryForm,
  type DiaryData,
  type LabourRow,
  type PlantRow,
  type PlantOption,
  type LabourSuggestion,
} from '@/app/field/diary/[projectId]/diary-form'

export default async function WorkDiaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>
  searchParams: Promise<{ date?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { kind: rawKind, id: projectId } = await params
  // The diary table belongs to projects only.
  if (parseWorkKind(rawKind) !== 'project') notFound()
  const { date: rawDate } = await searchParams

  const todayStr = todayAU()
  const yesterdayStr = yesterdayAU()
  // Today + yesterday (backfill) only — anything else falls back to today.
  const date = rawDate === yesterdayStr ? yesterdayStr : todayStr

  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, status')
    .eq('id', projectId)
    .single()
  if (!project) notFound()

  const [{ data: diaryRow }, { data: plantRows }, { data: assignmentRows }] =
    await Promise.all([
      supabase
        .from('diaries')
        .select('id, weather, work_performed, delays, instructions, visitors, created_by')
        .eq('project_id', projectId)
        .eq('date', date)
        .maybeSingle(),
      supabase.from('plant').select('id, name, type').eq('active', true).order('name'),
      supabase
        .from('assignments')
        .select('user_id, profiles!assignments_user_id_fkey(full_name)')
        .eq('project_id', projectId)
        .eq('date', date),
    ])

  const diary: DiaryData | null = diaryRow
    ? {
        id: diaryRow.id,
        weather: diaryRow.weather ?? null,
        work_performed: diaryRow.work_performed ?? '',
        delays: diaryRow.delays ?? '',
        instructions: diaryRow.instructions ?? '',
        visitors: diaryRow.visitors ?? '',
      }
    : null

  let labour: LabourRow[] = []
  let plant: PlantRow[] = []
  let photos: Awaited<ReturnType<typeof fetchAttachmentsWithUrls>> = []

  if (diaryRow) {
    const [{ data: labourRows }, { data: diaryPlantRows }, attachments] = await Promise.all([
      supabase
        .from('diary_labour')
        .select('id, user_id, name, trade, headcount, hours')
        .eq('diary_id', diaryRow.id)
        .order('id'),
      supabase
        .from('diary_plant')
        .select('id, plant_id, name, status, hours')
        .eq('diary_id', diaryRow.id)
        .order('id'),
      fetchAttachmentsWithUrls(supabase, 'diary', diaryRow.id),
    ])

    labour = (labourRows ?? []).map((r) => ({
      id: r.id,
      user_id: r.user_id ?? null,
      name: r.name,
      trade: r.trade ?? null,
      headcount: Number(r.headcount),
      hours: Number(r.hours),
    }))
    plant = (diaryPlantRows ?? []).map((r) => ({
      id: r.id,
      plant_id: r.plant_id ?? null,
      name: r.name,
      status: r.status as PlantRow['status'],
      hours: Number(r.hours),
    }))
    photos = attachments
  }

  const plantOptions: PlantOption[] = (plantRows ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type ?? null,
  }))

  // Suggestion chips: people scheduled on this project on the diary date.
  const seen = new Set<string>()
  const suggestions: LabourSuggestion[] = []
  for (const row of assignmentRows ?? []) {
    const profileRel = row.profiles as unknown as { full_name: string } | null
    if (!row.user_id || !profileRel || seen.has(row.user_id)) continue
    seen.add(row.user_id)
    suggestions.push({ user_id: row.user_id, name: profileRel.full_name })
  }

  const base = workHref('project', projectId, 'diary')

  return (
    <div className="flex flex-col gap-4">
      {/* Date toggle: today + yesterday backfill */}
      <div className="grid grid-cols-2 gap-2">
        <Link
          href={base}
          className={
            date === todayStr
              ? 'rounded-xl border-2 border-foreground px-3 py-2 text-center text-sm font-semibold'
              : 'rounded-xl border px-3 py-2 text-center text-sm text-muted-foreground'
          }
        >
          Today
        </Link>
        <Link
          href={`${base}?date=${yesterdayStr}`}
          className={
            date === yesterdayStr
              ? 'rounded-xl border-2 border-foreground px-3 py-2 text-center text-sm font-semibold'
              : 'rounded-xl border px-3 py-2 text-center text-sm text-muted-foreground'
          }
        >
          Yesterday
        </Link>
      </div>

      {project.status === 'closed' ? (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          This project is closed — diary entries are no longer accepted.
        </p>
      ) : (
        <DiaryForm
          projectId={projectId}
          date={date}
          diary={diary}
          labour={labour}
          plant={plant}
          photos={photos}
          plantOptions={plantOptions}
          suggestions={suggestions}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Redirect the old diary address**

Replace the whole of `src/app/field/diary/[projectId]/page.tsx` with:

```tsx
import { redirect } from 'next/navigation'

// The diary now lives on the project screen's Diary tab.
export default async function FieldDiaryRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ date?: string }>
}) {
  const { projectId } = await params
  const { date } = await searchParams
  const suffix = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `?date=${date}` : ''
  redirect(`/field/work/project/${projectId}/diary${suffix}`)
}
```

`diary-form.tsx` and `actions.ts` stay in `src/app/field/diary/[projectId]/` — the office diary screen imports those actions.

- [ ] **Step 5: Revalidate the new diary address**

In `src/app/field/diary/[projectId]/actions.ts` line 18 and in `src/app/(office)/projects/[id]/diary/actions.ts` line 104, replace

```ts
  revalidatePath(`/field/diary/${projectId}`)
```

with

```ts
  revalidatePath(`/field/work/project/${projectId}/diary`)
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

Run: `npx eslint "src/app/field/work" src/app/field/photo src/app/field/diary "src/app/(office)/projects/[id]/diary/actions.ts"`
Expected: no errors.

With the dev server running on `RP26020`: the Photos tab shows the capture screen with no target picker; the Diary tab shows the diary form; `/field/diary/<project id>` lands on the Diary tab; `/field/work/job/<any job id>/diary` is a 404; `/field/photo` still shows the picker.

- [ ] **Step 7: Commit**

```bash
git add "src/app/field/work" src/app/field/photo src/app/field/diary "src/app/(office)/projects/[id]/diary/actions.ts"
git commit -m "feat(field): photos and diary tabs on the job screen"
```

---

### Task 8: SWMS and Pre-start tabs

**Files:**
- Modify: `src/lib/swms-queries.ts` (`fetchMyFieldSwms`)
- Create: `src/app/field/work/[kind]/[id]/swms/page.tsx`
- Create: `src/app/field/work/[kind]/[id]/prestart/page.tsx`
- Modify: `src/app/field/safety/new/[templateId]/page.tsx:116-122`
- Modify: `src/app/field/safety/submission/[id]/page.tsx:190-196` and `:371`

**Interfaces:**
- Consumes: `FieldSwmsCard` from `@/components/FieldSwmsCard`; `FORM_KIND_LABELS`, `FORM_KIND_ORDER` from `@/lib/form-kinds`; `FormTemplateKind` from `@/lib/zod`; `fmtDate` from `@/lib/format`; `fmtTimeAU` (Task 2); `workHref`, `parseWorkKind` (Task 1).
- Produces: `fetchMyFieldSwms(supabase, profileId, work?: { kind: 'job' | 'project'; id: string })`; the two tab pages.

Locking is unchanged: a submitted form cannot be edited, its author can amend it. This task adds no unlock.

- [ ] **Step 1: Let the SWMS loader filter to one job**

In `src/lib/swms-queries.ts`, change the signature of `fetchMyFieldSwms` to:

```ts
export async function fetchMyFieldSwms(
  supabase: SupabaseClient,
  profileId: string,
  /** When set, only SWMS issued to this job or project. */
  work?: { kind: 'job' | 'project'; id: string }
): Promise<FieldSwmsItem[]> {
```

Directly above the `const [{ data: assignments }, { data: instances }] = await Promise.all([` line add:

```ts
  let instanceQuery = supabase
    .from('swms_instances')
    .select(
      'id, title, version, status, project_id, job_id, created_at, projects(number, name), jobs(number, title)'
    )
    .eq('status', 'active')
    .order('created_at', { ascending: false })
  if (work) {
    instanceQuery = instanceQuery.eq(work.kind === 'job' ? 'job_id' : 'project_id', work.id)
  }
```

and replace the second element of that `Promise.all` (the whole `supabase.from('swms_instances')…order(…)` expression) with `instanceQuery`.

- [ ] **Step 2: Write the SWMS tab**

Create `src/app/field/work/[kind]/[id]/swms/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation'
import { ShieldCheckIcon } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { parseWorkKind } from '@/lib/live-work'
import { fetchMyFieldSwms } from '@/lib/swms-queries'
import { FieldSwmsCard } from '@/components/FieldSwmsCard'

export default async function WorkSwmsPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { kind: rawKind, id } = await params
  const kind = parseWorkKind(rawKind)
  if (!kind) notFound()

  const supabase = await createClient()
  const items = await fetchMyFieldSwms(supabase, profile.id, { kind, id })

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border px-4 py-3 text-sm text-muted-foreground">
        <ShieldCheckIcon className="size-5 shrink-0" />
        No SWMS has been issued to this job yet.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <FieldSwmsCard key={item.id} item={item} />
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Write the Pre-start tab**

Create `src/app/field/work/[kind]/[id]/prestart/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { CheckCircle2Icon, ChevronRightIcon, ShieldCheckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU } from '@/lib/tz'
import { fmtDate } from '@/lib/format'
import { fmtTimeAU } from '@/lib/field-today'
import { parseWorkKind } from '@/lib/live-work'
import { FORM_KIND_LABELS, FORM_KIND_ORDER } from '@/lib/form-kinds'
import type { FormTemplateKind } from '@/lib/zod'

type SubmissionRow = {
  id: string
  kind: string
  submitted_at: string
  by: string | null
  name: string | null
}

export default async function WorkPrestartPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { kind: rawKind, id } = await params
  const kind = parseWorkKind(rawKind)
  if (!kind) notFound()

  const col = kind === 'job' ? 'job_id' : 'project_id'
  const target = `${kind}=${id}`
  // Brisbane is fixed +10 — the AU day starts at T00:00:00+10:00.
  const dayStartMs = new Date(`${todayAU()}T00:00:00+10:00`).getTime()

  const supabase = await createClient()
  const [{ data: templates }, { data: rawSubmissions }] = await Promise.all([
    supabase
      .from('form_templates')
      .select('id, kind, name, version')
      .eq('active', true)
      // Audit checklists are run from the office audit page, not the field.
      .neq('kind', 'audit')
      .order('version', { ascending: false }),
    supabase
      .from('form_submissions')
      .select(
        'id, kind, submitted_at, form_templates(name), profiles!form_submissions_submitted_by_fkey(full_name)'
      )
      .eq(col, id)
      .order('submitted_at', { ascending: false })
      .limit(40),
  ])

  const submissions: SubmissionRow[] = (rawSubmissions ?? []).map((s) => ({
    id: s.id as string,
    kind: s.kind as string,
    submitted_at: s.submitted_at as string,
    by: (s.profiles as unknown as { full_name: string } | null)?.full_name ?? null,
    name: (s.form_templates as unknown as { name: string } | null)?.name ?? null,
  }))

  const meetings = submissions.filter((s) => s.kind === 'prestart_meeting')
  const todaysMeeting =
    meetings.find((m) => new Date(m.submitted_at).getTime() >= dayStartMs) ?? null
  const earlier = meetings.filter((m) => m.id !== todaysMeeting?.id).slice(0, 14)
  const otherRecent = submissions.filter((s) => s.kind !== 'prestart_meeting').slice(0, 10)

  // Templates come newest version first, so the first prestart_meeting is current.
  const meetingTemplate = (templates ?? []).find((t) => t.kind === 'prestart_meeting') ?? null
  const otherTemplates = (templates ?? [])
    .filter((t) => t.kind !== 'prestart_meeting')
    .sort(
      (a, b) =>
        FORM_KIND_ORDER.indexOf(a.kind as FormTemplateKind) -
        FORM_KIND_ORDER.indexOf(b.kind as FormTemplateKind)
    )

  let signedOn = 0
  if (todaysMeeting) {
    const { count } = await supabase
      .from('form_signons')
      .select('id', { count: 'exact', head: true })
      .eq('submission_id', todaysMeeting.id)
    signedOn = count ?? 0
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Today's pre-start meeting */}
      {todaysMeeting ? (
        <Link
          href={`/field/safety/submission/${todaysMeeting.id}`}
          className="flex items-center gap-3 rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-3"
        >
          <CheckCircle2Icon className="size-5 shrink-0 text-green-600 dark:text-green-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Pre-start meeting done</p>
            <p className="truncate text-xs text-muted-foreground">
              {todaysMeeting.by ?? 'Someone'} · {fmtTimeAU(todaysMeeting.submitted_at)} ·{' '}
              {signedOn} signed on
            </p>
          </div>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      ) : meetingTemplate ? (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-sm font-semibold">No pre-start meeting yet today</p>
          </div>
          <Button
            className="w-full"
            render={<Link href={`/field/safety/new/${meetingTemplate.id}?${target}`} />}
          >
            Start pre-start meeting
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No pre-start meeting form is set up. Ask the office to add one in Settings.
        </p>
      )}

      {/* Earlier pre-starts */}
      {earlier.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Earlier on this job
          </h2>
          <div className="flex flex-col divide-y rounded-xl border">
            {earlier.map((m) => (
              <Link
                key={m.id}
                href={`/field/safety/submission/${m.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="text-sm">{fmtDate(m.submitted_at)}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {m.by ?? ''}
                  <ChevronRightIcon className="size-4" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Other forms */}
      {otherTemplates.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Other forms for this job
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {otherTemplates.map((t) => (
              <Link
                key={t.id}
                href={`/field/safety/new/${t.id}?${target}`}
                className="flex min-h-16 items-center rounded-xl border p-3 text-sm font-semibold leading-snug transition-colors hover:bg-muted/50 active:bg-muted"
              >
                {t.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {otherRecent.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recently filed on this job
          </h2>
          <div className="flex flex-col divide-y rounded-xl border">
            {otherRecent.map((s) => (
              <Link
                key={s.id}
                href={`/field/safety/submission/${s.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {s.name ?? FORM_KIND_LABELS[s.kind as FormTemplateKind] ?? 'Form'}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{s.by ?? ''}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {fmtDate(s.submitted_at)}
                  <ChevronRightIcon className="size-4" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        A submitted form can&apos;t be edited. Whoever filed it can amend it, which keeps the
        original.
      </p>
    </div>
  )
}
```

If more than one active template shares a kind (two versions of the pre-start meeting both active), `otherTemplates` may list an older version; that matches how `/field/safety` lists templates today, so leave it.

- [ ] **Step 4: Send the form's Back link to the job**

In `src/app/field/safety/new/[templateId]/page.tsx`, replace the `<Link href="/field/safety" …>` block (the back link, including its `<ArrowLeftIcon …/>` and the text `Safety`) with:

```tsx
        <Link
          href={
            defaultProjectId
              ? `/field/work/project/${defaultProjectId}/prestart`
              : defaultJobId
                ? `/field/work/job/${defaultJobId}/prestart`
                : '/field/safety'
          }
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          {defaultProjectId || defaultJobId ? 'Back to job' : 'Safety'}
        </Link>
```

- [ ] **Step 5: Send the submission's Back and Done to the job**

In `src/app/field/safety/submission/[id]/page.tsx`, directly above the `return (` of `FormSubmissionPage` add:

```tsx
  const backHref = submission.project_id
    ? `/field/work/project/${submission.project_id}/prestart`
    : submission.job_id
      ? `/field/work/job/${submission.job_id}/prestart`
      : '/field/safety'
  const backLabel = submission.project_id || submission.job_id ? 'Back to job' : 'Safety'
```

Then change the back link at the top from `href="/field/safety"` to `href={backHref}` and its text `Safety` to `{backLabel}`, and change the Done button at the bottom from `render={<Link href="/field/safety" />}` to `render={<Link href={backHref} />}`.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

Run: `npm test`
Expected: all pass.

Run: `npx eslint "src/app/field/work" src/app/field/safety src/lib/swms-queries.ts`
Expected: no errors.

With the dev server running on `RP26020`: the SWMS tab lists that project's active SWMS (or the empty message); `/field/safety` still lists every SWMS. The Pre-start tab shows either today's meeting or the Start button; Start opens the form with the project already chosen and a "Back to job" link.

- [ ] **Step 7: Commit**

```bash
git add "src/app/field/work" src/app/field/safety src/lib/swms-queries.ts
git commit -m "feat(field): swms and pre-start tabs scoped to the job"
```

---

### Task 9: Docs tab and the office "Show to crew" tick

**Files:**
- Create: `supabase/migrations/0078_attachment_field_visible.sql`
- Modify: `src/lib/attachment-queries.ts`
- Modify: `src/lib/attachments.ts`
- Modify: `src/components/AttachmentList.tsx`
- Modify: `src/app/(office)/jobs/[id]/page.tsx:525-529`
- Modify: `src/app/(office)/projects/[id]/documents/page.tsx:100`
- Create: `src/app/field/work/[kind]/[id]/docs/page.tsx`

**Interfaces:**
- Consumes: `parseWorkKind` (Task 1); `fmtDate` from `@/lib/format`.
- Produces: column `attachments.field_visible boolean not null default false`; `AttachmentRow.field_visible: boolean`; `setAttachmentFieldVisible(id, visible): Promise<{ error?: string }>`; `AttachmentList` prop `canCrew?: boolean`; the Docs tab.

`field_visible` is a display filter, not security. Crew can already read job and project attachments under migration 0019; the tick only decides what the Docs tab lists.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0078_attachment_field_visible.sql`:

```sql
-- 0078: crew-facing curation flag on attachments.
--
-- The field job screen's Docs tab lists only job/project documents the office
-- has ticked "Show to crew". This is a DISPLAY filter, not a security
-- boundary: migration 0019 already lets supervisor/field read job and project
-- attachments. No policy changes — attachments_update_admin_office already
-- limits who can flip it.

alter table attachments
  add column field_visible boolean not null default false;

comment on column attachments.field_visible is
  'Office-set: list this job/project document on the field Docs tab.';
```

- [ ] **Step 2: Get the owner's go-ahead, then apply it**

Stop and ask the owner before this step. Until the column exists on the live database, Steps 3 onward break every attachment list (the select names the column).

On approval, apply the file through the Supabase SQL editor (project ref `zspauxavbhtutanhekuu`) and record the history row:

```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('20261120090000', '0078_attachment_field_visible');
```

Check: `select column_name from information_schema.columns where table_name = 'attachments' and column_name = 'field_visible';`
Expected: one row.

- [ ] **Step 3: Carry the flag through the attachment loader**

In `src/lib/attachment-queries.ts`:

1. Add to `AttachmentRow`, under `client_visible`:

```ts
  /** Crew curation flag — list on the field Docs tab. */
  field_visible: boolean
```

2. In `ATTACHMENT_SELECT`, change `client_visible, created_by` to `client_visible, field_visible, created_by`.
3. In `shapeRow`, under the `client_visible:` line add:

```ts
    field_visible: Boolean(r.field_visible),
```

- [ ] **Step 4: Add the toggle action**

In `src/lib/attachments.ts`, directly below `setAttachmentClientVisible`, add:

```ts
/**
 * Crew curation: flips an attachment's field_visible flag, which decides
 * whether the field job screen's Docs tab lists it. Admin/office only, and
 * only on job/project attachments. A display filter, not a security boundary.
 */
export async function setAttachmentFieldVisible(
  id: string,
  visible: boolean
): Promise<{ error?: string }> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated' }
  if (profile.role !== 'admin' && profile.role !== 'office') {
    return { error: 'Only admin/office can change what the crew sees' }
  }

  const supabase = await createClient()

  const { data: row } = await supabase
    .from('attachments')
    .select('id, parent_type, parent_id')
    .eq('id', id)
    .maybeSingle()
  if (!row) return { error: 'Attachment not found' }
  if (row.parent_type !== 'job' && row.parent_type !== 'project') {
    return { error: 'Only job and project documents can be shown to the crew' }
  }

  const { error } = await supabase
    .from('attachments')
    .update({ field_visible: visible })
    .eq('id', id)
  if (error) return { error: error.message }

  await revalidateParent(supabase, row.parent_type, row.parent_id)
  revalidatePath(`/field/work/${row.parent_type}/${row.parent_id}/docs`)
  return {}
}
```

- [ ] **Step 5: Add the tick to the office document list**

In `src/components/AttachmentList.tsx`:

1. Change the import from `@/lib/attachments` to include the new action:

```ts
import {
  deleteAttachment,
  setAttachmentClientVisible,
  setAttachmentFieldVisible,
} from '@/lib/attachments'
```

and add `HardHatIcon` to the existing `lucide-react` import.

2. Add to `AttachmentItem`, under `client_visible?`:

```ts
  /** Crew curation flag; only meaningful when canCrew is set. */
  field_visible?: boolean
```

3. Add to `AttachmentListProps`, under `canCurate?`:

```ts
  /**
   * Shows the per-document "Show to crew" toggle (admin/office on job/project
   * documents) — decides what the field Docs tab lists.
   */
  canCrew?: boolean
```

4. Directly below the `useClientVisibleToggle` function add:

```tsx
// ─── Crew-visibility toggle (field Docs tab) ─────────────────────────────────

function useFieldVisibleToggle() {
  const [, startTransition] = useTransition()
  const [togglingId, setTogglingId] = useState<string | null>(null)

  function toggle(item: AttachmentItem) {
    const next = !item.field_visible
    setTogglingId(item.id)
    startTransition(async () => {
      const result = await setAttachmentFieldVisible(item.id, next)
      setTogglingId(null)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(
          next
            ? `${item.filename} now shows to the crew`
            : `${item.filename} hidden from the crew`
        )
      }
    })
  }

  return { toggle, togglingId }
}
```

5. Add to `DocListProps`:

```ts
  canCrew?: boolean
  onCrew?: (item: AttachmentItem) => void
  crewing?: string | null
```

and add `canCrew, onCrew, crewing` to `DocList`'s destructured parameters.

6. In `DocList`, directly above the `{canCurate && onCurate && (` block, add:

```tsx
            {canCrew && onCrew && (
              <button
                type="button"
                onClick={() => onCrew(doc)}
                disabled={crewing === doc.id}
                aria-pressed={Boolean(doc.field_visible)}
                aria-label={
                  doc.field_visible
                    ? `Hide ${doc.filename} from the crew`
                    : `Show ${doc.filename} to the crew`
                }
                title={doc.field_visible ? 'Shown to the crew' : 'Show to crew'}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium focus:outline-none ${
                  doc.field_visible
                    ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300'
                    : 'border-transparent text-muted-foreground'
                }`}
              >
                <HardHatIcon className="size-3.5" />
                {doc.field_visible ? 'Crew' : ''}
              </button>
            )}
```

7. In `AttachmentList`, change the signature to `({ items, canDelete, canCurate, canCrew }: AttachmentListProps)`, add below the `useClientVisibleToggle()` line:

```ts
  const { toggle: handleCrew, togglingId: crewingId } = useFieldVisibleToggle()
```

and pass three more props to `<DocList … />`:

```tsx
          canCrew={canCrew}
          onCrew={handleCrew}
          crewing={crewingId}
```

- [ ] **Step 6: Turn the tick on at the two office call sites**

In `src/app/(office)/jobs/[id]/page.tsx`, on the `<AttachmentList items={docItems} … />` (the second one, in the Documents section), add `canCrew={canDeleteAttachment}`.

In `src/app/(office)/projects/[id]/documents/page.tsx`, on `<AttachmentList items={documents} … />`, add `canCrew={canUpload}`.

Both pages pass rows straight from `fetchAttachmentsWithUrls`, so `field_visible` arrives without further change.

- [ ] **Step 7: Write the Docs tab**

Create `src/app/field/work/[kind]/[id]/docs/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronRightIcon, FileTextIcon } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fmtDate } from '@/lib/format'
import { parseWorkKind } from '@/lib/live-work'

export default async function WorkDocsPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { kind: rawKind, id } = await params
  const kind = parseWorkKind(rawKind)
  if (!kind) notFound()

  const supabase = await createClient()
  const { data: rows } = await supabase
    .from('attachments')
    .select('id, filename, caption, path, created_at')
    .eq('parent_type', kind)
    .eq('parent_id', id)
    .eq('field_visible', true)
    .in('kind', ['document', 'pdf'])
    .order('created_at', { ascending: false })

  // Private bucket — one-hour links, signed server-side.
  const urlByPath = new Map<string, string>()
  const paths = (rows ?? []).map((r) => r.path as string)
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from('attachments')
      .createSignedUrls(paths, 3600)
    for (const entry of signed ?? []) {
      if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Job documents
        </h2>
        {(rows ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            The office hasn&apos;t shared any documents for this job yet.
          </p>
        ) : (
          <div className="flex flex-col divide-y rounded-xl border">
            {(rows ?? []).map((doc) => {
              const url = urlByPath.get(doc.path as string)
              const body = (
                <>
                  <span className="flex min-w-0 items-center gap-2">
                    <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">
                        {doc.filename as string}
                      </span>
                      {doc.caption && (
                        <span className="truncate text-xs text-muted-foreground">
                          {doc.caption as string}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {fmtDate(doc.created_at as string)}
                  </span>
                </>
              )
              return url ? (
                <a
                  key={doc.id as string}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors active:bg-muted"
                >
                  {body}
                </a>
              ) : (
                <span
                  key={doc.id as string}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-muted-foreground"
                >
                  {body}
                </span>
              )
            })}
          </div>
        )}
      </section>

      <Link
        href="/field/safety"
        className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium"
      >
        Company documents
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </Link>

      <p className="text-xs text-muted-foreground">Read only. Shared by the office.</p>
    </div>
  )
}
```

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

Run: `npm test`
Expected: all pass. If a test builds an `AttachmentRow` literal and now fails to compile, add `field_visible: false` to that literal.

Run: `npx eslint src/components/AttachmentList.tsx src/lib/attachments.ts src/lib/attachment-queries.ts "src/app/field/work"`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/0078_attachment_field_visible.sql src/lib/attachment-queries.ts src/lib/attachments.ts src/components/AttachmentList.tsx "src/app/(office)/jobs/[id]/page.tsx" "src/app/(office)/projects/[id]/documents/page.tsx" "src/app/field/work"
git commit -m "feat(field): docs tab listing documents the office shows to crew"
```

---

### Task 10: Bottom bar, My Day and the last redirect

**Files:**
- Modify: `src/app/field/field-tabs.tsx`
- Modify: `src/app/field/page.tsx`
- Modify: `src/app/field/my-day-client.tsx`
- Modify: `src/app/field/diary/page.tsx` (becomes a redirect)
- Delete: `src/app/field/diary/project-picker.tsx`

**Interfaces:**
- Consumes: `fetchLiveWork`, `fetchScheduledKeys` (Task 3); `workHref`, `workKey`, `LiveWorkRow` (Task 1); the loosened `createManualEntry` (Task 5).
- Produces: the four-item bar; My Day cards with Open job; a Pick another job card; a Quick photo link; manual time on any live job.

This is the task the crew see. Everything before it was reachable only by typing an address.

- [ ] **Step 1: Replace the bottom bar**

Replace the whole of `src/app/field/field-tabs.tsx` with:

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BriefcaseIcon, HardHatIcon, SunIcon, WrenchIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const TABS = [
  { label: 'My Day', href: '/field', icon: SunIcon },
  { label: 'Jobs', href: '/field/jobs', icon: BriefcaseIcon },
  { label: 'Safety', href: '/field/safety', icon: HardHatIcon },
  { label: 'Maintenance', href: '/field/maintenance', icon: WrenchIcon },
]

function isActive(href: string, pathname: string): boolean {
  if (href === '/field') return pathname === '/field'
  if (pathname === href || pathname.startsWith(`${href}/`)) return true
  // The job screen lives under /field/work but belongs to Jobs.
  if (href === '/field/jobs') return pathname.startsWith('/field/work/')
  // SWMS sign pages and waste-load logging belong to Safety.
  if (href === '/field/safety') {
    return pathname.startsWith('/field/swms') || pathname.startsWith('/field/waste')
  }
  return false
}

export function FieldTabs() {
  const pathname = usePathname()

  return (
    // pb clears the iPhone home indicator, which otherwise sits over the last
    // tab in standalone mode.
    <nav className="sticky bottom-0 z-30 mx-auto w-full max-w-md border-t bg-background pb-[env(safe-area-inset-bottom)]">
      <div className="grid grid-cols-4">
        {TABS.map((tab) => {
          const active = isActive(tab.href, pathname)
          const Icon = tab.icon
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'relative flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors',
                active
                  ? 'text-primary before:absolute before:inset-x-0 before:top-0 before:mx-auto before:h-0.5 before:w-8 before:rounded-full before:bg-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="size-5" />
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
```

- [ ] **Step 2: Redirect the old diary picker**

Replace the whole of `src/app/field/diary/page.tsx` with:

```tsx
import { redirect } from 'next/navigation'

// The diary now lives on each project's screen; pick the project from Jobs.
export default function FieldDiaryRedirect() {
  redirect('/field/jobs')
}
```

Delete `src/app/field/diary/project-picker.tsx`:

```bash
git rm src/app/field/diary/project-picker.tsx
```

- [ ] **Step 3: Feed My Day the live work list**

In `src/app/field/page.tsx`:

1. Add imports:

```tsx
import { CameraIcon, CheckCircle2Icon, ShieldCheckIcon } from 'lucide-react'
import { fetchLiveWork } from '@/lib/field-work-queries'
import { workKey } from '@/lib/live-work'
import { MyDayClient, type AssignmentCard, type OpenEntry, type TomorrowItem, type WeekSummary, type WorkOption } from './my-day-client'
```

(replacing the existing `lucide-react` and `./my-day-client` import lines).

2. Directly above the `// ─── Shape data ───` comment add:

```tsx
  // ─── Every live job and project, for manual time ─────────────────────────

  const liveWork = await fetchLiveWork(supabase)
```

3. Replace the whole `const tomorrow: TomorrowItem[] = …` statement with:

```tsx
  const tomorrow: TomorrowItem[] = (tomorrowRows ?? []).map((row) => {
    const job = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs
    const project = Array.isArray(row.projects) ? row.projects[0] : row.projects
    if (job) return { number: job.number, title: job.title }
    return { number: project!.number, title: project!.name }
  })

  // Manual time can go on any live job: scheduled ones first, then the rest.
  const scheduled = new Set(
    assignments.map((a) => workKey(a.target_type, (a.job_id ?? a.project_id) as string))
  )
  const workOptions: WorkOption[] = liveWork
    .map((w) => ({
      key: workKey(w.kind, w.id),
      label: `${w.number} — ${w.title}`,
      job_id: w.kind === 'job' ? w.id : null,
      project_id: w.kind === 'project' ? w.id : null,
    }))
    .sort(
      (a, b) =>
        Number(scheduled.has(b.key)) - Number(scheduled.has(a.key)) ||
        b.label.localeCompare(a.label, 'en', { numeric: true })
    )
```

4. Replace the `<MyDayClient … />` element and everything between it and `<CalendarFeedCard` with:

```tsx
      <MyDayClient
        assignments={assignments}
        openEntry={openEntry}
        tomorrow={tomorrow}
        weekSummary={weekSummary}
        today={todayStr}
        workOptions={workOptions}
      />

      <Link
        href="/field/photo"
        className="flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium"
      >
        <CameraIcon className="size-5 shrink-0 text-muted-foreground" />
        Quick photo
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          Any job, including quotes
        </span>
      </Link>
```

- [ ] **Step 4: Update the My Day client**

In `src/app/field/my-day-client.tsx`:

1. Replace the `lucide-react` import with:

```tsx
import { BriefcaseIcon, MapPinIcon, PhoneIcon, LogInIcon, LogOutIcon, ChevronDownIcon, ChevronUpIcon, ChevronRightIcon } from 'lucide-react'
```

and add `import { workHref } from '@/lib/live-work'`.

2. Add this type below `WeekSummary`, and `workOptions: WorkOption[]` to `Props`:

```tsx
export type WorkOption = {
  key: string
  label: string
  job_id: string | null
  project_id: string | null
}
```

3. In `CheckedInBanner`, replace the `const target = …` statement with (numbers already carry their prefix):

```tsx
  const target = entry.job_number
    ? `${entry.job_number} — ${entry.job_title ?? ''}`
    : entry.project_number
      ? `${entry.project_number} — ${entry.project_name ?? ''}`
      : 'Unknown'
```

4. In `AssignmentCardItem`, delete the `const prefix = …` line and change the number span to:

```tsx
            <span className="text-xs text-muted-foreground font-mono shrink-0">
              {assignment.number}
            </span>
```

5. In `AssignmentCardItem`, replace the second `<Button …>` (the one rendering a `Link` to `/field/usage`, labelled "Log materials &amp; plant") with:

```tsx
          <Button
            size="sm"
            variant="outline"
            className="mt-2 w-full text-xs"
            render={
              <Link
                href={workHref(
                  assignment.target_type,
                  (assignment.job_id ?? assignment.project_id) as string
                )}
              />
            }
          >
            Open job
            <ChevronRightIcon className="size-3.5 ml-1" />
          </Button>
```

6. Replace the whole `ManualEntrySection` function with:

```tsx
function ManualEntrySection({
  options,
  today,
}: {
  options: WorkOption[]
  today: string
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [workKey, setWorkKey] = useState(options[0]?.key ?? '')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const w = options.find((x) => x.key === workKey)
    if (!w) return

    startTransition(async () => {
      const result = await createManualEntry({
        job_id: w.job_id,
        project_id: w.project_id,
        date: today,
        start_time: startTime,
        end_time: endTime,
      })
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Manual entry added')
        setStartTime('')
        setEndTime('')
        setOpen(false)
      }
    })
  }

  if (options.length === 0) return null

  return (
    <div className="rounded-xl border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
      >
        Add manual time
        {open ? (
          <ChevronUpIcon className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 border-t px-4 py-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium">Job</label>
            <select
              className="rounded-md border bg-background px-3 py-2 text-base md:text-sm"
              value={workKey}
              onChange={(e) => setWorkKey(e.target.value)}
              required
            >
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium">Start time</label>
              <input
                type="time"
                className="rounded-md border bg-background px-3 py-2 text-base md:text-sm"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium">End time</label>
              <input
                type="time"
                className="rounded-md border bg-background px-3 py-2 text-base md:text-sm"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
            </div>
          </div>

          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Saving…' : 'Save entry'}
          </Button>
        </form>
      )}
    </div>
  )
}
```

7. Replace the whole `MyDayClient` function with:

```tsx
export function MyDayClient({
  assignments,
  openEntry,
  tomorrow,
  weekSummary,
  today,
  workOptions,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      {/* Checked-in banner */}
      {openEntry && <CheckedInBanner entry={openEntry} />}

      {/* Assignment cards */}
      {assignments.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
          <div>
            <p className="text-sm font-medium">Nothing scheduled for you today</p>
            <p className="text-sm text-muted-foreground">
              Pick the job you&apos;re on and check in there.
            </p>
          </div>
          <Button render={<Link href="/field/jobs" />}>
            <BriefcaseIcon className="size-4 mr-1" />
            Pick a job
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {assignments.map((a) => (
            <AssignmentCardItem
              key={a.id}
              assignment={a}
              hasOpenEntry={openEntry !== null}
              isCheckedIntoThis={openEntry?.assignment_id === a.id}
              today={today}
            />
          ))}
          <Link
            href="/field/jobs"
            className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
          >
            <span className="flex flex-col">
              <span className="text-sm font-medium">Somewhere else today?</span>
              <span className="text-xs text-muted-foreground">
                Open any live job or project, scheduled or not.
              </span>
            </span>
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </div>
      )}

      {/* Manual entry — any live job */}
      <ManualEntrySection options={workOptions} today={today} />

      {/* Tomorrow preview */}
      {tomorrow.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Tomorrow
          </p>
          {tomorrow.map((t) => (
            <p key={t.number} className="text-sm text-muted-foreground">
              {t.number} — {t.title}
            </p>
          ))}
        </div>
      )}

      {/* This week summary */}
      {(weekSummary.entries > 0 || weekSummary.hours > 0) && (
        <div className="rounded-xl border px-4 py-3 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">This week</p>
          <p className="text-sm font-medium tabular-nums">
            {weekSummary.hours.toFixed(1)}h across {weekSummary.entries}{' '}
            {weekSummary.entries === 1 ? 'entry' : 'entries'}
          </p>
        </div>
      )}
    </div>
  )
}
```

`AssignmentCardItem` still receives `today`; it no longer uses it after Task 5. Remove the `today` prop from its parameter list, its props type and the call above if `eslint` flags it as unused.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

Run: `npm test`
Expected: all pass. `tests/crew-onboarding.test.tsx` renders field components — if it asserts on the five-tab bar or the "Log materials & plant" button, update those assertions to the four tabs and "Open job".

Run: `npx eslint src/app/field`
Expected: no errors.

Run: `git grep -n "/field/usage\|/field/diary" -- src`
Expected: only the two redirect pages' own comments or none — no link or `revalidatePath` still points at an old address.

- [ ] **Step 6: Commit**

```bash
git add src/app/field
git commit -m "feat(field): four-tab bar and My Day opening the job screen"
```

---

### Task 11: Live proof

**Files:** none changed. This task writes test records to the live database and removes them.

Run against `http://localhost:3020` (dev server from Task 3, Step 5), which talks to the live database. Migration 0078 must already be applied (Task 9, Step 2).

- [ ] **Step 1: Note the counter, then create a test job**

Through the `ecr-portal` agent tools, read the current counter:

```sql
select key, next_value from sequences where key like 'work_number%';
```

Write the value down. Then create a job titled `zz field proof` with status `in_progress` on any existing client and site (the insert trigger assigns its number). Do **not** schedule anyone on it.

- [ ] **Step 2: Walk the field side as `field1@entice.local`**

Confirm each line:

- [ ] Bottom bar shows My Day, Jobs, Safety, Maintenance.
- [ ] My Day shows "Nothing scheduled for you today" with a Pick a job button (or, if field1 is scheduled, the "Somewhere else today?" card).
- [ ] Jobs lists `zz field proof` under "Live jobs and projects". Searching `zz` narrows to it.
- [ ] Opening it shows the header, the tabs with no Diary tab, and "Not checked in".
- [ ] Check in — the card turns green with a running timer. Jobs now shows "Checked in" on the row.
- [ ] Day sheet — add one material line; it appears; "Your hours" shows the open entry.
- [ ] Photos — take or attach one photo; it appears under recent with no target picker shown.
- [ ] Pre-start — Start pre-start meeting opens the form with the job already chosen; submit it; "Back to job" returns to the tab, which now shows "Pre-start meeting done".
- [ ] Today — the checklist reads Done, the usage count, and "1 today" for photos.
- [ ] Open `RP26020` from Jobs — the card reads "Not checked in here / You're on … zz field proof". Switch to this job — the card turns green; the first entry now has a finish time.
- [ ] Check out.
- [ ] `/field/usage?job=<zz job id>` lands on the Day sheet tab; `/field/diary` lands on Jobs.

- [ ] **Step 3: Walk the office side as `admin@entice.local`**

- [ ] Reports → Timesheets shows field1's two entries, both tagged "Unscheduled".
- [ ] On the `zz field proof` job page, upload a document. Tick the hard-hat "Show to crew" chip on it; leave a second document unticked.
- [ ] Back as field1, the Docs tab lists the ticked document and not the other.
- [ ] Set the zz job's status to invoiced. As field1 it is gone from Jobs, and its link shows "This job is closed" with no check-in.

- [ ] **Step 4: Clean up**

Delete, in this order, everything created against the zz job and field1's test entry on `RP26020`: `form_signons` and `form_submissions`, `field_usage`, `field_day_notes`, `attachments` (and their storage objects), `timesheet_entries`, then the job row. Set the work-number counter back to the value noted in Step 1. Confirm:

```sql
select count(*) from jobs where title ilike 'zz%';
```

Expected: `0`.

- [ ] **Step 5: Report**

Record which lines passed and any that did not. Do not push to `main` — hand the branch to the owner for the go-ahead.
