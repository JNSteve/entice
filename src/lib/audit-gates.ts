// Pure close/transition gates for the Internal Audit module (ISO 9.2).
// These are the NON-BYPASSABLE rules the server actions enforce; extracted
// here so they are unit-testable without a database:
//
//   * audit lifecycle is a forward chain (planned → in_progress → complete →
//     closed) with admin/office step-backs;
//   * an audit cannot be marked complete without a conducted checklist;
//   * an audit cannot be closed while it has open findings;
//   * a major_nc finding cannot be closed without a linked NCR, and that NCR
//     must itself be closed (NCR close already carries the mandatory
//     verification-of-effectiveness gate — reused, not rebuilt).

import type { AuditStatus, FindingClassification } from '@/lib/zod'

/** Forward lifecycle + permitted step-backs. closed → complete is admin-only
 *  (enforced in the action alongside this table). */
export const AUDIT_TRANSITIONS: Record<AuditStatus, AuditStatus[]> = {
  planned: ['in_progress'],
  in_progress: ['complete'],
  complete: ['closed', 'in_progress'], // may step back before close-out
  closed: ['complete'], // admin reopen
}

export function auditTransitionAllowed(
  from: AuditStatus,
  to: AuditStatus
): boolean {
  return (AUDIT_TRANSITIONS[from] ?? []).includes(to)
}

/**
 * Gate for moving an audit to 'complete': the checklist must have been
 * conducted (a form_submission exists). Returns an error string, or null when
 * the move is allowed.
 */
export function auditCompleteError(hasChecklistSubmission: boolean): string | null {
  if (!hasChecklistSubmission) {
    return 'Cannot complete — conduct the audit checklist first'
  }
  return null
}

/**
 * Gate for moving an audit to 'closed': every finding must be closed.
 * Returns an error string, or null when the close is allowed.
 */
export function auditCloseError(openFindingCount: number): string | null {
  if (openFindingCount > 0) {
    return `Cannot close — ${openFindingCount} open finding${
      openFindingCount === 1 ? '' : 's'
    } must be closed first`
  }
  return null
}

export type FindingCloseCheck = {
  classification: FindingClassification
  /** The linked NCR id, if any. */
  ncr_id: string | null
  /** The linked NCR's status ('open' … 'closed'), or null when no NCR. */
  ncr_status: string | null
}

/**
 * Gate for closing a finding. A major nonconformance MUST have a linked NCR
 * and that NCR must itself be closed (which the NCR module only allows after
 * verification of effectiveness). Returns an error string, or null when the
 * close is allowed.
 */
export function findingCloseError(finding: FindingCloseCheck): string | null {
  if (finding.classification !== 'major_nc') return null
  if (!finding.ncr_id) {
    return 'Cannot close a major nonconformance without a linked NCR — raise an NCR from this finding first'
  }
  if (finding.ncr_status !== 'closed') {
    return 'Cannot close — the linked NCR must be closed (verification of effectiveness) before this major nonconformance can be closed'
  }
  return null
}
