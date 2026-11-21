import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SignoffStatusBadge } from '@/components/signoffs/SignoffStatusBadge'
import { fmtDate } from '@/lib/format'
import { todayAU, yesterdayAU } from '@/lib/tz'
import { ATTENTION_LABELS, fmtHours, hoursLabel, isIsoDate, timeOfDayAU } from '@/lib/site-days'
import { loadDayList } from '@/lib/site-days-queries'
import { DayPicker } from './day-picker'

export default async function SiteDaysPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  await requireRole('admin', 'office', 'supervisor')

  const sp = await searchParams
  const today = todayAU()
  const date = sp.date && isIsoDate(sp.date) && sp.date <= today ? sp.date : today

  const supabase = await createClient()
  const rows = await loadDayList(supabase, date)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Site days"
        description={`What the crew recorded on ${fmtDate(date)}, job by job.`}
      />

      <DayPicker date={date} today={today} yesterday={yesterdayAU()} />

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing was recorded in the field on this day.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Crew</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Pre-start</TableHead>
                <TableHead className="text-right">Logged</TableHead>
                <TableHead className="text-right">Photos</TableHead>
                <TableHead>Sign-off</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const href = `/site-days/${r.kind}/${r.id}/${date}`
                const hasHours = r.hours.closed + r.hours.open > 0
                return (
                  <TableRow key={`${r.kind}:${r.id}`}>
                    <TableCell>
                      <Link href={href} className="font-medium hover:underline">
                        <span className="font-mono text-xs text-muted-foreground">{r.number}</span>{' '}
                        {r.title}
                      </Link>
                      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        {r.client && <span>{r.client}</span>}
                        {r.attention.map((a) => (
                          <Badge
                            key={a}
                            variant="outline"
                            className="border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                          >
                            {ATTENTION_LABELS[a]}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {hasHours
                        ? `${r.hours.people} · ${fmtHours(r.hours.totalHours)} h`
                        : '—'}
                    </TableCell>
                    <TableCell>{hoursLabel(r.hours)}</TableCell>
                    <TableCell>
                      {r.prestartAt
                        ? `Done ${timeOfDayAU(r.prestartAt)}`
                        : hasHours
                          ? 'Missing'
                          : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.usageCount || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.photoCount || '—'}</TableCell>
                    <TableCell>
                      {r.signoff ? (
                        <Link href={`/signoffs/${r.signoff.id}`}>
                          <SignoffStatusBadge status={r.signoff.status} />
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
