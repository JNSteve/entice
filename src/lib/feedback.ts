// CP3 pure logic — handover-pack eligibility and portal feedback rules.
// NO Supabase imports: these run in the anonymous portal pages, office pages,
// the PDF builder and vitest alike. The SQL in
// supabase/migrations/0033_cp3_email.sql mirrors these rules — change them
// together.

export type HandoverKind = 'job' | 'project'

/**
 * "Completed" for handover/feedback purposes — the SAME grouping the portal
 * works-history timeline uses (workGroupForJob / workGroupForProject in
 * src/lib/portal-experience.ts): jobs past completion (incl. invoiced/paid),
 * projects closed.
 */
export const HANDOVER_ELIGIBLE_JOB_STATUSES = [
  'completed',
  'invoiced',
  'paid',
] as const

export const HANDOVER_ELIGIBLE_PROJECT_STATUSES = ['closed'] as const

export function handoverEligible(kind: HandoverKind, status: string): boolean {
  return kind === 'job'
    ? (HANDOVER_ELIGIBLE_JOB_STATUSES as readonly string[]).includes(status)
    : (HANDOVER_ELIGIBLE_PROJECT_STATUSES as readonly string[]).includes(status)
}

/** Feedback is invited on exactly the works a handover pack covers. */
export const feedbackEligible = handoverEligible

// ─── Feedback constraints (mirrors portal_submit_feedback) ───────────────────

export const FEEDBACK_MIN_RATING = 1
export const FEEDBACK_MAX_RATING = 5
export const FEEDBACK_MAX_COMMENT_CHARS = 2000
/** Rolling-24h submissions per link (SQL guard is count >= max). */
export const FEEDBACK_RATE_LIMIT = { max: 10, windowMs: 24 * 60 * 60 * 1000 }

export function feedbackProblem(rating: number, comment: string): string | null {
  if (
    !Number.isInteger(rating) ||
    rating < FEEDBACK_MIN_RATING ||
    rating > FEEDBACK_MAX_RATING
  ) {
    return 'Pick a star rating first'
  }
  if (comment.trim().length > FEEDBACK_MAX_COMMENT_CHARS) {
    return `Keep the comment under ${FEEDBACK_MAX_COMMENT_CHARS} characters`
  }
  return null
}

/** The attachment caption that marks a stored handover pack (portal detects it). */
export const HANDOVER_PACK_CAPTION = 'Handover pack'
