// src/lib/xero/reference.ts
import type { XeroApi } from './client'
import { logEvent, type Admin } from './register'
import type { XeroAccount, XeroTaxRate, XeroTrackingCategory } from './types'

const INCOME_TYPES = ['REVENUE', 'SALES', 'OTHERINCOME']

/**
 * Cache the reference data the Settings pickers need (spec §3 "Reference
 * data"): income accounts, tax rates, tracking categories + options. Upserts
 * by natural key; rows Xero no longer returns are marked ARCHIVED, never deleted.
 */
export async function syncReferenceData(
  admin: Admin,
  api: XeroApi,
  runId: string
): Promise<{ accounts: number; taxRates: number; trackingCategories: number }> {
  const now = new Date().toISOString()

  const where = encodeURIComponent(INCOME_TYPES.map((t) => `Type=="${t}"`).join('||'))
  const { Accounts = [] } = await api.get<{ Accounts?: XeroAccount[] }>(`/Accounts?where=${where}`)
  const accountRows = Accounts.filter((a) => a.Code).map((a) => ({
    code: a.Code!,
    name: a.Name,
    type: a.Type,
    tax_type: a.TaxType ?? null,
    status: a.Status ?? 'ACTIVE',
    synced_at: now,
  }))
  if (accountRows.length > 0) {
    const { error } = await admin.from('xero_accounts').upsert(accountRows, { onConflict: 'code' })
    if (error) throw new Error(`accounts cache: ${error.message}`)
    await admin
      .from('xero_accounts')
      .update({ status: 'ARCHIVED' })
      .lt('synced_at', now)
      .neq('status', 'ARCHIVED')
  }

  const { TaxRates = [] } = await api.get<{ TaxRates?: XeroTaxRate[] }>('/TaxRates')
  const taxRows = TaxRates.filter((t) => t.CanApplyToRevenue !== false).map((t) => ({
    tax_type: t.TaxType,
    name: t.Name,
    effective_rate: t.EffectiveRate ?? null,
    status: t.Status ?? 'ACTIVE',
    synced_at: now,
  }))
  if (taxRows.length > 0) {
    const { error } = await admin.from('xero_tax_rates').upsert(taxRows, { onConflict: 'tax_type' })
    if (error) throw new Error(`tax rates cache: ${error.message}`)
    await admin
      .from('xero_tax_rates')
      .update({ status: 'ARCHIVED' })
      .lt('synced_at', now)
      .neq('status', 'ARCHIVED')
  }

  const { TrackingCategories = [] } = await api.get<{ TrackingCategories?: XeroTrackingCategory[] }>(
    '/TrackingCategories?includeArchived=true'
  )
  for (const cat of TrackingCategories) {
    const { error } = await admin.from('xero_tracking_categories').upsert(
      { id: cat.TrackingCategoryID, name: cat.Name, status: cat.Status ?? 'ACTIVE', synced_at: now },
      { onConflict: 'id' }
    )
    if (error) throw new Error(`tracking cache: ${error.message}`)
    const options = (cat.Options ?? []).map((o) => ({
      id: o.TrackingOptionID,
      category_id: cat.TrackingCategoryID,
      name: o.Name,
      status: o.Status ?? 'ACTIVE',
      synced_at: now,
    }))
    if (options.length > 0) {
      const { error: optErr } = await admin.from('xero_tracking_options').upsert(options, { onConflict: 'id' })
      if (optErr) throw new Error(`tracking options cache: ${optErr.message}`)
    }
  }
  if (TrackingCategories.length > 0) {
    await admin
      .from('xero_tracking_options')
      .update({ status: 'ARCHIVED' })
      .lt('synced_at', now)
      .neq('status', 'ARCHIVED')
    await admin
      .from('xero_tracking_categories')
      .update({ status: 'ARCHIVED' })
      .lt('synced_at', now)
      .neq('status', 'ARCHIVED')
  }

  await logEvent(admin, runId, {
    direction: 'pull',
    entity: 'reference',
    action: 'updated',
    detail: `${accountRows.length} accounts, ${taxRows.length} tax rates, ${TrackingCategories.length} tracking categories`,
  })
  return { accounts: accountRows.length, taxRates: taxRows.length, trackingCategories: TrackingCategories.length }
}
