// Client portal CP2b pure logic — work-request lifecycle, approval gating and
// the rate-limit window semantics the SQL definer functions enforce. NO
// Supabase imports: these run in the anonymous portal pages, office pages and
// vitest alike. The SQL in supabase/migrations/0029_portal_interactions.sql
// mirrors these rules — change them together.

// ─── Work request lifecycle ──────────────────────────────────────────────────

export const REQUEST_STATUSES = [
  'submitted',
  'reviewed',
  'quoted',
  'scheduled',
  'completed',
  'declined',
] as const

export type RequestStatus = (typeof REQUEST_STATUSES)[number]

/** The client-facing progress timeline (declined branches off it). */
export const REQUEST_TIMELINE: RequestStatus[] = [
  'submitted',
  'reviewed',
  'quoted',
  'scheduled',
  'completed',
]

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  submitted: 'Submitted',
  reviewed: 'Reviewed',
  quoted: 'Quoted',
  scheduled: 'Scheduled',
  completed: 'Completed',
  declined: 'Declined',
}

/**
 * Index of a status on the client-facing timeline; -1 for declined (it
 * renders as a branch, not a step).
 */
export function requestTimelineIndex(status: string): number {
  return REQUEST_TIMELINE.indexOf(status as RequestStatus)
}

/**
 * Office-side legal transitions. Forward-only along the timeline (skipping
 * steps is allowed — a request may be scheduled without a quote), and any
 * open request may be declined. Terminal: completed, declined.
 */
export const REQUEST_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  submitted: ['reviewed', 'quoted', 'scheduled', 'declined'],
  reviewed: ['quoted', 'scheduled', 'declined'],
  quoted: ['scheduled', 'completed', 'declined'],
  scheduled: ['completed', 'declined'],
  completed: [],
  declined: [],
}

export function canTransitionRequest(from: string, to: string): boolean {
  return (
    (REQUEST_TRANSITIONS[from as RequestStatus] ?? []) as string[]
  ).includes(to)
}

/** Convert-to-quote is offered while the request is still being triaged. */
export const CONVERTIBLE_REQUEST_STATUSES: RequestStatus[] = [
  'submitted',
  'reviewed',
]

export function canConvertRequest(
  status: string,
  quoteId: string | null
): boolean {
  return (
    quoteId === null &&
    (CONVERTIBLE_REQUEST_STATUSES as string[]).includes(status)
  )
}

// ─── Urgency ─────────────────────────────────────────────────────────────────

export const REQUEST_URGENCIES = ['low', 'normal', 'high', 'urgent'] as const

export type RequestUrgency = (typeof REQUEST_URGENCIES)[number]

export const REQUEST_URGENCY_LABELS: Record<RequestUrgency, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

// ─── Approval gating (sign on the glass) ─────────────────────────────────────

export type ApprovalKind = 'quote' | 'variation'

/** The one status a published item is signable in — mirrors portal_accept(). */
export const APPROVAL_SIGNABLE_STATUS: Record<ApprovalKind, string> = {
  quote: 'sent',
  variation: 'submitted',
}

/**
 * Whether the portal may offer accept/decline: office published it AND the
 * item still sits in its signable status. (The SQL re-checks both — this
 * drives the office toggle and the portal UI.)
 */
export function canSignApproval(
  kind: ApprovalKind,
  status: string,
  published: boolean
): boolean {
  return published && status === APPROVAL_SIGNABLE_STATUS[kind]
}

/** Sent quotes go on the portal to be signed; accepted ones stay as records. */
export function canPublishQuote(status: string): boolean {
  return status === APPROVAL_SIGNABLE_STATUS.quote || status === 'accepted'
}

/** Office may publish only while the item is signable; unpublish anytime. */
export function canPublishVariation(status: string): boolean {
  return status === APPROVAL_SIGNABLE_STATUS.variation
}

/** The acceptance wording shown above the signature pad and stored intent. */
export function acceptanceWording(number: string, clientName: string): string {
  return `By signing, you confirm acceptance of ${number} on behalf of ${clientName}.`
}

// ─── Rate-limit windows (mirrors the SQL: count-in-rolling-window >= max) ────

export const MESSAGE_RATE_LIMIT = { max: 20, windowMs: 60 * 60 * 1000 } // 20/hr
export const REQUEST_RATE_LIMIT = { max: 10, windowMs: 24 * 60 * 60 * 1000 } // 10/day
export const UPLOAD_RATE_LIMIT = { max: 40, windowMs: 24 * 60 * 60 * 1000 } // 40/day

/** Events strictly inside the rolling window ending at `now`. */
export function countInWindow(
  eventTimesIso: string[],
  nowIso: string,
  windowMs: number
): number {
  const now = Date.parse(nowIso)
  return eventTimesIso.filter((t) => {
    const at = Date.parse(t)
    return Number.isFinite(at) && at > now - windowMs && at <= now
  }).length
}

/**
 * True when the NEXT event must be rejected — i.e. the window already holds
 * `max` events (the SQL guard is `count >= max` before insert).
 */
export function rateLimited(
  eventTimesIso: string[],
  nowIso: string,
  limit: { max: number; windowMs: number }
): boolean {
  return countInWindow(eventTimesIso, nowIso, limit.windowMs) >= limit.max
}

// ─── Photo upload constraints (mirrors /portal/[token]/request-upload) ───────

export const MAX_REQUEST_PHOTOS = 5
export const MAX_REQUEST_PHOTO_BYTES = 10 * 1024 * 1024 // 10MB
export const REQUEST_PHOTO_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const

export function photoUploadProblem(
  files: { type: string; size: number }[]
): string | null {
  if (files.length === 0) return 'No files provided'
  if (files.length > MAX_REQUEST_PHOTOS) {
    return `A maximum of ${MAX_REQUEST_PHOTOS} photos can be attached`
  }
  for (const f of files) {
    if (!(REQUEST_PHOTO_TYPES as readonly string[]).includes(f.type)) {
      return 'Only JPEG, PNG, WebP or GIF images can be attached'
    }
    if (f.size <= 0 || f.size > MAX_REQUEST_PHOTO_BYTES) {
      return 'Each photo must be under 10MB'
    }
  }
  return null
}
