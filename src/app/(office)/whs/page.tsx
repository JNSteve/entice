import Link from 'next/link'
import { differenceInCalendarDays, format, parseISO, subDays } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { nowAU } from '@/lib/tz'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuditHistory } from '@/components/AuditHistory'
import type { AuditRow } from '@/lib/audit-queries'
import { fmtDate } from '@/lib/format'
import type { FormTemplateKind } from '@/lib/zod'

const KIND_SHORT: Record<FormTemplateKind, string> = {
  prestart: 'pre-start',
  take5: 'take 5',
  toolbox: 'toolbox',
  induction: 'induction',
  incident: 'incident',
  custom: 'custom',
  audit: 'audit',
}

function dateStr(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  sub,
  href,
  alert,
}: {
  title: string
  value: number
  sub: React.ReactNode
  href: string
  /** Highlight the value in red when non-zero (bad-news stats). */
  alert?: boolean
}) {
  return (
    <Link href={href} className="group">
      <Card size="sm" className="h-full transition-colors group-hover:border-muted-foreground/40">
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground group-hover:underline">
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <span
            className={
              alert && value > 0
                ? 'text-2xl font-semibold tabular-nums text-red-600 dark:text-red-400'
                : 'text-2xl font-semibold tabular-nums'
            }
          >
            {value}
          </span>
          <span className="text-xs text-muted-foreground">{sub}</span>
        </CardContent>
      </Card>
    </Link>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function WhsOverviewPage() {
  const supabase = await createClient()

  // AU calendar 'today' for date-string guards and day-diffs; weekAgoIso is a
  // real instant (timestamp filter) so it stays anchored to the actual clock.
  const today = nowAU()
  const todayStr = dateStr(today)
  const weekAgoIso = subDays(new Date(), 7).toISOString()

  const [
    { data: incidents },
    { data: overdueActions },
    { data: pendingSubbies },
    { data: formSignons },
    { data: swmsSignatures },
    { data: recentSubmissions },
    { data: overdueHoldPoints },
    { data: expiredCompliance },
    { data: overdueDocReviews },
    { data: overduePlannedAudits },
    { data: openAuditFindings },
    { data: auditRows },
  ] = await Promise.all([
    supabase.from('incidents').select('id, status, severity'),
    // Overdue corrective actions — same shape as the dashboard Safety card.
    supabase
      .from('corrective_actions')
      .select('id, incident_id, description, due_date, incidents(number)')
      .eq('status', 'open')
      .not('due_date', 'is', null)
      .lt('due_date', todayStr),
    supabase
      .from('subbie_swms')
      .select('id')
      .in('status', ['submitted', 'under_review']),
    supabase
      .from('form_signons')
      .select('id, profile_id')
      .gte('signed_at', weekAgoIso),
    supabase
      .from('swms_signatures')
      .select('id, user_id')
      .gte('signed_at', weekAgoIso),
    supabase
      .from('form_submissions')
      .select('id, kind')
      .gte('submitted_at', weekAgoIso),
    // Unreleased hold points past date on active projects — dashboard shape.
    supabase
      .from('hold_points')
      .select('id, project_id, title, date, projects!inner(number, name, status)')
      .neq('status', 'released')
      .lt('date', todayStr)
      .eq('projects.status', 'active')
      .order('date', { ascending: true }),
    // Expired vendor compliance docs — dashboard Compliance card shape.
    supabase
      .from('vendor_compliance_docs')
      .select('id, vendor_id, kind, expiry_date, vendors(name)')
      .lt('expiry_date', todayStr)
      .order('expiry_date', { ascending: true }),
    // Issued controlled documents past their review date.
    supabase
      .from('documents')
      .select('id, title, doc_number, review_due')
      .eq('status', 'issued')
      .not('review_due', 'is', null)
      .lt('review_due', todayStr)
      .order('review_due', { ascending: true }),
    // Internal audits still 'planned' past their planned date.
    supabase
      .from('audits')
      .select('id, number, planned_date, audit_areas(name)')
      .eq('status', 'planned')
      .not('planned_date', 'is', null)
      .lt('planned_date', todayStr)
      .order('planned_date', { ascending: true }),
    // Open internal-audit findings awaiting closure.
    supabase
      .from('audit_findings')
      .select('id, audit_id, classification, description, audits(number)')
      .eq('status', 'open')
      .order('created_at', { ascending: true }),
    supabase
      .from('audit_log')
      .select('id, at, actor_id, actor_name, entity_type, entity_id, project_id, action, detail')
      .order('at', { ascending: false })
      .limit(10),
  ])

  // ── Stats ──────────────────────────────────────────────────────────────────

  const openIncidents = (incidents ?? []).filter((i) => i.status !== 'closed')
  const highSeverity = openIncidents.filter((i) => Number(i.severity) >= 4).length

  const overdueActionRows = (overdueActions ?? []).map((a) => ({
    id: a.id as string,
    incidentId: a.incident_id as string,
    incidentNumber:
      (a.incidents as unknown as { number: string } | null)?.number ?? '—',
    description: a.description as string,
    daysOverdue: Math.max(
      0,
      differenceInCalendarDays(today, parseISO(a.due_date as string))
    ),
  }))

  const signonRows = [
    ...(formSignons ?? []).map((s) => ({ internal: s.profile_id != null })),
    ...(swmsSignatures ?? []).map((s) => ({ internal: s.user_id != null })),
  ]
  const internalSignons = signonRows.filter((s) => s.internal).length
  const externalSignons = signonRows.length - internalSignons

  const formsByKind = new Map<string, number>()
  for (const s of recentSubmissions ?? []) {
    const kind = s.kind as string
    formsByKind.set(kind, (formsByKind.get(kind) ?? 0) + 1)
  }
  const formsBreakdown = [...formsByKind.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `${count} ${KIND_SHORT[kind as FormTemplateKind] ?? kind}`)
    .join(' · ')

  // ── Needs attention rows ───────────────────────────────────────────────────

  const holdPointRows = (overdueHoldPoints ?? []).map((hp) => {
    const project = hp.projects as unknown as { number: string; name: string } | null
    return {
      id: hp.id as string,
      projectId: hp.project_id as string,
      title: hp.title as string,
      date: hp.date as string,
      projectLabel: project ? `${project.number} — ${project.name}` : '—',
    }
  })

  const complianceRows = (expiredCompliance ?? []).map((d) => ({
    id: d.id as string,
    vendorId: d.vendor_id as string,
    vendor: (d.vendors as unknown as { name: string } | null)?.name ?? '—',
    kind: d.kind as string,
    expiry: d.expiry_date as string,
  }))

  const docReviewRows = (overdueDocReviews ?? []).map((d) => ({
    id: d.id as string,
    title: d.title as string,
    docNumber: (d.doc_number as string | null) ?? null,
    daysOverdue: Math.max(
      0,
      differenceInCalendarDays(today, parseISO(d.review_due as string))
    ),
  }))

  const overdueAuditRows = (overduePlannedAudits ?? []).map((a) => ({
    id: a.id as string,
    number: a.number as string,
    area: (a.audit_areas as unknown as { name: string } | null)?.name ?? '—',
    daysOverdue: Math.max(
      0,
      differenceInCalendarDays(today, parseISO(a.planned_date as string))
    ),
  }))

  const openFindingRows = (openAuditFindings ?? []).map((f) => ({
    id: f.id as string,
    auditId: f.audit_id as string,
    auditNumber:
      (f.audits as unknown as { number: string } | null)?.number ?? '—',
    classification: (f.classification as string).replace(/_nc$/, ' NC'),
    description: f.description as string,
  }))

  const needsAttentionCount =
    overdueActionRows.length +
    holdPointRows.length +
    complianceRows.length +
    docReviewRows.length +
    overdueAuditRows.length +
    openFindingRows.length

  const recentActivity: AuditRow[] = ((auditRows ?? []) as Record<string, unknown>[]).map(
    (r) => ({
      id: r.id as string,
      at: r.at as string,
      actor_id: (r.actor_id as string | null) ?? null,
      actor_name: (r.actor_name as string | null) ?? null,
      entity_type: r.entity_type as string,
      entity_id: r.entity_id as string,
      project_id: (r.project_id as string | null) ?? null,
      action: r.action as string,
      detail: (r.detail ?? {}) as Record<string, unknown>,
    })
  )

  return (
    <div className="flex flex-col gap-6">
      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          title="Open incidents"
          value={openIncidents.length}
          sub={
            highSeverity > 0 ? (
              <span className="font-medium text-red-600 dark:text-red-400">
                {highSeverity} high severity
              </span>
            ) : (
              'No high-severity incidents'
            )
          }
          href="/whs/incidents"
          alert
        />
        <StatCard
          title="Overdue corrective actions"
          value={overdueActionRows.length}
          sub={overdueActionRows.length > 0 ? 'Past their due date' : 'Nothing overdue'}
          href="/whs/incidents"
          alert
        />
        <StatCard
          title="Pending subbie reviews"
          value={(pendingSubbies ?? []).length}
          sub={
            (pendingSubbies ?? []).length > 0
              ? 'Awaiting review'
              : 'Queue is clear'
          }
          href="/whs/subbie-swms"
        />
        <StatCard
          title="Sign-ons — last 7 days"
          value={signonRows.length}
          sub={`${internalSignons} internal · ${externalSignons} external`}
          href="/whs/forms"
        />
        <StatCard
          title="Forms — last 7 days"
          value={(recentSubmissions ?? []).length}
          sub={formsBreakdown || 'No forms submitted'}
          href="/whs/forms"
        />
      </div>

      {/* Needs attention + recent activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Needs attention</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {needsAttentionCount === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing outstanding — corrective actions, hold points, vendor
                compliance, document reviews and internal audits are all in
                order.
              </p>
            ) : (
              <>
                {overdueActionRows.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-start justify-between gap-2 text-sm"
                  >
                    <div className="flex min-w-0 flex-col">
                      <Link
                        href={`/whs/incidents/${a.incidentId}`}
                        className="truncate hover:underline"
                      >
                        {a.description}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        Corrective action · {a.incidentNumber}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-red-600 tabular-nums dark:text-red-400">
                      {a.daysOverdue}d overdue
                    </span>
                  </div>
                ))}
                {holdPointRows.map((hp) => (
                  <div
                    key={hp.id}
                    className="flex items-start justify-between gap-2 text-sm"
                  >
                    <div className="flex min-w-0 flex-col">
                      <Link
                        href={`/projects/${hp.projectId}/programme`}
                        className="truncate hover:underline"
                      >
                        {hp.title}
                      </Link>
                      <span className="truncate text-xs text-muted-foreground">
                        Hold point · {hp.projectLabel}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-red-600 tabular-nums dark:text-red-400">
                      {fmtDate(hp.date)}
                    </span>
                  </div>
                ))}
                {complianceRows.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-start justify-between gap-2 text-sm"
                  >
                    <div className="flex min-w-0 flex-col">
                      <Link
                        href={`/vendors/${d.vendorId}`}
                        className="truncate hover:underline"
                      >
                        {d.vendor}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        Compliance expired · {d.kind.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-red-600 tabular-nums dark:text-red-400">
                      {fmtDate(d.expiry)}
                    </span>
                  </div>
                ))}
                {docReviewRows.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-start justify-between gap-2 text-sm"
                  >
                    <div className="flex min-w-0 flex-col">
                      <Link
                        href="/documents"
                        className="truncate hover:underline"
                      >
                        {d.title}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        Document review due{d.docNumber ? ` · ${d.docNumber}` : ''}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-red-600 tabular-nums dark:text-red-400">
                      {d.daysOverdue}d overdue
                    </span>
                  </div>
                ))}
                {overdueAuditRows.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-start justify-between gap-2 text-sm"
                  >
                    <div className="flex min-w-0 flex-col">
                      <Link
                        href={`/whs/audits/${a.id}`}
                        className="truncate hover:underline"
                      >
                        {a.area}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        Audit overdue · {a.number}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-red-600 tabular-nums dark:text-red-400">
                      {a.daysOverdue}d overdue
                    </span>
                  </div>
                ))}
                {openFindingRows.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-start justify-between gap-2 text-sm"
                  >
                    <div className="flex min-w-0 flex-col">
                      <Link
                        href={`/whs/audits/${f.auditId}`}
                        className="truncate hover:underline"
                      >
                        {f.description}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        Open audit finding · {f.auditNumber}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs font-medium capitalize text-red-600 dark:text-red-400">
                      {f.classification}
                    </span>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">
              <Link href="/whs/audit" className="hover:underline">
                Recent activity
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No WHS activity yet.</p>
            ) : (
              <AuditHistory rows={recentActivity} heading="" />
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              <Link href="/whs/audit" className="underline underline-offset-2 hover:text-foreground">
                Full audit register
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
