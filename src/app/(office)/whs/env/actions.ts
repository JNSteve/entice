'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { nextNumber } from '@/lib/numbering'
import {
  wasteLoadCreateSchema,
  wasteLoadUpdateSchema,
  envFacilitySchema,
  envPermitSchema,
  envAspectSchema,
} from '@/lib/zod'

type Result = { error?: string }

function revalidateEnv(loadId?: string, projectId?: string | null) {
  revalidatePath('/whs/env')
  revalidatePath('/')
  if (loadId) revalidatePath(`/whs/env/loads/${loadId}`)
  if (projectId) revalidatePath(`/projects/${projectId}/env`)
  revalidatePath('/field/waste')
}

// ─── Waste loads ──────────────────────────────────────────────────────────────

/**
 * Records a waste load leaving site. FIELD may log loads too (they are the
 * ones at the gate) — RLS restricts field inserts to created_by = self.
 * Gating (expired licence / permit over allowance) is WARN + override_reason
 * in the client, never a server-side block (locked decision).
 */
export async function createWasteLoad(
  data: unknown
): Promise<{ error?: string; id?: string; number?: string }> {
  const profile = await requireRole('admin', 'office', 'supervisor', 'field')

  const parsed = wasteLoadCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  let number: string
  try {
    number = await nextNumber(supabase, 'waste_load')
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Numbering failed' }
  }

  const { data: row, error } = await supabase
    .from('waste_loads')
    .insert({
      number,
      project_id: parsed.data.project_id,
      job_id: parsed.data.job_id,
      date: parsed.data.date,
      classification: parsed.data.classification,
      classification_detail: parsed.data.classification_detail,
      qty: parsed.data.qty,
      unit: parsed.data.unit,
      facility_id: parsed.data.facility_id,
      permit_id: parsed.data.permit_id,
      transporter: parsed.data.transporter,
      vendor_id: parsed.data.vendor_id,
      docket_ref: parsed.data.docket_ref,
      notes: parsed.data.notes,
      override_reason: parsed.data.override_reason,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidateEnv(row.id, parsed.data.project_id)
  return { id: row.id, number }
}

export async function updateWasteLoad(
  loadId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = wasteLoadUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('waste_loads')
    .select('id, project_id')
    .eq('id', loadId)
    .single()
  if (!existing) return { error: 'Waste load not found' }

  const { data: updated, error } = await supabase
    .from('waste_loads')
    .update(parsed.data)
    .eq('id', loadId)
    .select('id, project_id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Update was not applied (no permission)' }
  }

  revalidateEnv(loadId, updated[0].project_id ?? existing.project_id)
  return {}
}

export async function deleteWasteLoad(loadId: string): Promise<Result> {
  await requireRole('admin')

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('waste_loads')
    .select('id, project_id')
    .eq('id', loadId)
    .single()
  if (!existing) return { error: 'Waste load not found' }

  const { error } = await supabase.from('waste_loads').delete().eq('id', loadId)
  if (error) return { error: error.message }

  revalidateEnv(undefined, existing.project_id as string | null)
  return {}
}

// ─── Facilities (admin/office master data) ────────────────────────────────────

export async function createEnvFacility(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin', 'office')

  const parsed = envFacilitySchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { data: row, error } = await supabase
    .from('env_facilities')
    .insert({ ...parsed.data, created_by: profile.id })
    .select('id')
    .single()
  if (error) return { error: error.message }

  revalidateEnv()
  return { id: row.id }
}

export async function updateEnvFacility(
  facilityId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = envFacilitySchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from('env_facilities')
    .update(parsed.data)
    .eq('id', facilityId)
    .select('id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Update was not applied (no permission)' }
  }

  revalidateEnv()
  return {}
}

export async function deleteEnvFacility(facilityId: string): Promise<Result> {
  await requireRole('admin')

  const supabase = await createClient()
  const { error } = await supabase
    .from('env_facilities')
    .delete()
    .eq('id', facilityId)
  if (error) return { error: error.message }

  revalidateEnv()
  return {}
}

// ─── Permits (admin/office; project-scoped) ───────────────────────────────────

export async function createEnvPermit(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin', 'office')

  const parsed = envPermitSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { data: row, error } = await supabase
    .from('env_permits')
    .insert({ ...parsed.data, created_by: profile.id })
    .select('id')
    .single()
  if (error) return { error: error.message }

  revalidateEnv(undefined, parsed.data.project_id)
  return { id: row.id }
}

export async function updateEnvPermit(
  permitId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = envPermitSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from('env_permits')
    .update(parsed.data)
    .eq('id', permitId)
    .select('id, project_id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Update was not applied (no permission)' }
  }

  revalidateEnv(undefined, updated[0].project_id as string)
  return {}
}

export async function deleteEnvPermit(permitId: string): Promise<Result> {
  await requireRole('admin')

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from('env_permits')
    .select('id, project_id')
    .eq('id', permitId)
    .single()
  if (!existing) return { error: 'Permit not found' }

  const { error } = await supabase.from('env_permits').delete().eq('id', permitId)
  if (error) return { error: error.message }

  revalidateEnv(undefined, existing.project_id as string)
  return {}
}

// ─── Aspects (admin/office; edit-in-place — the audit trigger is the history) ─

export async function createEnvAspect(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin', 'office')

  const parsed = envAspectSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { data: row, error } = await supabase
    .from('env_aspects')
    .insert({ ...parsed.data, created_by: profile.id })
    .select('id')
    .single()
  if (error) return { error: error.message }

  revalidateEnv()
  return { id: row.id }
}

export async function updateEnvAspect(
  aspectId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = envAspectSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from('env_aspects')
    .update(parsed.data)
    .eq('id', aspectId)
    .select('id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Update was not applied (no permission)' }
  }

  revalidateEnv()
  return {}
}

export async function deleteEnvAspect(aspectId: string): Promise<Result> {
  await requireRole('admin')

  const supabase = await createClient()
  const { error } = await supabase
    .from('env_aspects')
    .delete()
    .eq('id', aspectId)
  if (error) return { error: error.message }

  revalidateEnv()
  return {}
}
