import { describe, expect, test } from 'vitest'
import {
  deriveLotConformance,
  failureResolved,
  holdPointItems,
  lotCloseError,
  unresolvedFailureCount,
} from '../src/lib/lot-gates'

describe('failureResolved', () => {
  test('no NCR → unresolved', () => {
    expect(failureResolved({ ncr_id: null, ncr_status: null })).toBe(false)
  })

  test('linked NCR still open → unresolved', () => {
    expect(failureResolved({ ncr_id: 'n1', ncr_status: 'open' })).toBe(false)
    expect(failureResolved({ ncr_id: 'n1', ncr_status: 'investigating' })).toBe(false)
    expect(failureResolved({ ncr_id: 'n1', ncr_status: 'actions' })).toBe(false)
    expect(failureResolved({ ncr_id: 'n1', ncr_status: 'verified' })).toBe(false)
  })

  test('linked NCR closed → resolved (verification gate already passed)', () => {
    expect(failureResolved({ ncr_id: 'n1', ncr_status: 'closed' })).toBe(true)
  })
})

describe('unresolvedFailureCount', () => {
  test('counts only unresolved failures', () => {
    expect(
      unresolvedFailureCount([
        { ncr_id: null, ncr_status: null },
        { ncr_id: 'n1', ncr_status: 'closed' },
        { ncr_id: 'n2', ncr_status: 'verified' },
      ])
    ).toBe(2)
  })

  test('empty list → 0', () => {
    expect(unresolvedFailureCount([])).toBe(0)
  })
})

describe('deriveLotConformance (mirrors SQL lot_conformance)', () => {
  test('unresolved failure wins over everything → nonconforming', () => {
    expect(
      deriveLotConformance({
        openHoldPointCount: 3,
        unresolvedFailureCount: 1,
        missingRecordCount: 4,
      })
    ).toBe('nonconforming')
  })

  test('open hold point (no failures) → open', () => {
    expect(
      deriveLotConformance({
        openHoldPointCount: 1,
        unresolvedFailureCount: 0,
        missingRecordCount: 0,
      })
    ).toBe('open')
  })

  test('missing inspection records → open', () => {
    expect(
      deriveLotConformance({
        openHoldPointCount: 0,
        unresolvedFailureCount: 0,
        missingRecordCount: 2,
      })
    ).toBe('open')
  })

  test('all inspected, failures dispositioned via closed NCRs, holds released → conforming', () => {
    expect(
      deriveLotConformance({
        openHoldPointCount: 0,
        unresolvedFailureCount: 0,
        missingRecordCount: 0,
      })
    ).toBe('conforming')
  })
})

describe('lotCloseError (the non-bypassable close gate)', () => {
  test('unresolved failure blocks close with the NCR message', () => {
    const err = lotCloseError({
      openHoldPointCount: 0,
      unresolvedFailureCount: 1,
      missingRecordCount: 0,
    })
    expect(err).toMatch(/failed item without a linked closed NCR/)
  })

  test('failure message pluralises', () => {
    const err = lotCloseError({
      openHoldPointCount: 0,
      unresolvedFailureCount: 2,
      missingRecordCount: 0,
    })
    expect(err).toMatch(/2 failed items/)
  })

  test('open hold point blocks close', () => {
    const err = lotCloseError({
      openHoldPointCount: 1,
      unresolvedFailureCount: 0,
      missingRecordCount: 0,
    })
    expect(err).toMatch(/1 hold point must be released/)
  })

  test('missing records block close', () => {
    const err = lotCloseError({
      openHoldPointCount: 0,
      unresolvedFailureCount: 0,
      missingRecordCount: 3,
    })
    expect(err).toMatch(/3 ITP items still need a passing inspection/)
  })

  test('failures outrank hold points outrank completeness', () => {
    const err = lotCloseError({
      openHoldPointCount: 2,
      unresolvedFailureCount: 1,
      missingRecordCount: 5,
    })
    expect(err).toMatch(/closed NCR/)
  })

  test('clean lot may close', () => {
    expect(
      lotCloseError({
        openHoldPointCount: 0,
        unresolvedFailureCount: 0,
        missingRecordCount: 0,
      })
    ).toBeNull()
  })
})

describe('holdPointItems', () => {
  const items = [
    { id: 'a', description: 'Pre-pour inspection', point_type: 'hold', status: 'pending', responsible: 'Engineer' },
    { id: 'b', description: 'Slump test', point_type: 'surveillance', status: 'pending', responsible: null },
    { id: 'c', description: 'Proof roll', point_type: 'witness', status: 'pending', responsible: 'Geotech' },
    { id: 'd', description: 'Clearance certificate', point_type: 'hold', status: 'na', responsible: 'LAA' },
  ]

  test('returns hold items only, excluding N/A', () => {
    expect(holdPointItems(items).map((i) => i.id)).toEqual(['a'])
  })

  test('empty when no hold items', () => {
    expect(holdPointItems(items.filter((i) => i.point_type !== 'hold'))).toEqual([])
  })
})
