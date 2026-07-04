import Link from 'next/link'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { aud, fmtDate } from '@/lib/format'
import { StatusBadge } from '@/components/StatusBadge'

/**
 * Dashboard card components (server components). Each card receives its data
 * pre-fetched by the page; `null` means the query failed and the card shows a
 * load-error note instead of breaking the page.
 */

// ─── Shared shell ─────────────────────────────────────────────────────────────

const MAX_ROWS = 8

function DashboardCard({
  title,
  href,
  className,
  children,
}: {
  title: string
  href: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <Card size="sm" className={className}>
      <CardHeader>
        <CardTitle className="text-sm">
          <Link href={href} className="hover:underline">
            {title}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">{children}</CardContent>
    </Card>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

function LoadError() {
  return <Muted>Couldn&apos;t load this card.</Muted>
}

function MoreNote({ total }: { total: number }) {
  if (total <= MAX_ROWS) return null
  return (
    <p className="text-xs text-muted-foreground">+{total - MAX_ROWS} more</p>
  )
}

// ─── 1. Claims due ────────────────────────────────────────────────────────────

export type ClaimDueRow = {
  projectId: string
  projectLabel: string
  claimDate: string
}

export type SubmittedClaimRow = {
  claimId: string
  projectId: string
  projectLabel: string
  number: number
  total: number | null
  daysSince: number
}

export type ClaimsDueData = {
  due: ClaimDueRow[]
  submitted: SubmittedClaimRow[]
}

export function ClaimsDueCard({ data }: { data: ClaimsDueData | null }) {
  return (
    <DashboardCard title="Claims due" href="/money">
      {data === null ? (
        <LoadError />
      ) : data.due.length === 0 && data.submitted.length === 0 ? (
        <Muted>Nothing due.</Muted>
      ) : (
        <>
          {data.due.slice(0, MAX_ROWS).map((r) => (
            <div
              key={r.projectId}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <Link
                href={`/projects/${r.projectId}`}
                className="min-w-0 truncate hover:underline"
              >
                {r.projectLabel}
              </Link>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {fmtDate(r.claimDate)}
              </span>
              <Link
                href={`/projects/${r.projectId}/claims`}
                className="shrink-0 text-xs font-medium text-primary hover:underline"
              >
                Start claim
              </Link>
            </div>
          ))}
          <MoreNote total={data.due.length} />
          {data.submitted.length > 0 && (
            <>
              <p className="mt-1 text-xs font-medium text-muted-foreground">
                Submitted, awaiting certification
              </p>
              {data.submitted.slice(0, MAX_ROWS).map((r) => (
                <div
                  key={r.claimId}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <Link
                    href={`/projects/${r.projectId}/claims/${r.claimId}`}
                    className="min-w-0 truncate hover:underline"
                  >
                    {r.projectLabel} — PC-{r.number}
                  </Link>
                  <span className="shrink-0 text-xs tabular-nums">
                    {r.total != null ? aud(r.total) : '—'}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {r.daysSince}d
                  </span>
                </div>
              ))}
              <MoreNote total={data.submitted.length} />
            </>
          )}
        </>
      )}
    </DashboardCard>
  )
}

// ─── 2. Quotes awaiting ───────────────────────────────────────────────────────

export type QuoteAwaitingRow = {
  id: string
  number: string
  title: string
  value: number
  ageDays: number
}

export function QuotesAwaitingCard({
  data,
}: {
  data: QuoteAwaitingRow[] | null
}) {
  return (
    <DashboardCard title="Quotes awaiting" href="/quotes?status=sent">
      {data === null ? (
        <LoadError />
      ) : data.length === 0 ? (
        <Muted>No quotes awaiting acceptance.</Muted>
      ) : (
        <>
          {data.slice(0, MAX_ROWS).map((q) => (
            <div
              key={q.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <Link
                href={`/quotes/${q.id}`}
                className="min-w-0 truncate hover:underline"
              >
                <span className="font-mono">{q.number}</span> — {q.title}
              </Link>
              <span className="shrink-0 text-xs tabular-nums">
                {aud(q.value)}
              </span>
              <span
                className={cn(
                  'shrink-0 text-xs tabular-nums',
                  q.ageDays > 14
                    ? 'font-medium text-red-600 dark:text-red-400'
                    : q.ageDays > 7
                      ? 'font-medium text-amber-600 dark:text-amber-400'
                      : 'text-muted-foreground'
                )}
              >
                {q.ageDays}d
              </span>
            </div>
          ))}
          <MoreNote total={data.length} />
        </>
      )}
    </DashboardCard>
  )
}

// ─── 3. Unpaid invoices ───────────────────────────────────────────────────────

export type UnpaidInvoiceRow = {
  id: string
  number: string
  client: string
  total: number
  dueDate: string | null
  overdue: boolean
}

export type UnpaidInvoicesData = {
  rows: UnpaidInvoiceRow[]
  outstandingTotal: number
}

export function UnpaidInvoicesCard({
  data,
}: {
  data: UnpaidInvoicesData | null
}) {
  return (
    <DashboardCard title="Unpaid invoices" href="/money?filter=unpaid">
      {data === null ? (
        <LoadError />
      ) : data.rows.length === 0 ? (
        <Muted>No unpaid invoices.</Muted>
      ) : (
        <>
          {data.rows.slice(0, MAX_ROWS).map((inv) => (
            <div
              key={inv.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <Link
                href={`/invoices/${inv.id}`}
                className="min-w-0 truncate hover:underline"
              >
                <span className="font-mono">{inv.number}</span> — {inv.client}
              </Link>
              <span className="shrink-0 text-xs tabular-nums">
                {aud(inv.total)}
              </span>
              <span
                className={cn(
                  'shrink-0 text-xs tabular-nums',
                  inv.overdue
                    ? 'font-medium text-red-600 dark:text-red-400'
                    : 'text-muted-foreground'
                )}
              >
                {inv.dueDate ? fmtDate(inv.dueDate) : '—'}
              </span>
            </div>
          ))}
          <MoreNote total={data.rows.length} />
          <div className="mt-1 flex items-center justify-between border-t pt-2 text-sm">
            <span className="text-muted-foreground">Outstanding</span>
            <span className="font-semibold tabular-nums">
              {aud(data.outstandingTotal)}
            </span>
          </div>
        </>
      )}
    </DashboardCard>
  )
}

// ─── 4. Time-bar warnings ─────────────────────────────────────────────────────

export type TimeBarRow = {
  id: string
  projectId: string
  projectLabel: string
  number: number
  title: string
  daysLeft: number
}

function timeBarBadge(daysLeft: number) {
  const className =
    daysLeft <= 3
      ? 'font-medium text-red-600 dark:text-red-400'
      : 'font-medium text-amber-600 dark:text-amber-400'
  const label =
    daysLeft < 0
      ? `${Math.abs(daysLeft)}d past`
      : daysLeft === 0
        ? 'Today'
        : `${daysLeft}d left`
  return (
    <span className={cn('shrink-0 text-xs tabular-nums', className)}>
      {label}
    </span>
  )
}

export function TimeBarCard({ data }: { data: TimeBarRow[] | null }) {
  return (
    <DashboardCard title="Time-bar warnings" href="/projects">
      {data === null ? (
        <LoadError />
      ) : data.length === 0 ? (
        <Muted>No time-bar warnings.</Muted>
      ) : (
        <>
          {data.slice(0, MAX_ROWS).map((v) => (
            <div
              key={v.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <div className="flex min-w-0 flex-col">
                <Link
                  href={`/projects/${v.projectId}/variations`}
                  className="truncate hover:underline"
                >
                  V{v.number} — {v.title}
                </Link>
                <span className="truncate text-xs text-muted-foreground">
                  {v.projectLabel}
                </span>
              </div>
              {timeBarBadge(v.daysLeft)}
            </div>
          ))}
          <MoreNote total={data.length} />
        </>
      )}
    </DashboardCard>
  )
}

// ─── 5. Compliance expiries ───────────────────────────────────────────────────

export type ComplianceRow = {
  id: string
  vendorId: string
  vendor: string
  kind: string
  expiry: string
  expired: boolean
}

const COMPLIANCE_KIND_LABELS: Record<string, string> = {
  public_liability: 'Public liability',
  workers_comp: 'Workers comp',
  licence: 'Licence',
  other: 'Other',
}

export function ComplianceCard({ data }: { data: ComplianceRow[] | null }) {
  return (
    <DashboardCard title="Compliance expiries" href="/vendors">
      {data === null ? (
        <LoadError />
      ) : data.length === 0 ? (
        <Muted>Nothing expiring in the next 30 days.</Muted>
      ) : (
        <>
          {data.slice(0, MAX_ROWS).map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <Link
                href={`/vendors/${d.vendorId}`}
                className="min-w-0 truncate hover:underline"
              >
                {d.vendor}
              </Link>
              <span className="shrink-0 text-xs text-muted-foreground">
                {COMPLIANCE_KIND_LABELS[d.kind] ?? d.kind}
              </span>
              <span
                className={cn(
                  'shrink-0 text-xs tabular-nums',
                  d.expired
                    ? 'font-medium text-red-600 dark:text-red-400'
                    : 'text-muted-foreground'
                )}
              >
                {fmtDate(d.expiry)}
              </span>
            </div>
          ))}
          <MoreNote total={data.length} />
        </>
      )}
    </DashboardCard>
  )
}

// ─── 5b. Property compliance due (client portal recall surface) ───────────────

export type PropertyComplianceDueRow = {
  id: string
  clientId: string
  siteId: string
  siteName: string
  clientName: string
  kindLabel: string
  title: string
  reviewDue: string
  overdue: boolean
}

export function PropertyComplianceCard({
  data,
}: {
  data: PropertyComplianceDueRow[] | null
}) {
  return (
    <DashboardCard title="Property compliance due" href="/clients">
      {data === null ? (
        <LoadError />
      ) : data.length === 0 ? (
        <Muted>No property compliance items due in the next 30 days.</Muted>
      ) : (
        <>
          {data.slice(0, MAX_ROWS).map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <div className="flex min-w-0 flex-col">
                <Link
                  href={`/clients/${r.clientId}/sites/${r.siteId}`}
                  className="truncate hover:underline"
                >
                  {r.title}
                </Link>
                <span className="truncate text-xs text-muted-foreground">
                  {r.siteName} · {r.clientName} · {r.kindLabel}
                </span>
              </div>
              <span
                className={cn(
                  'shrink-0 text-xs tabular-nums',
                  r.overdue
                    ? 'font-medium text-red-600 dark:text-red-400'
                    : 'font-medium text-amber-600 dark:text-amber-400'
                )}
              >
                {fmtDate(r.reviewDue)}
              </span>
            </div>
          ))}
          <MoreNote total={data.length} />
        </>
      )}
    </DashboardCard>
  )
}

// ─── 6. Retention due ─────────────────────────────────────────────────────────

export type RetentionDueRow = {
  projectId: string
  projectLabel: string
  type: 'PC release' | 'Final release'
  amount: number
  date: string
}

export function RetentionDueCard({ data }: { data: RetentionDueRow[] | null }) {
  return (
    <DashboardCard title="Retention due" href="/projects">
      {data === null ? (
        <LoadError />
      ) : data.length === 0 ? (
        <Muted>No releases due in the next 60 days.</Muted>
      ) : (
        <>
          {data.slice(0, MAX_ROWS).map((r) => (
            <div
              key={`${r.projectId}:${r.type}`}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <div className="flex min-w-0 flex-col">
                <Link
                  href={`/projects/${r.projectId}`}
                  className="truncate hover:underline"
                >
                  {r.projectLabel}
                </Link>
                <span className="text-xs text-muted-foreground">{r.type}</span>
              </div>
              <span className="shrink-0 text-xs tabular-nums">
                {aud(r.amount)}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {fmtDate(r.date)}
              </span>
            </div>
          ))}
          <MoreNote total={data.length} />
        </>
      )}
    </DashboardCard>
  )
}

// ─── 7. Active work summary ───────────────────────────────────────────────────

export type ActiveProjectRow = {
  id: string
  number: string
  name: string
  pctClaimed: number
  spend: number
  budget: number
  health: 'green' | 'amber' | 'red'
}

export type JobCounts = {
  scheduled: number
  in_progress: number
  completed: number
}

export type ActiveWorkData = {
  projects: ActiveProjectRow[]
  jobCounts: JobCounts
}

const HEALTH_DOT: Record<ActiveProjectRow['health'], string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
}

const JOB_CHIPS: { status: keyof JobCounts; label: string; className: string }[] =
  [
    {
      status: 'scheduled',
      label: 'Scheduled',
      className:
        'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
    },
    {
      status: 'in_progress',
      label: 'In progress',
      className:
        'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    },
    {
      status: 'completed',
      label: 'Completed (uninvoiced)',
      className:
        'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',
    },
  ]

export function ActiveWorkCard({ data }: { data: ActiveWorkData | null }) {
  return (
    <DashboardCard
      title="Active work"
      href="/projects"
      className="md:col-span-2 xl:col-span-3"
    >
      {data === null ? (
        <LoadError />
      ) : (
        <>
          {data.projects.length === 0 ? (
            <Muted>No active projects.</Muted>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-right">% claimed</TableHead>
                    <TableHead className="text-right">
                      Committed + actual
                    </TableHead>
                    <TableHead className="text-right">Budget</TableHead>
                    <TableHead className="text-center">Health</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.projects.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link
                          href={`/projects/${p.id}`}
                          className="hover:underline"
                        >
                          <span className="font-mono">{p.number}</span> —{' '}
                          {p.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.pctClaimed}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {aud(p.spend)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {aud(p.budget)}
                      </TableCell>
                      <TableCell className="text-center">
                        <span
                          className={cn(
                            'inline-block size-2.5 rounded-full',
                            HEALTH_DOT[p.health]
                          )}
                          title={`Spend is ${p.budget > 0 ? Math.round((p.spend / p.budget) * 100) : '—'}% of budget`}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-muted-foreground">Jobs:</span>
            {JOB_CHIPS.map((chip) => (
              <Link
                key={chip.status}
                href={`/jobs?status=${chip.status}`}
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs font-medium hover:opacity-80',
                  chip.className
                )}
              >
                {chip.label} {data.jobCounts[chip.status]}
              </Link>
            ))}
          </div>
        </>
      )}
    </DashboardCard>
  )
}

// ─── 8. Today on site ─────────────────────────────────────────────────────────

export type TodayOnSiteGroup = {
  key: string
  targetLabel: string
  people: string[]
}

export function TodayOnSiteCard({
  data,
}: {
  data: TodayOnSiteGroup[] | null
}) {
  return (
    <DashboardCard title="Today on site" href="/schedule">
      {data === null ? (
        <LoadError />
      ) : data.length === 0 ? (
        <Muted>No one on site today.</Muted>
      ) : (
        <>
          {data.slice(0, MAX_ROWS).map((g) => (
            <div key={g.key} className="flex flex-col gap-0.5 text-sm">
              <span className="truncate font-medium">{g.targetLabel}</span>
              <span className="text-xs text-muted-foreground">
                {g.people.join(', ')}
              </span>
            </div>
          ))}
          <MoreNote total={data.length} />
        </>
      )}
    </DashboardCard>
  )
}

// ─── 9. SWMS outstanding ──────────────────────────────────────────────────────

export type SwmsOutstandingRow = {
  id: string
  title: string
  parentLabel: string
  href: string
  signed: number
  total: number
}

export function SwmsOutstandingCard({
  data,
}: {
  data: SwmsOutstandingRow[] | null
}) {
  return (
    <DashboardCard title="SWMS outstanding" href="/projects">
      {data === null ? (
        <LoadError />
      ) : data.length === 0 ? (
        <Muted>No outstanding signatures.</Muted>
      ) : (
        <>
          {data.slice(0, MAX_ROWS).map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <div className="flex min-w-0 flex-col">
                <Link href={s.href} className="truncate hover:underline">
                  {s.title}
                </Link>
                <span className="truncate text-xs text-muted-foreground">
                  {s.parentLabel}
                </span>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {s.signed}/{s.total} signed
              </span>
            </div>
          ))}
          <MoreNote total={data.length} />
        </>
      )}
    </DashboardCard>
  )
}

// ─── 10. Hold points ──────────────────────────────────────────────────────────

export type HoldPointDueRow = {
  id: string
  projectId: string
  projectLabel: string
  title: string
  date: string
  status: string
  overdue: boolean
}

export function HoldPointsCard({ data }: { data: HoldPointDueRow[] | null }) {
  return (
    <DashboardCard title="Hold points" href="/projects">
      {data === null ? (
        <LoadError />
      ) : data.length === 0 ? (
        <Muted>No hold points due in the next 7 days.</Muted>
      ) : (
        <>
          {data.slice(0, MAX_ROWS).map((hp) => (
            <div
              key={hp.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <div className="flex min-w-0 flex-col">
                <Link
                  href={`/projects/${hp.projectId}/programme`}
                  className="truncate hover:underline"
                >
                  {hp.title}
                </Link>
                <span className="truncate text-xs text-muted-foreground">
                  {hp.projectLabel}
                </span>
              </div>
              <span
                className={cn(
                  'shrink-0 text-xs tabular-nums',
                  hp.overdue
                    ? 'font-medium text-red-600 dark:text-red-400'
                    : 'text-muted-foreground'
                )}
              >
                {fmtDate(hp.date)}
              </span>
              <span className="shrink-0">
                <StatusBadge status={hp.status} />
              </span>
            </div>
          ))}
          <MoreNote total={data.length} />
        </>
      )}
    </DashboardCard>
  )
}

// ─── 12. Safety ──────────────────────────────────────────────────────────────

export type SafetyOverdueRow = {
  actionId: string
  incidentId: string
  incidentNumber: string
  description: string
  daysOverdue: number
}

export type SafetyData = {
  openCount: number
  investigatingCount: number
  highSeverityCount: number
  overdueActions: SafetyOverdueRow[]
}

export function SafetyCard({ data }: { data: SafetyData | null }) {
  return (
    <DashboardCard title="Safety" href="/whs/incidents">
      {data === null ? (
        <LoadError />
      ) : (
        <>
          <div className="flex items-center gap-4 text-sm">
            {data.openCount > 0 ? (
              <span className="font-medium text-red-600 dark:text-red-400">
                {data.openCount} open
              </span>
            ) : null}
            {data.investigatingCount > 0 ? (
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {data.investigatingCount} investigating
              </span>
            ) : null}
            {data.highSeverityCount > 0 ? (
              <span className="font-medium text-red-600 dark:text-red-400">
                {data.highSeverityCount} high severity
              </span>
            ) : null}
            {data.openCount === 0 && data.investigatingCount === 0 ? (
              <Muted>No open incidents.</Muted>
            ) : null}
          </div>

          {data.overdueActions.length > 0 && (
            <>
              <p className="mt-1 text-xs font-medium text-muted-foreground">
                Overdue corrective actions
              </p>
              {data.overdueActions.slice(0, MAX_ROWS).map((a) => (
                <div
                  key={a.actionId}
                  className="flex items-start justify-between gap-2 text-sm"
                >
                  <div className="flex min-w-0 flex-col">
                    <Link
                      href={`/whs/incidents/${a.incidentId}`}
                      className="truncate hover:underline"
                    >
                      {a.description}
                    </Link>
                    <span className="truncate text-xs text-muted-foreground">
                      {a.incidentNumber}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-red-600 tabular-nums dark:text-red-400">
                    {a.daysOverdue}d overdue
                  </span>
                </div>
              ))}
              <MoreNote total={data.overdueActions.length} />
            </>
          )}
        </>
      )}
    </DashboardCard>
  )
}

// ─── 13. NCRs (nonconformances + CAPA) ────────────────────────────────────────

export type NcrOverdueCapaRow = {
  capaId: string
  ncrId: string
  ncrNumber: string
  description: string
  daysOverdue: number
}

export type NcrData = {
  openCount: number
  investigatingCount: number
  actionsCount: number
  overdueCapas: NcrOverdueCapaRow[]
}

export function NcrCard({ data }: { data: NcrData | null }) {
  return (
    <DashboardCard title="NCRs" href="/whs/ncr">
      {data === null ? (
        <LoadError />
      ) : (
        <>
          <div className="flex items-center gap-4 text-sm">
            {data.openCount > 0 ? (
              <span className="font-medium text-red-600 dark:text-red-400">
                {data.openCount} open
              </span>
            ) : null}
            {data.investigatingCount > 0 ? (
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {data.investigatingCount} investigating
              </span>
            ) : null}
            {data.actionsCount > 0 ? (
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {data.actionsCount} in actions
              </span>
            ) : null}
            {data.openCount === 0 &&
            data.investigatingCount === 0 &&
            data.actionsCount === 0 ? (
              <Muted>No open NCRs.</Muted>
            ) : null}
          </div>

          {data.overdueCapas.length > 0 && (
            <>
              <p className="mt-1 text-xs font-medium text-muted-foreground">
                Overdue CAPA actions
              </p>
              {data.overdueCapas.slice(0, MAX_ROWS).map((c) => (
                <div
                  key={c.capaId}
                  className="flex items-start justify-between gap-2 text-sm"
                >
                  <div className="flex min-w-0 flex-col">
                    <Link
                      href={`/whs/ncr/${c.ncrId}`}
                      className="truncate hover:underline"
                    >
                      {c.description}
                    </Link>
                    <span className="truncate text-xs text-muted-foreground">
                      {c.ncrNumber}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-red-600 tabular-nums dark:text-red-400">
                    {c.daysOverdue}d overdue
                  </span>
                </div>
              ))}
              <MoreNote total={data.overdueCapas.length} />
            </>
          )}
        </>
      )}
    </DashboardCard>
  )
}

// ─── 11. Diaries missing ──────────────────────────────────────────────────────

export type DiaryMissingRow = {
  projectId: string
  projectLabel: string
  missingDate: string
}

export function DiariesMissingCard({
  data,
}: {
  data: DiaryMissingRow[] | null
}) {
  return (
    <DashboardCard title="Diaries missing" href="/projects">
      {data === null ? (
        <LoadError />
      ) : data.length === 0 ? (
        <Muted>Nothing missing.</Muted>
      ) : (
        <>
          {data.slice(0, MAX_ROWS).map((d) => (
            <div
              key={d.projectId}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <Link
                href={`/projects/${d.projectId}/diary`}
                className="min-w-0 truncate hover:underline"
              >
                {d.projectLabel}
              </Link>
              <span className="shrink-0 text-xs font-medium text-amber-600 tabular-nums dark:text-amber-400">
                {fmtDate(d.missingDate)}
              </span>
            </div>
          ))}
          <MoreNote total={data.length} />
        </>
      )}
    </DashboardCard>
  )
}
