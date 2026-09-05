'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { xeroMappingSchema } from '@/lib/zod'
import { runXeroSync } from '@/lib/xero/pull'
import { pushClaimToXero } from '@/lib/xero/push'
import { finishRun, logEvent, startRun } from '@/lib/xero/register'
import {
  clearConnection,
  deleteConnection,
  getValidAccessToken,
  loadConnection,
} from '@/lib/xero/tokens'

type Result = { error?: string; summary?: string }

function revalidateXero() {
  revalidatePath('/settings')
  revalidatePath('/money')
  revalidatePath('/')
}

function admin() {
  try {
    return createAdminClient()
  } catch {
    return null
  }
}

export async function saveXeroMapping(data: unknown): Promise<Result> {
  await requireRole('admin')
  const parsed = xeroMappingSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid mapping' }
  const supabase = await createClient()
  const { error } = await supabase.from('settings').update(parsed.data).eq('id', 1)
  if (error) return { error: error.message }
  revalidateXero()
  return {}
}

export async function linkClientToXeroContact(clientId: string, contactId: string | null): Promise<Result> {
  const profile = await requireRole('admin', 'office')
  const supabase = await createClient()
  const { error } = await supabase.from('clients').update({ xero_contact_id: contactId }).eq('id', clientId)
  if (error) return { error: error.message.includes('unique') ? 'That Xero contact is already linked to another client' : error.message }
  const a = admin()
  if (a) {
    const runId = await startRun(a, 'manual', profile.id)
    await logEvent(a, runId, { direction: 'pull', entity: 'contact', entityId: clientId, xeroId: contactId, action: contactId ? 'matched' : 'unmatched', detail: `Linked by ${profile.full_name}` })
    await finishRun(a, runId, { status: 'success' })
  }
  revalidateXero()
  return {}
}

export async function syncXeroNow(): Promise<Result> {
  const profile = await requireRole('admin', 'office')
  const a = admin()
  if (!a) return { error: 'SUPABASE_SERVICE_ROLE_KEY is not configured on this deployment' }
  const s = await runXeroSync(a, { trigger: 'manual', createdBy: profile.id })
  revalidateXero()
  if (s.skipped) return { error: s.skipped }
  return {
    summary: `${s.status}: ${s.invoices_pulled} invoices checked, ${s.invoices_created} new from Xero, ${s.payments_upserted} payments, ${s.contacts_linked} contacts linked${s.errors ? `, ${s.errors} errors` : ''}`,
  }
}

export async function disconnectXero(): Promise<Result> {
  const profile = await requireRole('admin')
  const a = admin()
  if (!a) return { error: 'SUPABASE_SERVICE_ROLE_KEY is not configured on this deployment' }
  const conn = await loadConnection(a)
  try {
    if (conn?.connection_id && conn.refresh_token_enc) {
      const { accessToken } = await getValidAccessToken(a).catch(() => ({ accessToken: null }))
      if (accessToken) await deleteConnection(accessToken, conn.connection_id)
    }
  } catch (err) {
    console.error('[xero] remote disconnect failed:', err)
  }
  await clearConnection(a)
  const runId = await startRun(a, 'manual', profile.id)
  await logEvent(a, runId, { direction: 'push', entity: 'connection', action: 'updated', detail: `Disconnected by ${profile.full_name}` })
  await finishRun(a, runId, { status: 'success' })
  revalidateXero()
  return {}
}

/**
 * The callback stored tokens for a DIFFERENT org than before and left status
 * needs_reconnect. Typing the org name confirms: clear every link column that
 * pointed at the old org, empty the caches, then go live (spec §5.1).
 */
export async function confirmXeroOrgSwitch(typedName: string): Promise<Result> {
  const profile = await requireRole('admin')
  const a = admin()
  if (!a) return { error: 'SUPABASE_SERVICE_ROLE_KEY is not configured on this deployment' }
  const conn = await loadConnection(a)
  if (!conn || conn.status !== 'needs_reconnect' || !conn.refresh_token_enc || !conn.tenant_name) {
    return { error: 'No organisation switch is pending' }
  }
  if (typedName.trim().toLowerCase() !== conn.tenant_name.trim().toLowerCase()) {
    return { error: 'Organisation name does not match' }
  }

  const nulls = { xero_invoice_id: null, xero_number: null, xero_status: null, xero_total: null, xero_amount_paid: null, xero_amount_credited: null, xero_amount_due: null, xero_online_url: null, xero_pushed_at: null, xero_emailed_at: null, xero_synced_at: null }
  const steps = [
    a.from('invoices').update(nulls).not('xero_invoice_id', 'is', null),
    a.from('claims').update({ xero_invoice_id: null, xero_status: null, xero_amount_due: null, xero_online_url: null, xero_pushed_at: null, xero_synced_at: null }).not('xero_invoice_id', 'is', null),
    a.from('payments').update({ xero_payment_id: null }).not('xero_payment_id', 'is', null),
    a.from('clients').update({ xero_contact_id: null }).not('xero_contact_id', 'is', null),
    a.from('jobs').update({ xero_tracking_option_id: null }).not('xero_tracking_option_id', 'is', null),
    a.from('projects').update({ xero_tracking_option_id: null }).not('xero_tracking_option_id', 'is', null),
    a.from('xero_tracking_options').delete().neq('id', ''),
    a.from('xero_tracking_categories').delete().neq('id', ''),
    a.from('xero_accounts').delete().neq('code', ''),
    a.from('xero_tax_rates').delete().neq('tax_type', ''),
    a.from('xero_contacts').delete().neq('contact_id', ''),
    a.from('settings').update({ xero_default_account: null, xero_account_by_kind: {}, xero_claims_account: null, xero_tracking_category_id: null }).eq('id', 1),
  ]
  for (const step of steps) {
    const { error } = await step
    if (error) return { error: `Switch aborted: ${error.message}` }
  }
  await a.from('xero_connection').update({ status: 'connected', last_sync_at: null, last_sync_status: null, updated_at: new Date().toISOString() }).eq('id', 1)
  const runId = await startRun(a, 'manual', profile.id)
  await logEvent(a, runId, { direction: 'push', entity: 'connection', action: 'updated', detail: `Switched to organisation "${conn.tenant_name}" — all Xero links cleared by ${profile.full_name}` })
  await finishRun(a, runId, { status: 'success' })
  revalidateXero()
  return {}
}

export async function retryClaimPush(claimId: string): Promise<Result> {
  const profile = await requireRole('admin', 'office')
  const a = admin()
  if (!a) return { error: 'SUPABASE_SERVICE_ROLE_KEY is not configured on this deployment' }
  const r = await pushClaimToXero(a, claimId, profile.id)
  revalidateXero()
  return r.ok ? { summary: r.warnings.join(' ') || 'Claim is now in Xero' } : { error: r.error }
}
