import { expect, test } from 'vitest'
import { computeClaim } from '../src/lib/claims'

const lines = [
  { sourceType: 'budget_line' as const, sourceId: 'a', description: 'Earthworks', lineValue: 100000, pctComplete: 50, previousClaimed: 30000 },
  { sourceType: 'variation' as const, sourceId: 'v1', description: 'VO1 rock', lineValue: 10000, pctComplete: 100, previousClaimed: 0 },
]
const retention = { pctPerClaim: 10, capPct: 5, contractSum: 110000, previouslyWithheld: 3000 }

test('claim math end to end', () => {
  const r = computeClaim(lines, retention, 10)
  // line 1: claimedToDate 50000, thisClaim 20000; line 2: 10000/10000 → gross 30000
  expect(r.grossThisClaim).toBe(30000)
  // retention: 10% of 30000 = 3000; cap = 5% * 110000 = 5500; headroom = 2500 → withhold 2500
  expect(r.retentionThisClaim).toBe(2500)
  expect(r.subtotal).toBe(27500)
  expect(r.gst).toBe(2750)
  expect(r.totalIncGst).toBe(30250)
  expect(r.totalClaimedToDate).toBe(60000)
  expect(r.lines[0].thisClaim).toBe(20000)
  expect(r.lines[0].claimedToDate).toBe(50000)
})
test('negative movement clamps retention at 0', () => {
  const r = computeClaim([{ ...lines[0], pctComplete: 20 }], retention, 10)
  expect(r.grossThisClaim).toBe(-10000)
  expect(r.retentionThisClaim).toBe(0)
  expect(r.subtotal).toBe(-10000)
})
test('retention stops at cap', () => {
  const r = computeClaim(lines, { ...retention, previouslyWithheld: 5500 }, 10)
  expect(r.retentionThisClaim).toBe(0)
})
test('zero GST rate', () => {
  const r = computeClaim(lines, retention, 0)
  expect(r.gst).toBe(0)
  expect(r.totalIncGst).toBe(r.subtotal)
})
test('fractional percentages round per line', () => {
  const r = computeClaim([
    { sourceType: 'budget_line' as const, sourceId: 'b', description: 'X', lineValue: 33333.33, pctComplete: 33.33, previousClaimed: 0 },
  ], { pctPerClaim: 10, capPct: 5, contractSum: 33333.33, previouslyWithheld: 0 }, 10)
  // round2(33333.33 * 33.33 / 100) = round2(11109.998...) = 11110
  expect(r.lines[0].claimedToDate).toBe(11110)
  expect(r.grossThisClaim).toBe(11110)
})
