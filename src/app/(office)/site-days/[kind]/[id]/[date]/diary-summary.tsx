import Link from 'next/link'
import type { DayDetail } from '@/lib/site-days-queries'

export function DiarySummary({
  projectId,
  diary,
}: {
  projectId: string
  diary: DayDetail['diary']
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Diary</h2>
        <Link href={`/projects/${projectId}/diary`} className="text-sm underline underline-offset-2">
          Open the diary
        </Link>
      </div>
      {diary ? (
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Weather</dt>
          <dd>{diary.weather || '—'}</dd>
          <dt className="text-muted-foreground">Work performed</dt>
          <dd className="whitespace-pre-wrap">{diary.workPerformed || '—'}</dd>
          <dt className="text-muted-foreground">Delays</dt>
          <dd className="whitespace-pre-wrap">{diary.delays || '—'}</dd>
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">No diary entry for this day.</p>
      )}
    </section>
  )
}
