import { requireRole, getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { VendorsTable } from './vendors-table'
import { NewVendorDialog } from './vendor-dialogs'

export default async function VendorsPage() {
  await requireRole('admin', 'office')
  const profile = await getProfile()

  const supabase = await createClient()

  const { data: vendors } = await supabase
    .from('vendors')
    .select('id, name, trades, contact_name, phone, payment_terms_days')
    .eq('archived', false)
    .order('name')

  // Fetch compliance docs for all visible vendors
  const vendorIds = (vendors ?? []).map((v) => v.id)

  const { data: complianceDocs } =
    vendorIds.length > 0
      ? await supabase
          .from('vendor_compliance_docs')
          .select('vendor_id, expiry_date')
          .in('vendor_id', vendorIds)
      : { data: [] }

  // Build map: vendor_id → doc summaries
  const docsMap = new Map<string, { expiry_date: string }[]>()
  for (const doc of complianceDocs ?? []) {
    const existing = docsMap.get(doc.vendor_id) ?? []
    existing.push({ expiry_date: doc.expiry_date })
    docsMap.set(doc.vendor_id, existing)
  }

  const rows = (vendors ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    trades: v.trades ?? [],
    contact_name: v.contact_name ?? null,
    phone: v.phone ?? null,
    payment_terms_days: v.payment_terms_days ?? 30,
    compliance_docs: docsMap.get(v.id) ?? [],
  }))

  const canCreate =
    profile?.role === 'admin' || profile?.role === 'office'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Suppliers"
        description="Manage subcontractors and suppliers."
        actions={canCreate ? <NewVendorDialog /> : undefined}
      />
      <VendorsTable rows={rows} />
    </div>
  )
}
