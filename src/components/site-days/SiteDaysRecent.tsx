import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
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
import { fmtHours, hoursLabel, type WorkKind } from '@/lib/site-days'
import { loadRecentDays } from '@/lib/site-days-queries'

/** The last 14 days on which this job or project had hours or a materials-log line. */
export async function SiteDaysRecent({ kind, workId }: { kind: WorkKind; workId: string }) {
  const supabase = await createClient()
  const days = await loadRecentDays(supabase, kind, workId, 14)

  if (days.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing has been recorded in the field on this {kind} yet.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Day</TableHead>
            <TableHead>Crew</TableHead>
            <TableHead>Hours</TableHead>
            <TableHead className="text-right">Logged</TableHead>
            <TableHead>Sign-off</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {days.map((d) => {
            const href = `/site-days/${kind}/${workId}/${d.date}`
            const hasHours = d.hours.closed + d.hours.open > 0
            return (
              <TableRow key={d.date}>
                <TableCell>
                  <Link href={href} className="font-medium hover:underline">
                    {fmtDate(d.date)}
                  </Link>
                </TableCell>
                <TableCell className="tabular-nums">
                  {hasHours ? `${d.hours.people} · ${fmtHours(d.hours.totalHours)} h` : '—'}
                </TableCell>
                <TableCell>{hoursLabel(d.hours)}</TableCell>
                <TableCell className="text-right tabular-nums">{d.usageCount || '—'}</TableCell>
                <TableCell>
                  {d.signoff ? (
                    <SignoffStatusBadge status={d.signoff.status} />
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Link href={href} className="text-sm hover:underline">
                    Open
                  </Link>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
