import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { currentSourceHash } from '@/lib/signoff-build'
import { fmtDate } from '@/lib/format'
import { dateAU, todayAU } from '@/lib/tz'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SignoffStatusBadge } from './SignoffStatusBadge'
import { BuildSignoffForm } from './BuildSignoffForm'

/** Whole days since an instant (0 on the same day). */
export function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

/** dd/MM/yyyy of an instant in Brisbane time. */
export function fmtInstantAU(iso: string | null): string {
  if (!iso) return ''
  return fmtDate(todayAU(new Date(iso)))
}

type ResponseRel = { signed_at: string; disputes: unknown[] | null }

type Row = {
  id: string
  date: string
  version: number
  status: string
  released_at: string | null
  source_hash: string | null
  created_at: string
  daily_signoff_responses: ResponseRel | ResponseRel[] | null
}

const HASH_WINDOW_DAYS = 60

export async function SignoffRegister({
  kind,
  workId,
  canManage,
}: {
  kind: 'job' | 'project'
  workId: string
  canManage: boolean
}) {
  const supabase = await createClient()
  const col = kind === 'job' ? 'job_id' : 'project_id'
  const { data } = await supabase
    .from('daily_signoffs')
    .select(
      'id, date, version, status, released_at, source_hash, created_at, daily_signoff_responses(signed_at, disputes)'
    )
    .eq(col, workId)
    .order('date', { ascending: false })
    .order('version', { ascending: false })

  const rows = (data ?? []) as unknown as Row[]

  // "Source changed": the entries behind a sent sheet moved after it was
  // frozen. Bounded to recent days — each check re-reads that day's source.
  const cutoff = dateAU(-HASH_WINDOW_DAYS)
  const changed = new Set<string>()
  const hashCache = new Map<string, Promise<string | null>>()
  await Promise.all(
    rows
      .filter(
        (r) =>
          ['released', 'signed', 'disputed'].includes(r.status) &&
          r.source_hash &&
          r.date >= cutoff
      )
      .map(async (r) => {
        let p = hashCache.get(r.date)
        if (!p) {
          p = currentSourceHash(supabase, { kind, id: workId }, r.date).catch(() => null)
          hashCache.set(r.date, p)
        }
        try {
          const current = await p
          if (current && current !== r.source_hash) changed.add(r.id)
        } catch {
          // ignore — badge is best-effort
        }
      })
  )

  return (
    <div className="flex flex-col gap-4">
      {canManage && <BuildSignoffForm kind={kind} workId={workId} />}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No daily sign-offs yet. Drafts are built automatically each morning for any day with
          time on site or usage logged.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Released</TableHead>
                <TableHead>Client answered</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const resp = Array.isArray(r.daily_signoff_responses)
                  ? (r.daily_signoff_responses[0] ?? null)
                  : r.daily_signoff_responses
                const disputeCount = Array.isArray(resp?.disputes) ? resp.disputes.length : 0
                const waiting = r.status === 'released' ? daysSince(r.released_at) : null
                const muted = r.status === 'superseded'
                return (
                  <TableRow key={r.id} className={cn(muted && 'text-muted-foreground opacity-70')}>
                    <TableCell>
                      <Link href={`/signoffs/${r.id}`} className="font-medium hover:underline">
                        {fmtDate(r.date)}
                      </Link>
                    </TableCell>
                    <TableCell>{r.version > 1 ? `v${r.version}` : ''}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <SignoffStatusBadge status={r.status} />
                        {changed.has(r.id) && (
                          <Badge
                            variant="outline"
                            className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300"
                          >
                            Source changed
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{r.released_at ? fmtInstantAU(r.released_at) : '—'}</TableCell>
                    <TableCell>
                      {resp ? (
                        <span>
                          {fmtInstantAU(resp.signed_at)}
                          {disputeCount > 0 && (
                            <span className="text-red-700 dark:text-red-300">
                              {` · ${disputeCount} disputed`}
                            </span>
                          )}
                        </span>
                      ) : waiting != null ? (
                        <span className="text-muted-foreground">
                          {`Awaiting ${waiting} ${waiting === 1 ? 'day' : 'days'}`}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/signoffs/${r.id}`} className="text-sm hover:underline">
                        Open
                      </Link>
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
