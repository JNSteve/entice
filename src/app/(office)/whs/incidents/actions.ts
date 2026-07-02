'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { nextNumber } from '@/lib/numbering'
import { auLocalToInstant } from '@/lib/tz'
import {
  incidentCreateSchema,
  incidentUpdateSchema,
  incidentStatusSchema,
  correctiveActionSchema,
  correctiveActionUpdateSchema,
} from '@/lib/zod'

type Result = { error?: string }

function revalidateIncident(incidentId?: string) {
  revalidatePath('/whs/incidents')
  if (incidentId) revalidatePath(`/whs/incidents/${incidentId}`)
  revalidatePath('/')
}

// ─── Create incident (office-side) ───────────────────────────────────────────

export async function createIncident(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = incidentCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const number = await nextNumber(supabase, 'incident').catch((err) => {
    throw new Error(`Failed to get next incident number: ${err.message}`)
  })

  // datetime-local has no timezone; the value is Brisbane wall-clock time.
  // Storing it raw would make Postgres read it as UTC — convert explicitly.
  let occurredAt: string
  try {
    occurredAt = auLocalToInstant(parsed.data.occurred_at)
  } catch {
    return { error: 'Invalid date/time for when it happened' }
  }

  const { data: row, error } = await supabase
    .from('incidents')
    .insert({
      number,
      project_id: parsed.data.project_id,
      job_id: parsed.data.job_id,
      type: parsed.data.type,
      severity: parsed.data.severity,
      occurred_at: occurredAt,
      location: parsed.data.location ?? null,
      description: parsed.data.description,
      immediate_action: parsed.data.immediate_action ?? null,
      reported_by: parsed.data.reported_by ?? profile.id,
      status: 'open',
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidateIncident(row.id)
  return { id: row.id }
}

// ─── Update incident fields ───────────────────────────────────────────────────

export async function updateIncident(
  incidentId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = incidentUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('incidents')
    .select('id, status')
    .eq('id', incidentId)
    .single()
  if (!existing) return { error: 'Incident not found' }
  if (existing.status === 'closed') {
    return { error: 'Cannot edit a closed incident' }
  }

  const { error } = await supabase
    .from('incidents')
    .update(parsed.data)
    .eq('id', incidentId)

  if (error) return { error: error.message }

  revalidateIncident(incidentId)
  return {}
}

// ─── Status transitions ───────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  open: ['investigating'],
  investigating: ['closed'],
  closed: ['investigating'], // admin reopen
}

export async function setIncidentStatus(
  incidentId: string,
  data: unknown
): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = incidentStatusSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('incidents')
    .select('id, status')
    .eq('id', incidentId)
    .single()
  if (!existing) return { error: 'Incident not found' }

  const allowed = VALID_TRANSITIONS[existing.status] ?? []
  if (!allowed.includes(parsed.data.status)) {
    return {
      error: `Cannot move from ${existing.status} to ${parsed.data.status}`,
    }
  }

  // Reopen (closed → investigating) is admin-only
  if (existing.status === 'closed' && parsed.data.status === 'investigating') {
    if (profile.role !== 'admin') {
      return { error: 'Only admins can reopen a closed incident' }
    }
  }

  // Block close while open corrective actions exist
  if (parsed.data.status === 'closed') {
    const { count } = await supabase
      .from('corrective_actions')
      .select('id', { count: 'exact', head: true })
      .eq('incident_id', incidentId)
      .eq('status', 'open')

    if ((count ?? 0) > 0) {
      return {
        error: `Cannot close — ${count} corrective action${count === 1 ? '' : 's'} still open`,
      }
    }
  }

  const update: Record<string, unknown> = { status: parsed.data.status }
  if (parsed.data.status === 'closed') {
    update.closed_at = new Date().toISOString()
  } else if (existing.status === 'closed') {
    update.closed_at = null
  }

  const { error } = await supabase
    .from('incidents')
    .update(update)
    .eq('id', incidentId)

  if (error) return { error: error.message }

  revalidateIncident(incidentId)
  return {}
}

// ─── Corrective actions ───────────────────────────────────────────────────────

// Corrective actions may only be mutated while the parent incident is still open
// or under investigation. Once the incident is 'closed' the record is locked —
// reopen the incident (admin) to change its corrective actions. Returns an error
// string when the parent is locked.
async function incidentActionsLocked(
  supabase: Awaited<ReturnType<typeof createClient>>,
  incidentId: string
): Promise<string | null> {
  const { data: parent } = await supabase
    .from('incidents')
    .select('status')
    .eq('id', incidentId)
    .single()
  if (!parent) return 'Incident not found'
  if (parent.status === 'closed') {
    return 'This incident is closed — reopen it to change its corrective actions.'
  }
  return null
}

export async function createCorrectiveAction(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = correctiveActionSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const locked = await incidentActionsLocked(supabase, parsed.data.incident_id)
  if (locked) return { error: locked }

  const { data: row, error } = await supabase
    .from('corrective_actions')
    .insert({
      incident_id: parsed.data.incident_id,
      description: parsed.data.description,
      assigned_to: parsed.data.assigned_to ?? null,
      due_date: parsed.data.due_date ?? null,
      status: 'open',
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidateIncident(parsed.data.incident_id)
  return { id: row.id }
}

export async function updateCorrectiveAction(
  actionId: string,
  incidentId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = correctiveActionUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const locked = await incidentActionsLocked(supabase, incidentId)
  if (locked) return { error: locked }

  const { error } = await supabase
    .from('corrective_actions')
    .update(parsed.data)
    .eq('id', actionId)
    .eq('incident_id', incidentId)

  if (error) return { error: error.message }

  revalidateIncident(incidentId)
  return {}
}

export async function deleteCorrectiveAction(
  actionId: string,
  incidentId: string
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const locked = await incidentActionsLocked(supabase, incidentId)
  if (locked) return { error: locked }

  const { error } = await supabase
    .from('corrective_actions')
    .delete()
    .eq('id', actionId)
    .eq('incident_id', incidentId)

  if (error) return { error: error.message }

  revalidateIncident(incidentId)
  return {}
}

export async function markCorrectiveActionDone(
  actionId: string,
  incidentId: string
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const { error } = await supabase
    .from('corrective_actions')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', actionId)
    .eq('incident_id', incidentId)

  if (error) return { error: error.message }

  revalidateIncident(incidentId)
  return {}
}

export async function reopenCorrectiveAction(
  actionId: string,
  incidentId: string
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const locked = await incidentActionsLocked(supabase, incidentId)
  if (locked) return { error: locked }

  const { error } = await supabase
    .from('corrective_actions')
    .update({ status: 'open', completed_at: null })
    .eq('id', actionId)
    .eq('incident_id', incidentId)

  if (error) return { error: error.message }

  revalidateIncident(incidentId)
  return {}
}
