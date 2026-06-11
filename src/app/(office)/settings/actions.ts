'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import {
  settingsSchema,
  userCreateSchema,
  profileUpdateSchema,
  rateItemSchema,
  costCodeSchema,
  plantSchema,
  checklistTemplateSchema,
  swmsTemplateSchema,
} from '@/lib/zod'

// ─── Company settings ────────────────────────────────────────────────────────

export async function updateSettings(data: unknown): Promise<{ error?: string }> {
  await requireRole('admin')

  const parsed = settingsSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from('settings')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', 1)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return {}
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function createUser(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  await requireRole('admin')

  const parsed = userCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()
  const { data: id, error } = await supabase.rpc('admin_create_user', {
    p_email: parsed.data.email,
    p_password: parsed.data.password,
    p_full_name: parsed.data.full_name,
    p_role: parsed.data.role,
  })

  if (error) {
    if (/duplicate|already exists|unique/i.test(error.message)) {
      return { error: 'A user with that email already exists' }
    }
    return { error: error.message }
  }

  revalidatePath('/settings')
  return { id: id as string }
}

export async function updateProfile(
  id: string,
  data: unknown
): Promise<{ error?: string }> {
  const caller = await requireRole('admin')

  const parsed = profileUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  // Prevent an admin from demoting or deactivating their own account.
  if (id === caller.id) {
    if (parsed.data.role !== undefined && parsed.data.role !== 'admin') {
      return { error: "You can't demote or deactivate your own admin account" }
    }
    if (parsed.data.active !== undefined && parsed.data.active === false) {
      return { error: "You can't demote or deactivate your own admin account" }
    }
  }

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from('profiles')
    .update(parsed.data)
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return {}
}

// ─── Rate items ──────────────────────────────────────────────────────────────

export async function upsertRateItem(data: unknown): Promise<{ error?: string }> {
  await requireRole('admin')

  const parsed = rateItemSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()
  const { id, ...rest } = parsed.data

  if (id) {
    const { error } = await supabase.from('rate_items').update(rest).eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('rate_items').insert(rest)
    if (error) return { error: error.message }
  }

  revalidatePath('/settings')
  return {}
}

export async function setRateItemActive(
  id: string,
  active: boolean
): Promise<{ error?: string }> {
  await requireRole('admin')

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from('rate_items')
    .update({ active })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return {}
}

// ─── Cost codes ──────────────────────────────────────────────────────────────

export async function upsertCostCode(data: unknown): Promise<{ error?: string }> {
  await requireRole('admin')

  const parsed = costCodeSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()
  const { id, ...rest } = parsed.data

  if (id) {
    const { error } = await supabase.from('cost_codes').update(rest).eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('cost_codes').insert(rest)
    if (error) return { error: error.message }
  }

  revalidatePath('/settings')
  return {}
}

export async function setCostCodeActive(
  id: string,
  active: boolean
): Promise<{ error?: string }> {
  await requireRole('admin')

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from('cost_codes')
    .update({ active })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return {}
}

// ─── Plant ───────────────────────────────────────────────────────────────────

export async function upsertPlant(data: unknown): Promise<{ error?: string }> {
  await requireRole('admin')

  const parsed = plantSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()
  const { id, ...rest } = parsed.data

  if (id) {
    const { error } = await supabase.from('plant').update(rest).eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('plant').insert(rest)
    if (error) return { error: error.message }
  }

  revalidatePath('/settings')
  return {}
}

export async function setPlantActive(
  id: string,
  active: boolean
): Promise<{ error?: string }> {
  await requireRole('admin')

  const supabase = await createSupabaseClient()
  const { error } = await supabase.from('plant').update({ active }).eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return {}
}

// ─── Checklist templates ─────────────────────────────────────────────────────

export async function upsertChecklistTemplate(
  data: unknown
): Promise<{ error?: string }> {
  await requireRole('admin')

  const parsed = checklistTemplateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()
  const { id, ...rest } = parsed.data

  if (id) {
    const { error } = await supabase
      .from('checklist_templates')
      .update(rest)
      .eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('checklist_templates').insert(rest)
    if (error) return { error: error.message }
  }

  revalidatePath('/settings')
  return {}
}

export async function deleteChecklistTemplate(
  id: string
): Promise<{ error?: string }> {
  await requireRole('admin')

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from('checklist_templates')
    .delete()
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return {}
}

// ─── SWMS templates ──────────────────────────────────────────────────────────

export async function upsertSwmsTemplate(
  data: unknown
): Promise<{ error?: string }> {
  await requireRole('admin')

  const parsed = swmsTemplateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()
  const { id, ...rest } = parsed.data

  if (id) {
    const { data: current } = await supabase
      .from('swms_templates')
      .select('title, body, hazards, version')
      .eq('id', id)
      .single()
    if (!current) return { error: 'SWMS template not found' }

    // Bump the version only when the content actually changed.
    const changed =
      current.title !== rest.title ||
      (current.body ?? null) !== rest.body ||
      JSON.stringify(current.hazards) !== JSON.stringify(rest.hazards)

    const { error } = await supabase
      .from('swms_templates')
      .update({
        ...rest,
        version: changed ? Number(current.version) + 1 : Number(current.version),
      })
      .eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('swms_templates').insert(rest)
    if (error) return { error: error.message }
  }

  revalidatePath('/settings')
  return {}
}

export async function setSwmsTemplateActive(
  id: string,
  active: boolean
): Promise<{ error?: string }> {
  await requireRole('admin')

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from('swms_templates')
    .update({ active })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return {}
}
