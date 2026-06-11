import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PosTable, type PoRow } from './pos-table'
import { NewPoDialog, type VendorOption } from './new-po-dialog'

export default async function ProjectPosPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('admin', 'office')

  const { id } = await params
  const supabase = await createClient()

  const [{ data: project }, { data: pos }, { data: vendors }] = await Promise.all([
    supabase.from('projects').select('id').eq('id', id).single(),
    supabase
      .from('purchase_orders')
      .select(
        'id, number, status, issue_date, vendors(name), po_lines(qty, unit_cost)'
      )
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('vendors')
      .select('id, name')
      .eq('archived', false)
      .order('name'),
  ])

  if (!project) notFound()

  const poRows: PoRow[] = (pos ?? []).map((po) => {
    const vendorRel = po.vendors as unknown as { name: string } | null
    const lines = (po.po_lines as unknown as Array<{ qty: number; unit_cost: number }>) ?? []
    return {
      id: po.id,
      number: po.number,
      vendor_name: vendorRel?.name ?? '—',
      status: po.status,
      issue_date: po.issue_date,
      lines,
    }
  })

  const vendorOptions: VendorOption[] = (vendors ?? []).map((v) => ({
    id: v.id,
    name: v.name,
  }))

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Purchase orders</h2>
        <NewPoDialog projectId={id} vendors={vendorOptions} />
      </div>
      <PosTable projectId={id} pos={poRows} />
    </section>
  )
}
