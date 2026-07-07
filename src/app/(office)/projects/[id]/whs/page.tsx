import Link from 'next/link'
import { notFound } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU } from '@/lib/tz'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/StatusBadge'
import { SwmsInstancesSection } from '@/components/SwmsInstancesSection'
import { fetchSwmsInstances } from '@/lib/swms-queries'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  INCIDENT_TYPE_LABELS,
  type FormTemplateKind,
  type IncidentType,
} from '@/lib/zod'
import {
  RequestSubbieSwmsDialog,
} from '@/app/(office)/whs/subbie-swms/request-dialog'

const KIND_LABELS: Record<FormTemplateKind, string> = {
  prestart: 'Pre-Start',
  prestart_meeting: 'Pre-Start Meeting',
  take5: 'Take 5',
  toolbox: 'Toolbox',
  induction: 'Induction',
  incident: 'Incident',
  custom: 'Custom',
  audit: 'Audit',
}

const KIND_COLORS: Record<FormTemplateKind, string> = {
  prestart: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300',
  prestart_meeting: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300',
  take5: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300',
  toolbox: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300',
  induction: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300',
  incident: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300',
  custom: 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300',
  audit: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300',
}

const FORMS_LIMIT = 10

export default async function ProjectWhsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const canSupersede = profile.role === 'admin' || profile.role === 'office'

  const { id } = await params
  const supabase = await createClient()

  const [
    { data: project },
    swmsInstances,
    { data: swmsTemplates },
    { data: submissions, count: submissionCount },
    { data: incidents },
    { data: actions },
    { data: subbies },
    { data: holdPoints },
  ] = await Promise.all([
    supabase.from('projects').select('id, number, name').eq('id', id).single(),
    fetchSwmsInstances(supabase, 'project', id),
    supabase
      .from('swms_templates')
      .select('id, title, version, hrcw_items')
      .eq('active', true)
      .order('title'),
    supabase
      .from('form_submissions')
      .select(
        `id, kind, submitted_at,
         form_templates(name),
         profiles!form_submissions_submitted_by_fkey(full_name),
         plant(name),
         form_signons(id)`,
        { count: 'exact' }
      )
      .eq('project_id', id)
      .order('submitted_at', { ascending: false })
      .limit(FORMS_LIMIT),
    supabase
      .from('incidents')
      .select('id, number, type, severity, occurred_at, status, description')
      .eq('project_id', id)
      .order('occurred_at', { ascending: false }),
    supabase
      .from('corrective_actions')
      .select('incident_id, status, incidents!inner(project_id)')
      .eq('incidents.project_id', id),
    supabase
      .from('subbie_swms')
      .select(
        `id, created_at, company_name, contact_name, title, status,
         profiles!subbie_swms_reviewed_by_fkey(full_name)`
      )
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
    supabase.from('hold_points').select('id, date, status').eq('project_id', id),
  ])

  if (!project) notFound()

  // ── Shape rows ─────────────────────────────────────────────────────────────

  const formRows = (submissions ?? []).map((s) => {
    const template = s.form_templates as unknown as { name: string } | null
    const submitter = s.profiles as unknown as { full_name: string } | null
    const plant = s.plant as unknown as { name: string } | null
    const signons = (s.form_signons as unknown as { id: string }[]) ?? []
    return {
      id: s.id as string,
      kind: s.kind as FormTemplateKind,
      submittedAt: s.submitted_at as string,
      templateName: template?.name ?? '—',
      submittedBy: submitter?.full_name ?? '—',
      plantName: plant?.name ?? null,
      signonCount: signons.length,
    }
  })

  const openActionsByIncident = new Map<string, number>()
  for (const a of actions ?? []) {
    if (a.status !== 'open') continue
    const key = a.incident_id as string
    openActionsByIncident.set(key, (openActionsByIncident.get(key) ?? 0) + 1)
  }

  const subbieRows = (subbies ?? []).map((s) => ({
    id: s.id as string,
    createdAt: s.created_at as string,
    company: s.company_name as string,
    contact: s.contact_name as string,
    title: s.title as string,
    status: s.status as string,
    reviewedBy:
      (s.profiles as unknown as { full_name: string } | null)?.full_name ?? null,
  }))

  const todayStr = todayAU()
  const holdPointCount = (holdPoints ?? []).length
  const holdPointsOverdue = (holdPoints ?? []).filter(
    (hp) => hp.status !== 'released' && (hp.date as string) < todayStr
  ).length

  return (
    <div className="flex flex-col gap-8">
      {/* SWMS — full management section (moved here from the overview tab) */}
      <SwmsInstancesSection
        parentType="project"
        parentId={id}
        instances={swmsInstances}
        templates={swmsTemplates ?? []}
        canManage
        canSupersede={canSupersede}
      />

      {/* Forms */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold">Forms</h2>
          <Link
            href={`/whs/forms?project_id=${id}`}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            View all {submissionCount ?? formRows.length} in the forms register
          </Link>
        </div>
        {formRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No forms submitted on this project yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Form</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead className="text-right">Sign-ons</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {formRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {format(parseISO(r.submittedAt), 'dd/MM/yy HH:mm')}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn('text-xs', KIND_COLORS[r.kind])}>
                        {KIND_LABELS[r.kind]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/whs/forms?project_id=${id}&highlight=${r.id}`}
                        className="hover:underline"
                      >
                        {r.templateName}
                      </Link>
                      {r.plantName && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          · {r.plantName}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.submittedBy}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.signonCount > 0 ? r.signonCount : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Incidents */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold">Incidents</h2>
          <Link
            href="/whs/incidents"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Incident register
          </Link>
        </div>
        {(incidents ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No incidents reported on this project.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Occurred</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Open actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(incidents ?? []).map((inc) => {
                  const openActions = openActionsByIncident.get(inc.id as string) ?? 0
                  const severity = Number(inc.severity)
                  return (
                    <TableRow key={inc.id as string}>
                      <TableCell>
                        <Link
                          href={`/whs/incidents/${inc.id}`}
                          className="font-mono hover:underline"
                        >
                          {inc.number as string}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {INCIDENT_TYPE_LABELS[inc.type as IncidentType]}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'tabular-nums',
                            severity >= 4 &&
                              'font-medium text-red-600 dark:text-red-400'
                          )}
                        >
                          {severity}/5
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {fmtDate(inc.occurred_at as string)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={inc.status as string} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {openActions > 0 ? openActions : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Subbie SWMS */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold">Subbie SWMS</h2>
          <div className="flex items-center gap-3">
            <Link
              href="/whs/subbie-swms"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Review queue
            </Link>
            <RequestSubbieSwmsDialog
              projects={[
                {
                  id: project.id as string,
                  number: project.number as string,
                  name: project.name as string,
                },
              ]}
            />
          </div>
        </div>
        {subbieRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No subcontractor SWMS received for this project yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reviewed by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subbieRows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {fmtDate(s.createdAt)}
                    </TableCell>
                    <TableCell>
                      {s.company}
                      <span className="ml-1 text-xs text-muted-foreground">
                        · {s.contact}
                      </span>
                    </TableCell>
                    <TableCell>{s.title}</TableCell>
                    <TableCell>
                      <StatusBadge status={s.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.reviewedBy ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Hold points cross-link */}
      <p className="text-sm text-muted-foreground">
        {holdPointCount > 0 ? (
          <>
            {holdPointCount} hold point{holdPointCount === 1 ? '' : 's'}
            {holdPointsOverdue > 0 && (
              <span className="font-medium text-red-600 dark:text-red-400">
                {' '}
                ({holdPointsOverdue} unreleased past date)
              </span>
            )}{' '}
            — managed on the{' '}
          </>
        ) : (
          <>Hold points are managed on the </>
        )}
        <Link
          href={`/projects/${id}/programme`}
          className="underline underline-offset-2 hover:text-foreground"
        >
          Programme tab
        </Link>
        .
      </p>
    </div>
  )
}
