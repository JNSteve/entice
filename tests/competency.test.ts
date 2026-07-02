import { describe, expect, it } from 'vitest'
import {
  defaultExpiry,
  deriveCompetencyStatus,
  latestRecords,
  workerTypeKey,
  type CompetencyRecordLike,
} from '../src/lib/competency'
import { addDaysISO, deriveComplianceStatus, expiryColour } from '../src/lib/compliance'

const TODAY = '2026-07-02' // fixed AU calendar day — the functions are pure

function rec(overrides: Partial<CompetencyRecordLike>): CompetencyRecordLike {
  return {
    id: 'r1',
    worker_id: 'w1',
    competency_type_id: 't1',
    issue_date: '2025-01-01',
    expiry_date: null,
    superseded_by: null,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('deriveCompetencyStatus', () => {
  it('treats a null expiry (non-expiring ticket) as current', () => {
    expect(deriveCompetencyStatus(null, TODAY)).toBe('current')
  })

  it('is expired the day AFTER expiry, not on the expiry day itself', () => {
    expect(deriveCompetencyStatus('2026-07-01', TODAY)).toBe('expired')
    // Expiring TODAY is still (just) valid — amber, matching vendor compliance.
    expect(deriveCompetencyStatus('2026-07-02', TODAY)).toBe('expiring')
  })

  it('handles the 30-day boundary exactly (day 30 amber, day 31 green)', () => {
    const day30 = addDaysISO(TODAY, 30) // 2026-08-01
    const day31 = addDaysISO(TODAY, 31) // 2026-08-02
    expect(day30).toBe('2026-08-01')
    expect(deriveCompetencyStatus(day30, TODAY)).toBe('expiring')
    expect(deriveCompetencyStatus(day31, TODAY)).toBe('current')
  })

  it('is current well before the window and expired well after', () => {
    expect(deriveCompetencyStatus('2027-01-01', TODAY)).toBe('current')
    expect(deriveCompetencyStatus('2020-01-01', TODAY)).toBe('expired')
  })
})

describe('latestRecords (supersede de-dup rule)', () => {
  it('ignores superseded records entirely', () => {
    const old = rec({ id: 'a', issue_date: '2024-01-01', superseded_by: 'b' })
    const current = rec({ id: 'b', issue_date: '2026-01-01' })
    const latest = latestRecords([old, current])
    expect(latest.get(workerTypeKey('w1', 't1'))?.id).toBe('b')
    expect(latest.size).toBe(1)
  })

  it('a superseded record never drives the light even if newer by date', () => {
    // Pathological ordering: the superseded row has the later issue date.
    const superseded = rec({ id: 'a', issue_date: '2026-06-01', superseded_by: 'b' })
    const live = rec({ id: 'b', issue_date: '2026-01-01' })
    const latest = latestRecords([superseded, live])
    expect(latest.get(workerTypeKey('w1', 't1'))?.id).toBe('b')
  })

  it('picks the newest issue_date among non-superseded records', () => {
    const older = rec({ id: 'a', issue_date: '2025-01-01' })
    const newer = rec({ id: 'b', issue_date: '2026-03-01' })
    const latest = latestRecords([newer, older])
    expect(latest.get(workerTypeKey('w1', 't1'))?.id).toBe('b')
  })

  it('tie-breaks equal issue dates by created_at, deterministically', () => {
    const first = rec({ id: 'a', created_at: '2026-01-01T00:00:00Z' })
    const second = rec({ id: 'b', created_at: '2026-01-02T00:00:00Z' })
    expect(latestRecords([first, second]).get(workerTypeKey('w1', 't1'))?.id).toBe('b')
    expect(latestRecords([second, first]).get(workerTypeKey('w1', 't1'))?.id).toBe('b')
  })

  it('keys per (worker, type) — different pairs never collide', () => {
    const a = rec({ id: 'a', worker_id: 'w1', competency_type_id: 't1' })
    const b = rec({ id: 'b', worker_id: 'w1', competency_type_id: 't2' })
    const c = rec({ id: 'c', worker_id: 'w2', competency_type_id: 't1' })
    const latest = latestRecords([a, b, c])
    expect(latest.size).toBe(3)
    expect(latest.get(workerTypeKey('w1', 't2'))?.id).toBe('b')
    expect(latest.get(workerTypeKey('w2', 't1'))?.id).toBe('c')
  })
})

describe('defaultExpiry', () => {
  it('adds calendar months', () => {
    expect(defaultExpiry('2026-07-02', 12)).toBe('2027-07-02')
    expect(defaultExpiry('2026-07-02', 36)).toBe('2029-07-02')
  })

  it('returns null for non-expiring types', () => {
    expect(defaultExpiry('2026-07-02', null)).toBeNull()
  })

  it('clamps to the end of shorter months', () => {
    expect(defaultExpiry('2026-01-31', 1)).toBe('2026-02-28')
    expect(defaultExpiry('2026-08-31', 1)).toBe('2026-09-30')
  })

  it('rolls over year boundaries', () => {
    expect(defaultExpiry('2026-11-15', 3)).toBe('2027-02-15')
  })
})

describe('shared compliance helpers (extraction regression)', () => {
  it('deriveComplianceStatus keeps the vendors 30-day rule with injected today', () => {
    expect(deriveComplianceStatus([], TODAY)).toBe('red')
    expect(deriveComplianceStatus([{ expiry_date: '2026-07-01' }], TODAY)).toBe('red')
    expect(deriveComplianceStatus([{ expiry_date: addDaysISO(TODAY, 30) }], TODAY)).toBe('amber')
    expect(deriveComplianceStatus([{ expiry_date: addDaysISO(TODAY, 31) }], TODAY)).toBe('green')
    // one expired doc turns the whole set red regardless of the others
    expect(
      deriveComplianceStatus(
        [{ expiry_date: '2027-01-01' }, { expiry_date: '2026-01-01' }],
        TODAY
      )
    ).toBe('red')
  })

  it('expiryColour matches the same boundaries', () => {
    expect(expiryColour('2026-07-01', TODAY)).toContain('red')
    expect(expiryColour(addDaysISO(TODAY, 30), TODAY)).toContain('amber')
    expect(expiryColour(addDaysISO(TODAY, 31), TODAY)).toBe('')
  })
})
