// src/lib/xero/mapping.ts
import type { Admin } from './register'
import type { XeroMapping } from './types'

/** settings.xero_* → XeroMapping (single source of truth for push/pull). */
export async function loadMapping(admin: Admin): Promise<XeroMapping> {
  const { data, error } = await admin
    .from('settings')
    .select(
      'xero_email_mode, xero_default_account, xero_account_by_kind, xero_claims_account, xero_gst_tax_type, xero_no_gst_tax_type, xero_tracking_category_id'
    )
    .eq('id', 1)
    .single()
  if (error || !data) throw new Error(`Could not read Xero settings: ${error?.message}`)
  return {
    emailMode: (data.xero_email_mode as 'xero' | 'ecr') ?? 'xero',
    defaultAccount: (data.xero_default_account as string | null) ?? null,
    accountByKind: ((data.xero_account_by_kind as Record<string, string> | null) ?? {}),
    claimsAccount: (data.xero_claims_account as string | null) ?? null,
    gstTaxType: (data.xero_gst_tax_type as string) ?? 'OUTPUT',
    noGstTaxType: (data.xero_no_gst_tax_type as string) ?? 'EXEMPTOUTPUT',
    trackingCategoryId: (data.xero_tracking_category_id as string | null) ?? null,
  }
}
