import { describe, expect, test } from 'vitest'
import { computePnl, costCategory, drawdownTone, entryHours, labourAmount } from '../src/lib/pnl'

const NOW = new Date('2026-09-29T06:00:00Z')

describe('entryHours', () => {
  test('closed entry counts in full', () => {
    expect(entryHours('2026-09-28T21:00:00Z', '2026-09-29T05:30:00Z', NOW)).toBe(8.5)
  })
  test('open entry measured to now', () => {
    expect(entryHours('2026-09-29T04:00:00Z', null, NOW)).toBe(2)
  })
  test('never negative', () => {
    expect(entryHours('2026-09-29T07:00:00Z', '2026-09-29T06:00:00Z', NOW)).toBe(0)
  })
})

test('costCategory prefers the cost code, then labour source, then other', () => {
  expect(costCategory('manual', 'plant')).toBe('plant')
  expect(costCategory('labour', null)).toBe('labour')
  expect(costCategory('labour', 'subcontract')).toBe('subcontract')
  expect(costCategory('docket', null)).toBe('other')
})

test('labourAmount rounds hours × rate', () => {
  expect(labourAmount(7.5, 62.35)).toBe(467.63)
})

describe('computePnl', () => {
  const base = {
    basePrice: 10000,
    adjustments: [1500, -500],
    now: NOW,
    timesheets: [
      { userId: 'u1', workerName: 'Sam', startAt: '2026-09-28T21:00:00Z', endAt: '2026-09-29T05:00:00Z', approved: true, costRate: 50 },
      { userId: 'u1', workerName: 'Sam', startAt: '2026-09-27T21:00:00Z', endAt: '2026-09-28T01:00:00Z', approved: true, costRate: 50 },
      { userId: 'u2', workerName: 'Alex', startAt: '2026-09-28T21:00:00Z', endAt: '2026-09-28T23:00:00Z', approved: true, costRate: null },
      { userId: 'u3', workerName: 'Jo', startAt: '2026-09-28T21:00:00Z', endAt: '2026-09-29T00:00:00Z', approved: false, costRate: null },
      { userId: 'u3', workerName: 'Jo', startAt: '2026-09-29T05:00:00Z', endAt: null, approved: false, costRate: null },
    ],
    costs: [
      { amount: 400, source: 'labour' as const, category: null },
      { amount: 1200, source: 'manual' as const, category: 'plant' as const },
      { amount: 300, source: 'docket' as const, category: null },
    ],
  }

  test('price = base + adjustments', () => {
    const s = computePnl(base)
    expect(s.adjustmentsTotal).toBe(1000)
    expect(s.price).toBe(11000)
  })

  test('timesheet labour groups approved hours by worker and rate', () => {
    const s = computePnl(base)
    expect(s.timesheetLabour.hours).toBe(14)
    expect(s.timesheetLabour.cost).toBe(600)
    const sam = s.timesheetLabour.workers.find((w) => w.userId === 'u1')!
    expect(sam).toMatchObject({ hours: 12, rate: 50, cost: 600, missingRate: false })
    const alex = s.timesheetLabour.workers.find((w) => w.userId === 'u2')!
    expect(alex).toMatchObject({ hours: 2, rate: null, cost: 0, missingRate: true })
  })

  test('pending = unapproved + open hours, not costed', () => {
    const s = computePnl(base)
    expect(s.pendingHours).toBe(4)
  })

  test('category breakdown, total cost, margin and drawdown', () => {
    const s = computePnl(base)
    expect(s.byCategory).toEqual({ labour: 1000, plant: 1200, materials: 0, subcontract: 0, other: 300 })
    expect(s.cost).toBe(2500)
    expect(s.margin).toBe(8500)
    expect(s.marginPct).toBeCloseTo(77.27, 2)
    expect(s.drawdownPct).toBeCloseTo(22.73, 2)
  })

  test('no price → margin and percentages are null', () => {
    const s = computePnl({ ...base, basePrice: null, adjustments: [] })
    expect(s.price).toBeNull()
    expect(s.margin).toBeNull()
    expect(s.marginPct).toBeNull()
    expect(s.drawdownPct).toBeNull()
  })

  test('adjustments without a base still make a price', () => {
    expect(computePnl({ ...base, basePrice: null, adjustments: [2000] }).price).toBe(2000)
  })
})

test('drawdownTone thresholds', () => {
  expect(drawdownTone(null)).toBe('ok')
  expect(drawdownTone(80)).toBe('ok')
  expect(drawdownTone(80.1)).toBe('warn')
  expect(drawdownTone(100.1)).toBe('over')
})

describe('costLineSchema', async () => {
  const { costLineSchema, priceAdjustmentSchema } = await import('../src/lib/zod')
  const base = {
    parent_type: 'job',
    parent_id: '11450f03-f7a1-49f7-9296-ed48c8a809e1',
    date: '2026-09-29',
  }

  test('labour needs hours, rate and a worker', () => {
    const r = costLineSchema.safeParse({ ...base, kind: 'labour', hours: 8 })
    expect(r.success).toBe(false)
    const ok = costLineSchema.safeParse({ ...base, kind: 'labour', hours: 8, rate: 55, worker_name: 'Labour hire' })
    expect(ok.success).toBe(true)
  })

  test('other cost needs description and a positive amount', () => {
    expect(costLineSchema.safeParse({ ...base, kind: 'other', amount: 100 }).success).toBe(false)
    expect(costLineSchema.safeParse({ ...base, kind: 'other', description: 'Tip', amount: 0 }).success).toBe(false)
    expect(costLineSchema.safeParse({ ...base, kind: 'other', description: 'Tip', amount: 120 }).success).toBe(true)
  })

  test('price adjustment allows negatives but not zero', () => {
    const adj = { job_id: base.parent_id, date: base.date, description: 'Scope cut' }
    expect(priceAdjustmentSchema.safeParse({ ...adj, amount: -500 }).success).toBe(true)
    expect(priceAdjustmentSchema.safeParse({ ...adj, amount: 0 }).success).toBe(false)
  })
})
