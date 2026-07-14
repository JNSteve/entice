'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  maintenanceEntrySchema,
  maintenanceEntryUpdateSchema,
} from '@/lib/zod'

/**
 * Maintenance-log actions, shared by the office site page and the field app
 * (same 'use server' module pattern as attachments.ts). Crews (any staff
 * role) can record entries; editing, flagging, resolving and deleting are
 * admin/office only — RLS enforces the same split underneath.
 */

type Result = { error?: string }

function revalidateMaintenance(siteId: string, clientId?: string | null) {
  if (clientId) revalidatePath(`/clients/${clientId}/sites/${siteId}`)
  revalidatePath('/field/maintenance')
}

export async function createMaintenanceEntry(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin', 'office', 'supervisor', 'field')

  const parsed = maintenanceEntrySchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: site } = await supabase
    .from('sites')
    .select('id, client_id')
    .eq('id', parsed.data.site_id)
    .maybeSingle()
  if (!site) return { error: 'Property not found' }

  // Optional work links must be real records (RLS-scoped lookups).
  if (parsed.data.job_id) {
    const { data: job } = await supabase
      .from('jobs')
      .select('id')
      .eq('id', parsed.data.job_id)
      .maybeSingle()
    if (!job) return { error: 'Linked job not found' }
  }
  if (parsed.data.project_id) {
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', parsed.data.project_id)
      .maybeSingle()
    if (!project) return { error: 'Linked project not found' }
  }

  const { data: row, error } = await supabase
    .from('maintenance_entries')
    .insert({ ...parsed.data, created_by: profile.id })
    .select('id')
    .single()
  if (error) return { error: error.message }

  revalidateMaintenance(parsed.data.site_id, site.client_id as string | null)
  return { id: row.id as string }
}

export async function updateMaintenanceEntry(
  id: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = maintenanceEntryUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { data: entry } = await supabase
    .from('maintenance_entries')
    .select('id, site_id, sites(client_id)')
    .eq('id', id)
    .maybeSingle()
  if (!entry) return { error: 'Entry not found' }

  const { error } = await supabase
    .from('maintenance_entries')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidateMaintenance(
    entry.site_id as string,
    (entry.sites as unknown as { client_id: string | null } | null)?.client_id
  )
  return {}
}

/** Close out an open (temporary) measure — e.g. the permanent repair landed. */
export async function resolveMaintenanceEntry(id: string): Promise<Result> {
  return updateMaintenanceEntry(id, { status: 'resolved' })
}

export async function setMaintenanceFlag(
  id: string,
  flagged: boolean,
  flagNote?: string
): Promise<Result> {
  return updateMaintenanceEntry(id, {
    flagged,
    flag_note: flagged ? (flagNote ?? null) : null,
  })
}

export async function deleteMaintenanceEntry(id: string): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const { data: entry } = await supabase
    .from('maintenance_entries')
    .select('id, site_id, sites(client_id)')
    .eq('id', id)
    .maybeSingle()
  if (!entry) return { error: 'Entry not found' }

  const { error } = await supabase
    .from('maintenance_entries')
    .delete()
    .eq('id', id)
  if (error) return { error: error.message }

  revalidateMaintenance(
    entry.site_id as string,
    (entry.sites as unknown as { client_id: string | null } | null)?.client_id
  )
  return {}
}
