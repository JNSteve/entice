// Management Review (ISO 9001/14001/45001 9.3) — the CONTROLLED input list
// and the pure close/transition gates. Client-safe: no Supabase imports. The
// server-side data-snapshot engine lives in src/lib/mgmt-review-data.ts.
//
// Locked decisions implemented here:
//   * The 9.3.2 inputs are a controlled list (mirrored by the DB CHECK in
//     0024_management_review.sql), seeded per review at creation — never
//     user-configurable.
//   * The completion guard is SOFT: closing with un-reviewed inputs is
//     allowed, but only with an explicit confirmation — the gate returns the
//     exact list of un-reviewed inputs so the UI can show them. It NEVER
//     blocks on open output actions: decisions/actions are meant to stay open
//     in the tracker after the meeting (tests/mgmt-review.test.ts asserts
//     the gate is a function of un-reviewed inputs only).

import type { MgmtReviewStatus } from '@/lib/zod'

// ─── The controlled ISO 9.3.2 input list ─────────────────────────────────────

export const MGMT_REVIEW_INPUT_KEYS = [
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
] as const

export type MgmtReviewInputKey = (typeof MGMT_REVIEW_INPUT_KEYS)[number]

export type MgmtReviewStandard = '9001' | '14001' | '45001'

export type MgmtReviewInputDef = {
  label: string
  /** Plain-English guidance shown under the label on the checklist. */
  helper: string
  /** Which standards mandate this input (9.3.2). */
  standards: MgmtReviewStandard[]
  /** Whether the app auto-pulls a data snapshot from the live registers. */
  auto: boolean
}

export const MGMT_REVIEW_INPUT_DEFS: Record<MgmtReviewInputKey, MgmtReviewInputDef> = {
  previous_actions_status: {
    label: 'Status of actions from previous reviews',
    helper:
      'Did we do what we said we would last time? Work through the previous reviews’ output actions — what is done, what is still open, and why.',
    standards: ['9001', '14001', '45001'],
    auto: true,
  },
  context_changes: {
    label: 'Changes in internal and external issues',
    helper:
      'Anything that changed in the business or its environment relevant to the management system — new markets, clients, contracts, legislation on the horizon, staffing, plant, premises, interested-party expectations.',
    standards: ['9001', '14001', '45001'],
    auto: false,
  },
  customer_feedback_complaints: {
    label: 'Customer satisfaction and complaints',
    helper:
      'Feedback from clients and other interested parties — satisfaction signals, compliments and complaints, and any complaint-sourced NCRs raised this period.',
    standards: ['9001'],
    auto: true,
  },
  objectives_kpi_performance: {
    label: 'Objectives and KPI performance',
    helper:
      'The extent to which the measurable objectives have been met — each objective’s latest value against its target, and which are off track.',
    standards: ['9001', '14001', '45001'],
    auto: true,
  },
  process_performance_ncr_trends: {
    label: 'Process performance, nonconformities and corrective actions',
    helper:
      'How the processes performed: NCRs raised by source, what is still open, overdue corrective actions, and controlled documents past their review date.',
    standards: ['9001', '14001', '45001'],
    auto: true,
  },
  incidents_safety_performance: {
    label: 'Incidents and safety/environmental performance',
    helper:
      'Injuries, near misses, property and environmental incidents this period — counts by type, anything high-severity, and what is still open.',
    standards: ['14001', '45001'],
    auto: true,
  },
  audit_results: {
    label: 'Internal and external audit results',
    helper:
      'Audits conducted and closed this period, findings raised by classification, and findings still open. Include any external/certification audit results in the minute.',
    standards: ['9001', '14001', '45001'],
    auto: true,
  },
  risk_opportunity_effectiveness: {
    label: 'Effectiveness of actions on risks and opportunities',
    helper:
      'Is the risk register working? Open risks still rated High/Extreme after treatment, overdue risk reviews, and whether treatments are actually reducing exposure.',
    standards: ['9001', '14001', '45001'],
    auto: true,
  },
  legal_compliance_status: {
    label: 'Compliance with legal and other requirements',
    helper:
      'Fulfilment of compliance obligations — legislation, permits, licences, codes and client requirements. The obligations register is coming (next module); until then record the compliance position and any evaluations in the minute.',
    standards: ['14001', '45001'],
    auto: false,
  },
  resource_adequacy: {
    label: 'Adequacy of resources',
    helper:
      'Do we have the people, competence, plant and budget to run the system? Training compliance against mandatory role requirements is pulled from the competency register; cover staffing, plant and budget in the minute.',
    standards: ['9001', '14001', '45001'],
    auto: true,
  },
  worker_consultation_participation: {
    label: 'Consultation and participation of workers',
    helper:
      'Evidence workers are consulted and participate in the OHS system — toolbox talks held, sign-on participation, issues raised from the field and what happened to them.',
    standards: ['45001'],
    auto: true,
  },
  external_provider_performance: {
    label: 'Performance of external providers',
    helper:
      'Subcontractor and supplier performance — supplier-sourced NCRs this period and vendors with expired compliance documents.',
    standards: ['9001'],
    auto: true,
  },
  improvement_opportunities: {
    label: 'Opportunities for improvement',
    helper:
      'What could work better? Improvement opportunities raised in audits, open objective improvement actions, and ideas from the floor. Decisions on continual improvement belong in the outputs below.',
    standards: ['9001', '14001', '45001'],
    auto: true,
  },
}

export const MGMT_REVIEW_STANDARD_LABELS: Record<MgmtReviewStandard, string> = {
  '9001': 'ISO 9001',
  '14001': 'ISO 14001',
  '45001': 'ISO 45001',
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/** Forward chain + the admin reopen. A draft may close directly (the soft
 *  confirm gate below still applies), since input work auto-moves the review
 *  to in_progress anyway. */
export const MGMT_REVIEW_TRANSITIONS: Record<MgmtReviewStatus, MgmtReviewStatus[]> = {
  draft: ['in_progress', 'closed'],
  in_progress: ['closed'],
  closed: ['in_progress'], // admin reopen
}

export function mgmtReviewTransitionAllowed(
  from: MgmtReviewStatus,
  to: MgmtReviewStatus
): boolean {
  return (MGMT_REVIEW_TRANSITIONS[from] ?? []).includes(to)
}

// ─── The SOFT close gate ──────────────────────────────────────────────────────

/**
 * Gate for closing a review. SOFT by design: closing with un-reviewed inputs
 * is allowed, but only with an explicit confirmation — without it the close
 * is rejected with the exact list of un-reviewed inputs (the UI shows them).
 *
 * Deliberately a function of the un-reviewed INPUTS only: open output
 * actions NEVER block a close — they are the review's outputs and are meant
 * to stay open in the tracker after the meeting.
 *
 * Returns an error string, or null when the close may proceed.
 */
export function mgmtReviewCloseError(
  unreviewedLabels: string[],
  confirmed: boolean
): string | null {
  if (unreviewedLabels.length === 0) return null
  if (confirmed) return null
  return `Cannot close — ${unreviewedLabels.length} input${
    unreviewedLabels.length === 1 ? ' has' : 's have'
  } not been marked reviewed: ${unreviewedLabels.join(
    ', '
  )}. Close anyway requires explicit confirmation.`
}
