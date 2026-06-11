import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { computeClaim, type ClaimLineInput } from '@/lib/claims'
import { round2 } from '@/lib/money'
import { ClaimsTable, NewClaimButton, type ClaimRow } from './claims-table'

export default async function ProjectClaimsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('admin', 'office')

  const { id } = await params
  const supabase = await createClient()

  const [{ data: project }, { data: claims }, { data: approvedVos }, { data: retentionEntries }] =
    await Promise.all([
      supabase
        .from('projects')
        .select('id, status, contract_sum, retention_pct, retention_cap_pct')
        .eq('id', id)
        .single(),
      supabase
        .from('claims')
        .select(
          `id, number, status, reference_date, gst_rate, subtotal, total_claimed_to_date,
           total_inc_gst, certified_amount, submitted_at, paid_at,
           claim_lines(source_type, source_id, description, line_value, pct_complete, previous_claimed)`
        )
        .eq('project_id', id)
        .order('number', { ascending: false }),
      supabase
        .from('variations')
        .select('sell_amount')
        .eq('project_id', id)
        .eq('status', 'approved'),
      supabase
        .from('retention_entries')
        .select('kind, amount')
        .eq('project_id', id),
    ])

  if (!project) notFound()

  const adjustedSum = round2(
    Number(project.contract_sum) +
      (approvedVos ?? []).reduce((s, v) => s + Number(v.sell_amount), 0)
  )
  const previouslyWithheld = round2(
    (retentionEntries ?? []).reduce(
      (s, e) => s + (e.kind === 'withheld' ? Number(e.amount) : -Number(e.amount)),
      0
    )
  )

  const rows: ClaimRow[] = (claims ?? []).map((c) => {
    let subtotal = c.subtotal != null ? Number(c.subtotal) : null
    let claimedToDate =
      c.total_claimed_to_date != null ? Number(c.total_claimed_to_date) : null

    // Draft claims have no snapshot totals — compute live via the engine.
    if (c.status === 'draft') {
      const inputs: ClaimLineInput[] = (
        (c.claim_lines ?? []) as Array<{
          source_type: string
          source_id: string
          description: string
          line_value: number
          pct_complete: number
          previous_claimed: number
        }>
      ).map((l) => ({
        sourceType: l.source_type as 'budget_line' | 'variation',
        sourceId: l.source_id,
        description: l.description,
        lineValue: Number(l.line_value),
        pctComplete: Number(l.pct_complete),
        previousClaimed: Number(l.previous_claimed),
      }))
      const result = computeClaim(
        inputs,
        {
          pctPerClaim: Number(project.retention_pct),
          capPct: Number(project.retention_cap_pct),
          contractSum: adjustedSum,
          previouslyWithheld,
        },
        Number(c.gst_rate)
      )
      subtotal = result.subtotal
      claimedToDate = result.totalClaimedToDate
    }

    return {
      id: c.id,
      number: c.number,
      status: c.status,
      reference_date: c.reference_date,
      subtotal,
      claimed_to_date: claimedToDate,
      total_inc_gst: c.total_inc_gst != null ? Number(c.total_inc_gst) : null,
      certified_amount: c.certified_amount != null ? Number(c.certified_amount) : null,
      submitted_at: c.submitted_at,
      paid_at: c.paid_at,
    }
  })

  const hasDraft = rows.some((r) => r.status === 'draft')
  const projectClosed = project.status === 'closed'
  const disabledReason = projectClosed
    ? 'Project is closed — no further claims can be raised'
    : hasDraft
      ? 'A draft claim already exists — submit it before starting a new one'
      : null

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Progress claims</h2>
        <NewClaimButton projectId={id} disabledReason={disabledReason} />
      </div>
      <ClaimsTable projectId={id} claims={rows} />
    </section>
  )
}
