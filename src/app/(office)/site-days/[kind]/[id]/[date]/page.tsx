import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { fmtDate } from '@/lib/format'
import {
  approveChip,
  isIsoDate,
  isWorkKind,
  summariseHours,
  type DayRef,
} from '@/lib/site-days'
import { loadDayDetail } from '@/lib/site-days-queries'
import { ApproveDayButton } from './approve-day-button'
import { CrewHours } from './crew-hours'
import { DiarySummary } from './diary-summary'
import { MaterialsLog } from './materials-log'
import { PhotosDockets } from './photos-dockets'
import { PrestartForms } from './prestart-forms'
import { SwmsSignon } from './swms-signon'
import { WasteLoads } from './waste-loads'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function SiteDayPage({
  params,
}: {
  params: Promise<{ kind: string; id: string; date: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const { kind, id, date } = await params
  if (!isWorkKind(kind) || !UUID_RE.test(id) || !isIsoDate(date)) notFound()

  const supabase = await createClient()
  const day = await loadDayDetail(supabase, kind, id, date)
  if (!day) notFound()

  const dayRef: DayRef = { kind, workId: id, date }
  const hours = summariseHours(
    day.entries.map((e) => ({
      userId: e.userId,
      startAt: e.startAt,
      endAt: e.endAt,
      approved: e.approved,
    }))
  )
  const chip = approveChip(hours)
  const todo = hours.closed - hours.approved
  const crewCount = hours.people
  const workHref = kind === 'job' ? `/jobs/${id}` : `/projects/${id}`
  const photosHref = kind === 'job' ? `/jobs/${id}#photos` : `/projects/${id}/documents`
  const canBuild = profile.role === 'admin' || profile.role === 'office'
  const dayHref = (d: string) => `/site-days/${kind}/${id}/${d}`

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <PageHeader
          title={`${day.work.number} — ${day.work.title}`}
          description={`Site day · ${fmtDate(date)}${day.work.client ? ` · ${day.work.client}` : ''}`}
          actions={<ApproveDayButton dayRef={dayRef} todo={todo} />}
        />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button variant="outline" size="sm" render={<Link href={`/site-days?date=${date}`} />}>
            All jobs this day
          </Button>
          <Button variant="outline" size="sm" render={<Link href={workHref} />}>
            Open {kind}
          </Button>
          {day.prevDate && (
            <Button variant="outline" size="sm" render={<Link href={dayHref(day.prevDate)} />}>
              <ChevronLeftIcon />
              {fmtDate(day.prevDate)}
            </Button>
          )}
          {day.nextDate && (
            <Button variant="outline" size="sm" render={<Link href={dayHref(day.nextDate)} />}>
              {fmtDate(day.nextDate)}
              <ChevronRightIcon />
            </Button>
          )}
          <Badge
            variant="outline"
            className={
              chip.done
                ? 'border-green-200 bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
                : 'border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
            }
          >
            {chip.text}
          </Badge>
        </div>
      </div>

      <div className="border-t" />
      <CrewHours dayRef={dayRef} rows={day.entries} people={day.people} />

      <div className="border-t" />
      <PrestartForms
        hasHours={hours.closed + hours.open > 0}
        prestart={day.prestart}
        otherForms={day.otherForms}
      />

      <div className="border-t" />
      <SwmsSignon swms={day.swms} crewCount={crewCount} />

      <div className="border-t" />
      <MaterialsLog
        dayRef={dayRef}
        lines={day.usage}
        summary={day.summary}
        signoff={day.signoff ? { id: day.signoff.id, status: day.signoff.status } : null}
        canBuild={canBuild}
      />

      {kind === 'project' && (
        <>
          <div className="border-t" />
          <DiarySummary projectId={id} diary={day.diary} />
        </>
      )}

      <div className="border-t" />
      <PhotosDockets files={day.files} allHref={photosHref} />

      <div className="border-t" />
      <WasteLoads loads={day.wasteLoads} />
    </div>
  )
}
