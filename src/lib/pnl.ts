import { round2 } from './money'

export type CostCategory = 'labour' | 'plant' | 'materials' | 'subcontract' | 'other'
export type CostSource = 'manual' | 'docket' | 'labour'

export const COST_CATEGORIES: { key: CostCategory; label: string }[] = [
  { key: 'labour', label: 'Labour' },
  { key: 'plant', label: 'Plant & equipment' },
  { key: 'materials', label: 'Materials & consumables' },
  { key: 'subcontract', label: 'Subcontract' },
  { key: 'other', label: 'Other' },
]

export interface PnlTimesheetRow {
  userId: string
  workerName: string
  startAt: string
  endAt: string | null
  approved: boolean
  costRate: number | null
}

export interface PnlCostRow {
  amount: number
  source: CostSource
  /** The row's cost code category, null when it has no cost code. */
  category: CostCategory | null
}

export interface PnlInput {
  basePrice: number | null
  adjustments: number[]
  timesheets: PnlTimesheetRow[]
  costs: PnlCostRow[]
  now?: Date
}

export interface PnlWorkerLabour {
  userId: string
  workerName: string
  hours: number
  rate: number | null
  cost: number
  missingRate: boolean
}

export interface PnlSummary {
  basePrice: number | null
  adjustmentsTotal: number
  price: number | null
  timesheetLabour: { workers: PnlWorkerLabour[]; hours: number; cost: number }
  pendingHours: number
  byCategory: Record<CostCategory, number>
  cost: number
  margin: number | null
  marginPct: number | null
  drawdownPct: number | null
}

/** Clock on → clock off in full (open entries measured to `now`), in hours. */
export function entryHours(startAt: string, endAt: string | null, now: Date): number {
  const end = endAt ? new Date(endAt).getTime() : now.getTime()
  const ms = end - new Date(startAt).getTime()
  return ms > 0 ? ms / 3_600_000 : 0
}

export function costCategory(source: CostSource, codeCategory: CostCategory | null): CostCategory {
  if (codeCategory) return codeCategory
  return source === 'labour' ? 'labour' : 'other'
}

export function labourAmount(hours: number, rate: number): number {
  return round2(hours * rate)
}

export function computePnl(input: PnlInput): PnlSummary {
  const now = input.now ?? new Date()
  const adjustmentsTotal = round2(input.adjustments.reduce((s, a) => s + a, 0))
  const price =
    input.basePrice == null && input.adjustments.length === 0
      ? null
      : round2((input.basePrice ?? 0) + adjustmentsTotal)

  // Approved, closed entries → grouped by worker + locked rate (a rate change
  // between approvals shows as two rows for the same person).
  const groups = new Map<string, PnlWorkerLabour>()
  let pending = 0
  for (const t of input.timesheets) {
    const hours = entryHours(t.startAt, t.endAt, now)
    if (!t.approved || !t.endAt) {
      pending += hours
      continue
    }
    const key = `${t.userId}:${t.costRate ?? 'none'}`
    const g =
      groups.get(key) ??
      { userId: t.userId, workerName: t.workerName, hours: 0, rate: t.costRate, cost: 0, missingRate: t.costRate == null }
    g.hours += hours
    g.cost += t.costRate == null ? 0 : hours * t.costRate
    groups.set(key, g)
  }
  const workers = [...groups.values()]
    .map((g) => ({ ...g, hours: round2(g.hours), cost: round2(g.cost) }))
    .sort((a, b) => a.workerName.localeCompare(b.workerName))
  const tsHours = round2(workers.reduce((s, w) => s + w.hours, 0))
  const tsCost = round2(workers.reduce((s, w) => s + w.cost, 0))

  const byCategory: Record<CostCategory, number> = { labour: tsCost, plant: 0, materials: 0, subcontract: 0, other: 0 }
  for (const c of input.costs) {
    const cat = costCategory(c.source, c.category)
    byCategory[cat] = round2(byCategory[cat] + c.amount)
  }
  const cost = round2(Object.values(byCategory).reduce((s, v) => s + v, 0))

  const hasPrice = price != null && price !== 0
  const margin = price == null ? null : round2(price - cost)
  return {
    basePrice: input.basePrice,
    adjustmentsTotal,
    price,
    timesheetLabour: { workers, hours: tsHours, cost: tsCost },
    pendingHours: round2(pending),
    byCategory,
    cost,
    margin,
    marginPct: hasPrice ? ((price - cost) / price) * 100 : null,
    drawdownPct: hasPrice ? (cost / price) * 100 : null,
  }
}

export function drawdownTone(pct: number | null): 'ok' | 'warn' | 'over' {
  if (pct == null || pct <= 80) return 'ok'
  return pct > 100 ? 'over' : 'warn'
}

/** Inc-GST equivalent of an ex-GST amount — display only; the P&L itself is ex GST. */
export function withGst(exGst: number, gstRate: number): number {
  return round2(exGst * (1 + gstRate / 100))
}

/** Ex-GST amount from a GST-inclusive figure (e.g. a receipt total). */
export function exGstFrom(incGst: number, gstRate: number): number {
  return round2(incGst / (1 + gstRate / 100))
}
