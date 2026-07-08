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
      .select('amount, cost_code_id, budget_line_id')
      .eq('parent_type', 'project')
      .eq('parent_id', id),
    supabase
      .from('po_lines')
      .select('qty, unit_cost, cost_code_id, budget_line_id, purchase_orders!inner(project_id, status)')
      .eq('purchase_orders.project_id', id)
      .in('purchase_orders.status', ['issued', 'closed']),
    supabase
      .from('commitments')
      .select('amount, cost_code_id, budget_line_id')
      .eq('project_id', id)
      .eq('status', 'active'),
    supabase.from('cost_codes').select('id, code, name, active').order('code'),
  ])

  if (!project) notFound()

  // If a source row is linked to a budget line, attribute it to that line;
  // otherwise fall back to cost-code grouping (existing behaviour). Each row
  // lands in EXACTLY ONE bucket (line XOR code) — the group header relies on
  // that mutual exclusion to avoid double-counting.
  function bucket(
    byLine: Record<string, number>,
    byCode: Record<string, number>,
    budgetLineId: string | null,
    costCodeId: string | null,
    amt: number
  ) {
    if (budgetLineId) {
      byLine[budgetLineId] = round2((byLine[budgetLineId] ?? 0) + amt)
    } else {
      const key = costCodeId ?? 'uncoded'
      byCode[key] = round2((byCode[key] ?? 0) + amt)
    }
  }

  // Committed = Σ issued/closed po_lines + Σ active commitments.
  const committedByLine: Record<string, number> = {}
  const committedByCode: Record<string, number> = {}
  for (const l of poLines ?? []) {
    bucket(committedByLine, committedByCode, l.budget_line_id, l.cost_code_id, lineTotal(Number(l.qty), Number(l.unit_cost)))
  }
  for (const c of commitments ?? []) {
    bucket(committedByLine, committedByCode, c.budget_line_id, c.cost_code_id, Number(c.amount))
  }

  // Actual = Σ costs, same line-vs-code precedence.
  const actualByLine: Record<string, number> = {}
  const actualByCode: Record<string, number> = {}
  for (const c of costs ?? []) {
    bucket(actualByLine, actualByCode, c.budget_line_id, c.cost_code_id, Number(c.amount))
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
      committedByLine={committedByLine}
      committedByCode={committedByCode}
      actualByLine={actualByLine}
      actualByCode={actualByCode}
      costCodes={codes}
    />
  )
}
