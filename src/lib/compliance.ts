// Shared expiry traffic-light derivation (30-day amber rule), extracted from
// the vendors register so vendor compliance and the training/competency
// register share ONE rule. All comparisons are 'YYYY-MM-DD' string compares
// against the Australian (Brisbane) calendar day so client and server agree
// regardless of the host clock.

import { todayAUClient } from '@/lib/tz-client'

// ─── Vendor-style aggregate light ─────────────────────────────────────────────
//
// green  = has ≥1 doc AND all expiry_date > 30 days away
// amber  = any doc expiring within 30 days (but none expired)
// red    = any expired OR zero docs

export type ComplianceStatus = 'green' | 'amber' | 'red'

export interface ComplianceDocSummary {
  expiry_date: string // ISO date string
}

/** 'YYYY-MM-DD' n days after the given AU day (pure calendar arithmetic). */
export function addDaysISO(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Aggregate traffic light over a set of expiry-dated documents. `today` may be
 * injected (server code passes todayAU()); defaults to the AU calendar day.
 */
export function deriveComplianceStatus(
  docs: ComplianceDocSummary[],
  today: string = todayAUClient()
): ComplianceStatus {
  if (docs.length === 0) return 'red'

  const in30 = addDaysISO(today, 30)
  let hasAmber = false

  for (const doc of docs) {
    if (doc.expiry_date < today) return 'red'
    if (doc.expiry_date <= in30) hasAmber = true
  }

  return hasAmber ? 'amber' : 'green'
}

export function complianceTitle(status: ComplianceStatus): string {
  switch (status) {
    case 'green':
      return 'All compliance documents current'
    case 'amber':
      return 'One or more documents expire within 30 days'
    case 'red':
      return 'Expired or missing compliance documents'
  }
}

/**
 * Text colour classes for a single expiry date cell: red when expired, amber
 * within 30 days, default otherwise.
 */
export function expiryColour(
  expiryDate: string,
  today: string = todayAUClient()
): string {
  if (expiryDate < today) return 'text-red-600 font-medium'
  if (expiryDate <= addDaysISO(today, 30)) return 'text-amber-600 font-medium'
  return ''
}
