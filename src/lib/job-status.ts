import type { SupabaseClient } from '@supabase/supabase-js'
import { deriveJobStatusFromInvoices } from '@/lib/issue-guards'

/**
 * Reconcile a job's invoicing status against its non-void invoices, in both
 * directions (completed → invoiced → paid and back). Rules live in
 * deriveJobStatusFromInvoices. Works with either a user-session client (office
 * actions) or the service-role client (Xero push/pull).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function syncJobStatus(supabase: SupabaseClient<any, any, any>, jobId: string | null): Promise<void> {
  if (!jobId) return

  const [{ data: job }, { data: invoices }] = await Promise.all([
    supabase.from('jobs').select('id, status').eq('id', jobId).single(),
    supabase.from('invoices').select('status').eq('job_id', jobId),
  ])
  if (!job) return

  const next = deriveJobStatusFromInvoices(
    job.status as string,
    (invoices ?? []).map((i) => i.status as string)
  )
  if (next) {
    await supabase.from('jobs').update({ status: next }).eq('id', jobId)
  }
}
