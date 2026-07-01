import type { SupabaseClient } from '@supabase/supabase-js'
import { computeClaim, type ClaimLineInput, type ClaimResult } from './claims'
import { round2, round6 } from './money'

/**
 * Data-access layer for progress-claim computations. Every claim figure comes
 * from the tested engine in ./claims — nothing is re-derived inline. Shared by
 * the claim server actions and the live verification harness.
 */

// Loose-typed client: works with both the SSR cookie client and service-role client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

/** Statuses whose claim_lines count as "previously claimed" for the next claim. */
export const CLAIM_LOCKED_STATUSES = ['submitted', 'certified', 'paid'] as const

/**
 * Per-line claim figures via the engine. Retention rules do not affect
 * per-line outputs, so zeros are passed.
 */
export function computeLine(
  lineValue: number,
  pctComplete: number,
  previousClaimed: number
): { claimedToDate: number; thisClaim: number } {
  const r = computeClaim(
    [{ sourceType: 'budget_line', sourceId: '-', description: '', lineValue, pctComplete, previousClaimed }],
    { pctPerClaim: 0, capPct: 0, contractSum: 0, previouslyWithheld: 0 },
    0
  )
  return { claimedToDate: r.lines[0].claimedToDate, thisClaim: r.lines[0].thisClaim }
}

export type SnapshotLine = {
  source_type: 'budget_line' | 'variation'
  source_id: string
  description: string
  line_value: number
  pct_complete: number
  previous_claimed: number
  claimed_to_date: number
  this_claim: number
}

/**
 * Builds the claim-line snapshot for a project: one line per budget line plus
 * one per APPROVED variation. previous_claimed per source comes from the most
 * recent prior claim with status submitted/certified/paid; pct_complete is
 * initialised so claimed_to_date equals previous_claimed.
 */
export async function buildSnapshotLines(
  supabase: Db,
  projectId: string,
  excludeClaimId?: string
): Promise<SnapshotLine[]> {
  const [{ data: budgetLines }, { data: variations }] = await Promise.all([
    supabase
      .from('budget_lines')
      .select('id, description, budget_amount, position')
      .eq('project_id', projectId)
      .order('position')
      .order('id'),
    supabase
      .from('variations')
      .select('id, number, title, sell_amount')
      .eq('project_id', projectId)
      .eq('status', 'approved')
      .order('number'),
  ])

  // Most recent prior claim whose lines lock in "previously claimed".
  let priorQuery = supabase
    .from('claims')
    .select('id, number')
    .eq('project_id', projectId)
    .in('status', [...CLAIM_LOCKED_STATUSES])
    .order('number', { ascending: false })
    .limit(1)
  if (excludeClaimId) priorQuery = priorQuery.neq('id', excludeClaimId)
  const { data: prior } = await priorQuery.maybeSingle()

  const previousBySource = new Map<string, number>()
  if (prior) {
    const { data: priorLines } = await supabase
      .from('claim_lines')
      .select('source_type, source_id, claimed_to_date')
      .eq('claim_id', prior.id)
    for (const l of priorLines ?? []) {
      previousBySource.set(`${l.source_type}:${l.source_id}`, Number(l.claimed_to_date))
    }
  }

  const sources: Array<{
    source_type: 'budget_line' | 'variation'
    source_id: string
    description: string
    line_value: number
  }> = [
    ...(budgetLines ?? []).map((b) => ({
      source_type: 'budget_line' as const,
      source_id: b.id as string,
      description: b.description as string,
      line_value: Number(b.budget_amount),
    })),
    ...(variations ?? []).map((v) => ({
      source_type: 'variation' as const,
      source_id: v.id as string,
      description: `V${v.number} — ${v.title}`,
      line_value: Number(v.sell_amount),
    })),
  ]

  return sources.map((s) => {
    const previous = previousBySource.get(`${s.source_type}:${s.source_id}`) ?? 0
    // 6dp so the initialised pct reproduces previous_claimed exactly on large
    // lines (claimed_to_date = round2(line_value * pct / 100)).
    const pct =
      s.line_value > 0 ? Math.min(round6((previous / s.line_value) * 100), 100) : 0
    const { claimedToDate, thisClaim } = computeLine(s.line_value, pct, previous)
    return {
      ...s,
      pct_complete: pct,
      previous_claimed: previous,
      claimed_to_date: claimedToDate,
      this_claim: thisClaim,
    }
  })
}

export type ClaimComputation =
  | { error: string }
  | { error?: undefined; lineIds: string[]; result: ClaimResult }

/**
 * Fetches a claim's lines and the project's retention position, then computes
 * the full claim via the engine. Retention basis is the ADJUSTED contract sum
 * (base + approved VOs) — the cap grows with approved variations. The claim's
 * own retention entries are excluded from "previously withheld".
 */
export async function computeClaimTotals(
  supabase: Db,
  claimId: string,
  projectId: string,
  gstRate: number
): Promise<ClaimComputation> {
  const [{ data: project }, { data: lines }, { data: approvedVos }, { data: retentionEntries }] =
    await Promise.all([
      supabase
        .from('projects')
        .select('contract_sum, retention_pct, retention_cap_pct')
        .eq('id', projectId)
        .single(),
      supabase
        .from('claim_lines')
        .select('id, source_type, source_id, description, line_value, pct_complete, previous_claimed')
        .eq('claim_id', claimId),
      supabase
        .from('variations')
        .select('sell_amount')
        .eq('project_id', projectId)
        .eq('status', 'approved'),
      supabase
        .from('retention_entries')
        .select('kind, amount, claim_id')
        .eq('project_id', projectId),
    ])
  if (!project) return { error: 'Project not found' }
  if (!lines || lines.length === 0) return { error: 'Claim has no lines' }

  const adjustedSum = round2(
    Number(project.contract_sum) +
      (approvedVos ?? []).reduce((s, v) => s + Number(v.sell_amount), 0)
  )
  const previouslyWithheld = round2(
    (retentionEntries ?? [])
      .filter((e) => e.claim_id !== claimId)
      .reduce(
        (s, e) => s + (e.kind === 'withheld' ? Number(e.amount) : -Number(e.amount)),
        0
      )
  )

  const inputs: ClaimLineInput[] = lines.map((l) => ({
    sourceType: l.source_type as 'budget_line' | 'variation',
    sourceId: l.source_id as string,
    description: l.description as string,
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
    gstRate
  )

  return { lineIds: lines.map((l) => l.id as string), result }
}
