import { notFound } from 'next/navigation'
import { addMonths } from 'date-fns'
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

  const [{ data: project }, { data: diaries }] = await Promise.all([
    supabase
      .from('projects')
      .select(
        'id, contract_sum, claim_day, status, practical_completion_date, pc_release_fraction, dlp_months'
      )
      .eq('id', id)
      .single(),
    supabase
      .from('diaries')
      .select('id, date, work_performed')
      .eq('project_id', id)
      .order('date', { ascending: false })
      .limit(3),
  ])

  if (!project) notFound()

  const today = new Date()
  const nextClaimDate = nextClaimReferenceDate(Number(project.claim_day), today)

  // ── Money data (admin/office only — RLS blocks these tables for supervisors)
  let adjustedSum = 0
  let approvedVoTotal = 0
  let claimedToDate = 0
  let budgetTotal = 0
  let committedTotal = 0
  let actualTotal = 0
  let retentionHeld = 0
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
        .select('kind, amount')
        .eq('project_id', id),
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

  const pcRelease = round2(retentionHeld * Number(project.pc_release_fraction))
  const finalRelease = round2(retentionHeld - pcRelease)
  const pcDate = project.practical_completion_date
    ? new Date(project.practical_completion_date)
    : null
  const finalReleaseDate = pcDate ? addMonths(pcDate, Number(project.dlp_months)) : null

  const barMax = Math.max(budgetTotal, committedTotal, actualTotal, 1)
  const bars = [
    { label: 'Budget', value: budgetTotal, className: 'bg-blue-500' },
    { label: 'Committed', value: committedTotal, className: 'bg-amber-500' },
    { label: 'Actual', value: actualTotal, className: 'bg-green-600' },
  ]

  return (
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

          {/* Retention held */}
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">
                Retention held
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              <span className="text-2xl font-semibold tabular-nums">
                {aud(retentionHeld)}
              </span>
              {retentionHeld > 0 ? (
                <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    Expected at PC: {aud(pcRelease)}
                    {pcDate ? ` (${fmtDate(pcDate)})` : ''}
                  </span>
                  <span className="tabular-nums">
                    Final release: {aud(finalRelease)}
                    {finalReleaseDate ? ` (${fmtDate(finalReleaseDate)})` : ''}
                  </span>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">
                  No retention withheld yet.
                </span>
              )}
            </CardContent>
          </Card>

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
  )
}
