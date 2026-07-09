import { redirect } from 'next/navigation'
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfQuarter,
  format,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { nowAU } from '@/lib/tz'
import { PageHeader } from '@/components/PageHeader'
import { docTotals, lineTotal, round2 } from '@/lib/money'
import { ReportNav, REPORT_TABS, type ReportKey } from './report-nav'
import {
  ProfitabilityReport,
  type CostCodeBreakdown,
  type ProfitabilityRow,
} from './profitability'
import { WipReport, type WipJobRow, type WipProjectRow } from './wip'
import { QuoteConversionReport, type ConversionRow } from './quote-conversion'
import { PERIOD_TABS, type PeriodKey } from './periods'
import {
  OutstandingReport,
  type AgingBucket,
  type AgingInvoiceRow,
  type RetentionProjectRow,
  type UncertifiedClaimRow,
} from './outstanding'
import {
  TimesheetsReport,
  type PersonWeekRow,
  type TimesheetEntryRow,
} from './timesheets'

const OPEN_PROJECT_STATUSES = ['active', 'practical_completion', 'defects_liability']
const UNCODED = 'uncoded'

type Supabase = Awaited<ReturnType<typeof createClient>>

const REPORT_DESCRIPTIONS: Record<ReportKey, string> = {
  profitability: 'Forecast margin per open project, by cost code.',
  wip: 'Claimed vs certified vs paid, and completed jobs awaiting invoice.',
  'quote-conversion': 'Quotes sent vs accepted, grouped by client.',
  outstanding: 'Unpaid invoices, uncertified claims and retention held.',
  timesheets: 'Weekly hours per person with approval.',
}

// ─── Profitability ────────────────────────────────────────────────────────────

async function loadProfitability(supabase: Supabase): Promise<ProfitabilityRow[]> {
  const { data: projects } = await supabase
    .from('projects')
    .select('id, number, name, status, contract_sum')
    .eq('archived', false)
    .in('status', OPEN_PROJECT_STATUSES)
    .order('number')

  if (!projects || projects.length === 0) return []
  const ids = projects.map((p) => p.id)

  const [
    { data: variations },
    { data: claims },
    { data: budgetLines },
    { data: costs },
    { data: poLines },
    { data: commitments },
    { data: costCodes },
  ] = await Promise.all([
    supabase
      .from('variations')
      .select('project_id, sell_amount')
      .eq('status', 'approved')
      .in('project_id', ids),
    supabase
      .from('claims')
      .select('project_id, total_claimed_to_date')
      .neq('status', 'draft')
      .not('total_claimed_to_date', 'is', null)
      .in('project_id', ids),
    supabase
      .from('budget_lines')
      .select('project_id, budget_amount, cost_code_id')
      .in('project_id', ids),
    supabase
      .from('costs')
      .select('parent_id, amount, cost_code_id')
      .eq('parent_type', 'project')
      .in('parent_id', ids),
    supabase
      .from('po_lines')
      .select('qty, unit_cost, cost_code_id, purchase_orders!inner(project_id, status)')
      .in('purchase_orders.status', ['issued', 'closed'])
      .in('purchase_orders.project_id', ids),
    supabase
      .from('commitments')
      .select('project_id, amount, cost_code_id')
      .eq('status', 'active')
      .in('project_id', ids),
    supabase.from('cost_codes').select('id, code, name'),
  ])

  const codeLabel = (key: string): string => {
    if (key === UNCODED) return 'Uncoded'
    const cc = (costCodes ?? []).find((c) => c.id === key)
    return cc ? `${cc.code} – ${cc.name}` : 'Unknown code'
  }

  // Per-project, per-cost-code accumulators
  type CodeMap = Record<string, Record<string, number>>
  const budgetBy: CodeMap = {}
  const committedBy: CodeMap = {}
  const actualBy: CodeMap = {}

  const add = (map: CodeMap, projectId: string, codeId: string | null, amount: number) => {
    const code = codeId ?? UNCODED
    const perProject = (map[projectId] ??= {})
    perProject[code] = round2((perProject[code] ?? 0) + amount)
  }

  for (const l of budgetLines ?? []) {
    add(budgetBy, l.project_id, l.cost_code_id, Number(l.budget_amount))
  }
  for (const c of costs ?? []) {
    add(actualBy, c.parent_id, c.cost_code_id, Number(c.amount))
  }
  for (const l of poLines ?? []) {
    const po = l.purchase_orders as unknown as { project_id: string }
    add(committedBy, po.project_id, l.cost_code_id, lineTotal(Number(l.qty), Number(l.unit_cost)))
  }
  for (const c of commitments ?? []) {
    add(committedBy, c.project_id, c.cost_code_id, Number(c.amount))
  }

  const approvedVoByProject: Record<string, number> = {}
  for (const v of variations ?? []) {
    approvedVoByProject[v.project_id] = round2(
      (approvedVoByProject[v.project_id] ?? 0) + Number(v.sell_amount)
    )
  }

  const claimedByProject: Record<string, number> = {}
  for (const c of claims ?? []) {
    claimedByProject[c.project_id] = Math.max(
      claimedByProject[c.project_id] ?? 0,
      Number(c.total_claimed_to_date)
    )
  }

  return projects.map((p) => {
    const budget = budgetBy[p.id] ?? {}
    const committed = committedBy[p.id] ?? {}
    const actual = actualBy[p.id] ?? {}

    const codeKeys = new Set([
      ...Object.keys(budget),
      ...Object.keys(committed),
      ...Object.keys(actual),
    ])

    const codes: CostCodeBreakdown[] = [...codeKeys]
      .map((key) => ({
        key,
        label: codeLabel(key),
        budget: budget[key] ?? 0,
        committed: committed[key] ?? 0,
        actual: actual[key] ?? 0,
      }))
      .sort((a, b) =>
        a.key === UNCODED ? 1 : b.key === UNCODED ? -1 : a.label.localeCompare(b.label)
      )

    const adjusted = round2(Number(p.contract_sum) + (approvedVoByProject[p.id] ?? 0))
    const forecastCost = round2(
      codes.reduce((s, c) => s + Math.max(c.committed, c.actual), 0)
    )
    const forecastMargin = round2(adjusted - forecastCost)

    return {
      id: p.id,
      number: p.number,
      name: p.name,
      status: p.status,
      adjusted,
      claimed: claimedByProject[p.id] ?? 0,
      budget: round2(codes.reduce((s, c) => s + c.budget, 0)),
      committed: round2(codes.reduce((s, c) => s + c.committed, 0)),
      actual: round2(codes.reduce((s, c) => s + c.actual, 0)),
      forecastCost,
      forecastMargin,
      marginPct: adjusted > 0 ? round2((forecastMargin / adjusted) * 100) : 0,
      codes,
    }
  })
}

// ─── WIP ──────────────────────────────────────────────────────────────────────

async function loadWip(
  supabase: Supabase
): Promise<{ projects: WipProjectRow[]; jobs: WipJobRow[] }> {
  const [{ data: projects }, { data: claims }, { data: jobs }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, number, name')
      .eq('archived', false)
      .in('status', OPEN_PROJECT_STATUSES)
      .order('number'),
    supabase
      .from('claims')
      .select('project_id, status, total_inc_gst, certified_amount')
      .neq('status', 'draft'),
    supabase
      .from('jobs')
      .select(
        'id, number, title, completed_at, clients(name), quotes(gst_rate, quote_lines(qty, unit_sell)), invoices(status)'
      )
      .eq('archived', false)
      .eq('status', 'completed')
      .order('completed_at', { ascending: true }),
  ])

  const today = nowAU()

  const projectRows: WipProjectRow[] = (projects ?? []).map((p) => {
    const projectClaims = (claims ?? []).filter((c) => c.project_id === p.id)
    // Exposure = "billed value not yet certified". Keep both operands on the
    // SAME basis: inc-GST, and cumulative-via-Σ-of-per-claim figures.
    //   claimed   = Σ total_inc_gst  (per-claim billed inc-GST, net of retention)
    //   certified = Σ certified_amount (per-claim certified inc-GST)
    // A submitted-but-uncertified claim raises `claimed` but not `certified`,
    // so it lands in exposure — exactly the intended meaning.
    const claimed = round2(
      projectClaims
        .filter((c) => c.total_inc_gst != null)
        .reduce((s, c) => s + Number(c.total_inc_gst), 0)
    )
    const certified = round2(
      projectClaims
        .filter(
          (c) =>
            (c.status === 'certified' || c.status === 'paid') &&
            c.certified_amount != null
        )
        .reduce((s, c) => s + Number(c.certified_amount), 0)
    )
    const paid = round2(
      projectClaims
        .filter((c) => c.status === 'paid' && c.certified_amount != null)
        .reduce((s, c) => s + Number(c.certified_amount), 0)
    )
    return {
      id: p.id,
      number: p.number,
      name: p.name,
      claimed,
      certified,
      paid,
      exposure: round2(claimed - certified),
    }
  })

  const jobRows: WipJobRow[] = (jobs ?? [])
    .filter((j) => {
      const invoices = (j.invoices ?? []) as { status: string }[]
      return invoices.filter((i) => i.status !== 'void').length === 0
    })
    .map((j) => {
      const quote = j.quotes as unknown as {
        gst_rate: number
        quote_lines: { qty: number; unit_sell: number }[]
      } | null
      const quoted = quote
        ? docTotals(
            (quote.quote_lines ?? []).map((l) => ({
              qty: Number(l.qty),
              unitSell: Number(l.unit_sell),
            })),
            Number(quote.gst_rate)
          ).subtotal
        : 0
      return {
        id: j.id,
        number: j.number,
        title: j.title,
        client: (j.clients as unknown as { name: string } | null)?.name ?? '—',
        quoted,
        completedAt: j.completed_at as string | null,
        daysSinceCompleted: j.completed_at
          ? Math.max(0, differenceInCalendarDays(today, parseISO(j.completed_at)))
          : null,
      }
    })

  return { projects: projectRows, jobs: jobRows }
}

// ─── Quote conversion ─────────────────────────────────────────────────────────

function periodRange(period: PeriodKey, now: Date): { start: Date; end: Date } | null {
  switch (period) {
    case 'this-month':
      return { start: startOfMonth(now), end: endOfMonth(now) }
    case 'last-month': {
      const lastMonth = subMonths(now, 1)
      return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) }
    }
    case 'this-quarter':
      return { start: startOfQuarter(now), end: endOfQuarter(now) }
    case 'all':
      return null
  }
}

async function loadQuoteConversion(
  supabase: Supabase,
  period: PeriodKey
): Promise<ConversionRow[]> {
  let query = supabase
    .from('quotes')
    .select('id, status, gst_rate, sent_at, clients(name), quote_lines(qty, unit_sell)')
    .eq('archived', false)
    .not('sent_at', 'is', null)

  const range = periodRange(period, nowAU())
  if (range) {
    query = query
      .gte('sent_at', range.start.toISOString())
      .lte('sent_at', range.end.toISOString())
  }

  const { data: quotes } = await query

  const byClient = new Map<string, ConversionRow>()
  for (const q of quotes ?? []) {
    const client = (q.clients as unknown as { name: string } | null)?.name ?? '—'
    const { subtotal } = docTotals(
      (q.quote_lines ?? []).map((l) => ({
        qty: Number(l.qty),
        unitSell: Number(l.unit_sell),
      })),
      Number(q.gst_rate)
    )
    const row =
      byClient.get(client) ??
      ({
        client,
        sentCount: 0,
        sentValue: 0,
        acceptedCount: 0,
        acceptedValue: 0,
        ratePct: 0,
      } satisfies ConversionRow)
    row.sentCount += 1
    row.sentValue = round2(row.sentValue + subtotal)
    if (q.status === 'accepted') {
      row.acceptedCount += 1
      row.acceptedValue = round2(row.acceptedValue + subtotal)
    }
    byClient.set(client, row)
  }

  return [...byClient.values()]
    .map((r) => ({
      ...r,
      ratePct: r.sentCount > 0 ? round2((r.acceptedCount / r.sentCount) * 100) : 0,
    }))
    .sort((a, b) => a.client.localeCompare(b.client))
}

// ─── Outstanding money ────────────────────────────────────────────────────────

function agingBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'Current'
  if (daysOverdue <= 30) return '1–30'
  if (daysOverdue <= 60) return '31–60'
  if (daysOverdue <= 90) return '61–90'
  return '90+'
}

async function loadOutstanding(supabase: Supabase): Promise<{
  invoices: AgingInvoiceRow[]
  claims: UncertifiedClaimRow[]
  retention: RetentionProjectRow[]
}> {
  const [{ data: invoices }, { data: claims }, { data: retentionEntries }] =
    await Promise.all([
      supabase
        .from('invoices')
        .select(
          'id, number, status, due_date, gst_rate, clients(name), invoice_lines(qty, unit_sell)'
        )
        .in('status', ['draft', 'sent']),
      supabase
        .from('claims')
        .select('id, project_id, number, total_inc_gst, submitted_at, projects(number, name)')
        .eq('status', 'submitted')
        .order('submitted_at', { ascending: true }),
      supabase
        .from('retention_entries')
        .select(
          'project_id, kind, amount, projects(number, name, practical_completion_date, dlp_months, pc_release_fraction)'
        ),
    ])

  const today = nowAU()

  const invoiceRows: AgingInvoiceRow[] = (invoices ?? [])
    .map((inv) => {
      const { total } = docTotals(
        (inv.invoice_lines ?? []).map((l) => ({
          qty: Number(l.qty),
          unitSell: Number(l.unit_sell),
        })),
        Number(inv.gst_rate)
      )
      const daysOverdue = inv.due_date
        ? Math.max(0, differenceInCalendarDays(today, parseISO(inv.due_date)))
        : 0
      return {
        id: inv.id,
        number: inv.number,
        client: (inv.clients as unknown as { name: string } | null)?.name ?? '—',
        status: inv.status as string,
        dueDate: inv.due_date as string | null,
        daysOverdue,
        bucket: agingBucket(daysOverdue),
        total,
      }
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue)

  const claimRows: UncertifiedClaimRow[] = (claims ?? []).map((c) => {
    const project = c.projects as unknown as { number: string; name: string } | null
    return {
      id: c.id,
      projectId: c.project_id,
      projectLabel: project ? `${project.number} — ${project.name}` : '—',
      claimNumber: Number(c.number),
      totalIncGst: c.total_inc_gst != null ? Number(c.total_inc_gst) : null,
      submittedAt: c.submitted_at as string | null,
      daysWaiting: c.submitted_at
        ? Math.max(0, differenceInCalendarDays(today, parseISO(c.submitted_at)))
        : 0,
    }
  })

  // Retention held per project: Σ withheld − Σ releases
  type RetentionProjectMeta = {
    number: string
    name: string
    practical_completion_date: string | null
    dlp_months: number
    pc_release_fraction: number
  }
  const heldByProject = new Map<string, { held: number; project: RetentionProjectMeta | null }>()
  for (const e of retentionEntries ?? []) {
    const signed = e.kind === 'withheld' ? Number(e.amount) : -Number(e.amount)
    const existing = heldByProject.get(e.project_id)
    heldByProject.set(e.project_id, {
      held: round2((existing?.held ?? 0) + signed),
      project:
        existing?.project ?? (e.projects as unknown as RetentionProjectMeta | null),
    })
  }

  const retentionRows: RetentionProjectRow[] = [...heldByProject.entries()]
    .filter(([, v]) => v.held > 0)
    .map(([projectId, v]) => {
      const pcReleaseFraction = Number(v.project?.pc_release_fraction ?? 0.5)
      const pcRelease = round2(v.held * pcReleaseFraction)
      const pcDate = v.project?.practical_completion_date ?? null
      const finalDate = pcDate
        ? format(addMonths(parseISO(pcDate), Number(v.project?.dlp_months ?? 12)), 'yyyy-MM-dd')
        : null
      return {
        projectId,
        projectLabel: v.project ? `${v.project.number} — ${v.project.name}` : '—',
        held: v.held,
        pcRelease,
        pcDate,
        finalRelease: round2(v.held - pcRelease),
        finalDate,
      }
    })
    .sort((a, b) => a.projectLabel.localeCompare(b.projectLabel))

  return { invoices: invoiceRows, claims: claimRows, retention: retentionRows }
}

// ─── Timesheets ───────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

function getWeekMonday(weekParam: string | undefined): Date {
  if (weekParam) {
    const parsed = new Date(weekParam + 'T00:00:00')
    if (!isNaN(parsed.getTime())) {
      return startOfWeek(parsed, { weekStartsOn: 1 })
    }
  }
  return startOfWeek(nowAU(), { weekStartsOn: 1 })
}

async function loadTimesheets(
  supabase: Supabase,
  weekDays: string[]
): Promise<PersonWeekRow[]> {
  const [{ data: entries }, { data: profiles }] = await Promise.all([
    supabase
      .from('timesheet_entries')
      .select(
        'id, user_id, date, start_at, end_at, approved, assignment_id, jobs(number, title), projects(number, name)'
      )
      .gte('date', weekDays[0])
      .lte('date', weekDays[6])
      .order('date')
      .order('start_at'),
    supabase.from('profiles').select('id, full_name'),
  ])

  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]))

  const byUser = new Map<string, PersonWeekRow>()
  for (const e of entries ?? []) {
    const job = e.jobs as unknown as { number: string; title: string } | null
    const project = e.projects as unknown as { number: string; name: string } | null
    const target = job
      ? `${job.number} — ${job.title}`
      : project
        ? `${project.number} — ${project.name}`
        : '—'
    const hours = e.end_at
      ? Math.max(
          0,
          (new Date(e.end_at).getTime() - new Date(e.start_at).getTime()) / 3600000
        )
      : 0

    let row = byUser.get(e.user_id)
    if (!row) {
      row = {
        userId: e.user_id,
        name: nameById.get(e.user_id) ?? 'Unknown',
        dailyHours: {},
        total: 0,
        entries: [],
      }
      byUser.set(e.user_id, row)
    }

    const entryRow: TimesheetEntryRow = {
      id: e.id,
      date: e.date as string,
      target,
      startAt: e.start_at as string,
      endAt: e.end_at as string | null,
      hours,
      manual: e.assignment_id == null,
      approved: e.approved as boolean,
    }
    row.entries.push(entryRow)
    if (e.end_at) {
      row.dailyHours[entryRow.date] = (row.dailyHours[entryRow.date] ?? 0) + hours
      row.total += hours
    }
  }

  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; period?: string; week?: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const { report: rawReport, period: rawPeriod, week } = await searchParams

  const report: ReportKey = REPORT_TABS.some((t) => t.value === rawReport)
    ? (rawReport as ReportKey)
    : 'profitability'

  // Money reports are admin/office only; supervisors get timesheets.
  if (profile.role === 'supervisor' && report !== 'timesheets') {
    redirect('/reports?report=timesheets')
  }

  const supabase = await createClient()

  let content: React.ReactNode
  switch (report) {
    case 'profitability': {
      content = <ProfitabilityReport rows={await loadProfitability(supabase)} />
      break
    }
    case 'wip': {
      const { projects, jobs } = await loadWip(supabase)
      content = <WipReport projects={projects} jobs={jobs} />
      break
    }
    case 'quote-conversion': {
      const period: PeriodKey = PERIOD_TABS.some((t) => t.value === rawPeriod)
        ? (rawPeriod as PeriodKey)
        : 'this-month'
      content = (
        <QuoteConversionReport
          rows={await loadQuoteConversion(supabase, period)}
          period={period}
        />
      )
      break
    }
    case 'outstanding': {
      const { invoices, claims, retention } = await loadOutstanding(supabase)
      content = (
        <OutstandingReport invoices={invoices} claims={claims} retention={retention} />
      )
      break
    }
    case 'timesheets': {
      const monday = getWeekMonday(week)
      const sunday = addDays(monday, 6)
      const weekDays = eachDayOfInterval({ start: monday, end: sunday }).map(toDateStr)
      const thisWeek = toDateStr(startOfWeek(nowAU(), { weekStartsOn: 1 }))
      content = (
        <TimesheetsReport
          weekDays={weekDays}
          weekLabel={`${format(monday, 'd MMM')} – ${format(sunday, 'd MMM yyyy')}`}
          prevWeek={toDateStr(addDays(monday, -7))}
          nextWeek={toDateStr(addDays(monday, 7))}
          isCurrentWeek={thisWeek === weekDays[0]}
          people={await loadTimesheets(supabase, weekDays)}
        />
      )
      break
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Reports" description={REPORT_DESCRIPTIONS[report]} />

      <ReportNav active={report} isSupervisor={profile.role === 'supervisor'} />

      {content}
    </div>
  )
}
