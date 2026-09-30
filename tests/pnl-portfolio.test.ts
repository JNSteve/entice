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
