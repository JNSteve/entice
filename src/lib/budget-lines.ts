import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side guard for budget-line attribution writes.
 *
 * A budget_line_id arriving from the client is only a UUID — the FK proves the
 * line exists, not that it belongs to the project being written to. A
 * cross-project id would silently vanish from the budget rollup (attributed
 * to a line the page never renders). This verifies ownership and returns the
 * line's cost code so callers can keep cost_code_id consistent with the link —
 * the budget page attributes strictly by budget_line_id when present, so the
 * server, not the dialog, must own that invariant.
 */
export async function resolveBudgetLine(
  supabase: SupabaseClient,
  budgetLineId: string,
  projectId: string
): Promise<{ error?: string; costCodeId?: string }> {
  const { data: line } = await supabase
    .from('budget_lines')
    .select('id, cost_code_id')
    .eq('id', budgetLineId)
    .eq('project_id', projectId)
    .maybeSingle()

  if (!line) return { error: 'Budget line not found on this project' }
  return { costCodeId: line.cost_code_id }
}
