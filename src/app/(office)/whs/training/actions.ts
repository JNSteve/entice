'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { nextNumber } from '@/lib/numbering'
import {
  competencyRecordSchema,
  workerSchema,
} from '@/lib/zod'

type Result = { error?: string }

function revalidateTraining() {
  revalidatePath('/whs/training')
  revalidatePath('/whs') // overview "needs attention" — expiring/expired tickets
  revalidatePath('/field/safety') // field "My tickets"
  revalidatePath('/schedule') // roster warnings read the same records
}

/**
 * Records a competency (licence/ticket/VOC/induction/course) after the browser
 * client has uploaded the evidence file (if any) to attachments/competency/.
 *
 * DE-DUP RULE: recording a new one AUTOMATICALLY supersedes every previous
 * non-superseded record of the same (worker, type) — via the
 * supersede_competency_records RPC (SECURITY DEFINER with an internal
 * admin/office/supervisor check), so supervisors — who can INSERT records but
 * not UPDATE them — still trigger the supersede. The latest non-superseded
 * record then drives the matrix/status light.
 */
export async function createCompetencyRecord(data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = competencyRecordSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  let number: string
  try {
    number = await nextNumber(supabase, 'competency')
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Numbering failed' }
  }

  const { data: inserted, error } = await supabase
    .from('competency_records')
    .insert({
      number,
      worker_id: parsed.data.worker_id,
      competency_type_id: parsed.data.competency_type_id,
      issuer: parsed.data.issuer,
      reference_no: parsed.data.reference_no,
      issue_date: parsed.data.issue_date,
      expiry_date: parsed.data.expiry_date,
      evidence_path: parsed.data.evidence_path,
      evidence_filename: parsed.data.evidence_filename,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error || !inserted) return { error: error?.message ?? 'Insert failed' }

  const { error: supersedeError } = await supabase.rpc(
    'supersede_competency_records',
    {
      p_worker: parsed.data.worker_id,
      p_type: parsed.data.competency_type_id,
      p_new: inserted.id as string,
    }
  )

  revalidateTraining()

  if (supersedeError) {
    // The record itself is saved; surface the stale-predecessor problem.
    return {
      error: `Recorded as ${number}, but superseding the previous record failed: ${supersedeError.message}`,
    }
  }

  return {}
}

/**
 * Admin-only hard delete. The superseded_by FK is ON DELETE SET NULL, so
 * deleting the newest record automatically makes its predecessor current
 * again. Evidence object removal is best-effort (an orphaned object is
 * recoverable; a dangling row is not).
 */
export async function deleteCompetencyRecord(id: string): Promise<Result> {
  await requireRole('admin')

  const supabase = await createClient()

  const { data: row } = await supabase
    .from('competency_records')
    .select('id, evidence_path')
    .eq('id', id)
    .single()
  if (!row) return { error: 'Record not found' }

  const { error } = await supabase.from('competency_records').delete().eq('id', id)
  if (error) return { error: error.message }

  if (row.evidence_path) {
    const { error: storageError } = await supabase.storage
      .from('attachments')
      .remove([row.evidence_path as string])
    if (storageError) console.error('Storage delete error:', storageError.message)
  }

  revalidateTraining()
  return {}
}

/** Create or edit a worker (staff-linked rows come from the profiles trigger;
 * this is mainly for subbie individuals and trade/role overrides). */
export async function upsertWorker(data: unknown): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = workerSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { id, ...rest } = parsed.data

  if (id) {
    const { error } = await supabase.from('workers').update(rest).eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('workers').insert(rest)
    if (error) return { error: error.message }
  }

  revalidateTraining()
  return {}
}

export async function setWorkerActive(id: string, active: boolean): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const { error } = await supabase.from('workers').update({ active }).eq('id', id)
  if (error) return { error: error.message }

  revalidateTraining()
  return {}
}
