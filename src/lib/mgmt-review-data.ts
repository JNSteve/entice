// Management Review (ISO 9.3) — the server-side auto-pull engine. On review
// creation (and per-input "Refresh data" while draft/in_progress) it computes
// a COMPACT jsonb snapshot per auto-pullable 9.3.2 input from the live
// registers this module CONSUMES (never owns): NCRs/CAPA, incidents, audits/
// findings, objectives/KPI values, risk items, controlled documents, vendor
// compliance, competency records and form submissions/sign-ons.
//
// The snapshot is FROZEN EVIDENCE: it is stored on the input row and never
// refreshed once the review closes (enforced in the server action AND by the
// mgmt_review_child_guard DB trigger). Every snapshot shares one shape —
// window + headline figures + an optional small row list — so the checklist
// UI and the Management Review Report PDF render all thirteen uniformly.
//
// Window: since the previous CLOSED review's review_date, else the trailing
// 12 months. All date maths is Brisbane-calendar (src/lib/tz.ts).

import type { SupabaseClient } from '@supabase/supabase-js'
import { todayAU } from '@/lib/tz'
import {
  MGMT_REVIEW_INPUT_KEYS,
  MGMT_REVIEW_INPUT_DEFS,
  type MgmtReviewInputKey,
} from '@/lib/mgmt-review'
import { deriveObjectiveStatus, OBJECTIVE_TRAFFIC_LABELS } from '@/lib/objectives'
import { latestKpiValue } from '@/lib/objective-queries'
import {
  deriveCompetencyStatus,
  latestRecords,
  workerTypeKey,
  type CompetencyRecordLike,
} from '@/lib/competency'
import type { ObjectiveDirection } from '@/lib/zod'

type Supabase = SupabaseClient

// ─── Snapshot shape ───────────────────────────────────────────────────────────

export type SnapshotFigure = { label: string; value: string }

export type SnapshotRow = {
  label: string
  value: string
  /** Optional severity accent for the UI/PDF (red = needs attention). */
  flag?: 'red' | 'amber' | 'green'
}

export type InputSnapshot = {
  window: {
    /** 'YYYY-MM-DD' inclusive start of the reporting window. */
    start: string
    /** 'YYYY-MM-DD' inclusive end (the AU day the snapshot was taken). */
    end: string
    basis: 'last_closed_review' | 'trailing_12_months'
  }
  computed_at: string
  figures: SnapshotFigure[]
  rows?: SnapshotRow[]
}

/** Keep stored lists small — this is a minute pack, not a register export. */
const MAX_ROWS = 8

const truncate = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** UTC instant of Brisbane midnight for an AU date — timestamptz filters. */
function auMidnightInstant(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00+10:00`).toISOString()
}

/** The AU calendar day one year before dateStr (day clamped for Feb 29). */
function oneYearBefore(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const target = new Date(Date.UTC(y - 1, m - 1, 1))
  const daysInMonth = new Date(Date.UTC(y - 1, m, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, daysInMonth))
  return target.toISOString().slice(0, 10)
}

export type SnapshotWindow = InputSnapshot['window']

/**
 * The reporting window for a review's snapshots: from the most recent CLOSED
 * review's review_date (excluding the review being refreshed), else the
 * trailing 12 months.
 */
export async function snapshotWindow(
  supabase: Supabase,
  excludeReviewId?: string
): Promise<SnapshotWindow> {
  const today = todayAU()
  let query = supabase
    .from('management_reviews')
    .select('id, review_date')
    .eq('status', 'closed')
    .order('review_date', { ascending: false })
    .limit(1)
  if (excludeReviewId) query = query.neq('id', excludeReviewId)
  const { data } = await query
  const last = data?.[0]
  if (last?.review_date) {
    return {
      start: last.review_date as string,
      end: today,
      basis: 'last_closed_review',
    }
  }
  return { start: oneYearBefore(today), end: today, basis: 'trailing_12_months' }
}

// ─── Per-input computes ───────────────────────────────────────────────────────

type ComputeCtx = {
  window: SnapshotWindow
  /** Instant filters for the window ([startInstant, endInstant)). */
  startInstant: string
  endInstant: string
  today: string
  /** The review being refreshed (excluded from previous-actions). */
  excludeReviewId?: string
}

type Compute = (supabase: Supabase, ctx: ComputeCtx) => Promise<InputSnapshot | null>

function snapshot(
  ctx: ComputeCtx,
  figures: SnapshotFigure[],
  rows?: SnapshotRow[]
): InputSnapshot {
  return {
    window: ctx.window,
    computed_at: new Date().toISOString(),
    figures,
    ...(rows && rows.length > 0 ? { rows: rows.slice(0, MAX_ROWS) } : {}),
  }
}

const previousActionsStatus: Compute = async (supabase, ctx) => {
  let query = supabase
    .from('management_review_actions')
    .select(
      'description, due_date, status, management_reviews!inner(id, number)'
    )
    .order('due_date', { ascending: true, nullsFirst: false })
  if (ctx.excludeReviewId) query = query.neq('review_id', ctx.excludeReviewId)
  const { data, error } = await query
  if (error) throw new Error(`management_review_actions query failed: ${error.message}`)

  const rows = data ?? []
  const open = rows.filter((r) => r.status === 'open')
  const overdue = open.filter(
    (r) => r.due_date != null && (r.due_date as string) < ctx.today
  )
  return snapshot(
    ctx,
    [
      { label: 'Previous review actions', value: String(rows.length) },
      { label: 'Completed', value: String(rows.length - open.length) },
      { label: 'Still open', value: String(open.length) },
      { label: 'Overdue', value: String(overdue.length) },
    ],
    open.map((r) => {
      const review = r.management_reviews as unknown as { number: string } | null
      return {
        label: `${review?.number ?? 'MR'} — ${truncate(r.description as string)}`,
        value: r.due_date ? `due ${r.due_date as string}` : 'no due date',
        flag:
          r.due_date != null && (r.due_date as string) < ctx.today
            ? ('red' as const)
            : ('amber' as const),
      }
    })
  )
}

const customerFeedbackComplaints: Compute = async (supabase, ctx) => {
  const { data, error } = await supabase
    .from('ncrs')
    .select('number, title, status, created_at')
    .eq('source', 'customer_complaint')
    .gte('created_at', ctx.startInstant)
    .lt('created_at', ctx.endInstant)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`ncrs query failed: ${error.message}`)
  const rows = data ?? []
  const open = rows.filter((r) => r.status !== 'closed')
  return snapshot(
    ctx,
    [
      { label: 'Complaint NCRs raised', value: String(rows.length) },
      { label: 'Still open', value: String(open.length) },
    ],
    rows.map((r) => ({
      label: `${r.number as string} — ${truncate(r.title as string)}`,
      value: r.status as string,
      flag: r.status !== 'closed' ? ('amber' as const) : ('green' as const),
    }))
  )
}

const objectivesKpiPerformance: Compute = async (supabase, ctx) => {
  const [{ data: objectives, error: oErr }, { data: values, error: vErr }] =
    await Promise.all([
      supabase
        .from('objectives')
        .select('id, number, title, metric_name, unit, target_value, direction')
        .eq('status', 'active')
        .order('number'),
      supabase.from('kpi_values').select('objective_id, period_key, value'),
    ])
  if (oErr) throw new Error(`objectives query failed: ${oErr.message}`)
  if (vErr) throw new Error(`kpi_values query failed: ${vErr.message}`)

  const valuesByObjective = new Map<string, { period_key: string; value: number }[]>()
  for (const v of values ?? []) {
    const key = v.objective_id as string
    const row = { period_key: v.period_key as string, value: Number(v.value) }
    const list = valuesByObjective.get(key)
    if (list) list.push(row)
    else valuesByObjective.set(key, [row])
  }

  const counts = { on_track: 0, at_risk: 0, off_track: 0, no_data: 0 }
  const rows: SnapshotRow[] = []
  for (const o of objectives ?? []) {
    const latest = latestKpiValue(valuesByObjective.get(o.id as string) ?? [])
    const status = deriveObjectiveStatus(
      o.direction as ObjectiveDirection,
      Number(o.target_value),
      latest?.value ?? null
    )
    counts[status]++
    // 'max'/'min' rather than ≤/≥ — the snapshot is rendered into the PDF,
    // whose base font (WinAnsi) has no glyphs for the comparison operators.
    const dirWord = (o.direction as string) === 'at_most' ? 'max' : 'min'
    rows.push({
      label: `${o.number as string} — ${o.metric_name as string}`,
      value: latest
        ? `${latest.value}${(o.unit as string) === '%' ? '%' : ''} (${latest.period_key}) vs ${dirWord} ${Number(o.target_value)} — ${OBJECTIVE_TRAFFIC_LABELS[status]}`
        : `no data vs ${dirWord} ${Number(o.target_value)}`,
      flag:
        status === 'off_track'
          ? ('red' as const)
          : status === 'at_risk'
            ? ('amber' as const)
            : status === 'on_track'
              ? ('green' as const)
              : undefined,
    })
  }
  return snapshot(
    ctx,
    [
      { label: 'Active objectives', value: String((objectives ?? []).length) },
      { label: 'On track', value: String(counts.on_track) },
      { label: 'At risk', value: String(counts.at_risk) },
      { label: 'Off track', value: String(counts.off_track) },
      { label: 'No data', value: String(counts.no_data) },
    ],
    rows
  )
}

const processPerformanceNcrTrends: Compute = async (supabase, ctx) => {
  const [
    { data: raised, error: rErr },
    { count: openNcrs, error: oErr },
    { count: overdueCapa, error: cErr },
    { count: docsOverdue, error: dErr },
  ] = await Promise.all([
    supabase
      .from('ncrs')
      .select('source')
      .gte('created_at', ctx.startInstant)
      .lt('created_at', ctx.endInstant),
    supabase
      .from('ncrs')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'closed'),
    supabase
      .from('capa_actions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .not('due_date', 'is', null)
      .lt('due_date', ctx.today),
    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'issued')
      .not('review_due', 'is', null)
      .lt('review_due', ctx.today),
  ])
  if (rErr) throw new Error(`ncrs query failed: ${rErr.message}`)
  if (oErr) throw new Error(`ncrs count failed: ${oErr.message}`)
  if (cErr) throw new Error(`capa_actions count failed: ${cErr.message}`)
  if (dErr) throw new Error(`documents count failed: ${dErr.message}`)

  const bySource = new Map<string, number>()
  for (const r of raised ?? []) {
    const s = r.source as string
    bySource.set(s, (bySource.get(s) ?? 0) + 1)
  }
  return snapshot(
    ctx,
    [
      { label: 'NCRs raised', value: String((raised ?? []).length) },
      { label: 'NCRs open now', value: String(openNcrs ?? 0) },
      { label: 'Overdue CAPA actions', value: String(overdueCapa ?? 0) },
      { label: 'Documents overdue review', value: String(docsOverdue ?? 0) },
    ],
    [...bySource.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => ({
        label: `Raised — ${source.replace(/_/g, ' ')}`,
        value: String(count),
      }))
  )
}

const incidentsSafetyPerformance: Compute = async (supabase, ctx) => {
  const [{ data: occurred, error: iErr }, { count: openNow, error: oErr }] =
    await Promise.all([
      supabase
        .from('incidents')
        .select('type, severity')
        .gte('occurred_at', ctx.startInstant)
        .lt('occurred_at', ctx.endInstant),
      supabase
        .from('incidents')
        .select('id', { count: 'exact', head: true })
        .neq('status', 'closed'),
    ])
  if (iErr) throw new Error(`incidents query failed: ${iErr.message}`)
  if (oErr) throw new Error(`incidents count failed: ${oErr.message}`)

  const rows = occurred ?? []
  const byType = new Map<string, number>()
  for (const r of rows) {
    const t = r.type as string
    byType.set(t, (byType.get(t) ?? 0) + 1)
  }
  const highSeverity = rows.filter((r) => Number(r.severity) >= 4).length
  return snapshot(
    ctx,
    [
      { label: 'Incidents', value: String(rows.length) },
      { label: 'High severity (4+)', value: String(highSeverity) },
      { label: 'Open now', value: String(openNow ?? 0) },
    ],
    [...byType.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({
        label: type.replace(/_/g, ' '),
        value: String(count),
      }))
  )
}

const auditResults: Compute = async (supabase, ctx) => {
  const [
    { data: conducted, error: aErr },
    { data: findingsRaised, error: fErr },
    { count: openFindings, error: ofErr },
  ] = await Promise.all([
    supabase
      .from('audits')
      .select('planned_date, conducted_date, closed_at, status')
      .gte('conducted_date', ctx.window.start)
      .lte('conducted_date', ctx.window.end),
    supabase
      .from('audit_findings')
      .select('classification')
      .gte('created_at', ctx.startInstant)
      .lt('created_at', ctx.endInstant),
    supabase
      .from('audit_findings')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open'),
  ])
  if (aErr) throw new Error(`audits query failed: ${aErr.message}`)
  if (fErr) throw new Error(`audit_findings query failed: ${fErr.message}`)
  if (ofErr) throw new Error(`audit_findings count failed: ${ofErr.message}`)

  const audits = conducted ?? []
  const closed = audits.filter((a) => a.status === 'closed')
  // On time = conducted within 30 days of the planned date (audits without a
  // planned date are excluded — nothing to measure against).
  const withPlan = audits.filter((a) => a.planned_date != null)
  const onTime = withPlan.filter((a) => {
    const planned = new Date(`${a.planned_date as string}T00:00:00+10:00`)
    planned.setUTCDate(planned.getUTCDate() + 30)
    return (a.conducted_date as string) <= todayAU(planned)
  }).length

  const byClass = new Map<string, number>()
  for (const f of findingsRaised ?? []) {
    const c = f.classification as string
    byClass.set(c, (byClass.get(c) ?? 0) + 1)
  }
  return snapshot(
    ctx,
    [
      { label: 'Audits conducted', value: String(audits.length) },
      { label: 'Closed out', value: String(closed.length) },
      {
        label: 'On time (within 30d of plan)',
        value: withPlan.length > 0 ? `${onTime}/${withPlan.length}` : '—',
      },
      { label: 'Findings raised', value: String((findingsRaised ?? []).length) },
      { label: 'Findings open now', value: String(openFindings ?? 0) },
    ],
    [...byClass.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([classification, count]) => ({
        label: `Raised — ${classification.replace(/_nc$/, ' NC').replace(/_/g, ' ')}`,
        value: String(count),
      }))
  )
}

const riskOpportunityEffectiveness: Compute = async (supabase, ctx) => {
  const [{ data: openRisks, error: rErr }, { count: overdueReviews, error: oErr }] =
    await Promise.all([
      supabase
        .from('risk_items')
        .select('number, title, residual_rating, residual_score')
        .eq('kind', 'risk')
        .neq('status', 'closed')
        .order('residual_score', { ascending: false }),
      supabase
        .from('risk_items')
        .select('id', { count: 'exact', head: true })
        .neq('status', 'closed')
        .not('review_date', 'is', null)
        .lt('review_date', ctx.today),
    ])
  if (rErr) throw new Error(`risk_items query failed: ${rErr.message}`)
  if (oErr) throw new Error(`risk_items count failed: ${oErr.message}`)

  const rows = openRisks ?? []
  const highExtreme = rows.filter((r) =>
    ['High', 'Extreme'].includes((r.residual_rating as string | null) ?? '')
  )
  return snapshot(
    ctx,
    [
      { label: 'Open risks', value: String(rows.length) },
      { label: 'High/Extreme residual', value: String(highExtreme.length) },
      { label: 'Reviews overdue', value: String(overdueReviews ?? 0) },
    ],
    highExtreme.map((r) => ({
      label: `${r.number as string} — ${truncate(r.title as string)}`,
      value: `${r.residual_rating as string} ${Number(r.residual_score)}`,
      flag:
        (r.residual_rating as string) === 'Extreme'
          ? ('red' as const)
          : ('amber' as const),
    }))
  )
}

const resourceAdequacy: Compute = async (supabase, ctx) => {
  const [{ data: workers, error: wErr }, { data: reqs, error: qErr }, { data: records, error: cErr }] =
    await Promise.all([
      supabase.from('workers').select('id, role').eq('active', true),
      supabase
        .from('role_competency_requirements')
        .select('role, competency_type_id, competency_types(active)')
        .eq('is_mandatory', true),
      supabase
        .from('competency_records')
        .select(
          'id, worker_id, competency_type_id, issue_date, expiry_date, superseded_by, created_at'
        )
        .is('superseded_by', null),
    ])
  if (wErr) throw new Error(`workers query failed: ${wErr.message}`)
  if (qErr) throw new Error(`role_competency_requirements query failed: ${qErr.message}`)
  if (cErr) throw new Error(`competency_records query failed: ${cErr.message}`)

  const activeReqs = ((reqs ?? []) as unknown as {
    role: string
    competency_type_id: string
    competency_types: { active: boolean } | null
  }[]).filter((r) => r.competency_types?.active !== false)
  const latest = latestRecords((records ?? []) as CompetencyRecordLike[])

  let pairs = 0
  let compliant = 0
  let expiringSoon = 0
  for (const w of workers ?? []) {
    for (const req of activeReqs) {
      if (req.role !== (w.role as string)) continue
      pairs++
      const rec = latest.get(workerTypeKey(w.id as string, req.competency_type_id))
      if (!rec) continue
      const status = deriveCompetencyStatus(rec.expiry_date, ctx.today)
      if (status !== 'expired') compliant++
      if (status === 'expiring') expiringSoon++
    }
  }
  const pct = pairs > 0 ? `${Math.round((compliant / pairs) * 1000) / 10}%` : '—'
  return snapshot(ctx, [
    { label: 'Active workers', value: String((workers ?? []).length) },
    { label: 'Training compliance', value: pct },
    { label: 'Competencies expiring within 30d', value: String(expiringSoon) },
  ])
}

const workerConsultationParticipation: Compute = async (supabase, ctx) => {
  const [{ count: toolbox, error: tErr }, { count: signons, error: sErr }] =
    await Promise.all([
      supabase
        .from('form_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('kind', 'toolbox')
        .gte('submitted_at', ctx.startInstant)
        .lt('submitted_at', ctx.endInstant),
      supabase
        .from('form_signons')
        .select('id', { count: 'exact', head: true })
        .gte('signed_at', ctx.startInstant)
        .lt('signed_at', ctx.endInstant),
    ])
  if (tErr) throw new Error(`form_submissions count failed: ${tErr.message}`)
  if (sErr) throw new Error(`form_signons count failed: ${sErr.message}`)
  return snapshot(ctx, [
    { label: 'Toolbox talks', value: String(toolbox ?? 0) },
    { label: 'Form sign-ons', value: String(signons ?? 0) },
  ])
}

const externalProviderPerformance: Compute = async (supabase, ctx) => {
  const [{ data: supplierNcrs, error: nErr }, { count: expiredDocs, error: eErr }] =
    await Promise.all([
      supabase
        .from('ncrs')
        .select('number, title, status')
        .eq('source', 'supplier')
        .gte('created_at', ctx.startInstant)
        .lt('created_at', ctx.endInstant)
        .order('created_at', { ascending: false }),
      supabase
        .from('vendor_compliance_docs')
        .select('id', { count: 'exact', head: true })
        .lt('expiry_date', ctx.today),
    ])
  if (nErr) throw new Error(`ncrs query failed: ${nErr.message}`)
  if (eErr) throw new Error(`vendor_compliance_docs count failed: ${eErr.message}`)

  const rows = supplierNcrs ?? []
  return snapshot(
    ctx,
    [
      { label: 'Supplier NCRs raised', value: String(rows.length) },
      {
        label: 'Still open',
        value: String(rows.filter((r) => r.status !== 'closed').length),
      },
      { label: 'Supplier compliance docs expired', value: String(expiredDocs ?? 0) },
    ],
    rows.map((r) => ({
      label: `${r.number as string} — ${truncate(r.title as string)}`,
      value: r.status as string,
      flag: r.status !== 'closed' ? ('amber' as const) : ('green' as const),
    }))
  )
}

const improvementOpportunities: Compute = async (supabase, ctx) => {
  const [
    { data: opportunityFindings, error: fErr },
    { count: openObjectiveActions, error: aErr },
  ] = await Promise.all([
    supabase
      .from('audit_findings')
      .select('description, status')
      .eq('classification', 'opportunity')
      .gte('created_at', ctx.startInstant)
      .lt('created_at', ctx.endInstant)
      .order('created_at', { ascending: false }),
    supabase
      .from('objective_actions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open'),
  ])
  if (fErr) throw new Error(`audit_findings query failed: ${fErr.message}`)
  if (aErr) throw new Error(`objective_actions count failed: ${aErr.message}`)

  const rows = opportunityFindings ?? []
  return snapshot(
    ctx,
    [
      { label: 'Audit improvement opportunities', value: String(rows.length) },
      { label: 'Open objective actions', value: String(openObjectiveActions ?? 0) },
    ],
    rows.map((r) => ({
      label: truncate(r.description as string),
      value: r.status as string,
    }))
  )
}

// context_changes has no register (free-text minute); legal_compliance_status
// waits on the obligations register (P3.3) — its helper text says so.
const COMPUTES: Partial<Record<MgmtReviewInputKey, Compute>> = {
  previous_actions_status: previousActionsStatus,
  customer_feedback_complaints: customerFeedbackComplaints,
  objectives_kpi_performance: objectivesKpiPerformance,
  process_performance_ncr_trends: processPerformanceNcrTrends,
  incidents_safety_performance: incidentsSafetyPerformance,
  audit_results: auditResults,
  risk_opportunity_effectiveness: riskOpportunityEffectiveness,
  resource_adequacy: resourceAdequacy,
  worker_consultation_participation: workerConsultationParticipation,
  external_provider_performance: externalProviderPerformance,
  improvement_opportunities: improvementOpportunities,
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function computeCtx(
  supabase: Supabase,
  excludeReviewId?: string
): Promise<ComputeCtx> {
  const window = await snapshotWindow(supabase, excludeReviewId)
  // End instant is the start of the day AFTER the window end (inclusive end).
  const endPlusOne = new Date(`${window.end}T00:00:00+10:00`)
  endPlusOne.setUTCDate(endPlusOne.getUTCDate() + 1)
  return {
    window,
    startInstant: auMidnightInstant(window.start),
    endInstant: endPlusOne.toISOString(),
    today: todayAU(),
    excludeReviewId,
  }
}

/**
 * Fresh snapshot for ONE input key (the per-input "Refresh data" action), or
 * null for the free-text-only inputs. Runs under the caller's RLS.
 */
export async function buildInputSnapshot(
  supabase: Supabase,
  key: MgmtReviewInputKey,
  excludeReviewId?: string
): Promise<InputSnapshot | null> {
  const compute = COMPUTES[key]
  if (!compute) return null
  const ctx = await computeCtx(supabase, excludeReviewId)
  return compute(supabase, ctx)
}

/**
 * Snapshots for ALL thirteen controlled inputs — used to seed a new review.
 * Free-text-only inputs come back null (minute-only). Any register query
 * failure aborts loudly: a review must not be seeded with silently missing
 * evidence.
 */
export async function buildAllInputSnapshots(
  supabase: Supabase,
  excludeReviewId?: string
): Promise<Record<MgmtReviewInputKey, InputSnapshot | null>> {
  const ctx = await computeCtx(supabase, excludeReviewId)
  const result = {} as Record<MgmtReviewInputKey, InputSnapshot | null>
  for (const key of MGMT_REVIEW_INPUT_KEYS) {
    const compute = COMPUTES[key]
    result[key] = compute ? await compute(supabase, ctx) : null
    // Sanity: every auto-flagged input must have a compute (and vice versa).
    if (MGMT_REVIEW_INPUT_DEFS[key].auto !== Boolean(compute)) {
      throw new Error(`Input '${key}' auto flag disagrees with the compute registry`)
    }
  }
  return result
}
