import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, test } from 'vitest'
import {
  SIGNIFICANCE_THRESHOLD,
  significanceScore,
  isSignificant,
  PERMIT_WARN_PCT,
  permitUsage,
  permitUsageWithMovements,
  regulatedToPermitLoad,
  gatingWarnings,
} from '@/lib/env'

// ─── SQL ↔ TS significance agreement ─────────────────────────────────────────
// env_aspects.significance / .significant are GENERATED columns in migration
// 0031 — the source of truth. SIGNIFICANCE_THRESHOLD is the one TS mirror;
// parse the migration text and assert the two stay in agreement.

const MIGRATION = path.join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '0031_environmental.sql'
)

describe('env_aspects generated columns ↔ TS mirror', () => {
  const sql = readFileSync(MIGRATION, 'utf8')

  it('significance is likelihood × severity', () => {
    expect(sql).toMatch(
      /significance smallint generated always as \(likelihood \* severity\) stored/
    )
    expect(significanceScore(3, 4)).toBe(12)
    expect(significanceScore(5, 5)).toBe(25)
  })

  it('significant threshold matches SIGNIFICANCE_THRESHOLD', () => {
    const m = sql.match(
      /significant boolean generated always as \(\(likelihood \* severity\) >= (\d+)\) stored/
    )
    expect(m, 'significant generated column found in migration 0031').toBeTruthy()
    expect(Number(m![1])).toBe(SIGNIFICANCE_THRESHOLD)
  })

  it('isSignificant flips exactly at the threshold', () => {
    expect(isSignificant(SIGNIFICANCE_THRESHOLD - 1)).toBe(false)
    expect(isSignificant(SIGNIFICANCE_THRESHOLD)).toBe(true)
    expect(isSignificant(25)).toBe(true)
    // 3×4 = 12 is the canonical first significant cell
    expect(isSignificant(significanceScore(3, 4))).toBe(true)
    expect(isSignificant(significanceScore(2, 5))).toBe(false) // 10
  })
})

// ─── Permit reconciliation ────────────────────────────────────────────────────

describe('permitUsage', () => {
  it('sums only loads in the permit unit', () => {
    const usage = permitUsage(100, 'm3', [
      { qty: 30, unit: 'm3' },
      { qty: 20, unit: 'm3' },
      { qty: 15, unit: 't' }, // other unit — counted, never converted
    ])
    expect(usage.used).toBe(50)
    expect(usage.pctUsed).toBe(50)
    expect(usage.level).toBe('ok')
    expect(usage.otherUnitCount).toBe(1)
  })

  it('warn from 80% (inclusive), over above 100%', () => {
    expect(permitUsage(100, 't', [{ qty: 79.99, unit: 't' }]).level).toBe('ok')
    expect(permitUsage(100, 't', [{ qty: 80, unit: 't' }]).level).toBe('warn')
    expect(permitUsage(100, 't', [{ qty: 100, unit: 't' }]).level).toBe('warn')
    expect(permitUsage(100, 't', [{ qty: 100.01, unit: 't' }]).level).toBe('over')
    expect(PERMIT_WARN_PCT).toBe(80)
  })

  it('handles empty loads and rounds to 2 dp', () => {
    const empty = permitUsage(50, 'm3', [])
    expect(empty).toEqual({ used: 0, pctUsed: 0, level: 'ok', otherUnitCount: 0 })

    const rounded = permitUsage(3, 'm3', [
      { qty: 1.005, unit: 'm3' },
      { qty: 1.005, unit: 'm3' },
    ])
    expect(rounded.used).toBe(2.01)
    expect(rounded.pctUsed).toBe(67)
  })

  it('null percentage when allowance is not positive', () => {
    const usage = permitUsage(0, 't', [{ qty: 5, unit: 't' }])
    expect(usage.pctUsed).toBeNull()
    expect(usage.level).toBe('ok')
  })
})

// ─── Gating warnings (warn + override, never block) ──────────────────────────

describe('gatingWarnings', () => {
  const today = '2026-07-06'
  const load = { classification: 'asbestos', qty: 10, unit: 't' as const }
  const facility = { name: 'Test Facility', licence_expiry: '2027-01-01', active: true }
  const permit = {
    reference: 'EA-123',
    expiry: '2027-01-01',
    classification: 'asbestos',
    allowance_qty: 100,
    allowance_unit: 't' as const,
  }

  it('no warnings when everything is current and within allowance', () => {
    expect(
      gatingWarnings({ facility, permit, permitLoadsSoFar: [], load, today })
    ).toEqual([])
  })

  it('warns on expired facility licence and inactive facility', () => {
    const warnings = gatingWarnings({
      facility: { name: 'Old Tip', licence_expiry: '2026-07-05', active: false },
      permit: null,
      permitLoadsSoFar: [],
      load,
      today,
    })
    expect(warnings).toHaveLength(2)
    expect(warnings.join(' ')).toContain('inactive')
    expect(warnings.join(' ')).toContain('expired')
  })

  it('warns when the load pushes the permit over its allowance', () => {
    const warnings = gatingWarnings({
      facility: null,
      permit,
      permitLoadsSoFar: [{ qty: 95, unit: 't' }],
      load, // 95 + 10 = 105 > 100
      today,
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('allowance exceeded')
  })

  it('does not count an other-unit load against the allowance', () => {
    const warnings = gatingWarnings({
      facility: null,
      permit,
      permitLoadsSoFar: [{ qty: 99, unit: 't' }],
      load: { classification: 'asbestos', qty: 50, unit: 'm3' },
      today,
    })
    expect(warnings).toEqual([])
  })

  it('warns on classification mismatch and expired permit', () => {
    const warnings = gatingWarnings({
      facility: null,
      permit: { ...permit, expiry: '2026-01-01', classification: 'general' },
      permitLoadsSoFar: [],
      load,
      today,
    })
    expect(warnings).toHaveLength(2)
    expect(warnings.join(' ')).toContain('expired')
    expect(warnings.join(' ')).toContain('classification')
  })
})

// ─── Regulated movements against permit allowances ───────────────────────────
// Locked decision: union both tables, convert kg→t ONLY. That is exact
// arithmetic, not the density assumption the no-conversion rule exists to ban.

describe('regulatedToPermitLoad', () => {
  test('m³ maps straight across', () => {
    expect(regulatedToPermitLoad({ qty: 2.5, unit: 'm3' })).toEqual({
      qty: 2.5,
      unit: 'm3',
    })
  })

  test('kg converts to tonnes exactly', () => {
    expect(regulatedToPermitLoad({ qty: 1000, unit: 'kg' })).toEqual({
      qty: 1,
      unit: 't',
    })
    expect(regulatedToPermitLoad({ qty: 2500, unit: 'kg' })).toEqual({
      qty: 2.5,
      unit: 't',
    })
  })

  test('litres and container counts are never converted', () => {
    expect(regulatedToPermitLoad({ qty: 200, unit: 'L' })).toBeNull()
    expect(regulatedToPermitLoad({ qty: 3, unit: 'Each' })).toBeNull()
    expect(regulatedToPermitLoad({ qty: 1, unit: 'IBC' })).toBeNull()
  })
})

describe('permitUsageWithMovements', () => {
  test('sums general loads and tracked movements against a m³ permit', () => {
    const usage = permitUsageWithMovements(
      100,
      'm3',
      [{ qty: 40, unit: 'm3' }],
      [{ qty: 10, unit: 'm3' }]
    )
    expect(usage.used).toBe(50)
    expect(usage.pctUsed).toBe(50)
    expect(usage.otherUnitCount).toBe(0)
  })

  test('kg movements count against a tonne permit', () => {
    const usage = permitUsageWithMovements(
      10,
      't',
      [{ qty: 2, unit: 't' }],
      [{ qty: 3000, unit: 'kg' }]
    )
    expect(usage.used).toBe(5)
    expect(usage.level).toBe('ok')
  })

  test('non-convertible movements are surfaced, never summed', () => {
    const usage = permitUsageWithMovements(
      100,
      'm3',
      [],
      [
        { qty: 5, unit: 'm3' },
        { qty: 200, unit: 'L' },
        { qty: 2, unit: 'IBC' },
      ]
    )
    expect(usage.used).toBe(5)
    expect(usage.otherUnitCount).toBe(2)
  })

  test('kg is NOT summed against a m³ permit — that would need a density', () => {
    const usage = permitUsageWithMovements(100, 'm3', [], [{ qty: 5000, unit: 'kg' }])
    expect(usage.used).toBe(0)
    expect(usage.otherUnitCount).toBe(1)
  })

  test('the over-allowance level still fires on the union', () => {
    const usage = permitUsageWithMovements(
      5,
      't',
      [{ qty: 3, unit: 't' }],
      [{ qty: 2500, unit: 'kg' }]
    )
    expect(usage.used).toBe(5.5)
    expect(usage.level).toBe('over')
  })
})
