# Dashboard Job Margins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full-width Job margins panel on the office dashboard with Live (headroom, at-risk) and Closed out (earned margin by period) tabs.

**Architecture:** A pure module groups bulk rows per job/project and runs the existing `computePnl`, so dashboard numbers match each job's P&L. A bulk loader pages through the tables once; a client panel handles tabs and the period switch with no refetch.

**Tech Stack:** Next.js 16 server components, Supabase, vitest, existing `Card`/`Table` UI.

Spec: `docs/superpowers/specs/2026-09-30-dashboard-job-margins-design.md`

## Global Constraints

- All figures ex GST; margin maths only via `computePnl` (`src/lib/pnl.ts`).
- Admin/office only — loader is only called when `showMoney`.
- Dates are Brisbane calendar dates (`todayAU` from `src/lib/tz.ts`).
- Live: jobs `scheduled|in_progress`, projects `active`, not archived. Closed: jobs `completed|invoiced|paid` (by `completed_at`), projects `practical_completion|defects_liability|closed` (by `practical_completion_date`), archived included.
- Run tests with `npx vitest run <file>`; typecheck `npx tsc --noEmit`.

---

### Task 1: Pure portfolio module

**Files:**
- Create: `src/lib/pnl-portfolio.ts`
- Test: `tests/pnl-portfolio.test.ts`

**Interfaces:**
- Consumes: `computePnl`, `PnlCostRow`, `drawdownTone` from `src/lib/pnl.ts`.
- Produces: `PortfolioParent`, `PortfolioRow`, `ClosedPeriod`, `CLOSED_PERIODS`, `jobStage`, `projectStage`, `buildPortfolioRows`, `periodBounds`, `closedInPeriod`, `sortLive`, `summariseLive`, `summariseClosed`, `isAtRisk`.

- [ ] **Step 1: Tests** (`tests/pnl-portfolio.test.ts`)

```ts
import { describe, expect, test } from 'vitest'
import {
  buildPortfolioRows,
  closedInPeriod,
  jobStage,
  periodBounds,
  projectStage,
  sortLive,
  summariseClosed,
  summariseLive,
  type PortfolioParent,
  type PortfolioRow,
} from '../src/lib/pnl-portfolio'

const NOW = new Date('2026-09-30T02:00:00Z')

function parent(p: Partial<PortfolioParent> & { id: string }): PortfolioParent {
  return {
    kind: 'job', number: p.id.toUpperCase(), title: 'T', status: 'in_progress', stage: 'live',
    closedOn: null, basePrice: 1000, adjustments: [], ...p,
  }
}

test('stages', () => {
  expect(jobStage('scheduled')).toBe('live')
  expect(jobStage('in_progress')).toBe('live')
  expect(jobStage('paid')).toBe('closed')
  expect(jobStage('quote')).toBeNull()
  expect(jobStage('lost')).toBeNull()
  expect(projectStage('active')).toBe('live')
  expect(projectStage('defects_liability')).toBe('closed')
})

test('buildPortfolioRows groups costs and approved timesheets per parent', () => {
  const rows = buildPortfolioRows(
    [parent({ id: 'j1', adjustments: [500] }), parent({ id: 'p1', kind: 'project', basePrice: 2000 })],
    [
      { parentKey: 'job:j1', userId: 'u', workerName: '', startAt: '2026-09-29T00:00:00Z', endAt: '2026-09-29T02:00:00Z', approved: true, costRate: 50 },
      { parentKey: 'job:j1', userId: 'u', workerName: '', startAt: '2026-09-29T03:00:00Z', endAt: '2026-09-29T04:00:00Z', approved: false, costRate: null },
    ],
    [
      { parentKey: 'job:j1', amount: 200, source: 'manual', category: null },
      { parentKey: 'project:p1', amount: 1900, source: 'labour', category: null },
    ],
    NOW
  )
  const j1 = rows.find((r) => r.id === 'j1')!
  expect(j1).toMatchObject({ price: 1500, cost: 300, margin: 1200, pendingHours: 1, href: '/jobs/j1' })
  const p1 = rows.find((r) => r.id === 'p1')!
  expect(p1).toMatchObject({ price: 2000, cost: 1900, margin: 100, href: '/projects/p1/pnl' })
})

describe('periods', () => {
  test('FY runs 1 July to today', () => {
    expect(periodBounds('fy', '2026-09-30')).toEqual({ from: '2026-07-01', to: '2026-09-30' })
    expect(periodBounds('fy', '2026-03-15')).toEqual({ from: '2025-07-01', to: '2026-03-15' })
  })
  test('last FY is the previous 1 July – 30 June', () => {
    expect(periodBounds('last_fy', '2026-09-30')).toEqual({ from: '2025-07-01', to: '2026-06-30' })
  })
  test('last 90 days and all time', () => {
    expect(periodBounds('90d', '2026-09-30')).toEqual({ from: '2026-07-02', to: '2026-09-30' })
    expect(periodBounds('all', '2026-09-30')).toEqual({ from: null, to: null })
  })
  test('closedInPeriod filters closed rows by date; undated only under all time', () => {
    const rows = [
      { stage: 'closed', closedOn: '2026-08-01' },
      { stage: 'closed', closedOn: '2026-05-01' },
      { stage: 'closed', closedOn: null },
      { stage: 'live', closedOn: null },
    ] as PortfolioRow[]
    expect(closedInPeriod(rows, 'fy', '2026-09-30')).toHaveLength(1)
    expect(closedInPeriod(rows, 'all', '2026-09-30')).toHaveLength(3)
  })
})

function row(r: Partial<PortfolioRow>): PortfolioRow {
  return {
    kind: 'job', id: 'x', number: 'X', title: 'T', status: 'in_progress', stage: 'live', closedOn: null,
    href: '/jobs/x', price: 1000, cost: 0, margin: 1000, marginPct: 100, drawdownPct: 0, pendingHours: 0, ...r,
  }
}

test('sortLive: losses first, then highest drawdown, unpriced last', () => {
  const sorted = sortLive([
    row({ id: 'a', drawdownPct: 50, margin: 500 }),
    row({ id: 'b', price: null, margin: null, drawdownPct: null, cost: 300 }),
    row({ id: 'c', drawdownPct: 120, margin: -200 }),
    row({ id: 'd', drawdownPct: 90, margin: 100 }),
  ])
  expect(sorted.map((r) => r.id)).toEqual(['c', 'd', 'a', 'b'])
})

test('summariseLive', () => {
  const s = summariseLive([
    row({ price: 1000, cost: 900, margin: 100, drawdownPct: 90 }),
    row({ price: 2000, cost: 500, margin: 1500, drawdownPct: 25 }),
    row({ price: null, cost: 300, margin: null, drawdownPct: null }),
  ])
  expect(s).toEqual({ count: 3, contractValue: 3000, cost: 1700, headroom: 1600, atRisk: 1, unpriced: 1 })
})

test('summariseClosed: weighted average margin, best and worst', () => {
  const a = row({ id: 'a', stage: 'closed', price: 1000, cost: 700, margin: 300, marginPct: 30 })
  const b = row({ id: 'b', stage: 'closed', price: 3000, cost: 3300, margin: -300, marginPct: -10 })
  const c = row({ id: 'c', stage: 'closed', price: null, cost: 50, margin: null, marginPct: null })
  const s = summariseClosed([a, b, c])
  expect(s).toMatchObject({ count: 3, revenue: 4000, cost: 4000, margin: 0, avgMarginPct: 0, unpriced: 1 })
  expect(s.best?.id).toBe('a')
  expect(s.worst?.id).toBe('b')
  expect(summariseClosed([]).avgMarginPct).toBeNull()
})
```

- [ ] **Step 2:** `npx vitest run tests/pnl-portfolio.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `src/lib/pnl-portfolio.ts`

```ts
import { round2 } from './money'
import { computePnl, type PnlCostRow, type PnlTimesheetRow } from './pnl'

export type PortfolioKind = 'job' | 'project'
export type PortfolioStage = 'live' | 'closed'
export type ClosedPeriod = 'fy' | '90d' | 'last_fy' | 'all'

export const CLOSED_PERIODS: { key: ClosedPeriod; label: string }[] = [
  { key: 'fy', label: 'This FY' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'last_fy', label: 'Last FY' },
  { key: 'all', label: 'All time' },
]

export interface PortfolioParent {
  kind: PortfolioKind
  id: string
  number: string
  title: string
  status: string
  stage: PortfolioStage
  /** Brisbane date the work closed out (jobs: completed_at, projects: PC date). */
  closedOn: string | null
  basePrice: number | null
  /** Job price adjustments, or a project's approved variation sell amounts. */
  adjustments: number[]
}

export interface PortfolioRow {
  kind: PortfolioKind
  id: string
  number: string
  title: string
  status: string
  stage: PortfolioStage
  closedOn: string | null
  href: string
  price: number | null
  cost: number
  margin: number | null
  marginPct: number | null
  drawdownPct: number | null
  pendingHours: number
}

type Keyed<T> = T & { parentKey: string }

export function jobStage(status: string): PortfolioStage | null {
  if (status === 'scheduled' || status === 'in_progress') return 'live'
  if (status === 'completed' || status === 'invoiced' || status === 'paid') return 'closed'
  return null
}

export function projectStage(status: string): PortfolioStage | null {
  if (status === 'active') return 'live'
  if (status === 'practical_completion' || status === 'defects_liability' || status === 'closed') return 'closed'
  return null
}

export const parentKey = (kind: PortfolioKind, id: string) => `${kind}:${id}`

function groupBy<T extends { parentKey: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const list = m.get(r.parentKey)
    if (list) list.push(r)
    else m.set(r.parentKey, [r])
  }
  return m
}

/** One P&L row per job/project, computed exactly like the job page. */
export function buildPortfolioRows(
  parents: PortfolioParent[],
  timesheets: Keyed<PnlTimesheetRow>[],
  costs: Keyed<PnlCostRow>[],
  now: Date = new Date()
): PortfolioRow[] {
  const tsBy = groupBy(timesheets)
  const costBy = groupBy(costs)
  return parents.map((p) => {
    const key = parentKey(p.kind, p.id)
    const s = computePnl({
      basePrice: p.basePrice,
      adjustments: p.adjustments,
      timesheets: tsBy.get(key) ?? [],
      costs: costBy.get(key) ?? [],
      now,
    })
    return {
      kind: p.kind,
      id: p.id,
      number: p.number,
      title: p.title,
      status: p.status,
      stage: p.stage,
      closedOn: p.closedOn,
      href: p.kind === 'job' ? `/jobs/${p.id}` : `/projects/${p.id}/pnl`,
      price: s.price,
      cost: s.cost,
      margin: s.margin,
      marginPct: s.marginPct,
      drawdownPct: s.drawdownPct,
      pendingHours: s.pendingHours,
    }
  })
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function fyStartYear(today: string): number {
  const year = Number(today.slice(0, 4))
  return Number(today.slice(5, 7)) >= 7 ? year : year - 1
}

/** Inclusive date bounds for a closed-out period (Australian FY = 1 Jul – 30 Jun). */
export function periodBounds(period: ClosedPeriod, today: string): { from: string | null; to: string | null } {
  const fy = fyStartYear(today)
  switch (period) {
    case 'fy':
      return { from: `${fy}-07-01`, to: today }
    case 'last_fy':
      return { from: `${fy - 1}-07-01`, to: `${fy}-06-30` }
    case '90d':
      return { from: shiftDays(today, -90), to: today }
    case 'all':
      return { from: null, to: null }
  }
}

export function closedInPeriod(rows: PortfolioRow[], period: ClosedPeriod, today: string): PortfolioRow[] {
  const { from, to } = periodBounds(period, today)
  return rows.filter((r) => {
    if (r.stage !== 'closed') return false
    if (from == null || to == null) return true
    return r.closedOn != null && r.closedOn >= from && r.closedOn <= to
  })
}

export function isAtRisk(r: PortfolioRow): boolean {
  return r.price != null && ((r.margin ?? 0) < 0 || (r.drawdownPct ?? 0) > 80)
}

/** Worst first: losses (most negative), then highest drawdown; unpriced last by cost. */
export function sortLive(rows: PortfolioRow[]): PortfolioRow[] {
  return [...rows].sort((a, b) => {
    const ap = a.price != null
    const bp = b.price != null
    if (ap !== bp) return ap ? -1 : 1
    if (!ap) return b.cost - a.cost
    const al = (a.margin ?? 0) < 0
    const bl = (b.margin ?? 0) < 0
    if (al !== bl) return al ? -1 : 1
    if (al) return (a.margin ?? 0) - (b.margin ?? 0)
    return (b.drawdownPct ?? 0) - (a.drawdownPct ?? 0)
  })
}

export interface LiveSummary {
  count: number
  contractValue: number
  cost: number
  headroom: number
  atRisk: number
  unpriced: number
}

export function summariseLive(rows: PortfolioRow[]): LiveSummary {
  const priced = rows.filter((r) => r.price != null)
  return {
    count: rows.length,
    contractValue: round2(priced.reduce((s, r) => s + (r.price ?? 0), 0)),
    cost: round2(rows.reduce((s, r) => s + r.cost, 0)),
    headroom: round2(priced.reduce((s, r) => s + (r.margin ?? 0), 0)),
    atRisk: rows.filter(isAtRisk).length,
    unpriced: rows.length - priced.length,
  }
}

export interface ClosedSummary {
  count: number
  revenue: number
  cost: number
  margin: number
  /** Σ margin ÷ Σ price over priced rows — weighted, so small jobs can't skew it. */
  avgMarginPct: number | null
  best: PortfolioRow | null
  worst: PortfolioRow | null
  unpriced: number
}

export function summariseClosed(rows: PortfolioRow[]): ClosedSummary {
  const priced = rows.filter((r) => r.price != null && r.price !== 0)
  const revenue = round2(priced.reduce((s, r) => s + (r.price ?? 0), 0))
  const margin = round2(priced.reduce((s, r) => s + (r.margin ?? 0), 0))
  const byPct = [...priced].sort((a, b) => (b.marginPct ?? 0) - (a.marginPct ?? 0))
  return {
    count: rows.length,
    revenue,
    cost: round2(rows.reduce((s, r) => s + r.cost, 0)),
    margin,
    avgMarginPct: revenue !== 0 ? (margin / revenue) * 100 : null,
    best: byPct[0] ?? null,
    worst: byPct.length > 1 ? byPct[byPct.length - 1] : null,
    unpriced: rows.filter((r) => r.price == null || r.price === 0).length,
  }
}
```

- [ ] **Step 4:** tests PASS.
- [ ] **Step 5: Commit** — `feat(margins): pure portfolio P&L module`

---

### Task 2: Bulk loader

**Files:**
- Modify: `src/lib/pnl-queries.ts` (export `fetchAll`)
- Create: `src/lib/pnl-portfolio-queries.ts`

**Interfaces:**
- Produces: `loadPortfolioPnl(supabase): Promise<{ rows: PortfolioRow[]; today: string }>`

- [ ] **Step 1:** Export `fetchAll` from `pnl-queries.ts`.
- [ ] **Step 2:** Implement the loader: paged queries (`fetchAll`) for `jobs` (`id, number, title, status, archived, completed_at, contract_price`, status in live+closed), `projects` (`id, number, name, status, archived, practical_completion_date, contract_sum`, status in live+closed), `job_price_adjustments` (`job_id, amount`), `variations` (`project_id, sell_amount`, status approved), `costs` (`parent_type, parent_id, amount, source`), `timesheet_entries` (`job_id, project_id, user_id, start_at, end_at, approved, cost_rate`). Drop archived live rows; closedOn = `todayAU(new Date(completed_at))` for jobs, `practical_completion_date` for projects. Timesheets keyed by job first, else project. Costs `category: null` (totals only). Return `{ rows: buildPortfolioRows(...), today: todayAU() }`.
- [ ] **Step 3:** `npx tsc --noEmit`; commit `feat(margins): bulk portfolio loader`.

---

### Task 3: Margins panel + dashboard wiring

**Files:**
- Create: `src/app/(office)/margins-panel.tsx` (client)
- Modify: `src/app/(office)/page.tsx`
- Test: `tests/margins-panel.test.tsx`

- [ ] **Step 1:** Panel: `Card` full width (`md:col-span-2 xl:col-span-3`), header chip (TrendingUpIcon, emerald) + "Job margins" + "All figures ex GST". Tabs Live | Closed out (segmented buttons). Live: 4 tiles (Live contract value, Cost to date, Headroom, At risk) + unpriced note; table (Job/project link, Price, Cost to date, Headroom, Drawdown bar with %), top 10 + "Show all N". Closed: period segmented switch (`CLOSED_PERIODS`, localStorage key `margins.period`, try/catch), 5 tiles (Closed, Revenue, Cost, Margin earned, Avg margin %), best/worst line, table newest first (Job/project, Closed, Price, Cost, Margin, Margin %). Red for negative. Empty states. `data === null` → load error text.
- [ ] **Step 2:** Render test: live sorting and at-risk count shown; closed tab switch shows weighted average.
- [ ] **Step 3:** Page: `showMoney ? settle(() => loadPortfolioPnl(supabase)) : none`, render `<MarginsPanel data={margins ?? null} />` first inside the money fragment.
- [ ] **Step 4:** tsc, full vitest, `next build`; commit `feat(margins): Job margins panel on the dashboard`.

---

### Task 4: Ship

- [ ] Review diff; fetch origin/main, push main, confirm Vercel deploy; update memory.
