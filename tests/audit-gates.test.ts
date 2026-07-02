import { describe, expect, it } from 'vitest'
import {
  AUDIT_TRANSITIONS,
  auditTransitionAllowed,
  auditCompleteError,
  auditCloseError,
  findingCloseError,
} from '@/lib/audit-gates'
import { AUDIT_STATUSES } from '@/lib/zod'

describe('auditTransitionAllowed', () => {
  it('follows the forward chain', () => {
    expect(auditTransitionAllowed('planned', 'in_progress')).toBe(true)
    expect(auditTransitionAllowed('in_progress', 'complete')).toBe(true)
    expect(auditTransitionAllowed('complete', 'closed')).toBe(true)
  })

  it('allows the sanctioned step-backs only', () => {
    expect(auditTransitionAllowed('complete', 'in_progress')).toBe(true)
    expect(auditTransitionAllowed('closed', 'complete')).toBe(true) // admin reopen
    expect(auditTransitionAllowed('in_progress', 'planned')).toBe(false)
    expect(auditTransitionAllowed('closed', 'planned')).toBe(false)
  })

  it('never allows skipping straight to closed', () => {
    expect(auditTransitionAllowed('planned', 'closed')).toBe(false)
    expect(auditTransitionAllowed('in_progress', 'closed')).toBe(false)
  })

  it('never allows a self-transition and covers every status', () => {
    for (const s of AUDIT_STATUSES) {
      expect(AUDIT_TRANSITIONS[s]).toBeDefined()
      expect(auditTransitionAllowed(s, s)).toBe(false)
    }
  })
})

describe('auditCompleteError (checklist gate)', () => {
  it('blocks complete without a conducted checklist', () => {
    expect(auditCompleteError(false)).toMatch(/conduct the audit checklist/i)
  })

  it('allows complete once the checklist submission exists', () => {
    expect(auditCompleteError(true)).toBeNull()
  })
})

describe('auditCloseError (open-findings gate)', () => {
  it('blocks close while findings are open, with a count', () => {
    expect(auditCloseError(1)).toBe(
      'Cannot close — 1 open finding must be closed first'
    )
    expect(auditCloseError(3)).toBe(
      'Cannot close — 3 open findings must be closed first'
    )
  })

  it('allows close when no findings are open', () => {
    expect(auditCloseError(0)).toBeNull()
  })
})

describe('findingCloseError (major-NC escalation gate)', () => {
  it('non-major classifications close freely', () => {
    for (const classification of ['observation', 'minor_nc', 'opportunity'] as const) {
      expect(
        findingCloseError({ classification, ncr_id: null, ncr_status: null })
      ).toBeNull()
    }
  })

  it('major_nc without an NCR is blocked', () => {
    expect(
      findingCloseError({
        classification: 'major_nc',
        ncr_id: null,
        ncr_status: null,
      })
    ).toMatch(/without a linked NCR/i)
  })

  it('major_nc with an open/verified NCR is blocked until the NCR closes', () => {
    for (const status of ['open', 'investigating', 'actions', 'verified']) {
      expect(
        findingCloseError({
          classification: 'major_nc',
          ncr_id: 'ncr-1',
          ncr_status: status,
        })
      ).toMatch(/linked NCR must be closed/i)
    }
  })

  it('major_nc with a CLOSED linked NCR may close', () => {
    expect(
      findingCloseError({
        classification: 'major_nc',
        ncr_id: 'ncr-1',
        ncr_status: 'closed',
      })
    ).toBeNull()
  })
})
