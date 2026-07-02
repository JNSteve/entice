import { describe, expect, it } from 'vitest'
import {
  MGMT_REVIEW_INPUT_KEYS,
  MGMT_REVIEW_INPUT_DEFS,
  MGMT_REVIEW_TRANSITIONS,
  mgmtReviewTransitionAllowed,
  mgmtReviewCloseError,
} from '@/lib/mgmt-review'
import { MGMT_REVIEW_STATUSES } from '@/lib/zod'

// ─── Controlled input-list integrity (ISO 9.3.2) ──────────────────────────────
// The list is the contract between the app constant, the DB CHECK in
// 0024_management_review.sql and the seeded rows — it must stay exactly 13
// unique keys, each fully defined.

describe('MGMT_REVIEW_INPUT_KEYS (controlled list)', () => {
  it('is exactly the 13 mandated inputs, in a stable order', () => {
    expect(MGMT_REVIEW_INPUT_KEYS).toEqual([
      'previous_actions_status',
      'context_changes',
      'customer_feedback_complaints',
      'objectives_kpi_performance',
      'process_performance_ncr_trends',
      'incidents_safety_performance',
      'audit_results',
      'risk_opportunity_effectiveness',
      'legal_compliance_status',
      'resource_adequacy',
      'worker_consultation_participation',
      'external_provider_performance',
      'improvement_opportunities',
    ])
  })

  it('has no duplicate keys', () => {
    expect(new Set(MGMT_REVIEW_INPUT_KEYS).size).toBe(MGMT_REVIEW_INPUT_KEYS.length)
  })

  it('defines label, helper text and mandating standards for every key', () => {
    for (const key of MGMT_REVIEW_INPUT_KEYS) {
      const def = MGMT_REVIEW_INPUT_DEFS[key]
      expect(def, key).toBeDefined()
      expect(def.label.length, `${key} label`).toBeGreaterThan(0)
      expect(def.helper.length, `${key} helper`).toBeGreaterThan(0)
      expect(def.standards.length, `${key} standards`).toBeGreaterThan(0)
      for (const s of def.standards) {
        expect(['9001', '14001', '45001']).toContain(s)
      }
    }
  })

  it('has no orphan definitions outside the controlled list', () => {
    expect(Object.keys(MGMT_REVIEW_INPUT_DEFS).sort()).toEqual(
      [...MGMT_REVIEW_INPUT_KEYS].sort()
    )
  })

  it('covers every 9.3.2 theme across the three standards', () => {
    const all = (std: '9001' | '14001' | '45001') =>
      MGMT_REVIEW_INPUT_KEYS.filter((k) =>
        MGMT_REVIEW_INPUT_DEFS[k].standards.includes(std)
      )
    // Each standard mandates a non-trivial subset.
    expect(all('9001').length).toBeGreaterThanOrEqual(8)
    expect(all('14001').length).toBeGreaterThanOrEqual(8)
    expect(all('45001').length).toBeGreaterThanOrEqual(8)
    // Standard-specific inputs are attributed correctly.
    expect(MGMT_REVIEW_INPUT_DEFS.worker_consultation_participation.standards).toEqual(
      ['45001']
    )
    expect(MGMT_REVIEW_INPUT_DEFS.external_provider_performance.standards).toEqual([
      '9001',
    ])
    expect(MGMT_REVIEW_INPUT_DEFS.legal_compliance_status.standards).toEqual([
      '14001',
      '45001',
    ])
  })

  it('flags legal_compliance_status and context_changes as free-text (no register yet)', () => {
    expect(MGMT_REVIEW_INPUT_DEFS.legal_compliance_status.auto).toBe(false)
    expect(MGMT_REVIEW_INPUT_DEFS.context_changes.auto).toBe(false)
  })
})

// ─── Lifecycle transitions ────────────────────────────────────────────────────

describe('mgmtReviewTransitionAllowed', () => {
  it('follows the forward chain', () => {
    expect(mgmtReviewTransitionAllowed('draft', 'in_progress')).toBe(true)
    expect(mgmtReviewTransitionAllowed('in_progress', 'closed')).toBe(true)
    expect(mgmtReviewTransitionAllowed('draft', 'closed')).toBe(true) // soft gate still applies
  })

  it('only allows the admin reopen out of closed', () => {
    expect(mgmtReviewTransitionAllowed('closed', 'in_progress')).toBe(true)
    expect(mgmtReviewTransitionAllowed('closed', 'draft')).toBe(false)
  })

  it('never allows a self-transition and covers every status', () => {
    for (const s of MGMT_REVIEW_STATUSES) {
      expect(MGMT_REVIEW_TRANSITIONS[s]).toBeDefined()
      expect(mgmtReviewTransitionAllowed(s, s)).toBe(false)
    }
  })
})

// ─── SOFT close-confirm gate ──────────────────────────────────────────────────

describe('mgmtReviewCloseError (soft completion guard)', () => {
  it('allows close when every input is reviewed — no confirm needed', () => {
    expect(mgmtReviewCloseError([], false)).toBeNull()
    expect(mgmtReviewCloseError([], true)).toBeNull()
  })

  it('rejects an unconfirmed close, listing exactly the un-reviewed inputs', () => {
    const error = mgmtReviewCloseError(
      ['Customer satisfaction and complaints', 'Adequacy of resources'],
      false
    )
    expect(error).toMatch(/2 inputs have not been marked reviewed/)
    expect(error).toContain('Customer satisfaction and complaints')
    expect(error).toContain('Adequacy of resources')
    expect(error).toMatch(/explicit confirmation/i)
  })

  it('uses singular grammar for one un-reviewed input', () => {
    expect(mgmtReviewCloseError(['Audit results'], false)).toMatch(
      /1 input has not been marked reviewed/
    )
  })

  it('allows the close once explicitly confirmed (soft, never hard)', () => {
    expect(
      mgmtReviewCloseError(['Audit results', 'Adequacy of resources'], true)
    ).toBeNull()
  })

  it('is a function of un-reviewed INPUTS only — open output actions can never block a close', () => {
    // The gate's entire input surface is (unreviewedLabels, confirmed): there
    // is no parameter through which open output actions could influence it.
    expect(mgmtReviewCloseError.length).toBe(2)
    // And a fully-reviewed close passes regardless of any tracker state.
    expect(mgmtReviewCloseError([], false)).toBeNull()
  })
})
