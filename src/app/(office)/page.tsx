import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  format,
  isSameMonth,
  isSaturday,
  isSunday,
  parseISO,
  startOfDay,
  startOfMonth,
  subDays,
} from 'date-fns'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { docTotals, lineTotal, round2 } from '@/lib/money'
import {
  ActiveWorkCard,
  ClaimsDueCard,
  ComplianceCard,
  DiariesMissingCard,
  HoldPointsCard,
  QuotesAwaitingCard,
  RetentionDueCard,
  SwmsOutstandingCard,
  TimeBarCard,
  TodayOnSiteCard,
  UnpaidInvoicesCard,
  type ActiveWorkData,
  type ClaimsDueData,
  type ComplianceRow,
  type DiaryMissingRow,
  type HoldPointDueRow,
  type QuoteAwaitingRow,
  type RetentionDueRow,
  type SwmsOutstandingRow,
  type TimeBarRow,
  type TodayOnSiteGroup,
  type UnpaidInvoicesData,
} from './dashboard-cards'

type Db = Awaited<ReturnType<typeof createClient>>

/** Runs a loader, returning null on failure so one bad query can't kill the page. */
async function settle<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (err) {
    console.error('[dashboard] card query failed:', err)
    return null
  }
}

function dateStr(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

/** claim_day clamped to the month's length (claim_day 31 in Feb → Feb 28/29). */
function clampToMonth(year: number, month: number, day: number): Date {
  return new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate()))
}

/** Next occurrence of the project's claim day: this month if not yet passed, else next month. */
function nextClaimOccurrence(claimDay: number, today: Date): Date {
  const start = startOfDay(today)
  const candidate = clampToMonth(today.getFullYear(), today.getMonth(), claimDay)
  return candidate.getTime() >= start.getTime()
    ? candidate
    : clampToMonth(today.getFullYear(), today.getMonth() + 1, claimDay)
}

// ─── 1. Claims due ────────────────────────────────────────────────────────────

async function loadClaimsDue(supabase: Db, today: Date): Promise<ClaimsDueData> {
  const [projectsRes, monthClaimsRes, submittedRes] = await Promise.all([
    supabase
      .from('projects')
      .select('id, number, name, claim_day')
      .eq('status', 'active'),
    // Claims from the start of this month onward — covers the month-wrap case
    // where the next claim day falls early next month.
    supabase
      .from('claims')
      .select('project_id, reference_date')
      .gte('reference_date', dateStr(startOfMonth(today))),
    supabase
      .from('claims')
      .select('id, project_id, number, total_inc_gst, submitted_at, projects(number, name)')
      .eq('status', 'submitted')
      .order('submitted_at', { ascending: true }),
  ])
  if (projectsRes.error) throw projectsRes.error
  if (monthClaimsRes.error) throw monthClaimsRes.error
  if (submittedRes.error) throw submittedRes.error

  const horizon = addDays(startOfDay(today), 7)
  const monthClaims = monthClaimsRes.data ?? []

  const due = (projectsRes.data ?? []).flatMap((p) => {
    const next = nextClaimOccurrence(Number(p.claim_day), today)
    if (next.getTime() > horizon.getTime()) return []
    const covered = monthClaims.some(
      (c) =>
        c.project_id === p.id &&
        isSameMonth(parseISO(c.reference_date as string), next)
    )
    if (covered) return []
    return [
      {
        projectId: p.id as string,
        projectLabel: `${p.number} — ${p.name}`,
        claimDate: dateStr(next),
      },
    ]
  })

  const submitted = (submittedRes.data ?? []).map((c) => {
    const project = c.projects as unknown as { number: string; name: string } | null
    return {
      claimId: c.id as string,
      projectId: c.project_id as string,
      projectLabel: project ? `${project.number} — ${project.name}` : '—',
      number: Number(c.number),
      total: c.total_inc_gst != null ? Number(c.total_inc_gst) : null,
      daysSince: c.submitted_at
        ? Math.max(0, differenceInCalendarDays(today, parseISO(c.submitted_at as string)))
        : 0,
    }
  })

  return { due, submitted }
}

// ─── 2. Quotes awaiting ───────────────────────────────────────────────────────

async function loadQuotesAwaiting(
  supabase: Db,
  today: Date
): Promise<QuoteAwaitingRow[]> {
  const { data, error } = await supabase
    .from('quotes')
    .select('id, number, title, sent_at, created_at, quote_lines(qty, unit_sell)')
    .eq('status', 'sent')
    .order('sent_at', { ascending: true })
  if (error) throw error

  return (data ?? []).map((q) => {
    const lines = (q.quote_lines ?? []) as { qty: number; unit_sell: number }[]
    const value = round2(
      lines.reduce((s, l) => s + lineTotal(Number(l.qty), Number(l.unit_sell)), 0)
    )
    const since = (q.sent_at ?? q.created_at) as string
    return {
      id: q.id as string,
      number: q.number as string,
      title: q.title as string,
      value,
      ageDays: Math.max(0, differenceInCalendarDays(today, parseISO(since))),
    }
  })
}

// ─── 3. Unpaid invoices ───────────────────────────────────────────────────────

async function loadUnpaidInvoices(
  supabase: Db,
  today: Date
): Promise<UnpaidInvoicesData> {
  const { data, error } = await supabase
    .from('invoices')
    .select('id, number, due_date, gst_rate, clients(name), invoice_lines(qty, unit_sell)')
    .eq('status', 'sent')
    .order('due_date', { ascending: true })
  if (error) throw error

  const startToday = startOfDay(today).getTime()
  const rows = (data ?? []).map((inv) => {
    const lines = ((inv.invoice_lines ?? []) as { qty: number; unit_sell: number }[]).map(
      (l) => ({ qty: Number(l.qty), unitSell: Number(l.unit_sell) })
    )
    const { total } = docTotals(lines, Number(inv.gst_rate))
    const dueDate = inv.due_date as string | null
    return {
      id: inv.id as string,
      number: inv.number as string,
      client: (inv.clients as unknown as { name: string } | null)?.name ?? '—',
      total,
      dueDate,
      overdue: dueDate != null && parseISO(dueDate).getTime() < startToday,
    }
  })

  return {
    rows,
    outstandingTotal: round2(rows.reduce((s, r) => s + r.total, 0)),
  }
}

// ─── 4. Time-bar warnings ─────────────────────────────────────────────────────

async function loadTimeBarWarnings(
  supabase: Db,
  today: Date
): Promise<TimeBarRow[]> {
  const { data, error } = await supabase
    .from('variations')
    .select('id, project_id, number, title, time_bar_date, projects(number, name)')
    .in('status', ['notified', 'priced'])
    .not('time_bar_date', 'is', null)
    .lte('time_bar_date', dateStr(addDays(today, 7)))
    .order('time_bar_date', { ascending: true })
  if (error) throw error

  return (data ?? []).map((v) => {
    const project = v.projects as unknown as { number: string; name: string } | null
    return {
      id: v.id as string,
      projectId: v.project_id as string,
      projectLabel: project ? `${project.number} — ${project.name}` : '—',
      number: Number(v.number),
      title: v.title as string,
      daysLeft: differenceInCalendarDays(parseISO(v.time_bar_date as string), today),
    }
  })
}

// ─── 5. Compliance expiries ───────────────────────────────────────────────────

async function loadComplianceExpiries(
  supabase: Db,
  today: Date
): Promise<ComplianceRow[]> {
  const { data, error } = await supabase
    .from('vendor_compliance_docs')
    .select('id, vendor_id, kind, expiry_date, vendors(name)')
    .lte('expiry_date', dateStr(addDays(today, 30)))
    .order('expiry_date', { ascending: true })
  if (error) throw error

  const todayStr = dateStr(today)
  return (data ?? []).map((d) => ({
    id: d.id as string,
    vendorId: d.vendor_id as string,
    vendor: (d.vendors as unknown as { name: string } | null)?.name ?? '—',
    kind: d.kind as string,
    expiry: d.expiry_date as string,
    expired: (d.expiry_date as string) < todayStr,
  }))
}

// ─── 6. Retention due ─────────────────────────────────────────────────────────

async function loadRetentionDue(
  supabase: Db,
  today: Date
): Promise<RetentionDueRow[]> {
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, number, name, practical_completion_date, pc_release_fraction, dlp_months')
    .not('practical_completion_date', 'is', null)
  if (error) throw error
  if (!projects || projects.length === 0) return []

  const { data: entries, error: entriesError } = await supabase
    .from('retention_entries')
    .select('project_id, kind, amount')
    .in('project_id', projects.map((p) => p.id as string))
  if (entriesError) throw entriesError

  const cutoff = addDays(startOfDay(today), 60).getTime()
  const rows: RetentionDueRow[] = []

  for (const p of projects) {
    const projectEntries = (entries ?? []).filter((e) => e.project_id === p.id)
    const held = round2(
      projectEntries.reduce(
        (s, e) => s + (e.kind === 'withheld' ? Number(e.amount) : -Number(e.amount)),
        0
      )
    )
    if (held <= 0) continue
    const hasFinalRelease = projectEntries.some((e) => e.kind === 'release_final')
    if (hasFinalRelease) continue
    const hasPcRelease = projectEntries.some((e) => e.kind === 'release_pc')

    const pcDate = parseISO(p.practical_completion_date as string)
    const finalDate = addMonths(pcDate, Number(p.dlp_months))
    const projectLabel = `${p.number} — ${p.name}`
    const base = { projectId: p.id as string, projectLabel }

    if (!hasPcRelease) {
      // Neither release recorded: PC release = held × fraction, final = remainder.
      const pcAmount = round2(held * Number(p.pc_release_fraction))
      const finalAmount = round2(held - pcAmount)
      if (pcAmount > 0 && pcDate.getTime() <= cutoff) {
        rows.push({ ...base, type: 'PC release', amount: pcAmount, date: dateStr(pcDate) })
      }
      if (finalAmount > 0 && finalDate.getTime() <= cutoff) {
        rows.push({ ...base, type: 'Final release', amount: finalAmount, date: dateStr(finalDate) })
      }
    } else if (finalDate.getTime() <= cutoff) {
      // PC release done — everything still held releases at end of DLP.
      rows.push({ ...base, type: 'Final release', amount: held, date: dateStr(finalDate) })
    }
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date))
}

// ─── 7. Active work summary ───────────────────────────────────────────────────

async function loadActiveWork(supabase: Db): Promise<ActiveWorkData> {
  const [projectsRes, jobsRes] = await Promise.all([
    supabase
      .from('projects')
      .select(
        `id, number, name, contract_sum,
         variations(status, sell_amount),
         claims(status, total_claimed_to_date),
         budget_lines(budget_amount)`
      )
      .eq('status', 'active')
      .order('number'),
    supabase
      .from('jobs')
      .select('status')
      .in('status', ['scheduled', 'in_progress', 'completed']),
  ])
  if (projectsRes.error) throw projectsRes.error
  if (jobsRes.error) throw jobsRes.error

  type ProjectRecord = {
    id: string
    number: string
    name: string
    contract_sum: number
    variations: { status: string; sell_amount: number }[] | null
    claims: { status: string; total_claimed_to_date: number | null }[] | null
    budget_lines: { budget_amount: number }[] | null
  }
  const projects = (projectsRes.data ?? []) as unknown as ProjectRecord[]
  const ids = projects.map((p) => p.id)

  let costs: { parent_id: string; amount: number }[] = []
  let poLines: { qty: number; unit_cost: number; purchase_orders: { project_id: string } }[] = []
  let commitments: { project_id: string; amount: number }[] = []

  if (ids.length > 0) {
    const [costsRes, poRes, commitRes] = await Promise.all([
      supabase
        .from('costs')
        .select('parent_id, amount')
        .eq('parent_type', 'project')
        .in('parent_id', ids),
      supabase
        .from('po_lines')
        .select('qty, unit_cost, purchase_orders!inner(project_id, status)')
        .in('purchase_orders.project_id', ids)
        .in('purchase_orders.status', ['issued', 'closed']),
      supabase
        .from('commitments')
        .select('project_id, amount')
        .eq('status', 'active')
        .in('project_id', ids),
    ])
    if (costsRes.error) throw costsRes.error
    if (poRes.error) throw poRes.error
    if (commitRes.error) throw commitRes.error
    costs = (costsRes.data ?? []) as { parent_id: string; amount: number }[]
    poLines = (poRes.data ?? []) as unknown as typeof poLines
    commitments = (commitRes.data ?? []) as { project_id: string; amount: number }[]
  }

  const projectRows = projects.map((p) => {
    const approvedVos = (p.variations ?? [])
      .filter((v) => v.status === 'approved')
      .reduce((s, v) => s + Number(v.sell_amount), 0)
    const adjustedSum = round2(Number(p.contract_sum) + approvedVos)

    const claimedValues = (p.claims ?? [])
      .filter((c) => c.status !== 'draft' && c.total_claimed_to_date != null)
      .map((c) => Number(c.total_claimed_to_date))
    const claimed = claimedValues.length > 0 ? Math.max(...claimedValues) : 0
    const pctClaimed =
      adjustedSum > 0 ? Math.min(100, round2((claimed / adjustedSum) * 100)) : 0

    const budget = round2(
      (p.budget_lines ?? []).reduce((s, l) => s + Number(l.budget_amount), 0)
    )
    const actual = round2(
      costs.filter((c) => c.parent_id === p.id).reduce((s, c) => s + Number(c.amount), 0)
    )
    const committed = round2(
      poLines
        .filter((l) => l.purchase_orders.project_id === p.id)
        .reduce((s, l) => s + lineTotal(Number(l.qty), Number(l.unit_cost)), 0) +
        commitments
          .filter((c) => c.project_id === p.id)
          .reduce((s, c) => s + Number(c.amount), 0)
    )
    const spend = round2(committed + actual)
    const health: 'green' | 'amber' | 'red' =
      budget > 0
        ? spend > budget
          ? 'red'
          : spend > budget * 0.95
            ? 'amber'
            : 'green'
        : spend > 0
          ? 'red'
          : 'green'

    return { id: p.id, number: p.number, name: p.name, pctClaimed, spend, budget, health }
  })

  const statuses = (jobsRes.data ?? []).map((j) => j.status as string)
  return {
    projects: projectRows,
    jobCounts: {
      scheduled: statuses.filter((s) => s === 'scheduled').length,
      in_progress: statuses.filter((s) => s === 'in_progress').length,
      completed: statuses.filter((s) => s === 'completed').length,
    },
  }
}

// ─── 8. Today on site ─────────────────────────────────────────────────────────

async function loadTodayOnSite(
  supabase: Db,
  today: Date
): Promise<TodayOnSiteGroup[]> {
  const { data, error } = await supabase
    .from('assignments')
    .select(
      `id, job_id, project_id,
       profiles!assignments_user_id_fkey(full_name),
       jobs(number, title),
       projects(number, name)`
    )
    .eq('date', dateStr(today))
  if (error) throw error

  const groups = new Map<string, TodayOnSiteGroup>()
  for (const a of data ?? []) {
    const job = a.jobs as unknown as { number: string; title: string } | null
    const project = a.projects as unknown as { number: string; name: string } | null
    const person =
      (a.profiles as unknown as { full_name: string } | null)?.full_name ?? 'Unknown'
    const key = a.project_id ? `project:${a.project_id}` : `job:${a.job_id}`
    const targetLabel = project
      ? `${project.number} — ${project.name}`
      : job
        ? `${job.number} — ${job.title}`
        : 'Unassigned'
    const existing = groups.get(key)
    if (existing) existing.people.push(person)
    else groups.set(key, { key, targetLabel, people: [person] })
  }
  return [...groups.values()].sort((a, b) => a.targetLabel.localeCompare(b.targetLabel))
}

// ─── 9. SWMS outstanding ──────────────────────────────────────────────────────

async function loadSwmsOutstanding(
  supabase: Db,
  supervisorId: string | null
): Promise<SwmsOutstandingRow[]> {
  const [instancesRes, crewRes] = await Promise.all([
    supabase
      .from('swms_instances')
      .select(
        `id, title, version, project_id, job_id,
         projects(number, name, supervisor_id),
         jobs(number, title, supervisor_id)`
      )
      .eq('status', 'active'),
    supabase
      .from('profiles')
      .select('id')
      .in('role', ['supervisor', 'field'])
      .eq('active', true),
  ])
  if (instancesRes.error) throw instancesRes.error
  if (crewRes.error) throw crewRes.error

  type InstanceRecord = {
    id: string
    title: string
    version: number
    project_id: string | null
    job_id: string | null
    projects: { number: string; name: string; supervisor_id: string | null } | null
    jobs: { number: string; title: string; supervisor_id: string | null } | null
  }
  let instances = (instancesRes.data ?? []) as unknown as InstanceRecord[]
  // Supervisors only see instances for projects/jobs they supervise.
  if (supervisorId) {
    instances = instances.filter(
      (i) => (i.projects?.supervisor_id ?? i.jobs?.supervisor_id) === supervisorId
    )
  }

  const registerIds = new Set((crewRes.data ?? []).map((p) => p.id as string))
  if (instances.length === 0 || registerIds.size === 0) return []

  const { data: signatures, error: sigError } = await supabase
    .from('swms_signatures')
    .select('swms_instance_id, user_id, version')
    .in('swms_instance_id', instances.map((i) => i.id))
  if (sigError) throw sigError

  return instances.flatMap((i) => {
    // Signed = register members with a signature for the CURRENT version.
    const signed = new Set(
      (signatures ?? [])
        .filter(
          (s) =>
            s.swms_instance_id === i.id &&
            Number(s.version) === Number(i.version) &&
            registerIds.has(s.user_id as string)
        )
        .map((s) => s.user_id as string)
    ).size
    if (signed >= registerIds.size) return []

    const parentLabel = i.projects
      ? `${i.projects.number} — ${i.projects.name}`
      : i.jobs
        ? `${i.jobs.number} — ${i.jobs.title}`
        : '—'
    const href = i.project_id ? `/projects/${i.project_id}` : `/jobs/${i.job_id}`
    return [{ id: i.id, title: i.title, parentLabel, href, signed, total: registerIds.size }]
  })
}

// ─── 10. Hold points ──────────────────────────────────────────────────────────

async function loadHoldPoints(
  supabase: Db,
  today: Date
): Promise<HoldPointDueRow[]> {
  const { data, error } = await supabase
    .from('hold_points')
    .select('id, project_id, title, date, status, projects!inner(number, name, status)')
    .neq('status', 'released')
    .lte('date', dateStr(addDays(today, 7)))
    .eq('projects.status', 'active')
    .order('date', { ascending: true })
  if (error) throw error

  const todayStr = dateStr(today)
  return (data ?? []).map((hp) => {
    const project = hp.projects as unknown as { number: string; name: string } | null
    return {
      id: hp.id as string,
      projectId: hp.project_id as string,
      projectLabel: project ? `${project.number} — ${project.name}` : '—',
      title: hp.title as string,
      date: hp.date as string,
      status: hp.status as string,
      overdue: (hp.date as string) < todayStr,
    }
  })
}

// ─── 11. Diaries missing ──────────────────────────────────────────────────────

async function loadDiariesMissing(
  supabase: Db,
  today: Date
): Promise<DiaryMissingRow[]> {
  // Yesterday, weekdays only: Sat/Sun roll back to Friday.
  let target = subDays(startOfDay(today), 1)
  if (isSunday(target)) target = subDays(target, 2)
  else if (isSaturday(target)) target = subDays(target, 1)
  const targetStr = dateStr(target)

  const [projectsRes, diariesRes, assignmentsRes] = await Promise.all([
    supabase.from('projects').select('id, number, name').eq('status', 'active'),
    supabase.from('diaries').select('project_id').eq('date', targetStr),
    supabase
      .from('assignments')
      .select('project_id')
      .eq('date', targetStr)
      .not('project_id', 'is', null),
  ])
  if (projectsRes.error) throw projectsRes.error
  if (diariesRes.error) throw diariesRes.error
  if (assignmentsRes.error) throw assignmentsRes.error

  const hasDiary = new Set((diariesRes.data ?? []).map((d) => d.project_id as string))
  const hadCrew = new Set(
    (assignmentsRes.data ?? []).map((a) => a.project_id as string)
  )

  return (projectsRes.data ?? [])
    .filter((p) => hadCrew.has(p.id as string) && !hasDiary.has(p.id as string))
    .map((p) => ({
      projectId: p.id as string,
      projectLabel: `${p.number} — ${p.name}`,
      missingDate: targetStr,
    }))
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const showMoney = profile.role === 'admin' || profile.role === 'office'

  const supabase = await createClient()
  const today = new Date()

  // Money queries are skipped entirely (never issued) for supervisors.
  const none = Promise.resolve(undefined)
  const [
    claimsDue,
    quotesAwaiting,
    unpaidInvoices,
    timeBars,
    compliance,
    retentionDue,
    activeWork,
    todayOnSite,
    swmsOutstanding,
    holdPoints,
    diariesMissing,
  ] = await Promise.all([
    showMoney ? settle(() => loadClaimsDue(supabase, today)) : none,
    showMoney ? settle(() => loadQuotesAwaiting(supabase, today)) : none,
    showMoney ? settle(() => loadUnpaidInvoices(supabase, today)) : none,
    showMoney ? settle(() => loadTimeBarWarnings(supabase, today)) : none,
    showMoney ? settle(() => loadComplianceExpiries(supabase, today)) : none,
    showMoney ? settle(() => loadRetentionDue(supabase, today)) : none,
    showMoney ? settle(() => loadActiveWork(supabase)) : none,
    settle(() => loadTodayOnSite(supabase, today)),
    settle(() => loadSwmsOutstanding(supabase, showMoney ? null : profile.id)),
    settle(() => loadHoldPoints(supabase, today)),
    settle(() => loadDiariesMissing(supabase, today)),
  ])

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={
          showMoney
            ? 'What needs attention across money, compliance and site.'
            : 'What needs attention on site today.'
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {showMoney && (
          <>
            <ClaimsDueCard data={claimsDue ?? null} />
            <QuotesAwaitingCard data={quotesAwaiting ?? null} />
            <UnpaidInvoicesCard data={unpaidInvoices ?? null} />
            <TimeBarCard data={timeBars ?? null} />
            <ComplianceCard data={compliance ?? null} />
            <RetentionDueCard data={retentionDue ?? null} />
            <ActiveWorkCard data={activeWork ?? null} />
          </>
        )}
        <TodayOnSiteCard data={todayOnSite ?? null} />
        <SwmsOutstandingCard data={swmsOutstanding ?? null} />
        <HoldPointsCard data={holdPoints ?? null} />
        <DiariesMissingCard data={diariesMissing ?? null} />
      </div>
    </div>
  )
}
