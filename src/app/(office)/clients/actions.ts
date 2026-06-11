'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import { clientSchema, contactSchema, siteSchema } from '@/lib/zod'

// ─── Clients ────────────────────────────────────────────────────────────────

export async function createClient(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  await requireRole('admin', 'office')

  const parsed = clientSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()
  const { data: row, error } = await supabase
    .from('clients')
    .insert(parsed.data)
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidatePath('/clients')
  return { id: row.id }
}

export async function updateClient(
  id: string,
  data: unknown
): Promise<{ error?: string }> {
  await requireRole('admin', 'office')

  const parsed = clientSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from('clients')
    .update(parsed.data)
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/clients')
  revalidatePath(`/clients/${id}`)
  return {}
}

export async function archiveClient(
  id: string,
  archived: boolean = true
): Promise<{ error?: string }> {
  await requireRole('admin', 'office')

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from('clients')
    .update({ archived })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/clients')
  revalidatePath(`/clients/${id}`)
  return {}
}

// ─── Contacts ───────────────────────────────────────────────────────────────

export async function upsertContact(
  data: unknown
): Promise<{ error?: string }> {
  await requireRole('admin', 'office')

  const parsed = contactSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()
  const { id, ...rest } = parsed.data

  if (id) {
    const { error } = await supabase
      .from('contacts')
      .update(rest)
      .eq('id', id)
      .eq('client_id', rest.client_id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('contacts').insert(rest)
    if (error) return { error: error.message }
  }

  revalidatePath(`/clients/${rest.client_id}`)
  return {}
}

export async function deleteContact(
  id: string,
  clientId: string
): Promise<{ error?: string }> {
  await requireRole('admin', 'office')

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from('contacts')
    .delete()
    .eq('id', id)
    .eq('client_id', clientId)

  if (error) return { error: error.message }

  revalidatePath(`/clients/${clientId}`)
  return {}
}

// ─── Sites ───────────────────────────────────────────────────────────────────

export async function upsertSite(
  data: unknown
): Promise<{ error?: string }> {
  await requireRole('admin', 'office')

  const parsed = siteSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()
  const { id, ...rest } = parsed.data

  if (id) {
    const { error } = await supabase
      .from('sites')
      .update(rest)
      .eq('id', id)
      .eq('client_id', rest.client_id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('sites').insert(rest)
    if (error) return { error: error.message }
  }

  revalidatePath(`/clients/${rest.client_id}`)
  return {}
}

export async function deleteSite(
  id: string,
  clientId: string
): Promise<{ error?: string }> {
  await requireRole('admin', 'office')

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from('sites')
    .delete()
    .eq('id', id)
    .eq('client_id', clientId)

  if (error) return { error: error.message }

  revalidatePath(`/clients/${clientId}`)
  return {}
}
