import { describe, it, expect } from 'vitest'
import { latestEvaluation, nextReviewFrom } from '@/lib/legal'

// These helpers MIRROR the DB authority (legal_current_compliance() ordering
// and `date + make_interval(months => n)` advancement) — the tests pin the
// TypeScript side to the Postgres semantics.

describe('latestEvaluation', () => {
  const e = (evaluated_on: string, created_at: string, verdict = 'compliant') => ({
    evaluated_on,
    created_at,
    verdict,
  })

  it('returns null for an empty history', () => {
    expect(latestEvaluation([])).toBeNull()
  })

  it('picks the latest evaluated_on regardless of array order', () => {
    const older = e('2026-01-10', '2026-01-10T02:00:00Z')
    const newer = e('2026-06-01', '2026-06-01T01:00:00Z', 'gap')
    expect(latestEvaluation([newer, older])).toBe(newer)
    expect(latestEvaluation([older, newer])).toBe(newer)
  })

  it('breaks same-day ties by created_at — a same-day re-evaluation supersedes', () => {
    const first = e('2026-06-01', '2026-06-01T01:00:00Z', 'gap')
    const second = e('2026-06-01', '2026-06-01T05:00:00Z', 'compliant')
    expect(latestEvaluation([first, second])).toBe(second)
    expect(latestEvaluation([second, first])).toBe(second)
  })

  it('a backdated evaluation never overrides a later-dated one', () => {
    const current = e('2026-06-01', '2026-06-01T01:00:00Z', 'compliant')
    const backdated = e('2026-03-01', '2026-06-02T09:00:00Z', 'gap')
    expect(latestEvaluation([current, backdated])).toBe(current)
  })
})

describe('nextReviewFrom (Postgres month-add semantics)', () => {
  it('adds whole months keeping the day', () => {
    expect(nextReviewFrom('2026-07-02', 12)).toBe('2027-07-02')
    expect(nextReviewFrom('2026-07-02', 6)).toBe('2027-01-02')
    expect(nextReviewFrom('2026-03-15', 1)).toBe('2026-04-15')
  })

  it('clamps to the last day of the target month', () => {
    expect(nextReviewFrom('2026-01-31', 1)).toBe('2026-02-28')
    expect(nextReviewFrom('2026-08-31', 1)).toBe('2026-09-30')
    expect(nextReviewFrom('2026-05-31', 4)).toBe('2026-09-30')
  })

  it('handles leap years like Postgres', () => {
    expect(nextReviewFrom('2024-01-31', 1)).toBe('2024-02-29')
    expect(nextReviewFrom('2023-02-28', 12)).toBe('2024-02-28')
    expect(nextReviewFrom('2024-02-29', 12)).toBe('2025-02-28')
  })

  it('rolls across year boundaries', () => {
    expect(nextReviewFrom('2026-11-15', 3)).toBe('2027-02-15')
    expect(nextReviewFrom('2026-12-31', 2)).toBe('2027-02-28')
    expect(nextReviewFrom('2026-06-30', 18)).toBe('2027-12-30')
  })
})
