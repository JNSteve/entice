'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { nextNumber } from '@/lib/numbering'
import {
  legalObligationCreateSchema,
  legalObligationUpdateSchema,
  recordEvaluationSchema,
} from '@/lib/zod'

type Result = { error?: string }

function revalidateLegal(obligationId?: string) {
  revalidatePath('/whs/legal')
  revalidatePath('/whs')
  if (obligationId) revalidatePath(`/whs/legal/${obligationId}`)
}

// NOTE ON current_compliance: the column is DERIVED. The DB recompute trigger
// (AFTER INSERT/DELETE on compliance_evaluations) is the only writer, and a
// BEFORE INSERT/UPDATE guard on legal_obligations rejects any other value.
// No schema in src/lib/zod.ts even carries the field, so nothing here can
// pass it through — belt (schema) and braces (DB guard).

// ─── Create obligation (admin/office) ─────────────────────────────────────────

export async function createObligation(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin', 'office')

  const parsed = legalObligationCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const number = await nextNumber(supabase, 'legal_obligation').catch((err) => {
    throw new Error(`Failed to get next obligation number: ${err.message}`)
  })

  const { data: row, error } = await supabase
    .from('legal_obligations')
    .insert({
      number,
      title: parsed.data.title,
      category: parsed.data.category,
      jurisdiction: parsed.data.jurisdiction,
      iso_domain: parsed.data.iso_domain,
      summary: parsed.data.summary,
      how_it_applies: parsed.data.how_it_applies,
      how_we_comply: parsed.data.how_we_comply,
      controlling_document_id: parsed.data.controlling_document_id,
      responsible_id: parsed.data.responsible_id,
      review_frequency_months: parsed.data.review_frequency_months,
      next_review_date: parsed.data.next_review_date,
      status: 'active',
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidateLegal(row.id)
  return { id: row.id }
}

// ─── Update obligation fields (admin/office; not while retired) ───────────────

export async function updateObligation(
  obligationId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = legalObligationUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('legal_obligations')
    .select('id, status')
    .eq('id', obligationId)
    .single()
  if (!existing) return { error: 'Obligation not found' }
  if (existing.status === 'retired') {
    return { error: 'Cannot edit a retired obligation — reactivate it first' }
  }

  const { data: updated, error } = await supabase
    .from('legal_obligations')
    .update(parsed.data)
    .eq('id', obligationId)
    .select('id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Update was not applied (no permission)' }
  }

  revalidateLegal(obligationId)
  return {}
}

// ─── Retire / reactivate (retire, never delete — the audit history stays) ─────

export async function retireObligation(obligationId: string): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('legal_obligations')
    .select('id, status')
    .eq('id', obligationId)
    .single()
  if (!existing) return { error: 'Obligation not found' }
  if (existing.status === 'retired') return { error: 'Already retired' }

  const { data: updated, error } = await supabase
    .from('legal_obligations')
    .update({ status: 'retired' })
    .eq('id', obligationId)
    .select('id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Update was not applied (no permission)' }
  }

  revalidateLegal(obligationId)
  return {}
}

/** Reactivate is admin-only — mirrors the register reopen conventions. */
export async function reactivateObligation(obligationId: string): Promise<Result> {
  await requireRole('admin')

  const supabase = await createClient()

  const { data: updated, error } = await supabase
    .from('legal_obligations')
    .update({ status: 'active' })
    .eq('id', obligationId)
    .eq('status', 'retired')
    .select('id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'Obligation not found or not retired' }
  }

  revalidateLegal(obligationId)
  return {}
}

// ─── Delete (admin only — retire is the normal path) ──────────────────────────

export async function deleteObligation(obligationId: string): Promise<Result> {
  await requireRole('admin')

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('legal_obligations')
    .select('id')
    .eq('id', obligationId)
    .single()
  if (!existing) return { error: 'Obligation not found' }

  const { error } = await supabase
    .from('legal_obligations')
    .delete()
    .eq('id', obligationId)
  if (error) return { error: error.message }

  revalidateLegal()
  return {}
}

// ─── Record a compliance evaluation (admin/office/supervisor) ─────────────────
//
// ALWAYS a new row — compliance_evaluations has no UPDATE policy and no edit
// action exists (locked decision). On a 'gap' verdict the evaluation must
// escalate into the NCR/CAPA spine: link an existing NCR or raise a new one
// (source 'legal_compliance', category 'Legal compliance', description
// prefilled from the obligation). The DB trigger then flips the parent's
// current_compliance and advances next_review_date.

export async function recordEvaluation(
  data: unknown
): Promise<{ error?: string; id?: string; ncrId?: string }> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = recordEvaluationSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: obligation } = await supabase
    .from('legal_obligations')
    .select('id, number, title, status, summary, how_it_applies')
    .eq('id', parsed.data.obligation_id)
    .single()
  if (!obligation) return { error: 'Obligation not found' }
  if (obligation.status === 'retired') {
    return { error: 'Cannot evaluate a retired obligation' }
  }

  let ncrId: string | null = parsed.data.ncr_id
  let ncrNumber: string | null = null

  if (parsed.data.verdict === 'gap') {
    if (ncrId) {
      // Link an existing NCR — verify it exists and is not closed.
      const { data: ncr } = await supabase
        .from('ncrs')
        .select('id, number, status')
        .eq('id', ncrId)
        .single()
      if (!ncr) return { error: 'Linked NCR not found' }
      if (ncr.status === 'closed') {
        return { error: `${ncr.number} is closed — link an open NCR or raise a new one` }
      }
      ncrNumber = ncr.number as string
    } else {
      // Raise a new NCR from the gap.
      const number = await nextNumber(supabase, 'ncr').catch((err) => {
        throw new Error(`Failed to get next NCR number: ${err.message}`)
      })

      const descriptionParts = [
        `Compliance evaluation on ${parsed.data.evaluated_on} found a gap against ${obligation.number} — ${obligation.title}.`,
        obligation.summary ? `Requirement: ${obligation.summary}` : null,
        obligation.how_it_applies
          ? `How it applies: ${obligation.how_it_applies}`
          : null,
        parsed.data.notes ? `Evaluation notes: ${parsed.data.notes}` : null,
      ].filter(Boolean)

      const { data: ncr, error: ncrError } = await supabase
        .from('ncrs')
        .insert({
          number,
          source: 'legal_compliance',
          category: 'Legal compliance',
          severity: parsed.data.ncr_severity,
          title: `Compliance gap — ${obligation.number}: ${obligation.title}`,
          description: descriptionParts.join('\n\n'),
          raised_by: profile.id,
          occurred_on: parsed.data.evaluated_on,
          status: 'open',
        })
        .select('id, number')
        .single()
      if (ncrError) return { error: ncrError.message }
      ncrId = ncr.id as string
      ncrNumber = ncr.number as string
    }
  }

  const { data: row, error } = await supabase
    .from('compliance_evaluations')
    .insert({
      obligation_id: parsed.data.obligation_id,
      evaluated_on: parsed.data.evaluated_on,
      evaluator_id: profile.id,
      verdict: parsed.data.verdict,
      notes: parsed.data.notes,
      ncr_id: parsed.data.verdict === 'gap' ? ncrId : null,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error) {
    if (ncrNumber && parsed.data.create_ncr) {
      return {
        error: `NCR ${ncrNumber} was raised but recording the evaluation failed: ${error.message}`,
      }
    }
    return { error: error.message }
  }

  revalidateLegal(parsed.data.obligation_id)
  revalidatePath('/whs/ncr')
  return { id: row.id, ncrId: ncrId ?? undefined }
}
