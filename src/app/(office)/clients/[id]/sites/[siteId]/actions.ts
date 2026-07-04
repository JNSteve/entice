'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { propertyComplianceItemSchema } from '@/lib/zod'

type Result = { error?: string }

function revalidateSite(clientId: string, siteId: string) {
  revalidatePath(`/clients/${clientId}/sites/${siteId}`)
  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/') // dashboard "Property compliance due" card
}

/**
 * Records a property compliance item after the browser has uploaded any
 * evidence file to attachments/property-compliance/ (two-phase upload).
 *
 * REPLACE flow (supersede-on-replace, like competency records): when
 * supersedes_id is set, the predecessor is flipped to status 'superseded'
 * with superseded_by → the new item, so the active register only ever shows
 * the current document while history is preserved (and audited).
 */
export async function createPropertyComplianceItem(
  clientId: string,
  data: unknown
): Promise<Result> {
  const profile = await requireRole('admin', 'office')

  const parsed = propertyComplianceItemSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { supersedes_id, ...item } = parsed.data

  // The site must belong to the claimed client (defence against URL games).
  const { data: site } = await supabase
    .from('sites')
    .select('id')
    .eq('id', item.site_id)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!site) return { error: 'Site not found for this client' }

  const { data: inserted, error } = await supabase
    .from('property_compliance_items')
    .insert({ ...item, created_by: profile.id })
    .select('id')
    .single()
  if (error || !inserted) return { error: error?.message ?? 'Insert failed' }

  if (supersedes_id) {
    const { error: supersedeError } = await supabase
      .from('property_compliance_items')
      .update({ status: 'superseded', superseded_by: inserted.id })
      .eq('id', supersedes_id)
      .eq('site_id', item.site_id)
      .eq('status', 'active')
    if (supersedeError) {
      revalidateSite(clientId, item.site_id)
      return {
        error: `Item saved, but superseding the previous one failed: ${supersedeError.message}`,
      }
    }
  }

  revalidateSite(clientId, item.site_id)
  return {}
}

/** Edit an item in place (dates/title/notes/document; optionally new evidence). */
export async function updatePropertyComplianceItem(
  clientId: string,
  id: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = propertyComplianceItemSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { supersedes_id: _ignored, evidence_path, evidence_filename, ...rest } = parsed.data
  void _ignored

  // Only replace the stored evidence when a new file was uploaded — an edit
  // without a file keeps the existing one.
  const patch: Record<string, unknown> = { ...rest }
  if (evidence_path) {
    patch.evidence_path = evidence_path
    patch.evidence_filename = evidence_filename
  }

  const { error } = await supabase
    .from('property_compliance_items')
    .update(patch)
    .eq('id', id)
    .eq('site_id', rest.site_id)
  if (error) return { error: error.message }

  revalidateSite(clientId, rest.site_id)
  return {}
}

/**
 * Admin-only hard delete. Mirrors competency records: deleting the newest
 * item makes the one it superseded active again; evidence object removal is
 * best-effort (an orphaned object is recoverable, a dangling row is not).
 */
export async function deletePropertyComplianceItem(
  clientId: string,
  id: string
): Promise<Result> {
  await requireRole('admin')

  const supabase = await createClient()

  const { data: row } = await supabase
    .from('property_compliance_items')
    .select('id, site_id, evidence_path')
    .eq('id', id)
    .single()
  if (!row) return { error: 'Item not found' }

  // Predecessors flipped by the replace flow become current again.
  const { data: predecessors } = await supabase
    .from('property_compliance_items')
    .select('id')
    .eq('superseded_by', id)

  const { error } = await supabase
    .from('property_compliance_items')
    .delete()
    .eq('id', id)
  if (error) return { error: error.message }

  if (predecessors && predecessors.length > 0) {
    await supabase
      .from('property_compliance_items')
      .update({ status: 'active', superseded_by: null })
      .in('id', predecessors.map((p) => p.id as string))
  }

  if (row.evidence_path) {
    const { error: storageError } = await supabase.storage
      .from('attachments')
      .remove([row.evidence_path as string])
    if (storageError) console.error('Storage delete error:', storageError.message)
  }

  revalidateSite(clientId, row.site_id as string)
  return {}
}
