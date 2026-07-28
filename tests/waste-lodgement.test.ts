import { describe, expect, test } from 'vitest'
import {
  LODGEMENT_WINDOW_DAYS,
  daysBetween,
  formatMonth,
  lodgementStatus,
  monthOptions,
  outstandingParts,
} from '../src/lib/waste/lodgement'

describe('daysBetween', () => {
  test('counts whole calendar days', () => {
    expect(daysBetween('2026-07-01', '2026-07-08')).toBe(7)
    expect(daysBetween('2026-07-08', '2026-07-01')).toBe(-7)
    expect(daysBetween('2026-07-01', '2026-07-01')).toBe(0)
  })

  test('crosses month and year boundaries', () => {
    expect(daysBetween('2026-07-30', '2026-08-02')).toBe(3)
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3)
  })
})

describe('lodgementStatus — 7 days from COLLECTION', () => {
  test('the window is 7 days', () => {
    expect(LODGEMENT_WINDOW_DAYS).toBe(7)
  })

  test('a lodged movement stops counting', () => {
    const s = lodgementStatus('2026-07-01', '2026-07-03T00:00:00Z', '2026-07-30')
    expect(s.urgency).toBe('lodged')
    expect(s.daysLeft).toBeNull()
  })

  test('fresh load has the full window', () => {
    const s = lodgementStatus('2026-07-28', null, '2026-07-28')
    expect(s.urgency).toBe('ok')
    expect(s.daysLeft).toBe(7)
  })

  test('warns from two days out', () => {
    // collected 23rd, today 28th → 5 days elapsed, 2 left
    expect(lodgementStatus('2026-07-23', null, '2026-07-28').urgency).toBe('soon')
    expect(lodgementStatus('2026-07-23', null, '2026-07-28').daysLeft).toBe(2)
    // collected 22nd → only 1 left, so still 'soon', not 'ok'
    expect(lodgementStatus('2026-07-22', null, '2026-07-28').daysLeft).toBe(1)
    expect(lodgementStatus('2026-07-22', null, '2026-07-28').urgency).toBe('soon')
    // collected 24th → 3 left, the first comfortable day
    expect(lodgementStatus('2026-07-24', null, '2026-07-28').urgency).toBe('ok')
  })

  test('day seven is due today, day eight is overdue', () => {
    const due = lodgementStatus('2026-07-21', null, '2026-07-28')
    expect(due.urgency).toBe('due-today')
    expect(due.daysLeft).toBe(0)

    const late = lodgementStatus('2026-07-20', null, '2026-07-28')
    expect(late.urgency).toBe('overdue')
    expect(late.daysLeft).toBe(-1)
    expect(late.label).toBe('1 day overdue')
  })

  test('overdue label pluralises', () => {
    expect(lodgementStatus('2026-07-18', null, '2026-07-28').label).toBe('3 days overdue')
  })
})

describe('outstandingParts', () => {
  test('names the parts still missing', () => {
    expect(
      outstandingParts({ part2_submitted_at: null, part3_submitted_at: null })
    ).toEqual(['Transport', 'Receipt'])
    expect(
      outstandingParts({ part2_submitted_at: '2026-07-28', part3_submitted_at: null })
    ).toEqual(['Receipt'])
    expect(
      outstandingParts({ part2_submitted_at: '2026-07-28', part3_submitted_at: '2026-07-29' })
    ).toEqual([])
  })
})

describe('month helpers', () => {
  test('options run backwards from the current month', () => {
    const opts = monthOptions('2026-07-28', 4)
    expect(opts).toEqual(['2026-07', '2026-06', '2026-05', '2026-04'])
  })

  test('options cross the year boundary', () => {
    expect(monthOptions('2026-02-10', 4)).toEqual([
      '2026-02', '2026-01', '2025-12', '2025-11',
    ])
  })

  test('formatMonth is human readable', () => {
    expect(formatMonth('2026-07')).toBe('July 2026')
    expect(formatMonth('2026-01')).toBe('January 2026')
  })
})
