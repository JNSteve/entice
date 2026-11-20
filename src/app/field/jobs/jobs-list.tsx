'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRightIcon } from 'lucide-react'
import {
  WORK_STATUS_LABELS,
  groupLiveWork,
  searchLiveWork,
  workHref,
  workKey,
  type LiveWorkRow,
} from '@/lib/live-work'

function Row({ row, checkedIn }: { row: LiveWorkRow; checkedIn: boolean }) {
  return (
    <Link
      href={workHref(row.kind, row.id)}
      className="flex items-center justify-between gap-3 px-4 py-3 transition-colors active:bg-muted"
    >
      <div className="flex min-w-0 flex-col">
        <span className="font-mono text-xs text-muted-foreground">{row.number}</span>
        <span className="truncate text-sm font-medium">{row.title}</span>
        {(row.client || row.site) && (
          <span className="truncate text-xs text-muted-foreground">
            {[row.client, row.site].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {checkedIn ? (
          <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
            Checked in
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {WORK_STATUS_LABELS[row.status] ?? row.status}
          </span>
        )}
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </div>
    </Link>
  )
}

function Group({
  title,
  rows,
  checkedInKey,
}: {
  title: string
  rows: LiveWorkRow[]
  checkedInKey: string | null
}) {
  if (rows.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title} · {rows.length}
      </h2>
      <div className="flex flex-col divide-y rounded-xl border">
        {rows.map((r) => (
          <Row
            key={workKey(r.kind, r.id)}
            row={r}
            checkedIn={checkedInKey === workKey(r.kind, r.id)}
          />
        ))}
      </div>
    </section>
  )
}

export function JobsList({
  rows,
  scheduledKeys,
  checkedInKey,
}: {
  rows: LiveWorkRow[]
  scheduledKeys: string[]
  checkedInKey: string | null
}) {
  const [query, setQuery] = useState('')
  const groups = groupLiveWork(searchLiveWork(rows, query), new Set(scheduledKeys))
  const nothing =
    groups.scheduled.length + groups.live.length + groups.finished.length === 0

  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Job number, client or address"
        aria-label="Search jobs"
        className="w-full rounded-lg border bg-background px-3 py-2.5 text-base md:text-sm"
      />

      {nothing ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {rows.length === 0
            ? 'No live jobs or projects right now.'
            : 'Nothing matches that search.'}
        </p>
      ) : (
        <>
          <Group title="Scheduled for you today" rows={groups.scheduled} checkedInKey={checkedInKey} />
          <Group title="Live jobs and projects" rows={groups.live} checkedInKey={checkedInKey} />
          <Group title="Finished, not yet invoiced" rows={groups.finished} checkedInKey={checkedInKey} />
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Quotes, invoiced and closed work don&apos;t appear here.
      </p>
    </div>
  )
}
