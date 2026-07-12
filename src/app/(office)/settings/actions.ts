'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import { nextNumber } from '@/lib/numbering'
import {
  accessReviewSchema,
  settingsSchema,
  userCreateSchema,
  profileUpdateSchema,
  rateItemSchema,
  rateImportSchema,
  costCodeSchema,
  plantSchema,
  checklistTemplateSchema,
  formTemplateSchema,
  competencyTypeSchema,
  roleRequirementSchema,
  takeoffAssemblySchema,
  takeoffAssemblyComponentSchema,
} from '@/lib/zod'
import { swmsTemplateV2Schema } from '@/lib/swms'

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

export async function importRateItems(
  data: unknown
): Promise<{ error?: string; added?: number; updated?: number }> {
  await requireRole('admin', 'office')

  const parsed = rateImportSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()

  // Fetch all active rows once and match in JS (case-insensitive name).
  const { data: existing, error: fetchError } = await supabase
    .from('rate_items')
    .select('id, kind, name')
    .eq('active', true)

  if (fetchError) return { error: fetchError.message }

  const key = (kind: string, name: string) =>
    `${kind}|${name.trim().toLowerCase()}`
  const byKey = new Map<string, string>()
  for (const row of existing ?? []) {
    byKey.set(key(row.kind, row.name), row.id as string)
  }

  let added = 0
  let updated = 0

  for (const row of parsed.data) {
    const id = byKey.get(key(row.kind, row.name))
    if (id) {
      const { error } = await supabase
        .from('rate_items')
        .update({
          cost: row.cost,
          default_markup_pct: row.default_markup_pct,
          unit: row.unit,
        })
        .eq('id', id)
      if (error) return { error: error.message }
      updated++
    } else {
      const { error } = await supabase.from('rate_items').insert({
        kind: row.kind,
        name: row.name,
        unit: row.unit,
        cost: row.cost,
        default_markup_pct: row.default_markup_pct,
        active: true,
      })
      if (error) return { error: error.message }
      added++
    }
  }

  revalidatePath('/settings')
  return { added, updated }
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

/** Columns compared for the content-change version bump. */
const SWMS_CONTENT_KEYS = [
  'title',
  'doc_control',
  'hrcw_items',
  'requirements',
  'steps',
  'stop_work_triggers',
  'emergency_scenarios',
  'references_list',
] as const

/** JSON.stringify with sorted object keys — Postgres jsonb reorders keys, so a
 * naive stringify comparison would flag every save as a content change. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export async function upsertSwmsTemplate(
  data: unknown
): Promise<{ error?: string }> {
  await requireRole('admin')

  const parsed = swmsTemplateV2Schema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()
  const { id, ...rest } = parsed.data

  if (id) {
    const { data: current } = await supabase
      .from('swms_templates')
      .select(
        'title, doc_control, hrcw_items, requirements, steps, stop_work_triggers, emergency_scenarios, references_list, version'
      )
      .eq('id', id)
      .single()
    if (!current) return { error: 'SWMS template not found' }

    // Bump the version only when the content actually changed.
    const changed = SWMS_CONTENT_KEYS.some(
      (key) => stableJson(current[key]) !== stableJson(rest[key])
    )

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

// ─── Form templates (WHS) ────────────────────────────────────────────────────

export async function upsertFormTemplate(
  data: unknown
): Promise<{ error?: string }> {
  await requireRole('admin')

  const parsed = formTemplateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()
  const { id, ...rest } = parsed.data

  if (id) {
    const { data: current } = await supabase
      .from('form_templates')
      .select('name, schema, requires_signon, version')
      .eq('id', id)
      .single()
    if (!current) return { error: 'Form template not found' }

    // Bump version when any content changes (not on active toggle alone)
    const changed =
      current.name !== rest.name ||
      (current.requires_signon ?? false) !== rest.requires_signon ||
      JSON.stringify(current.schema) !== JSON.stringify(rest.schema)

    const { error } = await supabase
      .from('form_templates')
      .update({
        ...rest,
        version: changed ? Number(current.version) + 1 : Number(current.version),
      })
      .eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('form_templates').insert({ ...rest, version: 1 })
    if (error) return { error: error.message }
  }

  revalidatePath('/settings')
  return {}
}

export async function setFormTemplateActive(
  id: string,
  active: boolean
): Promise<{ error?: string }> {
  await requireRole('admin')

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from('form_templates')
    .update({ active })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return {}
}

// ─── Training & competency configuration (ISO 7.2) ───────────────────────────

function revalidateCompetencyConfig() {
  revalidatePath('/settings')
  revalidatePath('/whs/training')
  revalidatePath('/whs')
  revalidatePath('/schedule')
}

export async function upsertCompetencyType(data: unknown): Promise<{ error?: string }> {
  await requireRole('admin')

  const parsed = competencyTypeSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()
  const { id, ...rest } = parsed.data

  if (id) {
    const { error } = await supabase.from('competency_types').update(rest).eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('competency_types').insert(rest)
    if (error) return { error: error.message }
  }

  revalidateCompetencyConfig()
  return {}
}

export async function setCompetencyTypeActive(
  id: string,
  active: boolean
): Promise<{ error?: string }> {
  await requireRole('admin')

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from('competency_types')
    .update({ active })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidateCompetencyConfig()
  return {}
}

export async function upsertRoleRequirement(data: unknown): Promise<{ error?: string }> {
  await requireRole('admin')

  const parsed = roleRequirementSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()
  const { id, ...rest } = parsed.data

  if (id) {
    const { error } = await supabase
      .from('role_competency_requirements')
      .update(rest)
      .eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('role_competency_requirements')
      .insert(rest)
    if (error) {
      if (error.code === '23505') {
        return { error: 'That role already requires this competency' }
      }
      return { error: error.message }
    }
  }

  revalidateCompetencyConfig()
  return {}
}

export async function deleteRoleRequirement(id: string): Promise<{ error?: string }> {
  await requireRole('admin')

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from('role_competency_requirements')
    .delete()
    .eq('id', id)

  if (error) return { error: error.message }

  revalidateCompetencyConfig()
  return {}
}

// ─── Go-live hardening: error register + access reviews ──────────────────────

/** Admin marks a captured app error as dealt with (Settings → Errors). */
export async function resolveAppError(id: string): Promise<{ error?: string }> {
  await requireRole('admin')

  const supabase = await createSupabaseClient()
  // RLS allows admin UPDATE; a DB guard trigger freezes every column except
  // `resolved`, so the captured evidence itself cannot be edited.
  const { error } = await supabase
    .from('app_errors')
    .update({ resolved: true })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return {}
}

/** Record a periodic access review (ACR-xxxx, Settings → Security). */
export async function createAccessReview(
  data: unknown
): Promise<{ error?: string }> {
  const caller = await requireRole('admin')

  const parsed = accessReviewSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()
  const number = await nextNumber(supabase, 'access_review')
  const { error } = await supabase.from('access_reviews').insert({
    number,
    ...parsed.data,
    created_by: caller.id,
  })

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return {}
}

// ─── Estimating: takeoff assemblies ──────────────────────────────────────────

export async function createTakeoffAssembly(
  data: unknown
): Promise<{ error?: string }> {
  await requireRole('admin', 'office')

  const parsed = takeoffAssemblySchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()
  const { error } = await supabase.from('takeoff_assemblies').insert(parsed.data)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return {}
}

export async function updateTakeoffAssembly(
  id: string,
  data: unknown
): Promise<{ error?: string }> {
  await requireRole('admin', 'office')

  const parsed = takeoffAssemblySchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from('takeoff_assemblies')
    .update(parsed.data)
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return {}
}

export async function setTakeoffAssemblyActive(
  id: string,
  active: boolean
): Promise<{ error?: string }> {
  await requireRole('admin', 'office')

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from('takeoff_assemblies')
    .update({ active })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return {}
}

export async function addAssemblyComponent(
  data: unknown
): Promise<{ error?: string }> {
  await requireRole('admin', 'office')

  const parsed = takeoffAssemblyComponentSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()

  // Append at the end: next position = max(position) + 1 within the assembly.
  const { data: last } = await supabase
    .from('takeoff_assembly_components')
    .select('position')
    .eq('assembly_id', parsed.data.assembly_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const position = (last?.position ?? -1) + 1

  const { error } = await supabase
    .from('takeoff_assembly_components')
    .insert({ ...parsed.data, position })

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return {}
}

export async function updateAssemblyComponent(
  id: string,
  data: unknown
): Promise<{ error?: string }> {
  await requireRole('admin', 'office')

  const parsed = takeoffAssemblyComponentSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()
  const { assembly_id, ...rest } = parsed.data
  const { error } = await supabase
    .from('takeoff_assembly_components')
    .update(rest)
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return {}
}

export async function deleteAssemblyComponent(
  id: string
): Promise<{ error?: string }> {
  await requireRole('admin', 'office')

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from('takeoff_assembly_components')
    .delete()
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return {}
}
