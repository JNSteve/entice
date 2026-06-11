import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { round2 } from '@/lib/money'
import { ClaimEditor, type ClaimLineRow } from './claim-editor'

export default async function ProjectClaimDetailPage({
  params,
}: {
  params: Promise<{ id: string; claimId: string }>
}) {
  await requireRole('admin', 'office')

  const { id: projectId, claimId } = await params
  const supabase = await createClient()

  const [
    { data: claim },
    { data: claimLines },
    { data: project },
    { data: budgetLines },
    { data: variations },
    { data: retentionEntries },
  ] = await Promise.all([
    supabase
      .from('claims')
      .select(
        `id, number, status, reference_date, gst_rate,
         gross_this_claim, retention_this_claim, subtotal, gst, total_inc_gst,
         total_claimed_to_date, submitted_at, certified_amount, certified_at,
         schedule_received_at, paid_at`
      )
      .eq('id', claimId)
      .eq('project_id', projectId)
      .single(),
    supabase
      .from('claim_lines')
      .select(
        'id, source_type, source_id, description, line_value, pct_complete, previous_claimed, claimed_to_date, this_claim'
      )
      .eq('claim_id', claimId),
    supabase
      .from('projects')
      .select('id, contract_sum, retention_pct, retention_cap_pct')
      .eq('id', projectId)
      .single(),
    supabase
      .from('budget_lines')
      .select('id, position')
      .eq('project_id', projectId)
      .order('position'),
    supabase
      .from('variations')
      .select('id, number, sell_amount, status')
      .eq('project_id', projectId),
    supabase
      .from('retention_entries')
      .select('kind, amount, claim_id')
      .eq('project_id', projectId),
  ])

  if (!claim || !project) notFound()

  // Retention basis: adjusted contract sum = base + approved variations.
  const adjustedContractSum = round2(
    Number(project.contract_sum) +
      (variations ?? [])
        .filter((v) => v.status === 'approved')
        .reduce((s, v) => s + Number(v.sell_amount), 0)
  )

  // Retention held before this claim — excludes this claim's own entry so the
  // running position reads correctly on submitted+ claims too.
  const previouslyWithheld = round2(
    (retentionEntries ?? [])
      .filter((e) => e.claim_id !== claimId)
      .reduce(
        (s, e) => s + (e.kind === 'withheld' ? Number(e.amount) : -Number(e.amount)),
        0
      )
  )

  // Deterministic ordering: budget lines by budget position, then variations
  // by VO number; orphaned sources sink to the end of their group.
  const budgetPos = new Map((budgetLines ?? []).map((b, i) => [b.id as string, i]))
  const voNum = new Map((variations ?? []).map((v) => [v.id as string, v.number as number]))
  const orderKey = (l: { source_type: string; source_id: string }) =>
    l.source_type === 'budget_line'
      ? (budgetPos.get(l.source_id) ?? Number.MAX_SAFE_INTEGER)
      : (voNum.get(l.source_id) ?? Number.MAX_SAFE_INTEGER)

  const lines: ClaimLineRow[] = (claimLines ?? [])
    .map((l) => ({
      id: l.id as string,
      source_type: l.source_type as 'budget_line' | 'variation',
      source_id: l.source_id as string,
      description: l.description as string,
      line_value: Number(l.line_value),
      pct_complete: Number(l.pct_complete),
      previous_claimed: Number(l.previous_claimed),
    }))
    .sort((a, b) => {
      if (a.source_type !== b.source_type) {
        return a.source_type === 'budget_line' ? -1 : 1
      }
      return orderKey(a) - orderKey(b) || a.description.localeCompare(b.description)
    })

  return (
    <ClaimEditor
      projectId={projectId}
      claim={{
        id: claim.id,
        number: claim.number,
        status: claim.status,
        reference_date: claim.reference_date,
        gst_rate: Number(claim.gst_rate),
        gross_this_claim: claim.gross_this_claim != null ? Number(claim.gross_this_claim) : null,
        retention_this_claim:
          claim.retention_this_claim != null ? Number(claim.retention_this_claim) : null,
        subtotal: claim.subtotal != null ? Number(claim.subtotal) : null,
        gst: claim.gst != null ? Number(claim.gst) : null,
        total_inc_gst: claim.total_inc_gst != null ? Number(claim.total_inc_gst) : null,
        total_claimed_to_date:
          claim.total_claimed_to_date != null ? Number(claim.total_claimed_to_date) : null,
        submitted_at: claim.submitted_at,
        certified_amount: claim.certified_amount != null ? Number(claim.certified_amount) : null,
        certified_at: claim.certified_at,
        schedule_received_at: claim.schedule_received_at,
        paid_at: claim.paid_at,
      }}
      lines={lines}
      retention={{
        pctPerClaim: Number(project.retention_pct),
        capPct: Number(project.retention_cap_pct),
        contractSum: adjustedContractSum,
        previouslyWithheld,
      }}
    />
  )
}
