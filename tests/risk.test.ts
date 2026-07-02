import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RISK_BANDS,
  riskRating,
  riskTransitionAllowed,
  RISK_TRANSITIONS,
  riskCloseError,
} from '@/lib/risk'
import { RISK_STATUSES } from '@/lib/zod'

// ─── SQL ↔ TS band agreement ─────────────────────────────────────────────────
// The IMMUTABLE risk_rating() SQL fn in migration 0022 is the source of truth
// for the 5×5 bands; RISK_BANDS is its one TS mirror. Parse the actual
// migration text and assert the two definitions agree — if someone edits one
// side, this test fails.

const MIGRATION = path.join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '0022_risk_register.sql'
)

function parseSqlBands(): { min: number; max: number; rating: string }[] {
  const sql = readFileSync(MIGRATION, 'utf8')
  const fnMatch = sql.match(
    /create function risk_rating[\s\S]*?\$\$([\s\S]*?)\$\$/i
  )
  expect(fnMatch, 'risk_rating() fn found in migration 0022').toBeTruthy()
  const body = fnMatch![1]
  const bandRe = /when score between\s+(\d+)\s+and\s+(\d+)\s+then\s+'(\w+)'/gi
  const bands: { min: number; max: number; rating: string }[] = []
  for (const m of body.matchAll(bandRe)) {
    bands.push({ min: Number(m[1]), max: Number(m[2]), rating: m[3] })
  }
  return bands
}

describe('risk_rating SQL fn ↔ RISK_BANDS TS mirror', () => {
  it('defines identical bands', () => {
    const sqlBands = parseSqlBands()
    expect(sqlBands).toEqual(RISK_BANDS)
  })

  it('SQL bands cover every 5×5 score exactly once', () => {
    const sqlBands = parseSqlBands()
    for (let l = 1; l <= 5; l++) {
      for (let c = 1; c <= 5; c++) {
        const score = l * c
        const matches = sqlBands.filter((b) => score >= b.min && score <= b.max)
        expect(matches, `score ${score}`).toHaveLength(1)
      }
    }
  })
})

describe('riskRating (TS mirror)', () => {
  it('rates the band boundaries per the locked matrix', () => {
    expect(riskRating(1)).toBe('Low')
    expect(riskRating(4)).toBe('Low')
    expect(riskRating(5)).toBe('Medium')
    expect(riskRating(9)).toBe('Medium')
    expect(riskRating(10)).toBe('High')
    expect(riskRating(16)).toBe('High')
    expect(riskRating(17)).toBe('Extreme')
    expect(riskRating(25)).toBe('Extreme')
  })

  it('is null for null/undefined (matches SQL STRICT) and out-of-range', () => {
    expect(riskRating(null)).toBeNull()
    expect(riskRating(undefined)).toBeNull()
    expect(riskRating(0)).toBeNull()
    expect(riskRating(26)).toBeNull()
  })
})

// ─── Lifecycle ────────────────────────────────────────────────────────────────

describe('riskTransitionAllowed', () => {
  it('working statuses are freely navigable', () => {
    expect(riskTransitionAllowed('open', 'treating')).toBe(true)
    expect(riskTransitionAllowed('treating', 'accepted')).toBe(true)
    expect(riskTransitionAllowed('accepted', 'treating')).toBe(true)
  })

  it('closed is reachable from every working status (gated separately)', () => {
    expect(riskTransitionAllowed('open', 'closed')).toBe(true)
    expect(riskTransitionAllowed('treating', 'closed')).toBe(true)
    expect(riskTransitionAllowed('accepted', 'closed')).toBe(true)
  })

  it('closed only reopens to open (admin-only in the action)', () => {
    expect(riskTransitionAllowed('closed', 'open')).toBe(true)
    expect(riskTransitionAllowed('closed', 'treating')).toBe(false)
    expect(riskTransitionAllowed('closed', 'accepted')).toBe(false)
  })

  it('never allows a self-transition and covers every status', () => {
    for (const s of RISK_STATUSES) {
      expect(RISK_TRANSITIONS[s]).toBeDefined()
      expect(riskTransitionAllowed(s, s)).toBe(false)
    }
  })
})

// ─── Close gates ──────────────────────────────────────────────────────────────

describe('riskCloseError', () => {
  const scoredRisk = {
    kind: 'risk' as const,
    residual_likelihood: 2,
    residual_consequence: 3,
  }
  const unscoredRisk = {
    kind: 'risk' as const,
    residual_likelihood: null,
    residual_consequence: null,
  }
  const opportunity = {
    kind: 'opportunity' as const,
    residual_likelihood: null,
    residual_consequence: null,
  }

  it('blocks close while treatments are open, with a count', () => {
    expect(riskCloseError(scoredRisk, 1)).toBe(
      'Cannot close — 1 open treatment must be completed first'
    )
    expect(riskCloseError(scoredRisk, 3)).toBe(
      'Cannot close — 3 open treatments must be completed first'
    )
    // Open treatments block opportunities too.
    expect(riskCloseError(opportunity, 2)).toMatch(/open treatments/)
  })

  it('blocks closing a RISK without residual scores', () => {
    expect(riskCloseError(unscoredRisk, 0)).toMatch(
      /residual likelihood and consequence/i
    )
    // Half-scored is still blocked (belt-and-braces; DB CHECK forbids it too).
    expect(
      riskCloseError(
        { kind: 'risk', residual_likelihood: 2, residual_consequence: null },
        0
      )
    ).toMatch(/residual/i)
  })

  it('opportunities are exempt from residual scoring', () => {
    expect(riskCloseError(opportunity, 0)).toBeNull()
  })

  it('allows closing a scored risk with no open treatments', () => {
    expect(riskCloseError(scoredRisk, 0)).toBeNull()
  })
})
