// Client portal (CP1) pure logic — property compliance lights and client-link
// validity. NO Supabase imports: these run in office pages, the anonymous
// portal pages and vitest alike. Date comparisons are 'YYYY-MM-DD' string
// compares against the Australian (Brisbane) calendar day, same convention as
// src/lib/compliance.ts (whose 30-day amber rule this reuses).

import { addDaysISO, type ComplianceStatus } from '@/lib/compliance'

// ─── Compliance item kinds ───────────────────────────────────────────────────

export const PROPERTY_COMPLIANCE_KINDS = [
  'asbestos_register',
  'asbestos_mgmt_plan',
  'hazmat_survey',
  'clearance_certificate',
  'air_monitoring',
  'contaminated_land',
  'other',
] as const

export type PropertyComplianceKind = (typeof PROPERTY_COMPLIANCE_KINDS)[number]

export const PROPERTY_COMPLIANCE_KIND_LABELS: Record<PropertyComplianceKind, string> = {
  asbestos_register: 'Asbestos register',
  asbestos_mgmt_plan: 'Asbestos management plan',
  hazmat_survey: 'HAZMAT survey',
  clearance_certificate: 'Clearance certificate',
  air_monitoring: 'Air monitoring',
  contaminated_land: 'Contaminated land',
  other: 'Other',
}

// ─── Per-item status ─────────────────────────────────────────────────────────

/**
 * One item's traffic light from its review_due date.
 * - null review_due (clearances/air monitoring — no re-inspection cycle)
 *   → 'green': the item never falls due.
 * - review_due before today → 'red' (overdue).
 * - today .. today+30 inclusive → 'amber' (due soon — the recall window).
 * - later → 'green'.
 * Boundary semantics match deriveComplianceStatus: due TODAY is still (just)
 * current — amber, not red.
 */
export function derivePropertyItemStatus(
  reviewDue: string | null,
  today: string
): ComplianceStatus {
  if (!reviewDue) return 'green'
  if (reviewDue < today) return 'red'
  if (reviewDue <= addDaysISO(today, 30)) return 'amber'
  return 'green'
}

/**
 * A property's aggregate light over its ACTIVE items' review dates
 * (nulls = non-expiring items, which count as held evidence but never age).
 * Zero items → 'red', per the house rule (deriveComplianceStatus: missing
 * compliance documents are red) — an untracked property needs attention.
 */
export function derivePropertyStatus(
  reviewDues: (string | null)[],
  today: string
): ComplianceStatus {
  if (reviewDues.length === 0) return 'red'

  const in30 = addDaysISO(today, 30)
  let hasAmber = false

  for (const due of reviewDues) {
    if (due === null) continue
    if (due < today) return 'red'
    if (due <= in30) hasAmber = true
  }

  return hasAmber ? 'amber' : 'green'
}

// ─── Client link validity ────────────────────────────────────────────────────

export interface ClientLinkLike {
  revoked_at: string | null
  expires_at: string | null
}

/**
 * Mirrors portal_live_link()'s validity rule (revoked wins; expiry is a
 * strict instant compare) for office-side status display. The portal itself
 * never trusts this — the SECURITY DEFINER RPCs re-validate server-side.
 */
export function isClientLinkActive(
  link: ClientLinkLike,
  now: Date = new Date()
): boolean {
  if (link.revoked_at !== null) return false
  if (link.expires_at !== null && new Date(link.expires_at) <= now) return false
  return true
}

export type ClientLinkState = 'active' | 'revoked' | 'expired'

export function clientLinkState(
  link: ClientLinkLike,
  now: Date = new Date()
): ClientLinkState {
  if (link.revoked_at !== null) return 'revoked'
  if (link.expires_at !== null && new Date(link.expires_at) <= now) return 'expired'
  return 'active'
}
