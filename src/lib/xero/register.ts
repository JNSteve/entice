import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Admin = SupabaseClient<any, 'public', any>

export type XeroEvent = {
  direction: 'push' | 'pull'
  entity: 'invoice' | 'claim' | 'payment' | 'contact' | 'tracking' | 'reference' | 'connection'
  entityId?: string | null
  xeroId?: string | null
  action:
    | 'created'
    | 'updated'
    | 'voided'
    | 'matched'
    | 'unmatched'
    | 'archived'
    | 'skipped'
    | 'warning'
    | 'failed'
  detail?: string | null
}

export type RunPatch = {
  status: 'success' | 'partial' | 'failed'
  invoices_pulled?: number
  invoices_created?: number
  payments_upserted?: number
  contacts_linked?: number
  pushed?: number
  warnings?: number
  errors?: number
  error?: string | null
}

/**
 * The sync register (xero_sync_runs / xero_sync_events). Service-role writes
 * only — no client role has an INSERT policy. Never pruned: it is the audit
 * trail Xero's security standard asks for. Event writes never throw (a
 * logging failure must not break a push).
 */
export async function startRun(
  admin: Admin,
  trigger: 'cron' | 'manual' | 'push',
  createdBy: string | null = null
): Promise<string> {
  const { data, error } = await admin
    .from('xero_sync_runs')
    .insert({ trigger, created_by: createdBy, status: 'running' })
    .select('id')
    .single()
  if (error || !data) throw new Error(`Could not open a Xero sync run: ${error?.message}`)
  return data.id as string
}

export async function logEvent(admin: Admin, runId: string, ev: XeroEvent): Promise<void> {
  try {
    await admin.from('xero_sync_events').insert({
      run_id: runId,
      direction: ev.direction,
      entity: ev.entity,
      entity_id: ev.entityId ?? null,
      xero_id: ev.xeroId ?? null,
      action: ev.action,
      detail: ev.detail ? ev.detail.slice(0, 1000) : null,
    })
  } catch (err) {
    console.error('[xero] failed to write sync event:', err)
  }
}

export async function finishRun(admin: Admin, runId: string, patch: RunPatch): Promise<void> {
  const { error } = await admin
    .from('xero_sync_runs')
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq('id', runId)
  if (error) console.error('[xero] failed to close sync run:', error.message)
}

/** True while another run is still marked running and younger than 10 minutes. */
export async function runInProgress(admin: Admin): Promise<boolean> {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { count } = await admin
    .from('xero_sync_runs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'running')
    .gte('started_at', since)
  return (count ?? 0) > 0
}
