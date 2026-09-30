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
    // Priced rows only, so revenue − cost = margin earned.
    cost: round2(priced.reduce((s, r) => s + r.cost, 0)),
    margin,
    avgMarginPct: revenue !== 0 ? (margin / revenue) * 100 : null,
    best: byPct[0] ?? null,
    worst: byPct.length > 1 ? byPct[byPct.length - 1] : null,
    unpriced: rows.filter((r) => r.price == null || r.price === 0).length,
  }
}
