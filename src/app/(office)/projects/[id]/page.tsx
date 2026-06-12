import Link from 'next/link'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { round2, lineTotal } from '@/lib/money'
import { aud, fmtDate, pct } from '@/lib/format'
import { fetchSwmsInstances } from '@/lib/swms-queries'
import { SwmsInstancesSection } from '@/components/SwmsInstancesSection'
import { RetentionCard, type RetentionEntry } from './retention-card'

/** Claim day of the current month if not yet passed, otherwise next month. */
function nextClaimReferenceDate(claimDay: number, today: Date): Date {
  const y = today.getFullYear()
  const m = today.getMonth()
  const clamp = (year: number, month: number) =>
    new Date(year, month, Math.min(claimDay, new Date(year, month + 1, 0).getDate()))
  const startOfToday = new Date(y, m, today.getDate())
  const candidate = clamp(y, m)
  return candidate.getTime() >= startOfToday.getTime() ? candidate : clamp(y, m + 1)
}

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const showMoney = profile.role === 'admin' || profile.role === 'office'

  const { id } = await params
  const supabase = await createClient()

  const [
    { data: project },
    { data: diaries },
    swmsInstances,
    { data: swmsTemplates },
    { data: programmeTasks },
    { data: holdPoints },
  ] = await Promise.all([
    supabase
      .from('projects')
      .select(
        'id, contract_sum, claim_day, status, practical_completion_date, pc_release_fraction, dlp_months, retention_cap_pct'
      )
      .eq('id', id)
      .single(),
    supabase
      .from('diaries')
      .select('id, date, work_performed')
      .eq('project_id', id)
      .order('date', { ascending: false })
      .limit(3),
    fetchSwmsInstances(supabase, 'project', id),
    supabase
      .from('swms_templates')
      .select('id, title, version')
      .eq('active', true)
      .order('title'),
    supabase
      .from('programme_tasks')
      .select('end_date, progress_pct')
      .eq('project_id', id),
    supabase
      .from('hold_points')
      .select('date, status')
      .eq('project_id', id)
      .neq('status', 'released'),
  ])

  if (!project) notFound()

  const today = new Date()
  const nextClaimDate = nextClaimReferenceDate(Number(project.claim_day), today)

  // ── Programme summary (ops-visible incl supervisor — op table under RLS)
  const todayIso = format(today, 'yyyy-MM-dd')
  const programmeCount = (programmeTasks ?? []).length
  const programmeBehind = (programmeTasks ?? []).filter(
    (t) => t.end_date < todayIso && Number(t.progress_pct) < 100
  ).length
  const holdPointsOverdue = (holdPoints ?? []).filter(
    (hp) => hp.date < todayIso
  ).length

  // ── Money data (admin/office only — RLS blocks these tables for supervisors)
  let adjustedSum = 0
  let approvedVoTotal = 0
  let claimedToDate = 0
  let budgetTotal = 0
  let committedTotal = 0
  let actualTotal = 0
  let retentionHeld = 0
  let retentionEntriesForCard: RetentionEntry[] = []
  let openVariationsCount = 0
  let timeBarWarnings = 0
  let claimThisMonth: 'drafted' | 'submitted' | null = null

  if (showMoney) {
    const [
      { data: variations },
      { data: claims },
      { data: budgetLines },
      { data: costs },
      { data: poLines },
      { data: commitments },
      { data: retentionEntries },
    ] = await Promise.all([
      supabase
        .from('variations')
        .select('status, sell_amount, time_bar_date')
        .eq('project_id', id),
      supabase
        .from('claims')
        .select('status, total_claimed_to_date, reference_date')
        .eq('project_id', id),
      supabase.from('budget_lines').select('budget_amount').eq('project_id', id),
      supabase
        .from('costs')
        .select('amount')
        .eq('parent_type', 'project')
        .eq('parent_id', id),
      supabase
        .from('po_lines')
        .select('qty, unit_cost, purchase_orders!inner(project_id, status)')
        .eq('purchase_orders.project_id', id)
        .in('purchase_orders.status', ['issued', 'closed']),
      supabase
        .from('commitments')
        .select('amount')
        .eq('project_id', id)
        .eq('status', 'active'),
      supabase
        .from('retention_entries')
        .select('id, kind, amount, date, notes, claims(number)')
        .eq('project_id', id)
        .order('date', { ascending: true }),
    ])

    approvedVoTotal = round2(
      (variations ?? [])
        .filter((v) => v.status === 'approved')
        .reduce((s, v) => s + Number(v.sell_amount), 0)
    )
    adjustedSum = round2(Number(project.contract_sum) + approvedVoTotal)

    const claimedValues = (claims ?? [])
      .filter((c) => c.status !== 'draft' && c.total_claimed_to_date != null)
      .map((c) => Number(c.total_claimed_to_date))
    claimedToDate = claimedValues.length > 0 ? Math.max(...claimedValues) : 0

    budgetTotal = round2(
      (budgetLines ?? []).reduce((s, l) => s + Number(l.budget_amount), 0)
    )
    actualTotal = round2((costs ?? []).reduce((s, c) => s + Number(c.amount), 0))
    committedTotal = round2(
      (poLines ?? []).reduce(
        (s, l) => s + lineTotal(Number(l.qty), Number(l.unit_cost)),
        0
      ) + (commitments ?? []).reduce((s, c) => s + Number(c.amount), 0)
    )

    retentionHeld = round2(
      (retentionEntries ?? []).reduce(
        (s, e) =>
          e.kind === 'withheld' ? s + Number(e.amount) : s - Number(e.amount),
        0
      )
    )

    retentionEntriesForCard = (retentionEntries ?? []).map((e) => {
      const claimsData = e.claims
      const claimNumber =
        claimsData != null && !Array.isArray(claimsData)
          ? (claimsData as { number: number }).number
          : Array.isArray(claimsData) && claimsData.length > 0
            ? (claimsData[0] as { number: number }).number
            : null
      return {
        id: e.id as string,
        kind: e.kind as 'withheld' | 'release_pc' | 'release_final',
        amount: Number(e.amount),
        date: e.date as string,
        notes: e.notes as string | null,
        claim_number: claimNumber,
      }
    })

    const openStatuses = ['notified', 'priced', 'submitted']
    const openVariations = (variations ?? []).filter((v) =>
      openStatuses.includes(v.status)
    )
    openVariationsCount = openVariations.length
    const warningCutoff = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 7
    )
    timeBarWarnings = openVariations.filter(
      (v) => v.time_bar_date && new Date(v.time_bar_date) <= warningCutoff
    ).length

    const monthClaims = (claims ?? []).filter((c) => {
      const ref = new Date(c.reference_date)
      return (
        ref.getFullYear() === today.getFullYear() &&
        ref.getMonth() === today.getMonth()
      )
    })
    if (monthClaims.some((c) => c.status !== 'draft')) claimThisMonth = 'submitted'
    else if (monthClaims.length > 0) claimThisMonth = 'drafted'
  }

  const remaining = round2(adjustedSum - claimedToDate)
  const pctClaimed =
    adjustedSum > 0 ? Math.min(100, round2((claimedToDate / adjustedSum) * 100)) : 0

  const barMax = Math.max(budgetTotal, committedTotal, actualTotal, 1)
  const bars = [
    { label: 'Budget', value: budgetTotal, className: 'bg-blue-500' },
    { label: 'Committed', value: committedTotal, className: 'bg-amber-500' },
    { label: 'Actual', value: actualTotal, className: 'bg-green-600' },
  ]

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {showMoney && (
        <>
          {/* Adjusted contract sum */}
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">
                Adjusted contract sum
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              <span className="text-2xl font-semibold tabular-nums">
                {aud(adjustedSum)}
              </span>
              <span className="text-xs text-muted-foreground">
                {aud(Number(project.contract_sum))} contract +{' '}
                {aud(approvedVoTotal)} approved variations
              </span>
            </CardContent>
          </Card>

          {/* Claimed to date */}
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">
                Claimed to date
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-semibold tabular-nums">
                  {aud(claimedToDate)}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {pct(pctClaimed)}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-green-600"
                  style={{ width: `${pctClaimed}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {aud(remaining)} remaining
              </span>
            </CardContent>
          </Card>

          {/* Budget vs committed vs actual */}
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">
                Budget vs committed vs actual
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {bars.map((b) => (
                <div key={b.label} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-xs text-muted-foreground">
                    {b.label}
                  </span>
                  <div className="h-3 flex-1 overflow-hidden rounded bg-muted">
                    <div
                      className={`h-full rounded ${b.className}`}
                      style={{ width: `${Math.min(100, (b.value / barMax) * 100)}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs tabular-nums">
                    {aud(b.value)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Retention held — rich ledger card */}
          <RetentionCard
            projectId={id}
            entries={retentionEntriesForCard}
            retentionHeld={retentionHeld}
            retentionCapPct={Number(project.retention_cap_pct)}
            adjustedSum={adjustedSum}
            pcReleaseFraction={Number(project.pc_release_fraction)}
            practicalCompletionDate={project.practical_completion_date ?? null}
            dlpMonths={Number(project.dlp_months)}
          />

          {/* Open variations */}
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">
                Open variations
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              <span className="text-2xl font-semibold tabular-nums">
                {openVariationsCount}
              </span>
              {timeBarWarnings > 0 ? (
                <span className="text-xs font-medium text-red-600 dark:text-red-400">
                  {timeBarWarnings} within 7 days of time bar
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  No time-bar warnings.
                </span>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Programme — visible to all roles */}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">
            Programme
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <span className="text-2xl font-semibold tabular-nums">
            {programmeCount}{' '}
            <span className="text-sm font-normal text-muted-foreground">
              task{programmeCount === 1 ? '' : 's'}
            </span>
          </span>
          {programmeBehind > 0 ? (
            <span className="text-xs font-medium text-red-600 dark:text-red-400">
              {programmeBehind} behind programme
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {programmeCount > 0 ? 'Nothing behind programme.' : 'No tasks yet.'}
            </span>
          )}
          {holdPointsOverdue > 0 && (
            <span className="text-xs font-medium text-red-600 dark:text-red-400">
              {holdPointsOverdue} unreleased hold point
              {holdPointsOverdue === 1 ? '' : 's'} past date
            </span>
          )}
          <Link
            href={`/projects/${id}/programme`}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Open programme
          </Link>
        </CardContent>
      </Card>

      {/* Next claim reference date — visible to all roles */}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">
            Next claim reference date
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <span className="text-2xl font-semibold tabular-nums">
            {fmtDate(nextClaimDate)}
          </span>
          {showMoney &&
            (claimThisMonth ? (
              <span className="text-xs font-medium text-green-700 dark:text-green-400">
                Claim {claimThisMonth} this month
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                No claim drafted this month.
              </span>
            ))}
        </CardContent>
      </Card>

      {/* Recent diary entries — visible to all roles */}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">
            Recent diary entries
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {(diaries ?? []).length > 0 ? (
            (diaries ?? []).map((d) => (
              <div key={d.id} className="flex flex-col gap-0.5">
                <span className="text-xs font-medium tabular-nums">
                  {fmtDate(d.date)}
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {d.work_performed || '—'}
                </span>
              </div>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">
              No diary entries yet.
            </span>
          )}
        </CardContent>
      </Card>
      </div>

      {/* SWMS — ops-visible incl supervisor */}
      <SwmsInstancesSection
        parentType="project"
        parentId={id}
        instances={swmsInstances}
        templates={swmsTemplates ?? []}
        canManage
        canSupersede={showMoney}
      />
    </div>
  )
}
