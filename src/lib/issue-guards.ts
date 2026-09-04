// Pure guards for issuing documents and for the job invoicing lifecycle.
// NO Supabase imports — shared by the quote/invoice server actions and vitest.

import { docTotals } from '@/lib/money'
import type { JobStatus } from '@/lib/zod'

/**
 * Why a quote or invoice must not be marked sent yet, or null when it may.
 * An empty or $0 document reaching a client is always a mistake (sent quotes
 * now publish straight to the portal), so both are blocked at the action.
 */
export function issueProblem(
  lines: { qty: number; unitSell: number }[],
  what: 'quote' | 'invoice'
): string | null {
  if (lines.length === 0) {
    return `Add at least one line before marking the ${what} sent`
  }
  const { total } = docTotals(lines, 0)
  if (total <= 0) {
    return `The ${what} total is $0 — add prices before marking it sent`
  }
  return null
}

/**
 * The job's invoicing-lifecycle status implied by its NON-VOID invoices, or
 * null for "leave it alone". Only completed → invoiced → paid are touched;
 * earlier statuses (quote/scheduled/in_progress) never move.
 *   - all invoices paid (≥1)              → paid
 *   - any invoice issued (sent/paid)      → invoiced
 *   - none issued (all draft or all void) → completed  (reversal: voiding
 *     the last issued invoice or deleting the settling payment)
 */
export function deriveJobStatusFromInvoices(
  jobStatus: string,
  invoiceStatuses: string[]
): JobStatus | null {
  if (!['completed', 'invoiced', 'paid'].includes(jobStatus)) return null

  const live = invoiceStatuses.filter((s) => s !== 'void')
  const allPaid = live.length > 0 && live.every((s) => s === 'paid')
  const anyIssued = live.some((s) => s === 'sent' || s === 'paid')

  const next: JobStatus = allPaid ? 'paid' : anyIssued ? 'invoiced' : 'completed'
  return next === jobStatus ? null : next
}
