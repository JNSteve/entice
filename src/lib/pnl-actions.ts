'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { costLineSchema, jobBasePriceSchema, priceAdjustmentSchema, type CostLineInput } from '@/lib/zod'
import { labourAmount } from '@/lib/pnl'
import { round2 } from '@/lib/money'

type Result = { error?: string }
type Supabase = Awaited<ReturnType<typeof createClient>>

function revalidateParent(parentType: string, parentId: string) {
  if (parentType === 'job') {
    revalidatePath(`/jobs/${parentId}`)
  } else {
    revalidatePath(`/projects/${parentId}`)
    revalidatePath(`/projects/${parentId}/budget`)
    revalidatePath(`/projects/${parentId}/pnl`)
  }
}

/** Builds the costs-row fields for a validated line (shared by add + update). */
async function costFields(supabase: Supabase, d: CostLineInput) {
  if (d.kind === 'other') {
    return {
      date: d.date,
      description: d.description,
      amount: round2(d.amount!),
      cost_code_id: d.cost_code_id,
      source: 'manual' as const,
      hours: null,
      rate: null,
      worker_id: null,
      worker_name: null,
    }
  }
  // A staff worker is stored by id only; a typed name covers labour hire.
  let label = d.worker_name
  if (d.worker_id) {
    const { data: p } = await supabase.from('profiles').select('full_name').eq('id', d.worker_id).single()
    if (!p) return { error: 'Worker not found' }
    label = p.full_name
  }
  // Round to the stored precision first so hours × rate = amount on the row.
  const hours = round2(d.hours!)
  const rate = round2(d.rate!)
  if (hours <= 0) return { error: 'Hours must be positive' }
  return {
    date: d.date,
    description: d.description || `Labour — ${label}`,
    amount: labourAmount(hours, rate),
    cost_code_id: d.cost_code_id,
    source: 'labour' as const,
    hours,
    rate,
    worker_id: d.worker_id,
    worker_name: d.worker_id ? null : d.worker_name,
  }
}

export async function addCostLine(data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office')
  const parsed = costLineSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }

  const supabase = await createClient()
  const fields = await costFields(supabase, parsed.data)
  if ('error' in fields) return { error: fields.error }

  const { error } = await supabase.from('costs').insert({
    ...fields,
    parent_type: parsed.data.parent_type,
    parent_id: parsed.data.parent_id,
    created_by: profile.id,
  })
  if (error) return { error: error.message }
  revalidateParent(parsed.data.parent_type, parsed.data.parent_id)
  return {}
}

/** Loads a cost row and refuses docket rows / parent mismatches. */
async function editableCost(supabase: Supabase, id: string) {
  const { data: row } = await supabase
    .from('costs')
    .select('id, parent_type, parent_id, source')
    .eq('id', id)
    .single()
  if (!row) return { error: 'Cost not found' } as const
  if (row.source === 'docket') return { error: 'Docket costs are managed from the docket' } as const
  return { row } as const
}

export async function updateCostLine(id: string, data: unknown): Promise<Result> {
  await requireRole('admin', 'office')
  const parsed = costLineSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }

  const supabase = await createClient()
  const found = await editableCost(supabase, id)
  if ('error' in found) return { error: found.error }
  if (found.row.parent_type !== parsed.data.parent_type || found.row.parent_id !== parsed.data.parent_id) {
    return { error: 'Cost does not belong to this record' }
  }

  const fields = await costFields(supabase, parsed.data)
  if ('error' in fields) return { error: fields.error }

  const { error } = await supabase.from('costs').update(fields).eq('id', id)
  if (error) return { error: error.message }
  revalidateParent(found.row.parent_type, found.row.parent_id)
  return {}
}

export async function deleteCostLine(id: string): Promise<Result> {
  await requireRole('admin', 'office')
  const supabase = await createClient()
  const found = await editableCost(supabase, id)
  if ('error' in found) return { error: found.error }

  const { error } = await supabase.from('costs').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidateParent(found.row.parent_type, found.row.parent_id)
  return {}
}

export async function addPriceAdjustment(data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office')
  const parsed = priceAdjustmentSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }

  const supabase = await createClient()
  const { error } = await supabase.from('job_price_adjustments').insert({
    ...parsed.data,
    amount: round2(parsed.data.amount),
    created_by: profile.id,
  })
  if (error) return { error: error.message }
  revalidateParent('job', parsed.data.job_id)
  return {}
}

export async function deletePriceAdjustment(id: string): Promise<Result> {
  await requireRole('admin', 'office')
  const supabase = await createClient()
  const { data: row, error } = await supabase
    .from('job_price_adjustments')
    .delete()
    .eq('id', id)
    .select('job_id')
    .single()
  if (error || !row) return { error: error?.message ?? 'Adjustment not found' }
  revalidateParent('job', row.job_id)
  return {}
}

/** Hand-set base price — only for jobs without a quote-derived price. */
export async function setJobBasePrice(data: unknown): Promise<Result> {
  await requireRole('admin', 'office')
  const parsed = jobBasePriceSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }

  const supabase = await createClient()
  const { data: job } = await supabase
    .from('jobs')
    .select('id, quote_id, contract_price')
    .eq('id', parsed.data.job_id)
    .single()
  if (!job) return { error: 'Job not found' }
  if (job.quote_id && job.contract_price != null) {
    return { error: 'This price came from the accepted quote — use an adjustment instead' }
  }

  const { error } = await supabase
    .from('jobs')
    .update({ contract_price: round2(parsed.data.price) })
    .eq('id', job.id)
  if (error) return { error: error.message }
  revalidateParent('job', job.id)
  return {}
}
