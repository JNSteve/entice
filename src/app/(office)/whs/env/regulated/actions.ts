'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { regulatedMovementCreateSchema } from '@/lib/zod'

/**
 * Server actions for QLD regulated (trackable) waste movements.
 *
 * The statutory record is created here; Parts 2 and 3 arrive later through the
 * transporter/receiver QR links (anon RPCs in migration 0055) or through the
 * office register. There is deliberately NO delete action — RLS carries no
 * delete policy and a before-update trigger freezes the record on lodgement.
 */

function revalidateRegulated(projectId?: string | null) {
  revalidatePath('/whs/env/regulated')
  revalidatePath('/field/waste')
  revalidatePath('/field/waste/regulated')
  if (projectId) revalidatePath(`/projects/${projectId}/env`)
}

/** window.location.origin from the caller; env/localhost fallback. */
function safeOrigin(origin: string | null | undefined): string {
  const fallback = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  if (!origin) return fallback
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback
    return url.origin
  } catch {
    return fallback
  }
}

export interface MovementLinks {
  transporterUrl: string
  receiverUrl: string
}

async function issueLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  movementId: string,
  origin: string | null | undefined
): Promise<MovementLinks | null> {
  const { data, error } = await supabase.rpc('issue_waste_movement_links', {
    p_movement_id: movementId,
  })
  const payload = data as
    | { transporter_token?: string; receiver_token?: string; error?: string }
    | null
  if (error || !payload?.transporter_token || !payload?.receiver_token) return null

  const base = safeOrigin(origin)
  return {
    transporterUrl: `${base}/haul/${payload.transporter_token}`,
    receiverUrl: `${base}/receive/${payload.receiver_token}`,
  }
}

export type CreateMovementResult =
  | { id: string; loadSeq: number; links: MovementLinks | null; error?: never }
  | { error: string }

/**
 * Records a regulated waste movement. FIELD may create these — they are the
 * ones at the gate — and RLS restricts field inserts to created_by = self.
 *
 * load_seq is NOT set here: it defaults to nextval('regulated_waste_load_seq')
 * in the database, so the number can never be reused by a rolled-back
 * transaction and never repeats across submissions.
 */
export async function createRegulatedMovement(
  data: unknown,
  origin?: string
): Promise<CreateMovementResult> {
  const profile = await requireRole('admin', 'office', 'supervisor', 'field')

  const parsed = regulatedMovementCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }
  const input = parsed.data

  // Belt and braces over the database NOT NULL: it is an offence under s96 of
  // the Environmental Protection Regulation 2019 to give trackable waste to an
  // unauthorised transporter, so say so rather than surfacing a constraint.
  if (!input.transporter_ea_number.trim()) {
    return {
      error:
        'This transporter has no environmental authority number on file. It is an offence under s96 of the Environmental Protection Regulation 2019 to give trackable waste to an unauthorised transporter.',
    }
  }

  const supabase = await createClient()

  const { data: row, error } = await supabase
    .from('regulated_waste_movements')
    .insert({ ...input, created_by: profile.id })
    .select('id, load_seq')
    .single()

  if (error || !row) {
    return { error: error?.message ?? 'Could not record the movement' }
  }

  const id = row.id as string
  const links = await issueLinks(supabase, id, origin)

  revalidateRegulated(input.project_id)
  return { id, loadSeq: row.load_seq as number, links }
}

/** Re-fetches (or mints) the transporter and receiver links for a movement. */
export async function getMovementLinks(
  movementId: string,
  origin?: string
): Promise<{ links?: MovementLinks; error?: string }> {
  await requireRole('admin', 'office', 'supervisor', 'field')
  const supabase = await createClient()
  const links = await issueLinks(supabase, movementId, origin)
  return links ? { links } : { error: 'Could not issue the links' }
}

/**
 * Marks a movement as given to the department.
 *
 * Everything the record needs at lodgement is written in ONE update, because
 * the regulated_waste_guard trigger freezes the statutory fields the moment
 * lodged_at is set — a follow-up write would be rejected. Afterwards only
 * wtc_reference and notes may change.
 */
export async function markLodged(
  movementId: string,
  method: 'connect' | 'bulk_upload',
  wtcReference: string | null
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  if (method !== 'connect' && method !== 'bulk_upload') {
    return { error: 'Unknown lodgement method' }
  }
  // Connect issues a waste transport certificate reference; bulk upload does
  // not, so it is only required for the Connect route.
  const reference = (wtcReference ?? '').trim()
  if (method === 'connect' && !reference) {
    return { error: 'Enter the Connect WTC reference' }
  }

  const supabase = await createClient()

  const { data: settings } = await supabase
    .from('settings')
    .select('budf_identifier')
    .eq('id', 1)
    .single()

  const { error } = await supabase
    .from('regulated_waste_movements')
    .update({
      lodged_at: new Date().toISOString(),
      lodgement_method: method,
      wtc_reference: reference || null,
      // The identifier actually submitted under, snapshotted.
      budf_identifier: (settings?.budf_identifier as string | null) ?? null,
    })
    .eq('id', movementId)
    .is('lodged_at', null)

  if (error) return { error: error.message }

  revalidateRegulated()
  return {}
}

/** The WTC reference stays editable after lodgement — the guard allows it. */
export async function setWtcReference(
  movementId: string,
  wtcReference: string
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()
  const { error } = await supabase
    .from('regulated_waste_movements')
    .update({ wtc_reference: wtcReference.trim() || null })
    .eq('id', movementId)

  if (error) return { error: error.message }

  revalidateRegulated()
  return {}
}

/**
 * Reopens the transporter or receiver part so it can be submitted again.
 * Goes through the reopen_waste_part RPC, which refuses once the movement is
 * lodged; the table's audit trigger records it either way.
 */
export async function reopenPart(
  movementId: string,
  part: 'transporter' | 'receiver'
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('reopen_waste_part', {
    p_movement_id: movementId,
    p_part: part,
  })
  if (error) return { error: error.message }

  const payload = data as { ok?: boolean; error?: string } | null
  if (!payload?.ok) return { error: payload?.error ?? 'Could not reopen that part' }

  revalidateRegulated()
  return {}
}

type Result = { error?: string }
