import { describe, expect, test } from 'vitest'
import {
  BUILTIN_RATE_KINDS,
  compareKinds,
  isRateKindKey,
  kindLabel,
  quoteLineKinds,
  slugKey,
  sortRateKinds,
} from '../src/lib/rate-kinds'

const custom = (key: string, label = key) => ({ key, label, builtin: false })

describe('slugKey', () => {
  test('lower-cases and joins words with dashes', () => {
    expect(slugKey('Waste disposal')).toBe('waste-disposal')
    expect(slugKey('  Permits & Fees  ')).toBe('permits-fees')
    expect(slugKey('Air-monitoring (NATA)')).toBe('air-monitoring-nata')
  })

  test('empty when nothing survives, and capped at 40 valid characters', () => {
    expect(slugKey('&&&')).toBe('')
    expect(slugKey('a'.repeat(60))).toHaveLength(40)
    expect(isRateKindKey(slugKey('x'.repeat(60)))).toBe(true)
    // A dash landing on the cut does not leave a trailing dash behind.
    expect(isRateKindKey(slugKey(`${'a'.repeat(39)} bb`))).toBe(true)
  })
})

describe('sortRateKinds', () => {
  test('built-ins in fixed order, then custom by key', () => {
    const rows = [custom('waste'), BUILTIN_RATE_KINDS[5], custom('air'), BUILTIN_RATE_KINDS[0]]
    expect(sortRateKinds(rows).map((r) => r.key)).toEqual(['labour', 'other', 'air', 'waste'])
  })

  test('the built-in list itself is already in display order', () => {
    expect(BUILTIN_RATE_KINDS.map((r) => r.key)).toEqual([
      'labour',
      'plant',
      'material',
      'consumable',
      'subbie',
      'other',
    ])
    expect(sortRateKinds([...BUILTIN_RATE_KINDS].reverse())).toEqual([...BUILTIN_RATE_KINDS])
  })
})

describe('compareKinds', () => {
  test('built-in < custom < null', () => {
    expect(compareKinds('other', 'air')).toBeLessThan(0)
    expect(compareKinds('air', 'waste')).toBeLessThan(0)
    expect(compareKinds('waste', 'air')).toBeGreaterThan(0)
    expect(compareKinds('waste', null)).toBeLessThan(0)
    expect(compareKinds(null, 'labour')).toBeGreaterThan(0)
    expect(compareKinds(null, null)).toBe(0)
    expect(compareKinds('labour', 'plant')).toBeLessThan(0)
    expect(compareKinds('plant', 'plant')).toBe(0)
  })
})

describe('labels', () => {
  test('catalog label, then raw key, then Uncategorised', () => {
    expect(kindLabel('plant')).toBe('Plant & equipment')
    expect(
      kindLabel('waste', [...BUILTIN_RATE_KINDS, custom('waste', 'Waste disposal')])
    ).toBe('Waste disposal')
    expect(kindLabel('waste')).toBe('waste')
    expect(kindLabel(null)).toBe('Uncategorised')
  })

  test('quoteLineKinds drops consumable only', () => {
    expect(quoteLineKinds().map((r) => r.key)).toEqual([
      'labour',
      'plant',
      'material',
      'subbie',
      'other',
    ])
    const withCustom = quoteLineKinds([...BUILTIN_RATE_KINDS, custom('waste')])
    expect(withCustom.map((r) => r.key)).toContain('waste')
    expect(withCustom.map((r) => r.key)).not.toContain('consumable')
  })
})
