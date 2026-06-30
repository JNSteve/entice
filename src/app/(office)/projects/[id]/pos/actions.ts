'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { nextNumber } from '@/lib/numbering'
import { todayAU } from '@/lib/tz'
import {
  poCreateSchema,
  poHeaderSchema,
  poLineCreateSchema,
  poLineUpdateSchema,
  poStatusSchema,
  vendorQuickSchema,
} from '@/lib/zod'

type Result = { error?: string }

function revalidatePo(projectId: string, poId?: string) {
  revalidatePath(`/projects/${projectId}/pos`)
  revalidatePath(`/projects/${projectId}/budget`)
  revalidatePath(`/projects/${projectId}`)
  if (poId) revalidatePath(`/projects/${projectId}/pos/${poId}`)
}

// ─── Create PO ────────────────────────────────────────────────────────────────

export async function createPo(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  await requireRole('admin', 'office')

  const parsed = poCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  // Verify vendor exists and is not archived.
  const { data: vendor } = await supabase
    .from('vendors')
    .select('id')
    .eq('id', parsed.data.vendor_id)
    .eq('archived', false)
    .single()
  if (!vendor) return { error: 'Vendor not found or archived' }

  let number: string
  try {
    number = await nextNumber(supabase, 'po')
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : 'Failed to allocate PO number',
    }
  }

  const { data: row, error } = await supabase
    .from('purchase_orders')
    .insert({
      number,
      project_id: parsed.data.project_id,
      vendor_id: parsed.data.vendor_id,
      notes: parsed.data.notes ?? null,
      status: 'draft',
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidatePo(parsed.data.project_id, row.id)
  return { id: row.id }
}

// ─── Update PO header (draft only) ────────────────────────────────────────────

export async function updatePoHeader(
  poId: string,
  projectId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = poHeaderSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  // Confirm PO is draft and belongs to project.
  const { data: po } = await supabase
    .from('purchase_orders')
    .select('id, status')
    .eq('id', poId)
    .eq('project_id', projectId)
    .single()
  if (!po) return { error: 'PO not found' }
  if (po.status !== 'draft') return { error: 'PO is not in draft status' }

  const { error } = await supabase
    .from('purchase_orders')
    .update(parsed.data)
    .eq('id', poId)

  if (error) return { error: error.message }

  revalidatePo(projectId, poId)
  return {}
}

// ─── PO Lines (draft only) ────────────────────────────────────────────────────

export async function addPoLine(data: unknown): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = poLineCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  // Confirm PO is draft.
  const { data: po } = await supabase
    .from('purchase_orders')
    .select('id, status, project_id')
    .eq('id', parsed.data.po_id)
    .single()
  if (!po) return { error: 'PO not found' }
  if (po.status !== 'draft') return { error: 'PO is not in draft status' }

  // Get next position.
  const { data: last } = await supabase
    .from('po_lines')
    .select('position')
    .eq('po_id', parsed.data.po_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await supabase.from('po_lines').insert({
    po_id: parsed.data.po_id,
    description: parsed.data.description,
    cost_code_id: parsed.data.cost_code_id,
    qty: parsed.data.qty,
    unit: parsed.data.unit,
    unit_cost: parsed.data.unit_cost,
    position: (last?.position ?? -1) + 1,
  })
  if (error) return { error: error.message }

  revalidatePo(po.project_id, po.id)
  return {}
}

export async function updatePoLine(
  lineId: string,
  poId: string,
  projectId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = poLineUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  // Confirm PO is draft.
  const { data: po } = await supabase
    .from('purchase_orders')
    .select('id, status')
    .eq('id', poId)
    .eq('project_id', projectId)
    .single()
  if (!po) return { error: 'PO not found' }
  if (po.status !== 'draft') return { error: 'PO is not in draft status' }

  const { error } = await supabase
    .from('po_lines')
    .update(parsed.data)
    .eq('id', lineId)
    .eq('po_id', poId)

  if (error) return { error: error.message }

  revalidatePo(projectId, poId)
  return {}
}

export async function deletePoLine(
  lineId: string,
  poId: string,
  projectId: string
): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()

  // Confirm PO is draft.
  const { data: po } = await supabase
    .from('purchase_orders')
    .select('id, status')
    .eq('id', poId)
    .eq('project_id', projectId)
    .single()
  if (!po) return { error: 'PO not found' }
  if (po.status !== 'draft') return { error: 'PO is not in draft status' }

  const { error } = await supabase
    .from('po_lines')
    .delete()
    .eq('id', lineId)
    .eq('po_id', poId)

  if (error) return { error: error.message }

  revalidatePo(projectId, poId)
  return {}
}

// ─── Status transitions ───────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['issued', 'cancelled'],
  issued: ['closed', 'cancelled'],
}

export async function setPoStatus(
  poId: string,
  projectId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = poStatusSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: po } = await supabase
    .from('purchase_orders')
    .select('id, status')
    .eq('id', poId)
    .eq('project_id', projectId)
    .single()
  if (!po) return { error: 'PO not found' }

  const allowed = VALID_TRANSITIONS[po.status] ?? []
  if (!allowed.includes(parsed.data.status)) {
    return {
      error: `Cannot move a ${po.status} PO to ${parsed.data.status}`,
    }
  }

  const update: Record<string, unknown> = { status: parsed.data.status }
  if (parsed.data.status === 'issued') {
    update.issue_date = todayAU()
  }

  const { error } = await supabase
    .from('purchase_orders')
    .update(update)
    .eq('id', poId)

  if (error) return { error: error.message }

  revalidatePo(projectId, poId)
  return {}
}

// ─── Quick-add vendor ─────────────────────────────────────────────────────────

export async function createVendorQuick(
  data: unknown
): Promise<{ error?: string; id?: string; name?: string }> {
  await requireRole('admin', 'office')

  const parsed = vendorQuickSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: row, error } = await supabase
    .from('vendors')
    .insert({
      name: parsed.data.name,
      email: parsed.data.email ?? null,
      trades: parsed.data.trade ? [parsed.data.trade] : [],
    })
    .select('id, name')
    .single()

  if (error) return { error: error.message }

  return { id: row.id, name: row.name }
}
