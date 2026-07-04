import { describe, expect, it } from 'vitest'
import {
  clientLinkState,
  derivePropertyItemStatus,
  derivePropertyStatus,
  isClientLinkActive,
} from '@/lib/portal'

const TODAY = '2026-07-05'

describe('derivePropertyItemStatus', () => {
  it('null review_due never falls due (clearances, air monitoring)', () => {
    expect(derivePropertyItemStatus(null, TODAY)).toBe('green')
  })

  it('overdue review is red', () => {
    expect(derivePropertyItemStatus('2026-07-04', TODAY)).toBe('red')
    expect(derivePropertyItemStatus('2020-01-01', TODAY)).toBe('red')
  })

  it('due today is amber (still just current), matching the vendor rule', () => {
    expect(derivePropertyItemStatus(TODAY, TODAY)).toBe('amber')
  })

  it('due within 30 days inclusive is amber', () => {
    expect(derivePropertyItemStatus('2026-08-04', TODAY)).toBe('amber') // +30
  })

  it('due beyond 30 days is green', () => {
    expect(derivePropertyItemStatus('2026-08-05', TODAY)).toBe('green') // +31
  })
})

describe('derivePropertyStatus (site aggregate)', () => {
  it('no items at all → red (untracked property needs attention)', () => {
    expect(derivePropertyStatus([], TODAY)).toBe('red')
  })

  it('only non-expiring items → green (evidence held, nothing ages)', () => {
    expect(derivePropertyStatus([null, null], TODAY)).toBe('green')
  })

  it('any overdue item makes the site red', () => {
    expect(derivePropertyStatus([null, '2027-01-01', '2026-07-01'], TODAY)).toBe('red')
  })

  it('any item due within 30 days (none overdue) makes the site amber', () => {
    expect(derivePropertyStatus(['2027-01-01', '2026-07-20'], TODAY)).toBe('amber')
  })

  it('all items current → green', () => {
    expect(derivePropertyStatus([null, '2027-01-01'], TODAY)).toBe('green')
  })
})

describe('client link validity', () => {
  const NOW = new Date('2026-07-05T00:00:00Z')

  it('never-expiring, unrevoked link is active', () => {
    const link = { revoked_at: null, expires_at: null }
    expect(isClientLinkActive(link, NOW)).toBe(true)
    expect(clientLinkState(link, NOW)).toBe('active')
  })

  it('revoked link is dead, even with a future expiry', () => {
    const link = {
      revoked_at: '2026-07-01T00:00:00Z',
      expires_at: '2030-01-01T00:00:00Z',
    }
    expect(isClientLinkActive(link, NOW)).toBe(false)
    expect(clientLinkState(link, NOW)).toBe('revoked')
  })

  it('expired link is dead (boundary: expiry == now is expired)', () => {
    expect(
      isClientLinkActive({ revoked_at: null, expires_at: '2026-07-04T23:59:59Z' }, NOW)
    ).toBe(false)
    expect(
      clientLinkState({ revoked_at: null, expires_at: '2026-07-05T00:00:00Z' }, NOW)
    ).toBe('expired')
  })

  it('future expiry is still active', () => {
    expect(
      isClientLinkActive({ revoked_at: null, expires_at: '2026-07-06T00:00:00Z' }, NOW)
    ).toBe(true)
  })
})
