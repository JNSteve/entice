'use server'

import { revalidatePath } from 'next/cache'
import { isComplianceDirector, requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { nextCarNumber } from '@/lib/numbering'
import {
  ncrCreateSchema,
  ncrUpdateSchema,
  ncrStatusSchema,
  capaActionSchema,
  capaActionUpdateSchema,
} from '@/lib/zod'

type Result = { error?: string }

function revalidateNcr(ncrId?: string) {
  revalidatePath('/whs/ncr')
  if (ncrId) revalidatePath(`/whs/ncr/${ncrId}`)
  revalidatePath('/')
}

// ─── Create NCR (office-side raise) ───────────────────────────────────────────

export async function createNcr(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = ncrCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const number = await nextCarNumber(supabase).catch((err) => {
    throw new Error(`Failed to get next CAR number: ${err.message}`)
  })

  const { data: row, error } = await supabase
    .from('ncrs')
    .insert({
      number,
      source: parsed.data.source,
      source_detail: parsed.data.source_detail,
      classification: parsed.data.classification,
      category: parsed.data.category,
      severity: parsed.data.severity,
      title: parsed.data.title,
      description: parsed.data.description,
      immediate_action: parsed.data.immediate_action,
      assigned_to_text: parsed.data.assigned_to_text,
      due_date: parsed.data.due_date,
      project_id: parsed.data.project_id,
      job_id: parsed.data.job_id,
      vendor_id: parsed.data.vendor_id,
      incident_id: parsed.data.incident_id,
      occurred_on: parsed.data.occurred_on,
      raised_by: profile.id,
      status: 'open',
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidateNcr(row.id)
  return { id: row.id }
}

// ─── Update NCR fields ────────────────────────────────────────────────────────

export async function updateNcr(ncrId: string, data: unknown): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = ncrUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('ncrs')
    .select('id, status')
    .eq('id', ncrId)
    .single()
  if (!existing) return { error: 'Corrective action not found' }
  if (existing.status === 'closed') {
    return { error: 'Cannot edit a closed CAR' }
  }

  const { error } = await supabase.from('ncrs').update(parsed.data).eq('id', ncrId)
  if (error) return { error: error.message }

  revalidateNcr(ncrId)
  return {}
}

// ─── Status transitions + verification-of-effectiveness gate ──────────────────

// Forward lifecycle. 'closed' is reachable ONLY from 'verified' (and only when
// every CAPA action is done — both checked below). Admin may reopen.
const VALID_TRANSITIONS: Record<string, string[]> = {
  open: ['investigating'],
  investigating: ['actions'],
  actions: ['verified', 'investigating'], // may step back if more digging needed
  verified: ['closed', 'actions'], // may step back if verification fails
  closed: ['verified'], // admin reopen
}

export async function setNcrStatus(ncrId: string, data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = ncrStatusSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('ncrs')
    .select('id, status')
    .eq('id', ncrId)
    .single()
  if (!existing) return { error: 'Corrective action not found' }

  const target = parsed.data.status
  const allowed = VALID_TRANSITIONS[existing.status] ?? []
  if (!allowed.includes(target)) {
    return { error: `Cannot move from ${existing.status} to ${target}` }
  }

  // Reopen (closed → verified) is admin-only.
  if (existing.status === 'closed' && target === 'verified') {
    if (profile.role !== 'admin') {
      return { error: 'Only admins can reopen a closed CAR' }
    }
  }

  // ── Verification-of-effectiveness gate (NON-BYPASSABLE) ──────────────────
  // Moving to 'verified': require verification notes (also enforced in zod)
  // AND every CAPA action must be done — you cannot attest effectiveness while
  // actions remain outstanding.
  if (target === 'verified') {
    if (!parsed.data.verification_notes) {
      return { error: 'Verification notes are required to verify effectiveness' }
    }
    const { count: openCapa } = await supabase
      .from('capa_actions')
      .select('id', { count: 'exact', head: true })
      .eq('ncr_id', ncrId)
      .eq('status', 'open')
    if ((openCapa ?? 0) > 0) {
      return {
        error: `Cannot verify — ${openCapa} CAPA action${openCapa === 1 ? '' : 's'} still open. Complete all actions before verifying effectiveness.`,
      }
    }
  }

  // Closing: BLOCKED unless status is moving from 'verified' (transition table
  // already guarantees this) AND all CAPA actions are done. This is the hard
  // gate — close is impossible without a completed verification step.
  if (target === 'closed') {
    if (existing.status !== 'verified') {
      return {
        error: 'Cannot close — effectiveness must be verified first',
      }
    }
    const { count: openCapa } = await supabase
      .from('capa_actions')
      .select('id', { count: 'exact', head: true })
      .eq('ncr_id', ncrId)
      .eq('status', 'open')
    if ((openCapa ?? 0) > 0) {
      return {
        error: `Cannot close — ${openCapa} CAPA action${openCapa === 1 ? '' : 's'} still open`,
      }
    }
    // SMS-05: close-out is the compliance director's alone. The ncrs_close_guard
    // trigger (0072) enforces the same in the database.
    if (!isComplianceDirector(profile)) {
      return {
        error: 'Only the Director (Compliance and Technical) closes a corrective action (SMS-05).',
      }
    }
  }

  const update: Record<string, unknown> = { status: target }

  if (target === 'verified') {
    update.verification_notes = parsed.data.verification_notes
    update.verified_by = profile.id
    update.verified_at = new Date().toISOString()
  } else if (existing.status === 'verified' && target === 'actions') {
    // Stepping back from verified clears the (now stale) verification record.
    update.verification_notes = null
    update.verified_by = null
    update.verified_at = null
  }

  if (target === 'closed') {
    update.closed_at = new Date().toISOString()
  } else if (existing.status === 'closed') {
    update.closed_at = null
  }

  const { error } = await supabase.from('ncrs').update(update).eq('id', ncrId)
  if (error) return { error: error.message }

  revalidateNcr(ncrId)
  return {}
}

// ─── CAPA actions ─────────────────────────────────────────────────────────────

// CAPA actions may only be mutated while the parent NCR is in a working status.
// Once the NCR is 'verified' or 'closed' the attested verification-of-effectiveness
// is locked in — reopen the NCR (moving it back to an editable status) to change
// its corrective actions. Returns an error string when the parent is locked.
async function ncrActionsLocked(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ncrId: string
): Promise<string | null> {
  const { data: parent } = await supabase
    .from('ncrs')
    .select('status')
    .eq('id', ncrId)
    .single()
  if (!parent) return 'Corrective action not found'
  if (parent.status === 'verified' || parent.status === 'closed') {
    return 'This CAR is verified/closed — reopen it to change its CAPA actions.'
  }
  return null
}

export async function createCapaAction(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = capaActionSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const locked = await ncrActionsLocked(supabase, parsed.data.ncr_id)
  if (locked) return { error: locked }

  const { data: row, error } = await supabase
    .from('capa_actions')
    .insert({
      ncr_id: parsed.data.ncr_id,
      kind: parsed.data.kind,
      description: parsed.data.description,
      assigned_to: parsed.data.assigned_to,
      due_date: parsed.data.due_date,
      status: 'open',
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidateNcr(parsed.data.ncr_id)
  return { id: row.id }
}

export async function updateCapaAction(
  actionId: string,
  ncrId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = capaActionUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const locked = await ncrActionsLocked(supabase, ncrId)
  if (locked) return { error: locked }

  const { error } = await supabase
    .from('capa_actions')
    .update(parsed.data)
    .eq('id', actionId)
    .eq('ncr_id', ncrId)

  if (error) return { error: error.message }

  revalidateNcr(ncrId)
  return {}
}

export async function deleteCapaAction(
  actionId: string,
  ncrId: string
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const locked = await ncrActionsLocked(supabase, ncrId)
  if (locked) return { error: locked }

  const { error } = await supabase
    .from('capa_actions')
    .delete()
    .eq('id', actionId)
    .eq('ncr_id', ncrId)

  if (error) return { error: error.message }

  revalidateNcr(ncrId)
  return {}
}

export async function markCapaActionDone(
  actionId: string,
  ncrId: string
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const { error } = await supabase
    .from('capa_actions')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', actionId)
    .eq('ncr_id', ncrId)

  if (error) return { error: error.message }

  revalidateNcr(ncrId)
  return {}
}

export async function reopenCapaAction(
  actionId: string,
  ncrId: string
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const locked = await ncrActionsLocked(supabase, ncrId)
  if (locked) return { error: locked }

  const { error } = await supabase
    .from('capa_actions')
    .update({ status: 'open', completed_at: null })
    .eq('id', actionId)
    .eq('ncr_id', ncrId)

  if (error) return { error: error.message }

  revalidateNcr(ncrId)
  return {}
}
