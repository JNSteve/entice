import { describe, expect, it } from 'vitest'
import {
  closedWithinDaysPct,
  daysBetween,
  deriveObjectiveStatus,
  enumeratePeriods,
  isCurrent,
  isElapsed,
  ltifr,
  monthsOf,
  nextPeriodKey,
  onTimeDeliveryPct,
  pctOf,
  periodKeyFor,
  periodKeyLabel,
  periodRangeOf,
} from '@/lib/objectives'
import { todayAU } from '@/lib/tz'

// ─── Direction-aware traffic light ────────────────────────────────────────────

describe('deriveObjectiveStatus', () => {
  it('at_most (lower is better): on/amber/red bands', () => {
    // e.g. NCRs raised, target ≤ 3
    expect(deriveObjectiveStatus('at_most', 3, 0)).toBe('on_track')
    expect(deriveObjectiveStatus('at_most', 3, 3)).toBe('on_track') // boundary
    expect(deriveObjectiveStatus('at_most', 3, 3.3)).toBe('at_risk') // +10% boundary
    expect(deriveObjectiveStatus('at_most', 3, 3.31)).toBe('off_track')
    expect(deriveObjectiveStatus('at_most', 3, 4)).toBe('off_track')
  })

  it('at_most with target 0 (LTIFR): no amber band — any breach is off_track', () => {
    expect(deriveObjectiveStatus('at_most', 0, 0)).toBe('on_track')
    expect(deriveObjectiveStatus('at_most', 0, 0.01)).toBe('off_track')
    expect(deriveObjectiveStatus('at_most', 0, 246.91)).toBe('off_track')
  })

  it('at_least (higher is better): on/amber/red bands', () => {
    // e.g. training compliance, target ≥ 95%
    expect(deriveObjectiveStatus('at_least', 95, 100)).toBe('on_track')
    expect(deriveObjectiveStatus('at_least', 95, 95)).toBe('on_track') // boundary
    expect(deriveObjectiveStatus('at_least', 95, 85.5)).toBe('at_risk') // −10% boundary
    expect(deriveObjectiveStatus('at_least', 95, 85.49)).toBe('off_track')
    expect(deriveObjectiveStatus('at_least', 95, 0)).toBe('off_track')
  })

  it('null / NaN value is no_data — never a false green', () => {
    expect(deriveObjectiveStatus('at_most', 0, null)).toBe('no_data')
    expect(deriveObjectiveStatus('at_least', 95, undefined)).toBe('no_data')
    expect(deriveObjectiveStatus('at_least', 95, Number.NaN)).toBe('no_data')
  })
})

// ─── LTIFR arithmetic ─────────────────────────────────────────────────────────

describe('ltifr', () => {
  it('computes (injuries × 1,000,000) / hours, 2 dp', () => {
    expect(ltifr(1, 4050)).toBe(246.91) // 1e6 / 4050 = 246.913…
    expect(ltifr(2, 1_000_000)).toBe(2)
    expect(ltifr(3, 12150)).toBe(246.91)
  })

  it('zero injuries with hours entered is a REAL 0', () => {
    expect(ltifr(0, 4050)).toBe(0)
  })

  it('no hours (null/0/negative) is null — an unmeasured period, never 0', () => {
    expect(ltifr(0, null)).toBeNull()
    expect(ltifr(1, null)).toBeNull()
    expect(ltifr(1, 0)).toBeNull()
    expect(ltifr(1, -5)).toBeNull()
  })
})

describe('pctOf', () => {
  it('rounds to 1 dp and nulls an empty denominator', () => {
    expect(pctOf(1, 3)).toBe(33.3)
    expect(pctOf(2, 3)).toBe(66.7)
    expect(pctOf(3, 3)).toBe(100)
    expect(pctOf(0, 5)).toBe(0)
    expect(pctOf(0, 0)).toBeNull()
  })
})

// ─── CAPA closure age (SMS-M-01 §6.3: corrective actions ≤ 28 days) ──────────

describe('daysBetween', () => {
  it('whole calendar days between AU date strings', () => {
    expect(daysBetween('2026-06-01', '2026-06-01')).toBe(0)
    expect(daysBetween('2026-06-01', '2026-06-29')).toBe(28)
    expect(daysBetween('2026-06-01', '2026-06-30')).toBe(29)
    expect(daysBetween('2026-12-20', '2027-01-17')).toBe(28) // year boundary
    expect(daysBetween('2026-06-10', '2026-06-01')).toBe(-9) // negative when b < a
  })
})

describe('closedWithinDaysPct', () => {
  const row = (createdDate: string, completedDate: string) => ({
    createdDate,
    completedDate,
  })

  it('% closed within the window, 1 dp', () => {
    expect(
      closedWithinDaysPct(
        [
          row('2026-06-01', '2026-06-05'), // 4 days — within
          row('2026-06-01', '2026-06-29'), // 28 days — boundary, still within
          row('2026-06-01', '2026-06-30'), // 29 days — outside
        ],
        28
      )
    ).toBe(66.7)
  })

  it('same-day closure is day 0 (within)', () => {
    expect(closedWithinDaysPct([row('2026-06-01', '2026-06-01')], 28)).toBe(100)
  })

  it('all outside the window → 0, not null', () => {
    expect(closedWithinDaysPct([row('2026-01-01', '2026-06-01')], 28)).toBe(0)
  })

  it('no closures → null (unmeasured, never a fake 0 or 100)', () => {
    expect(closedWithinDaysPct([], 28)).toBeNull()
  })
})

// ─── Period keys ──────────────────────────────────────────────────────────────

describe('periodKeyFor', () => {
  it('monthly key of an AU date', () => {
    expect(periodKeyFor('monthly', '2026-07-02')).toBe('2026-07')
    expect(periodKeyFor('monthly', '2026-12-31')).toBe('2026-12')
  })

  it('quarterly key of an AU date (calendar quarters)', () => {
    expect(periodKeyFor('quarterly', '2026-01-01')).toBe('2026-Q1')
    expect(periodKeyFor('quarterly', '2026-03-31')).toBe('2026-Q1')
    expect(periodKeyFor('quarterly', '2026-07-02')).toBe('2026-Q3')
    expect(periodKeyFor('quarterly', '2026-10-01')).toBe('2026-Q4')
  })
})

describe('monthsOf / periodRangeOf', () => {
  it('a month is itself; a quarter is its three months', () => {
    expect(monthsOf('2026-07')).toEqual(['2026-07'])
    expect(monthsOf('2026-Q2')).toEqual(['2026-04', '2026-05', '2026-06'])
    expect(monthsOf('2026-Q4')).toEqual(['2026-10', '2026-11', '2026-12'])
  })

  it('half-open ranges, incl. year rollover', () => {
    expect(periodRangeOf('2026-07')).toEqual({
      start: '2026-07-01',
      endExclusive: '2026-08-01',
    })
    expect(periodRangeOf('2026-12')).toEqual({
      start: '2026-12-01',
      endExclusive: '2027-01-01',
    })
    expect(periodRangeOf('2026-Q4')).toEqual({
      start: '2026-10-01',
      endExclusive: '2027-01-01',
    })
  })

  it('rejects malformed keys', () => {
    expect(() => monthsOf('2026-13')).toThrow()
    expect(() => monthsOf('2026-Q5')).toThrow()
    expect(() => periodRangeOf('garbage')).toThrow()
  })
})

describe('isElapsed / isCurrent', () => {
  it('a period elapses the day after it ends', () => {
    expect(isElapsed('2026-06', '2026-07-01')).toBe(true)
    expect(isElapsed('2026-06', '2026-06-30')).toBe(false)
    expect(isElapsed('2026-Q2', '2026-07-02')).toBe(true)
    expect(isElapsed('2026-Q3', '2026-07-02')).toBe(false)
  })

  it('isCurrent brackets the containing period', () => {
    expect(isCurrent('2026-07', '2026-07-02')).toBe(true)
    expect(isCurrent('2026-06', '2026-07-02')).toBe(false)
    expect(isCurrent('2026-Q3', '2026-07-02')).toBe(true)
    expect(isCurrent('2026-Q3', '2026-10-01')).toBe(false)
  })

  it('UTC-clock guard: 23:00 UTC is already the NEXT AU calendar day', () => {
    // 2026-06-30T23:00Z = 2026-07-01 09:00 Brisbane → June has elapsed.
    const auDay = todayAU(new Date('2026-06-30T23:00:00Z'))
    expect(auDay).toBe('2026-07-01')
    expect(isElapsed('2026-06', auDay)).toBe(true)
    expect(isCurrent('2026-07', auDay)).toBe(true)
  })
})

describe('enumeratePeriods / nextPeriodKey', () => {
  it('walks months across a year boundary', () => {
    expect(nextPeriodKey('2026-12')).toBe('2027-01')
    expect(enumeratePeriods('monthly', '2026-11-15', '2027-01-10')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
    ])
  })

  it('walks quarters across a year boundary', () => {
    expect(nextPeriodKey('2026-Q4')).toBe('2027-Q1')
    expect(enumeratePeriods('quarterly', '2026-07-01', '2027-02-01')).toEqual([
      '2026-Q3',
      '2026-Q4',
      '2027-Q1',
    ])
  })

  it('anchor after today yields nothing; anchor in today period yields one', () => {
    expect(enumeratePeriods('monthly', '2026-08-01', '2026-07-02')).toEqual([])
    expect(enumeratePeriods('monthly', '2026-07-01', '2026-07-02')).toEqual([
      '2026-07',
    ])
  })

  it('calendar-year anchor produces the refresh window', () => {
    expect(enumeratePeriods('monthly', '2026-01-01', '2026-07-02')).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07',
    ])
    expect(enumeratePeriods('quarterly', '2026-01-01', '2026-07-02')).toEqual([
      '2026-Q1', '2026-Q2', '2026-Q3',
    ])
  })
})

describe('periodKeyLabel', () => {
  it('labels months and quarters', () => {
    expect(periodKeyLabel('2026-07')).toBe('Jul 2026')
    expect(periodKeyLabel('2026-01')).toBe('Jan 2026')
    expect(periodKeyLabel('2026-Q3')).toBe('Q3 2026')
  })
})

// ─── On-time programme delivery (owner decision: baseline vs actual) ──────────

describe('onTimeDeliveryPct', () => {
  const task = (
    project: string,
    end: string,
    progress: number,
    baseline: string | null
  ) => ({
    project_id: project,
    end_date: end,
    progress_pct: progress,
    baseline_end: baseline,
  })

  it('null when no project finished in the window', () => {
    // In-progress project: not finished.
    expect(
      onTimeDeliveryPct(
        [task('p1', '2026-05-20', 50, '2026-05-31')],
        '2026-04-01',
        '2026-07-01'
      )
    ).toBeNull()
    // Finished, but outside the window.
    expect(
      onTimeDeliveryPct(
        [task('p1', '2026-03-20', 100, '2026-03-31')],
        '2026-04-01',
        '2026-07-01'
      )
    ).toBeNull()
  })

  it('projects without any baseline are excluded (nothing to measure)', () => {
    expect(
      onTimeDeliveryPct(
        [task('p1', '2026-05-20', 100, null)],
        '2026-04-01',
        '2026-07-01'
      )
    ).toBeNull()
  })

  it('on-time vs late against the latest baseline end', () => {
    const tasks = [
      // p1: finished 2026-05-20, baseline 2026-05-31 → on time
      task('p1', '2026-05-01', 100, '2026-05-10'),
      task('p1', '2026-05-20', 100, '2026-05-31'),
      // p2: finished 2026-06-15, baseline 2026-05-31 → late
      task('p2', '2026-06-15', 100, '2026-05-31'),
    ]
    expect(onTimeDeliveryPct(tasks, '2026-04-01', '2026-07-01')).toBe(50)
  })

  it('a project is only finished when EVERY task is 100%', () => {
    const tasks = [
      task('p1', '2026-05-20', 100, '2026-05-31'),
      task('p1', '2026-05-25', 90, '2026-05-31'), // still open
    ]
    expect(onTimeDeliveryPct(tasks, '2026-04-01', '2026-07-01')).toBeNull()
  })
})
