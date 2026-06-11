'use server'

import { revalidatePath } from 'next/cache'
import { format, lastDayOfMonth } from 'date-fns'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { buildSnapshotLines, computeClaimTotals, computeLine } from '@/lib/claim-logic'
import { round2 } from '@/lib/money'
import { claimCertifySchema, claimLineUpdateSchema } from '@/lib/zod'

type Result = { error?: string }

function revalidateClaim(projectId: string, claimId?: string) {
  revalidatePath(`/projects/${projectId}/claims`)
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/money')
  if (claimId) revalidatePath(`/projects/${projectId}/claims/${claimId}`)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─── Create claim ─────────────────────────────────────────────────────────────

export async function createClaim(
  projectId: string
): Promise<{ error?: string; id?: string }> {
  await requireRole('admin', 'office')

  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, status, claim_day')
    .eq('id', projectId)
    .single()
  if (!project) return { error: 'Project not found' }
  if (project.status === 'closed') {
    return { error: 'Project is closed — no further claims can be raised' }
  }

  const { data: existingDraft } = await supabase
    .from('claims')
    .select('id')
    .eq('project_id', projectId)
    .eq('status', 'draft')
    .maybeSingle()
  if (existingDraft) {
    return { error: 'A draft claim already exists — submit or delete it first' }
  }

  const [{ data: maxRow }, { data: settings }] = await Promise.all([
    supabase
      .from('claims')
      .select('number')
      .eq('project_id', projectId)
      .order('number', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('settings').select('gst_rate').eq('id', 1).single(),
  ])

  // claim_day clamped into the current month (claim_day 31 in June → 30 June).
  const now = new Date()
  const day = Math.min(project.claim_day, lastDayOfMonth(now).getDate())
  const referenceDate = format(
    new Date(now.getFullYear(), now.getMonth(), day),
    'yyyy-MM-dd'
  )

  const snapshot = await buildSnapshotLines(supabase, projectId)

  const { data: claim, error } = await supabase
    .from('claims')
    .insert({
      project_id: projectId,
      number: (maxRow?.number ?? 0) + 1,
      status: 'draft',
      reference_date: referenceDate,
      gst_rate: Number(settings?.gst_rate ?? 10),
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  if (snapshot.length > 0) {
    const { error: linesError } = await supabase
      .from('claim_lines')
      .insert(snapshot.map((l) => ({ ...l, claim_id: claim.id })))
    if (linesError) {
      await supabase.from('claims').delete().eq('id', claim.id)
      return { error: linesError.message }
    }
  }

  revalidateClaim(projectId, claim.id)
  return { id: claim.id }
}

// ─── Update claim line (draft only) ───────────────────────────────────────────

export async function updateClaimLine(
  lineId: string,
  claimId: string,
  projectId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = claimLineUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: claim } = await supabase
    .from('claims')
    .select('id, status')
    .eq('id', claimId)
    .eq('project_id', projectId)
    .single()
  if (!claim) return { error: 'Claim not found' }
  if (claim.status !== 'draft') return { error: 'Claim is not in draft status' }

  const { data: line } = await supabase
    .from('claim_lines')
    .select('id, line_value, previous_claimed')
    .eq('id', lineId)
    .eq('claim_id', claimId)
    .single()
  if (!line) return { error: 'Claim line not found' }

  const lineValue = Number(line.line_value)
  const previous = Number(line.previous_claimed)
  const pct = parsed.data.pct_complete

  // Floor: cannot drop below the previously-claimed percentage unless the
  // caller explicitly allows a reduction (credit situation).
  const floorPct =
    lineValue > 0 ? Math.min(round2((previous / lineValue) * 100), 100) : 0
  if (!parsed.data.allow_reduction && pct < floorPct) {
    return {
      error: `% complete cannot drop below the previously claimed ${floorPct}% — enable "allow reduction" for credits`,
    }
  }

  const { claimedToDate, thisClaim } = computeLine(lineValue, pct, previous)

  const { error } = await supabase
    .from('claim_lines')
    .update({
      pct_complete: pct,
      claimed_to_date: claimedToDate,
      this_claim: thisClaim,
    })
    .eq('id', lineId)
    .eq('claim_id', claimId)
  if (error) return { error: error.message }

  revalidateClaim(projectId, claimId)
  return {}
}

// ─── Refresh lines (draft only) ───────────────────────────────────────────────

/**
 * Re-syncs the snapshot with the current budget lines / approved variations:
 * adds new lines, refreshes line values and previous-claimed figures, drops
 * lines whose source no longer exists. Entered % complete is preserved for
 * lines whose source survives.
 */
export async function refreshClaimLines(
  claimId: string,
  projectId: string
): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()

  const { data: claim } = await supabase
    .from('claims')
    .select('id, status')
    .eq('id', claimId)
    .eq('project_id', projectId)
    .single()
  if (!claim) return { error: 'Claim not found' }
  if (claim.status !== 'draft') return { error: 'Claim is not in draft status' }

  const { data: existingLines } = await supabase
    .from('claim_lines')
    .select('source_type, source_id, pct_complete')
    .eq('claim_id', claimId)

  const enteredPct = new Map<string, number>()
  for (const l of existingLines ?? []) {
    enteredPct.set(`${l.source_type}:${l.source_id}`, Number(l.pct_complete))
  }

  const snapshot = (await buildSnapshotLines(supabase, projectId, claimId)).map((l) => {
    const kept = enteredPct.get(`${l.source_type}:${l.source_id}`)
    if (kept === undefined) return l
    const pct = Math.min(Math.max(kept, 0), 100)
    const { claimedToDate, thisClaim } = computeLine(l.line_value, pct, l.previous_claimed)
    return { ...l, pct_complete: pct, claimed_to_date: claimedToDate, this_claim: thisClaim }
  })

  const { error: deleteError } = await supabase
    .from('claim_lines')
    .delete()
    .eq('claim_id', claimId)
  if (deleteError) return { error: deleteError.message }

  if (snapshot.length > 0) {
    const { error: insertError } = await supabase
      .from('claim_lines')
      .insert(snapshot.map((l) => ({ ...l, claim_id: claimId })))
    if (insertError) return { error: insertError.message }
  }

  revalidateClaim(projectId, claimId)
  return {}
}

// ─── Submit claim ─────────────────────────────────────────────────────────────

export async function submitClaim(
  claimId: string,
  projectId: string
): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()

  const { data: claim } = await supabase
    .from('claims')
    .select('id, status, number, gst_rate')
    .eq('id', claimId)
    .eq('project_id', projectId)
    .single()
  if (!claim) return { error: 'Claim not found' }
  if (claim.status !== 'draft') return { error: 'Claim is not in draft status' }

  // Recompute EVERYTHING server-side via the engine (adjusted contract sum,
  // current retention position) — never trust client figures.
  const computation = await computeClaimTotals(
    supabase,
    claimId,
    projectId,
    Number(claim.gst_rate)
  )
  if (computation.error !== undefined) return { error: computation.error }
  const { lineIds, result } = computation

  // Re-persist per-line figures so the stored snapshot matches the totals.
  for (let i = 0; i < lineIds.length; i++) {
    const { error } = await supabase
      .from('claim_lines')
      .update({
        claimed_to_date: result.lines[i].claimedToDate,
        this_claim: result.lines[i].thisClaim,
      })
      .eq('id', lineIds[i])
    if (error) return { error: error.message }
  }

  const { error: claimError } = await supabase
    .from('claims')
    .update({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      gross_this_claim: result.grossThisClaim,
      retention_this_claim: result.retentionThisClaim,
      subtotal: result.subtotal,
      gst: result.gst,
      total_inc_gst: result.totalIncGst,
      total_claimed_to_date: result.totalClaimedToDate,
    })
    .eq('id', claimId)
    .eq('status', 'draft')
  if (claimError) return { error: claimError.message }

  if (result.retentionThisClaim > 0) {
    const { error: retError } = await supabase.from('retention_entries').insert({
      project_id: projectId,
      claim_id: claimId,
      kind: 'withheld',
      amount: result.retentionThisClaim,
      date: today(),
      notes: `Withheld on claim ${claim.number}`,
    })
    if (retError) return { error: retError.message }
  }

  revalidateClaim(projectId, claimId)
  return {}
}

// ─── Certify claim ────────────────────────────────────────────────────────────

export async function certifyClaim(
  claimId: string,
  projectId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = claimCertifySchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: claim } = await supabase
    .from('claims')
    .select('id, status')
    .eq('id', claimId)
    .eq('project_id', projectId)
    .single()
  if (!claim) return { error: 'Claim not found' }
  if (claim.status !== 'submitted') {
    return { error: 'Only submitted claims can be certified' }
  }

  const { error } = await supabase
    .from('claims')
    .update({
      status: 'certified',
      certified_amount: parsed.data.certified_amount,
      schedule_received_at: parsed.data.schedule_received_at,
      certified_at: new Date().toISOString(),
    })
    .eq('id', claimId)
  if (error) return { error: error.message }

  revalidateClaim(projectId, claimId)
  return {}
}

// ─── Mark paid ────────────────────────────────────────────────────────────────

export async function markClaimPaid(
  claimId: string,
  projectId: string
): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()

  const { data: claim } = await supabase
    .from('claims')
    .select('id, status, certified_amount, total_inc_gst')
    .eq('id', claimId)
    .eq('project_id', projectId)
    .single()
  if (!claim) return { error: 'Claim not found' }
  if (claim.status !== 'certified') {
    return { error: 'Only certified claims can be marked paid' }
  }

  const { error } = await supabase
    .from('claims')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', claimId)
  if (error) return { error: error.message }

  const amount =
    claim.certified_amount != null
      ? Number(claim.certified_amount)
      : Number(claim.total_inc_gst ?? 0)
  const { error: payError } = await supabase.from('payments').insert({
    claim_id: claimId,
    amount,
    date: today(),
    method: 'eft',
    reference: null,
  })
  if (payError) return { error: payError.message }

  revalidateClaim(projectId, claimId)
  return {}
}
