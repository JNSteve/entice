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
