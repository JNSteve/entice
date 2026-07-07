import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  PoEditor,
  type PoLine,
  type CostCodeOption,
  type VendorOption,
  type BudgetLineOption,
} from './po-editor'

export default async function ProjectPoDetailPage({
  params,
}: {
  params: Promise<{ id: string; poId: string }>
}) {
  await requireRole('admin', 'office')

  const { id: projectId, poId } = await params
  const supabase = await createClient()

  const [
    { data: po },
    { data: poLines },
    { data: costCodes },
    { data: vendors },
    { data: settings },
    { data: budgetLines },
  ] = await Promise.all([
    supabase
      .from('purchase_orders')
      .select('id, number, vendor_id, status, issue_date, notes, vendors(name)')
      .eq('id', poId)
      .eq('project_id', projectId)
      .single(),
    supabase
      .from('po_lines')
      .select('id, position, description, cost_code_id, budget_line_id, qty, unit, unit_cost')
      .eq('po_id', poId)
      .order('position')
      .order('id'),
    supabase.from('cost_codes').select('id, code, name, active').order('code'),
    supabase.from('vendors').select('id, name').eq('archived', false).order('name'),
    supabase.from('settings').select('gst_rate').eq('id', 1).single(),
    supabase
      .from('budget_lines')
      .select('id, description, cost_code_id')
      .eq('project_id', projectId)
      .order('position'),
  ])

  if (!po) notFound()

  const vendorRel = po.vendors as unknown as { name: string } | null

  const lines: PoLine[] = (poLines ?? []).map((l) => ({
    id: l.id,
    position: l.position,
    description: l.description,
    cost_code_id: l.cost_code_id,
    budget_line_id: l.budget_line_id,
    qty: Number(l.qty),
    unit: l.unit,
    unit_cost: Number(l.unit_cost),
  }))

  const codes: CostCodeOption[] = (costCodes ?? []).map((cc) => ({
    id: cc.id,
    code: cc.code,
    name: cc.name,
    active: cc.active,
  }))

  const vendorOptions: VendorOption[] = (vendors ?? []).map((v) => ({
    id: v.id,
    name: v.name,
  }))

  const budgetLineOptions: BudgetLineOption[] = (budgetLines ?? []).map((b) => ({
    id: b.id,
    description: b.description,
    cost_code_id: b.cost_code_id,
  }))

  return (
    <PoEditor
      projectId={projectId}
      po={{
        id: po.id,
        number: po.number,
        vendor_id: po.vendor_id,
        vendor_name: vendorRel?.name ?? '—',
        status: po.status,
        issue_date: po.issue_date,
        notes: po.notes,
      }}
      lines={lines}
      costCodes={codes}
      vendors={vendorOptions}
      budgetLines={budgetLineOptions}
      gstRate={Number(settings?.gst_rate ?? 10)}
    />
  )
}
