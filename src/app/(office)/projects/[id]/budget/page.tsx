import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { round2, lineTotal } from '@/lib/money'
import { BudgetTable, type BudgetLineRow, type CostCodeOption } from './budget-table'

export default async function ProjectBudgetPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('admin', 'office')

  const { id } = await params
  const supabase = await createClient()

  const [
    { data: project },
    { data: budgetLines },
    { data: costs },
    { data: poLines },
    { data: commitments },
    { data: costCodes },
  ] = await Promise.all([
    supabase.from('projects').select('id').eq('id', id).single(),
    supabase
      .from('budget_lines')
      .select('id, description, budget_amount, position, cost_code_id')
      .eq('project_id', id)
      .order('position'),
    supabase
      .from('costs')
      .select('amount, cost_code_id')
      .eq('parent_type', 'project')
      .eq('parent_id', id),
    supabase
      .from('po_lines')
      .select('qty, unit_cost, cost_code_id, purchase_orders!inner(project_id, status)')
      .eq('purchase_orders.project_id', id)
      .in('purchase_orders.status', ['issued', 'closed']),
    supabase
      .from('commitments')
      .select('amount, cost_code_id')
      .eq('project_id', id)
      .eq('status', 'active'),
    supabase.from('cost_codes').select('id, code, name, active').order('code'),
  ])

  if (!project) notFound()

  // Committed = Σ issued/closed po_lines + Σ active commitments, PER COST CODE.
  const committedByCode: Record<string, number> = {}
  for (const l of poLines ?? []) {
    const key = l.cost_code_id ?? 'uncoded'
    committedByCode[key] = round2(
      (committedByCode[key] ?? 0) + lineTotal(Number(l.qty), Number(l.unit_cost))
    )
  }
  for (const c of commitments ?? []) {
    const key = c.cost_code_id ?? 'uncoded'
    committedByCode[key] = round2((committedByCode[key] ?? 0) + Number(c.amount))
  }

  // Actual = Σ costs, PER COST CODE.
  const actualByCode: Record<string, number> = {}
  for (const c of costs ?? []) {
    const key = c.cost_code_id ?? 'uncoded'
    actualByCode[key] = round2((actualByCode[key] ?? 0) + Number(c.amount))
  }

  const lines: BudgetLineRow[] = (budgetLines ?? []).map((l) => ({
    id: l.id,
    description: l.description,
    budget_amount: Number(l.budget_amount),
    cost_code_id: l.cost_code_id,
  }))

  const codes: CostCodeOption[] = (costCodes ?? []).map((cc) => ({
    id: cc.id,
    code: cc.code,
    name: cc.name,
    active: cc.active,
  }))

  return (
    <BudgetTable
      projectId={id}
      lines={lines}
      committedByCode={committedByCode}
      actualByCode={actualByCode}
      costCodes={codes}
    />
  )
}
