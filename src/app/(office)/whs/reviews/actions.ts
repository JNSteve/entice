'use server'

// Management Review (ISO 9.3) server actions. Writes are admin/office only
// (matching RLS); supervisors read via the pages. The SOFT close gate lives
// here (and pure in src/lib/mgmt-review.ts): closing with un-reviewed inputs
// is rejected UNLESS explicitly confirmed — and open output actions NEVER
// block a close. A closed review is locked (server checks + the DB guard
// triggers in 0024); only its output actions stay workable (status/completed
// fields), so the tracker lives on after the meeting.

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { nextNumber } from '@/lib/numbering'
import {
  MGMT_REVIEW_INPUT_KEYS,
  MGMT_REVIEW_INPUT_DEFS,
  mgmtReviewCloseError,
  type MgmtReviewInputKey,
} from '@/lib/mgmt-review'
import { buildAllInputSnapshots, buildInputSnapshot } from '@/lib/mgmt-review-data'
import {
  mgmtReviewCreateSchema,
  mgmtReviewUpdateSchema,
  mgmtReviewCloseSchema,
  mgmtReviewInputUpdateSchema,
  mgmtReviewAttendeeSchema,
  mgmtReviewActionSchema,
  mgmtReviewActionUpdateSchema,
} from '@/lib/zod'

type Result = { error?: string }

function revalidateReviews(reviewId?: string) {
  revalidatePath('/whs/reviews')
  if (reviewId) revalidatePath(`/whs/reviews/${reviewId}`)
  revalidatePath('/whs')
}

async function loadReview(
  supabase: Awaited<ReturnType<typeof createClient>>,
  reviewId: string
) {
  const { data: review } = await supabase
    .from('management_reviews')
    .select('id, status')
    .eq('id', reviewId)
    .single()
  return review as { id: string; status: string } | null
}

// ─── Create (seeds the 13 controlled inputs with fresh snapshots) ─────────────

export async function createReview(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin', 'office')

  const parsed = mgmtReviewCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  // Pull the register snapshots BEFORE creating anything — if a register
  // query fails the review is not created half-seeded.
  let snapshots: Awaited<ReturnType<typeof buildAllInputSnapshots>>
  try {
    snapshots = await buildAllInputSnapshots(supabase)
  } catch (err) {
    return {
      error: `Could not pull the register data: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const number = await nextNumber(supabase, 'mgmt_review').catch((err) => {
    throw new Error(`Failed to get next review number: ${err.message}`)
  })

  const { data: row, error } = await supabase
    .from('management_reviews')
    .insert({
      number,
      review_date: parsed.data.review_date,
      period_covered: parsed.data.period_covered,
      chaired_by: parsed.data.chaired_by,
      status: 'draft',
      created_by: profile.id,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  const { error: inputsError } = await supabase
    .from('management_review_inputs')
    .insert(
      MGMT_REVIEW_INPUT_KEYS.map((key) => ({
        review_id: row.id,
        input_key: key,
        data: snapshots[key],
      }))
    )
  if (inputsError) {
    // Don't leave a half-seeded review behind (admin-only RLS delete would
    // strand it for office users — remove the shell we just created).
    await supabase.from('management_reviews').delete().eq('id', row.id)
    return { error: `Review inputs could not be seeded: ${inputsError.message}` }
  }

  revalidateReviews(row.id)
  return { id: row.id }
}

// ─── Header / minutes ─────────────────────────────────────────────────────────

export async function updateReview(reviewId: string, data: unknown): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = mgmtReviewUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const review = await loadReview(supabase, reviewId)
  if (!review) return { error: 'Review not found' }
  if (review.status === 'closed') {
    return { error: 'Cannot edit a closed management review' }
  }

  const { data: updated, error } = await supabase
    .from('management_reviews')
    .update(parsed.data)
    .eq('id', reviewId)
    .select('id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Update was not applied (no permission)' }
  }

  revalidateReviews(reviewId)
  return {}
}

// ─── Close (SOFT gate) / reopen ───────────────────────────────────────────────

export async function closeReview(
  reviewId: string,
  data: unknown
): Promise<{
  error?: string
  /** The exact inputs still un-reviewed — the UI lists them in the confirm. */
  unreviewed?: { key: MgmtReviewInputKey; label: string }[]
}> {
  await requireRole('admin', 'office')

  const parsed = mgmtReviewCloseSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const review = await loadReview(supabase, reviewId)
  if (!review) return { error: 'Review not found' }
  if (review.status === 'closed') return { error: 'Review is already closed' }

  // ── SOFT completion guard: un-reviewed inputs need an explicit confirm.
  //    NEVER blocks on open output actions — they live on in the tracker. ──
  const { data: inputRows, error: inputsError } = await supabase
    .from('management_review_inputs')
    .select('input_key, reviewed')
    .eq('review_id', reviewId)
    .eq('reviewed', false)
  if (inputsError) return { error: inputsError.message }

  const unreviewed = (inputRows ?? [])
    .map((r) => r.input_key as MgmtReviewInputKey)
    .sort(
      (a, b) => MGMT_REVIEW_INPUT_KEYS.indexOf(a) - MGMT_REVIEW_INPUT_KEYS.indexOf(b)
    )
    .map((key) => ({ key, label: MGMT_REVIEW_INPUT_DEFS[key]?.label ?? key }))

  const gateError = mgmtReviewCloseError(
    unreviewed.map((u) => u.label),
    parsed.data.confirm
  )
  if (gateError) return { error: gateError, unreviewed }

  const { data: updated, error } = await supabase
    .from('management_reviews')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', reviewId)
    .select('id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Close was not applied (no permission)' }
  }

  revalidateReviews(reviewId)
  return {}
}

export async function reopenReview(reviewId: string): Promise<Result> {
  // Reopening a closed review is admin-only (it un-freezes the minutes).
  await requireRole('admin')

  const supabase = await createClient()

  const review = await loadReview(supabase, reviewId)
  if (!review) return { error: 'Review not found' }
  if (review.status !== 'closed') return { error: 'Review is not closed' }

  const { data: updated, error } = await supabase
    .from('management_reviews')
    .update({ status: 'in_progress', closed_at: null })
    .eq('id', reviewId)
    .select('id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Reopen was not applied (no permission)' }
  }

  revalidateReviews(reviewId)
  return {}
}

export async function deleteReview(reviewId: string): Promise<Result> {
  await requireRole('admin')

  const supabase = await createClient()

  const review = await loadReview(supabase, reviewId)
  if (!review) return { error: 'Review not found' }
  if (review.status === 'closed') {
    return { error: 'A closed management review is a permanent record — reopen it first if it truly must be deleted' }
  }

  const { error } = await supabase
    .from('management_reviews')
    .delete()
    .eq('id', reviewId)
  if (error) return { error: error.message }

  revalidateReviews()
  return {}
}

// ─── Inputs (RAG / minute / reviewed + snapshot refresh) ──────────────────────

export async function updateReviewInput(
  inputId: string,
  reviewId: string,
  data: unknown
): Promise<Result> {
  const profile = await requireRole('admin', 'office')

  const parsed = mgmtReviewInputUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const review = await loadReview(supabase, reviewId)
  if (!review) return { error: 'Review not found' }
  if (review.status === 'closed') {
    return { error: 'This review is closed — its inputs are frozen' }
  }

  const update: Record<string, unknown> = {}
  if (parsed.data.rag !== undefined) update.rag = parsed.data.rag
  if (parsed.data.minute !== undefined) update.minute = parsed.data.minute
  if (parsed.data.reviewed !== undefined) {
    update.reviewed = parsed.data.reviewed
    update.reviewed_by = parsed.data.reviewed ? profile.id : null
    update.reviewed_at = parsed.data.reviewed ? new Date().toISOString() : null
  }
  if (Object.keys(update).length === 0) return { error: 'Nothing to update' }

  const { data: updated, error } = await supabase
    .from('management_review_inputs')
    .update(update)
    .eq('id', inputId)
    .eq('review_id', reviewId)
    .select('id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Update was not applied (no permission)' }
  }

  // Working an input moves a draft review into progress.
  if (review.status === 'draft') {
    await supabase
      .from('management_reviews')
      .update({ status: 'in_progress' })
      .eq('id', reviewId)
      .eq('status', 'draft')
  }

  revalidateReviews(reviewId)
  return {}
}

export async function refreshReviewInputData(
  inputId: string,
  reviewId: string
): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()

  const review = await loadReview(supabase, reviewId)
  if (!review) return { error: 'Review not found' }
  if (review.status === 'closed') {
    return { error: 'This review is closed — its data snapshots are frozen evidence' }
  }

  const { data: input } = await supabase
    .from('management_review_inputs')
    .select('id, input_key')
    .eq('id', inputId)
    .eq('review_id', reviewId)
    .single()
  if (!input) return { error: 'Input not found' }

  const key = input.input_key as MgmtReviewInputKey
  if (!MGMT_REVIEW_INPUT_DEFS[key]?.auto) {
    return { error: 'This input has no auto-pulled data — record it in the minute' }
  }

  let snapshot
  try {
    snapshot = await buildInputSnapshot(supabase, key, reviewId)
  } catch (err) {
    return {
      error: `Could not pull the register data: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const { data: updated, error } = await supabase
    .from('management_review_inputs')
    .update({ data: snapshot })
    .eq('id', inputId)
    .eq('review_id', reviewId)
    .select('id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Refresh was not applied (no permission)' }
  }

  revalidateReviews(reviewId)
  return {}
}

// ─── Attendees ────────────────────────────────────────────────────────────────

export async function addAttendee(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  await requireRole('admin', 'office')

  const parsed = mgmtReviewAttendeeSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const review = await loadReview(supabase, parsed.data.review_id)
  if (!review) return { error: 'Review not found' }
  if (review.status === 'closed') {
    return { error: 'This review is closed — its attendee record is frozen' }
  }

  const { data: row, error } = await supabase
    .from('management_review_attendees')
    .insert({
      review_id: parsed.data.review_id,
      profile_id: parsed.data.profile_id,
      name: parsed.data.name,
      role_title: parsed.data.role_title,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  revalidateReviews(parsed.data.review_id)
  return { id: row.id }
}

export async function removeAttendee(
  attendeeId: string,
  reviewId: string
): Promise<Result> {
  // RLS only allows admins to delete.
  await requireRole('admin')

  const supabase = await createClient()

  const review = await loadReview(supabase, reviewId)
  if (!review) return { error: 'Review not found' }
  if (review.status === 'closed') {
    return { error: 'This review is closed — its attendee record is frozen' }
  }

  const { error } = await supabase
    .from('management_review_attendees')
    .delete()
    .eq('id', attendeeId)
    .eq('review_id', reviewId)
  if (error) return { error: error.message }

  revalidateReviews(reviewId)
  return {}
}

// ─── Output actions (the tracker — lives on after close) ─────────────────────

export async function createReviewAction(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  await requireRole('admin', 'office')

  const parsed = mgmtReviewActionSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const review = await loadReview(supabase, parsed.data.review_id)
  if (!review) return { error: 'Review not found' }
  if (review.status === 'closed') {
    return {
      error:
        'This review is closed — its decisions are minuted. Raise new actions in the next review.',
    }
  }

  const { data: row, error } = await supabase
    .from('management_review_actions')
    .insert({
      review_id: parsed.data.review_id,
      description: parsed.data.description,
      assigned_to: parsed.data.assigned_to,
      due_date: parsed.data.due_date,
      status: 'open',
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  revalidateReviews(parsed.data.review_id)
  return { id: row.id }
}

export async function updateReviewAction(
  actionId: string,
  reviewId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = mgmtReviewActionUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const review = await loadReview(supabase, reviewId)
  if (!review) return { error: 'Review not found' }
  // Once closed, the minuted decision text/owner/due date is locked — only
  // completion status may change (setReviewActionDone below).
  if (review.status === 'closed') {
    return {
      error:
        'This review is closed — the minuted action is locked. You can still mark it done.',
    }
  }

  const { data: updated, error } = await supabase
    .from('management_review_actions')
    .update(parsed.data)
    .eq('id', actionId)
    .eq('review_id', reviewId)
    .select('id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Update was not applied (no permission)' }
  }

  revalidateReviews(reviewId)
  return {}
}

/** Completing (or reopening) an output action is allowed even on a CLOSED
 *  review — the tracker is meant to live on after the meeting. */
export async function setReviewActionDone(
  actionId: string,
  reviewId: string,
  done: boolean
): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()

  const { data: updated, error } = await supabase
    .from('management_review_actions')
    .update(
      done
        ? { status: 'done', completed_at: new Date().toISOString() }
        : { status: 'open', completed_at: null }
    )
    .eq('id', actionId)
    .eq('review_id', reviewId)
    .select('id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Update was not applied (no permission)' }
  }

  revalidateReviews(reviewId)
  return {}
}

export async function deleteReviewAction(
  actionId: string,
  reviewId: string
): Promise<Result> {
  // RLS only allows admins to delete.
  await requireRole('admin')

  const supabase = await createClient()

  const review = await loadReview(supabase, reviewId)
  if (!review) return { error: 'Review not found' }
  if (review.status === 'closed') {
    return { error: 'This review is closed — its minuted decisions cannot be deleted' }
  }

  const { error } = await supabase
    .from('management_review_actions')
    .delete()
    .eq('id', actionId)
    .eq('review_id', reviewId)
  if (error) return { error: error.message }

  revalidateReviews(reviewId)
  return {}
}
