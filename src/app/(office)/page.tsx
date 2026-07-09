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
import { nowAU, todayAU } from '@/lib/tz'
import { isBackupStale } from '@/lib/backup'
import {
  PROPERTY_COMPLIANCE_KIND_LABELS,
  type PropertyComplianceKind,
} from '@/lib/portal'
import { PageHeader } from '@/components/PageHeader'
import { docTotals, lineTotal, round2 } from '@/lib/money'
import { permitUsage, type WasteUnit } from '@/lib/env'
import {
  ActiveWorkCard,
  ClaimsDueCard,
  ComplianceCard,
  DiariesMissingCard,
  EnvironmentCard,
  HoldPointsCard,
  NcrCard,
  PortalActivityCard,
  PortalEngagementCard,
  PrestartTodayCard,
  PropertyComplianceCard,
  QualityCard,
  QuotesAwaitingCard,
  RetentionDueCard,
  SafetyCard,
  SwmsOutstandingCard,
  SystemHealthCard,
  TimeBarCard,
  TodayOnSiteCard,
  UnpaidInvoicesCard,
  type ActiveWorkData,
  type ClaimsDueData,
  type ComplianceRow,
  type DiaryMissingRow,
  type EnvExpiryRow,
  type EnvPermitUsageRow,
  type EnvironmentData,
  type HoldPointDueRow,
  type NcrData,
  type NcrOverdueCapaRow,
  type PortalActivityData,
  type PortalEngagementRow,
  type PrestartTodayRow,
  type PortalDecisionRow,
  type PropertyComplianceDueRow,
  type QualityData,
  type QuoteAwaitingRow,
  type RetentionDueRow,
  type SafetyData,
  type SafetyOverdueRow,
  type SwmsOutstandingRow,
  type SystemHealthData,
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
      .eq('archived', false)
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
    .eq('archived', false)
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

// ─── 5b. Property compliance due (client-portal recall surface) ───────────────

async function loadPropertyComplianceDue(
  supabase: Db,
  today: Date
): Promise<PropertyComplianceDueRow[]> {
  const { data, error } = await supabase
    .from('property_compliance_items')
    .select('id, kind, title, review_due, site_id, sites(name, client_id, clients(name))')
    .eq('status', 'active')
    .not('review_due', 'is', null)
    .lte('review_due', dateStr(addDays(today, 30)))
    .order('review_due', { ascending: true })
  if (error) throw error

  const todayStr = dateStr(today)
  return (data ?? []).map((i) => {
    const site = i.sites as unknown as {
      name: string
      client_id: string
      clients: { name: string } | null
    } | null
    return {
      id: i.id as string,
      clientId: site?.client_id ?? '',
      siteId: i.site_id as string,
      siteName: site?.name ?? '—',
      clientName: site?.clients?.name ?? '—',
      kindLabel: PROPERTY_COMPLIANCE_KIND_LABELS[i.kind as PropertyComplianceKind] ?? (i.kind as string),
      title: i.title as string,
      reviewDue: i.review_due as string,
      overdue: (i.review_due as string) < todayStr,
    }
  })
}

// ─── 6. Retention due ─────────────────────────────────────────────────────────

async function loadRetentionDue(
  supabase: Db,
  today: Date
): Promise<RetentionDueRow[]> {
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, number, name, practical_completion_date, pc_release_fraction, dlp_months')
    .eq('archived', false)
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
      .eq('archived', false)
      .eq('status', 'active')
      .order('number'),
    supabase
      .from('jobs')
      .select('status')
      .eq('archived', false)
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
    // Quality-origin (lot) hold points have their own dashboard card.
    .eq('origin', 'programme')
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

// ─── 12. Safety ───────────────────────────────────────────────────────────────

async function loadSafety(
  supabase: Db,
  today: Date
): Promise<SafetyData> {
  const todayStr = dateStr(today)

  const [incidentsRes, actionsRes] = await Promise.all([
    supabase
      .from('incidents')
      .select('id, number, status, severity'),
    supabase
      .from('corrective_actions')
      .select('id, incident_id, description, due_date, status, incidents(number)')
      .eq('status', 'open')
      .not('due_date', 'is', null)
      .lt('due_date', todayStr),
  ])
  if (incidentsRes.error) throw incidentsRes.error
  if (actionsRes.error) throw actionsRes.error

  const incidents = incidentsRes.data ?? []
  const openIncidents = incidents.filter((i) => i.status === 'open')
  const investigatingIncidents = incidents.filter((i) => i.status === 'investigating')
  const highSeverity = incidents.filter(
    (i) => (i.status === 'open' || i.status === 'investigating') && Number(i.severity) >= 4
  )

  const overdueActions: SafetyOverdueRow[] = (actionsRes.data ?? []).map((a) => {
    const incidentRel = a.incidents as unknown as { number: string } | null
    return {
      actionId: a.id as string,
      incidentId: a.incident_id as string,
      incidentNumber: incidentRel?.number ?? '—',
      description: a.description as string,
      daysOverdue: Math.max(
        0,
        differenceInCalendarDays(today, parseISO(a.due_date as string))
      ),
    }
  }).sort((a, b) => b.daysOverdue - a.daysOverdue)

  return {
    openCount: openIncidents.length,
    investigatingCount: investigatingIncidents.length,
    highSeverityCount: highSeverity.length,
    overdueActions,
  }
}

// ─── 13b. Quality (ITP / lots) ────────────────────────────────────────────────

async function loadQuality(supabase: Db): Promise<QualityData> {
  const [lotsRes, hpRes] = await Promise.all([
    supabase
      .from('lots')
      .select('id, number, description, project_id, projects!inner(number, name, status)')
      .eq('status', 'nonconforming')
      .eq('projects.status', 'active')
      .order('created_at', { ascending: false }),
    supabase
      .from('hold_points')
      .select('id, title, date, lot_id, project_id, projects!inner(number, name, status)')
      .eq('origin', 'quality')
      .neq('status', 'released')
      .eq('projects.status', 'active')
      .order('date', { ascending: true }),
  ])
  if (lotsRes.error) throw lotsRes.error
  if (hpRes.error) throw hpRes.error

  const label = (p: unknown) => {
    const project = p as { number: string; name: string } | null
    return project ? `${project.number} — ${project.name}` : '—'
  }

  return {
    nonconformingLots: (lotsRes.data ?? []).map((l) => ({
      id: l.id as string,
      projectId: l.project_id as string,
      number: l.number as string,
      description: l.description as string,
      projectLabel: label(l.projects),
    })),
    openHoldPoints: (hpRes.data ?? []).flatMap((hp) =>
      hp.lot_id
        ? [
            {
              id: hp.id as string,
              projectId: hp.project_id as string,
              lotId: hp.lot_id as string,
              title: hp.title as string,
              projectLabel: label(hp.projects),
              date: hp.date as string,
            },
          ]
        : []
    ),
  }
}

// ─── 13. NCRs (nonconformances + CAPA) ────────────────────────────────────────

async function loadNcr(supabase: Db, today: Date): Promise<NcrData> {
  const todayStr = dateStr(today)

  const [ncrsRes, capasRes] = await Promise.all([
    supabase.from('ncrs').select('id, status'),
    supabase
      .from('capa_actions')
      .select('id, ncr_id, description, due_date, status, ncrs(number)')
      .eq('status', 'open')
      .not('due_date', 'is', null)
      .lt('due_date', todayStr),
  ])
  if (ncrsRes.error) throw ncrsRes.error
  if (capasRes.error) throw capasRes.error

  const ncrs = ncrsRes.data ?? []

  const overdueCapas: NcrOverdueCapaRow[] = (capasRes.data ?? [])
    .map((c) => {
      const ncrRel = c.ncrs as unknown as { number: string } | null
      return {
        capaId: c.id as string,
        ncrId: c.ncr_id as string,
        ncrNumber: ncrRel?.number ?? '—',
        description: c.description as string,
        daysOverdue: Math.max(
          0,
          differenceInCalendarDays(today, parseISO(c.due_date as string))
        ),
      }
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue)

  return {
    openCount: ncrs.filter((n) => n.status === 'open').length,
    investigatingCount: ncrs.filter((n) => n.status === 'investigating').length,
    actionsCount: ncrs.filter((n) => n.status === 'actions').length,
    overdueCapas,
  }
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
    supabase.from('projects').select('id, number, name').eq('archived', false).eq('status', 'active'),
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

// ─── 15. Client portal activity (unread messages / new requests / decisions) ─

async function loadPortalActivity(
  supabase: Db,
  today: Date
): Promise<PortalActivityData> {
  const since = subDays(today, 14).toISOString()

  const [messagesRes, requestsRes, decisionsRes, feedbackRes, uploadsRes] = await Promise.all([
    supabase
      .from('portal_messages')
      .select('client_id, site_id, clients(name), sites(name)')
      .eq('sender', 'client')
      .eq('read_by_office', false),
    supabase
      .from('portal_requests')
      .select('id, number, title, urgency, created_at, clients(name)')
      .eq('status', 'submitted')
      .order('created_at', { ascending: true }),
    supabase
      .from('portal_acceptances')
      .select('id, kind, target_id, action, signer_name, reason, signed_at')
      .gte('signed_at', since)
      .order('signed_at', { ascending: false }),
    supabase
      .from('portal_feedback')
      .select(
        'id, rating, created_at, client_id, clients(name), jobs(number, title), projects(number, name)'
      )
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(6),
    supabase
      .from('portal_uploads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
  ])
  if (messagesRes.error) throw messagesRes.error
  if (requestsRes.error) throw requestsRes.error
  if (decisionsRes.error) throw decisionsRes.error
  if (feedbackRes.error) throw feedbackRes.error
  // portal_uploads may not exist until migration 0042 runs — treat as zero.
  const pendingUploads = uploadsRes.error ? 0 : (uploadsRes.count ?? 0)

  // Group unread messages into one row per thread (client × property).
  const threads = new Map<
    string,
    { clientId: string; siteId: string; clientName: string; siteName: string; count: number }
  >()
  for (const m of messagesRes.data ?? []) {
    const key = `${m.client_id}:${m.site_id}`
    const existing = threads.get(key)
    if (existing) existing.count++
    else {
      threads.set(key, {
        clientId: m.client_id as string,
        siteId: m.site_id as string,
        clientName:
          (m.clients as unknown as { name: string } | null)?.name ?? '—',
        siteName: (m.sites as unknown as { name: string } | null)?.name ?? '—',
        count: 1,
      })
    }
  }

  // Resolve decision targets (quote number/title; variation VO-n + project).
  const decisionRows = decisionsRes.data ?? []
  const quoteIds = decisionRows
    .filter((d) => d.kind === 'quote')
    .map((d) => d.target_id as string)
  const variationIds = decisionRows
    .filter((d) => d.kind === 'variation')
    .map((d) => d.target_id as string)

  const [quotesRes, variationsRes] = await Promise.all([
    quoteIds.length > 0
      ? supabase.from('quotes').select('id, number, title').in('id', quoteIds)
      : Promise.resolve({ data: [], error: null }),
    variationIds.length > 0
      ? supabase
          .from('variations')
          .select('id, number, title, project_id')
          .in('id', variationIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (quotesRes.error) throw quotesRes.error
  if (variationsRes.error) throw variationsRes.error

  const quoteById = new Map(
    (quotesRes.data ?? []).map((q) => [q.id as string, q])
  )
  const variationById = new Map(
    (variationsRes.data ?? []).map((v) => [v.id as string, v])
  )

  const decisions: PortalDecisionRow[] = decisionRows.flatMap((d): PortalDecisionRow[] => {
    if (d.kind === 'quote') {
      const quote = quoteById.get(d.target_id as string)
      if (!quote) return []
      return [
        {
          id: d.id as string,
          kind: 'quote' as const,
          action: d.action as 'accepted' | 'declined',
          label: `${quote.number} — ${quote.title}`,
          href: `/quotes/${quote.id}`,
          signerName: d.signer_name as string,
          reason: (d.reason as string | null) ?? null,
          signedAt: d.signed_at as string,
        },
      ]
    }
    const variation = variationById.get(d.target_id as string)
    if (!variation) return []
    return [
      {
        id: d.id as string,
        kind: 'variation' as const,
        action: d.action as 'accepted' | 'declined',
        label: `VO-${variation.number} — ${variation.title}`,
        href: `/projects/${variation.project_id}/variations`,
        signerName: d.signer_name as string,
        reason: (d.reason as string | null) ?? null,
        signedAt: d.signed_at as string,
      },
    ]
  })

  return {
    unreadThreads: [...threads.values()].sort((a, b) => b.count - a.count),
    newRequests: (requestsRes.data ?? []).map((r) => ({
      id: r.id as string,
      number: r.number as string,
      title: r.title as string,
      urgency: r.urgency as string,
      clientName: (r.clients as unknown as { name: string } | null)?.name ?? '—',
      createdAt: r.created_at as string,
    })),
    decisions,
    recentFeedback: (feedbackRes.data ?? []).map((f) => {
      const job = f.jobs as unknown as { number: string; title: string } | null
      const project = f.projects as unknown as {
        number: string
        name: string
      } | null
      return {
        id: f.id as string,
        rating: Number(f.rating),
        clientId: f.client_id as string,
        clientName: (f.clients as unknown as { name: string } | null)?.name ?? '—',
        work: job
          ? `${job.number} — ${job.title}`
          : project
            ? `${project.number} — ${project.name}`
            : '—',
        createdAt: f.created_at as string,
      }
    }),
    pendingUploads,
  }
}

// ─── 16. Environment (licences/permits expiring + permit allowances ≥80%) ────

async function loadEnvironment(
  supabase: Db,
  today: Date
): Promise<EnvironmentData> {
  const todayStr = dateStr(today)
  const horizon = dateStr(addDays(today, 30))

  const [facilitiesRes, permitsRes, loadsRes] = await Promise.all([
    supabase
      .from('env_facilities')
      .select('id, name, licence_no, licence_expiry')
      .eq('active', true)
      .not('licence_expiry', 'is', null)
      .lte('licence_expiry', horizon)
      .order('licence_expiry', { ascending: true }),
    supabase
      .from('env_permits')
      .select(
        'id, project_id, reference, allowance_qty, allowance_unit, expiry, projects(number, name)'
      ),
    supabase.from('waste_loads').select('permit_id, qty, unit'),
  ])
  if (facilitiesRes.error) throw facilitiesRes.error
  if (permitsRes.error) throw permitsRes.error
  if (loadsRes.error) throw loadsRes.error

  const expiries: EnvExpiryRow[] = (facilitiesRes.data ?? []).map((f) => ({
    id: f.id as string,
    label: f.name as string,
    detail: `Facility licence${f.licence_no ? ` ${f.licence_no}` : ''}`,
    href: '/whs/env',
    expiry: f.licence_expiry as string,
    expired: (f.licence_expiry as string) < todayStr,
  }))

  const loads = (loadsRes.data ?? []).map((l) => ({
    permit_id: (l.permit_id as string | null) ?? null,
    qty: Number(l.qty),
    unit: l.unit as WasteUnit,
  }))

  const usageRows: EnvPermitUsageRow[] = []
  for (const p of permitsRes.data ?? []) {
    const project = p.projects as unknown as { number: string; name: string } | null
    const projectLabel = project ? `${project.number} — ${project.name}` : '—'

    const expiry = (p.expiry as string | null) ?? null
    if (expiry && expiry <= horizon) {
      expiries.push({
        id: `permit-${p.id}`,
        label: p.reference as string,
        detail: `Permit · ${projectLabel}`,
        href: `/projects/${p.project_id}/env`,
        expiry,
        expired: expiry < todayStr,
      })
    }

    const usage = permitUsage(
      Number(p.allowance_qty),
      p.allowance_unit as WasteUnit,
      loads.filter((l) => l.permit_id === (p.id as string))
    )
    if (usage.level !== 'ok' && usage.pctUsed !== null) {
      usageRows.push({
        id: p.id as string,
        projectId: p.project_id as string,
        reference: p.reference as string,
        projectLabel,
        pctUsed: usage.pctUsed,
        level: usage.level,
      })
    }
  }

  expiries.sort((a, b) => a.expiry.localeCompare(b.expiry))
  usageRows.sort((a, b) => b.pctUsed - a.pctUsed)

  return { expiries, permitUsage: usageRows }
}

// ─── 14. System health (backup staleness / app errors / access reviews) ──────

async function loadSystemHealth(
  supabase: Db,
  isAdmin: boolean,
  todayStr: string
): Promise<SystemHealthData> {
  const [backupRes, reviewRes, errorsRes] = await Promise.all([
    supabase
      .from('backup_runs')
      .select('started_at')
      .eq('status', 'success')
      .order('started_at', { ascending: false })
      .limit(1),
    supabase
      .from('access_reviews')
      .select('number, next_review_due')
      .order('reviewed_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1),
    // app_errors is admin-only by RLS — don't even issue the query for office.
    isAdmin
      ? supabase
          .from('app_errors')
          .select('id', { count: 'exact', head: true })
          .eq('resolved', false)
          .gte('at', subDays(new Date(), 7).toISOString())
      : Promise.resolve({ count: null, error: null }),
  ])
  if (backupRes.error) throw backupRes.error
  if (reviewRes.error) throw reviewRes.error
  if (errorsRes.error) throw errorsRes.error

  const lastBackupAt =
    (backupRes.data?.[0]?.started_at as string | undefined) ?? null
  const latestReview = reviewRes.data?.[0] as
    | { number: string; next_review_due: string }
    | undefined

  return {
    backupStale: isBackupStale(lastBackupAt),
    lastBackupAt,
    unresolvedErrors: isAdmin ? (errorsRes.count ?? 0) : null,
    accessReviewOverdue:
      latestReview && latestReview.next_review_due < todayStr
        ? { number: latestReview.number, due: latestReview.next_review_due }
        : null,
  }
}

// ─── Portal engagement (dormancy radar) ──────────────────────────────────────
// PortalEngagementRow lives in dashboard-cards.tsx alongside the card.

async function loadPortalEngagement(
  supabase: Db,
  todayStr: string
): Promise<PortalEngagementRow[]> {
  const [{ data: links }, { data: clients }] = await Promise.all([
    supabase
      .from('client_links')
      .select('id, client_id, revoked_at, expires_at')
      .is('revoked_at', null),
    supabase.from('clients').select('id, name').eq('archived', false),
  ])
  const nowIso = new Date().toISOString()
  const live = (links ?? []).filter((l) => !l.expires_at || l.expires_at > nowIso)
  const clientIds = [...new Set(live.map((l) => l.client_id as string))].filter(
    (cid) => (clients ?? []).some((c) => c.id === cid)
  )
  if (clientIds.length === 0) return []

  const linkIds = live.map((l) => l.id as string)
  const [{ data: views }, { data: overdue }] = await Promise.all([
    supabase
      .from('portal_views')
      .select('client_link_id, viewed_at')
      .in('client_link_id', linkIds)
      .order('viewed_at', { ascending: false })
      .limit(2000),
    supabase
      .from('property_compliance_items')
      .select('id, sites!inner(client_id)')
      .eq('status', 'active')
      .not('review_due', 'is', null)
      .lt('review_due', todayStr),
  ])

  const lastByLink = new Map<string, string>()
  for (const v of views ?? []) {
    const key = v.client_link_id as string
    if (!lastByLink.has(key)) lastByLink.set(key, v.viewed_at as string)
  }
  const overdueByClient = new Map<string, number>()
  for (const o of overdue ?? []) {
    const cid = (o.sites as unknown as { client_id: string }).client_id
    overdueByClient.set(cid, (overdueByClient.get(cid) ?? 0) + 1)
  }

  const rows: PortalEngagementRow[] = clientIds.map((cid) => {
    const lasts = live
      .filter((l) => l.client_id === cid)
      .map((l) => lastByLink.get(l.id as string))
      .filter((x): x is string => Boolean(x))
      .sort()
    const lastViewed = lasts.at(-1) ?? null
    const daysSince = lastViewed
      ? Math.floor((Date.now() - new Date(lastViewed).getTime()) / 86_400_000)
      : null
    return {
      clientId: cid,
      clientName: (clients ?? []).find((c) => c.id === cid)?.name ?? 'Unknown client',
      daysSince,
      overdueItems: overdueByClient.get(cid) ?? 0,
    }
  })

  // Only stale clients (never viewed, or >30 days quiet), worst first:
  // overdue compliance tops the list, then by staleness.
  return rows
    .filter((r) => r.daysSince === null || r.daysSince > 30)
    .sort(
      (a, b) =>
        b.overdueItems - a.overdueItems ||
        (b.daysSince ?? 9999) - (a.daysSince ?? 9999)
    )
}

// ─── Pre-starts today ─────────────────────────────────────────────────────────

async function loadPrestartsToday(
  supabase: Db,
  todayStr: string
): Promise<PrestartTodayRow[]> {
  // Brisbane is fixed +10 — the AU day starts at T00:00:00+10:00.
  const dayStartIso = new Date(`${todayStr}T00:00:00+10:00`).toISOString()
  const [{ data: assignments }, { data: meetings }] = await Promise.all([
    supabase
      .from('assignments')
      .select('project_id, job_id, projects(number, name), jobs(number, title)')
      .eq('date', todayStr),
    supabase
      .from('form_submissions')
      .select('id, project_id, job_id')
      .eq('kind', 'prestart_meeting')
      .gte('submitted_at', dayStartIso),
  ])

  const byTarget = new Map<string, PrestartTodayRow>()
  for (const a of assignments ?? []) {
    const key = (a.project_id ?? a.job_id) as string | null
    if (!key) continue
    const existing = byTarget.get(key)
    if (existing) {
      existing.crew += 1
      continue
    }
    const project = a.projects as unknown as { number: string; name: string } | null
    const job = a.jobs as unknown as { number: string; title: string } | null
    const meeting = (meetings ?? []).find((m) =>
      a.project_id ? m.project_id === a.project_id : m.job_id === a.job_id
    )
    byTarget.set(key, {
      key,
      label: project
        ? `${project.number} — ${project.name}`
        : job
          ? `${job.number} — ${job.title}`
          : 'Unknown',
      crew: 1,
      done: Boolean(meeting),
      href: meeting ? `/field/safety/submission/${meeting.id}` : '/whs/forms',
    })
  }
  // Missing pre-starts first, then by label.
  return [...byTarget.values()].sort(
    (a, b) => Number(a.done) - Number(b.done) || a.label.localeCompare(b.label)
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const showMoney = profile.role === 'admin' || profile.role === 'office'

  const supabase = await createClient()
  // Anchored to the Australian (Brisbane) calendar day so date-window/day-diff
  // logic in the loaders below is correct on a UTC server.
  const today = nowAU()

  // Money queries are skipped entirely (never issued) for supervisors.
  const none = Promise.resolve(undefined)
  const [
    claimsDue,
    quotesAwaiting,
    unpaidInvoices,
    timeBars,
    compliance,
    propertyCompliance,
    retentionDue,
    activeWork,
    prestartsToday,
    todayOnSite,
    swmsOutstanding,
    holdPoints,
    diariesMissing,
    safety,
    ncr,
    environment,
    systemHealth,
    portalActivity,
    portalEngagement,
    quality,
  ] = await Promise.all([
    showMoney ? settle(() => loadClaimsDue(supabase, today)) : none,
    showMoney ? settle(() => loadQuotesAwaiting(supabase, today)) : none,
    showMoney ? settle(() => loadUnpaidInvoices(supabase, today)) : none,
    showMoney ? settle(() => loadTimeBarWarnings(supabase, today)) : none,
    showMoney ? settle(() => loadComplianceExpiries(supabase, today)) : none,
    showMoney ? settle(() => loadPropertyComplianceDue(supabase, today)) : none,
    showMoney ? settle(() => loadRetentionDue(supabase, today)) : none,
    showMoney ? settle(() => loadActiveWork(supabase)) : none,
    settle(() => loadPrestartsToday(supabase, todayAU())),
    settle(() => loadTodayOnSite(supabase, today)),
    settle(() => loadSwmsOutstanding(supabase, showMoney ? null : profile.id)),
    settle(() => loadHoldPoints(supabase, today)),
    settle(() => loadDiariesMissing(supabase, today)),
    settle(() => loadSafety(supabase, today)),
    settle(() => loadNcr(supabase, today)),
    settle(() => loadEnvironment(supabase, today)),
    showMoney
      ? settle(() =>
          loadSystemHealth(supabase, profile.role === 'admin', todayAU())
        )
      : none,
    showMoney ? settle(() => loadPortalActivity(supabase, today)) : none,
    showMoney ? settle(() => loadPortalEngagement(supabase, todayAU())) : none,
    settle(() => loadQuality(supabase)),
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
            <PortalActivityCard data={portalActivity ?? null} />
            <PortalEngagementCard data={portalEngagement ?? null} />
            <ClaimsDueCard data={claimsDue ?? null} />
            <QuotesAwaitingCard data={quotesAwaiting ?? null} />
            <UnpaidInvoicesCard data={unpaidInvoices ?? null} />
            <TimeBarCard data={timeBars ?? null} />
            <ComplianceCard data={compliance ?? null} />
            <PropertyComplianceCard data={propertyCompliance ?? null} />
            <RetentionDueCard data={retentionDue ?? null} />
            <ActiveWorkCard data={activeWork ?? null} />
            <SystemHealthCard data={systemHealth ?? null} />
          </>
        )}
        <PrestartTodayCard data={prestartsToday ?? null} />
        <TodayOnSiteCard data={todayOnSite ?? null} />
        <SwmsOutstandingCard data={swmsOutstanding ?? null} />
        <HoldPointsCard data={holdPoints ?? null} />
        <DiariesMissingCard data={diariesMissing ?? null} />
        <SafetyCard data={safety ?? null} />
        <NcrCard data={ncr ?? null} />
        <EnvironmentCard data={environment ?? null} />
        <QualityCard data={quality ?? null} />
      </div>
    </div>
  )
}
