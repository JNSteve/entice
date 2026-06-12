import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeftIcon, CheckCircle2Icon, StarIcon } from 'lucide-react'
import { format, isValid, parseISO } from 'date-fns'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAttachmentsWithUrls } from '@/lib/attachment-queries'
import { AttachmentList } from '@/components/AttachmentList'
import { PhotoUpload } from '@/components/PhotoUpload'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { INCIDENT_TYPE_LABELS, type IncidentType } from '@/lib/zod'

function fmtDateTime(value: string): string {
  const d = parseISO(value)
  return isValid(d) ? format(d, 'dd/MM/yyyy HH:mm') : ''
}

function SeverityStars({ severity }: { severity: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon
          key={n}
          className={cn(
            'size-4',
            n <= severity
              ? 'fill-amber-400 text-amber-400'
              : 'text-muted-foreground/40'
          )}
        />
      ))}
      <span className="ml-1 text-sm tabular-nums">{severity} / 5</span>
    </span>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  )
}

export default async function FieldIncidentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { id } = await params
  const supabase = await createClient()

  const { data: incident } = await supabase
    .from('incidents')
    .select(
      `id, number, type, severity, occurred_at, location, description,
       immediate_action, status, reported_by, created_at,
       projects(number, name), jobs(number, title), profiles(full_name)`
    )
    .eq('id', id)
    .single()
  if (!incident) notFound()

  const projectRel = incident.projects as unknown as {
    number: string
    name: string
  } | null
  const jobRel = incident.jobs as unknown as {
    number: string
    title: string
  } | null
  const reporter = incident.profiles as unknown as { full_name: string } | null

  const isMine = incident.reported_by === profile.id
  const isStaff = profile.role === 'admin' || profile.role === 'office'

  const targetLabel = projectRel
    ? `P-${projectRel.number} — ${projectRel.name}`
    : jobRel
      ? `J-${jobRel.number} — ${jobRel.title}`
      : '—'

  const attachments = await fetchAttachmentsWithUrls(supabase, 'incident', id)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link
          href="/field/safety"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          Safety
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold">Incident {incident.number}</h1>
          <StatusBadge status={incident.status as string} />
        </div>
        <p className="text-sm text-muted-foreground">{targetLabel}</p>
        <div className="flex items-center gap-2 rounded-xl border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm">
          <CheckCircle2Icon className="size-4 shrink-0 text-green-600 dark:text-green-400" />
          <span>
            Reported by {reporter?.full_name ?? '—'} ·{' '}
            {fmtDateTime(incident.created_at as string)}
          </span>
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Details
        </h2>
        <div className="divide-y rounded-xl border">
          <Row label="Type">
            {INCIDENT_TYPE_LABELS[incident.type as IncidentType] ?? incident.type}
          </Row>
          <Row label="Severity">
            <SeverityStars severity={Number(incident.severity)} />
          </Row>
          <Row label="When it happened">
            {fmtDateTime(incident.occurred_at as string)}
          </Row>
          <Row label="Location">
            {incident.location ?? <span className="text-muted-foreground">—</span>}
          </Row>
          <Row label="What happened">
            <span className="whitespace-pre-wrap">{incident.description}</span>
          </Row>
          <Row label="Immediate action taken">
            {incident.immediate_action ? (
              <span className="whitespace-pre-wrap">{incident.immediate_action}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Row>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Photos
        </h2>
        {isMine && (
          <PhotoUpload
            parentType="incident"
            parentId={id}
            kind="photo"
            capture
            multiple
          />
        )}
        {attachments.length === 0 ? (
          !isMine && <p className="text-sm text-muted-foreground">No photos.</p>
        ) : (
          <AttachmentList items={attachments} canDelete={isMine || isStaff} />
        )}
      </section>

      <Button render={<Link href="/field/safety" />} size="lg" variant="outline">
        Done
      </Button>
    </div>
  )
}
