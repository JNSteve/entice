// Server-side training & competency queries (ISO 7.2), shared by the WHS
// training register, the WHS overview "Needs attention" card, the schedule
// assignment warning hook and the PDF exports. Status is DERIVED at read time
// against the AU (Brisbane) calendar day the caller passes in (todayAU()).

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  deriveCompetencyStatus,
  latestRecords,
  workerTypeKey,
  type CompetencyRecordLike,
} from '@/lib/competency'
import { fmtDate } from '@/lib/format'

const RECORD_COLUMNS =
  'id, worker_id, competency_type_id, issue_date, expiry_date, superseded_by, created_at'

type RequirementRow = {
  competency_type_id: string
  is_mandatory: boolean
  competency_types: { name: string; active: boolean } | null
}

/**
 * Non-blocking roster warning: the mandatory competencies for the person's
 * role that are missing, expired, or expiring within 30 days. Returns [] when
 * the person has no worker row or everything mandatory is current. Never
 * throws for data problems — a warning must not break assigning.
 */
export async function competencyWarningsForProfile(
  supabase: SupabaseClient,
  profileId: string,
  today: string
): Promise<string[]> {
  const { data: worker } = await supabase
    .from('workers')
    .select('id, role')
    .eq('profile_id', profileId)
    .maybeSingle()
  if (!worker) return []

  const [{ data: reqs }, { data: records }] = await Promise.all([
    supabase
      .from('role_competency_requirements')
      .select('competency_type_id, is_mandatory, competency_types(name, active)')
      .eq('role', worker.role as string)
      .eq('is_mandatory', true),
    supabase
      .from('competency_records')
      .select(RECORD_COLUMNS)
      .eq('worker_id', worker.id as string)
      .is('superseded_by', null),
  ])

  const latest = latestRecords((records ?? []) as CompetencyRecordLike[])
  const items: string[] = []

  for (const req of (reqs ?? []) as unknown as RequirementRow[]) {
    const type = req.competency_types
    if (!type || type.active === false) continue
    const rec = latest.get(
      workerTypeKey(worker.id as string, req.competency_type_id)
    )
    if (!rec) {
      items.push(`${type.name} — no record on file`)
      continue
    }
    const status = deriveCompetencyStatus(rec.expiry_date, today)
    if (status === 'expired') {
      items.push(`${type.name} — expired ${fmtDate(rec.expiry_date)}`)
    } else if (status === 'expiring') {
      items.push(`${type.name} — expires ${fmtDate(rec.expiry_date)}`)
    }
  }

  return items
}

// ─── WHS overview "Needs attention" rows ──────────────────────────────────────

export type CompetencyAttentionRow = {
  recordId: string
  workerId: string
  workerName: string
  typeName: string
  expiry: string
  status: 'expired' | 'expiring'
}

/**
 * Mandatory competencies (per the holder's role) that are expired or expiring
 * within 30 days, for ACTIVE workers, based on the latest non-superseded
 * record per (worker, type). Missing records are surfaced on the matrix, not
 * here — the card highlights lapsing evidence, sorted soonest-expiry first.
 */
export async function fetchCompetencyAttention(
  supabase: SupabaseClient,
  today: string
): Promise<CompetencyAttentionRow[]> {
  const [{ data: workers }, { data: reqs }, { data: records }] =
    await Promise.all([
      supabase.from('workers').select('id, name, role').eq('active', true),
      supabase
        .from('role_competency_requirements')
        .select('role, competency_type_id, is_mandatory, competency_types(name, active)')
        .eq('is_mandatory', true),
      supabase
        .from('competency_records')
        .select(RECORD_COLUMNS)
        .is('superseded_by', null)
        .not('expiry_date', 'is', null),
    ])

  const workerById = new Map(
    (workers ?? []).map((w) => [w.id as string, w as { id: string; name: string; role: string }])
  )

  const mandatory = new Set<string>()
  const typeNameById = new Map<string, string>()
  for (const r of (reqs ?? []) as unknown as (RequirementRow & { role: string })[]) {
    const type = r.competency_types
    if (!type || type.active === false) continue
    mandatory.add(`${r.role}::${r.competency_type_id}`)
    typeNameById.set(r.competency_type_id, type.name)
  }

  const latest = latestRecords((records ?? []) as CompetencyRecordLike[])
  const rows: CompetencyAttentionRow[] = []

  for (const rec of latest.values()) {
    const worker = workerById.get(rec.worker_id)
    if (!worker) continue // inactive worker or RLS-filtered
    if (!mandatory.has(`${worker.role}::${rec.competency_type_id}`)) continue
    const status = deriveCompetencyStatus(rec.expiry_date, today)
    if (status === 'current') continue
    rows.push({
      recordId: rec.id,
      workerId: rec.worker_id,
      workerName: worker.name,
      typeName: typeNameById.get(rec.competency_type_id) ?? 'Competency',
      expiry: rec.expiry_date as string,
      status,
    })
  }

  rows.sort((a, b) => a.expiry.localeCompare(b.expiry))
  return rows
}
