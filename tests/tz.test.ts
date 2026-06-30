import { expect, test } from 'vitest'
import { todayAU, dateAU, yesterdayAU, isFutureAU, nowAU } from '../src/lib/tz'

// 2026-06-24 23:30 UTC = 2026-06-25 09:30 Brisbane (+10)
const lateUtc = new Date('2026-06-24T23:30:00Z')

test('todayAU rolls to the Brisbane calendar day', () => {
  expect(todayAU(lateUtc)).toBe('2026-06-25')
})

test('early-UTC same Brisbane day', () => {
  expect(todayAU(new Date('2026-06-24T02:00:00Z'))).toBe('2026-06-24') // 12:00 Brisbane
})

test('yesterday/offset', () => {
  expect(yesterdayAU(lateUtc)).toBe('2026-06-24')
  expect(dateAU(-7, lateUtc)).toBe('2026-06-18')
  expect(dateAU(1, lateUtc)).toBe('2026-06-26')
})

test('dateAU crosses month boundaries correctly', () => {
  // 2026-06-30 23:30 UTC = 2026-07-01 09:30 Brisbane
  const monthEnd = new Date('2026-06-30T23:30:00Z')
  expect(todayAU(monthEnd)).toBe('2026-07-01')
  expect(yesterdayAU(monthEnd)).toBe('2026-06-30')
  expect(dateAU(-1, monthEnd)).toBe('2026-06-30')
})

test('isFutureAU', () => {
  expect(isFutureAU('2026-06-26', lateUtc)).toBe(true)
  expect(isFutureAU('2026-06-25', lateUtc)).toBe(false)
  expect(isFutureAU('2026-06-24', lateUtc)).toBe(false)
})

test('nowAU local components match the Brisbane wall-clock', () => {
  // 2026-06-24 23:30 UTC = 2026-06-25 09:30 Brisbane (+10)
  const d = nowAU(lateUtc)
  expect(d.getFullYear()).toBe(2026)
  expect(d.getMonth()).toBe(5) // June (0-based)
  expect(d.getDate()).toBe(25)
  expect(d.getHours()).toBe(9)
  expect(d.getMinutes()).toBe(30)
})
