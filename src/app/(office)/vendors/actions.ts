'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  vendorSchema,
  complianceDocSchema,
} from '@/lib/zod'

type Result = { error?: string }

function revalidateVendor(id?: string) {
  revalidatePath('/vendors')
  if (id) revalidatePath(`/vendors/${id}`)
}

// ─── Vendor CRUD ─────────────────────────────────────────────────────────────

export async function createVendor(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  await requireRole('admin', 'office')

  const parsed = vendorSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { data: row, error } = await supabase
    .from('vendors')
    .insert({
      name: parsed.data.name,
      abn: parsed.data.abn ?? null,
      trades: parsed.data.trades,
      contact_name: parsed.data.contact_name ?? null,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      payment_terms_days: parsed.data.payment_terms_days,
      notes: parsed.data.notes ?? null,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidateVendor(row.id)
  return { id: row.id }
}

export async function updateVendor(
  id: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = vendorSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('vendors')
    .update({
      name: parsed.data.name,
      abn: parsed.data.abn ?? null,
      trades: parsed.data.trades,
      contact_name: parsed.data.contact_name ?? null,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      payment_terms_days: parsed.data.payment_terms_days,
      notes: parsed.data.notes ?? null,
    })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidateVendor(id)
  return {}
}

export async function setVendorArchived(
  id: string,
  archived: boolean
): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const { error } = await supabase
    .from('vendors')
    .update({ archived })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidateVendor(id)
  return {}
}

// ─── Compliance docs ──────────────────────────────────────────────────────────

export async function upsertComplianceDoc(
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = complianceDocSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { id, vendor_id, ...rest } = parsed.data

  if (id) {
    const { error } = await supabase
      .from('vendor_compliance_docs')
      .update(rest)
      .eq('id', id)
      .eq('vendor_id', vendor_id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('vendor_compliance_docs')
      .insert({ vendor_id, ...rest })
    if (error) return { error: error.message }
  }

  revalidateVendor(vendor_id)
  return {}
}

export async function deleteComplianceDoc(
  id: string,
  vendorId: string
): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const { error } = await supabase
    .from('vendor_compliance_docs')
    .delete()
    .eq('id', id)
    .eq('vendor_id', vendorId)

  if (error) return { error: error.message }

  revalidateVendor(vendorId)
  return {}
}
