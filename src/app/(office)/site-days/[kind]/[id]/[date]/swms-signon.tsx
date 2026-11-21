import type { DayDetail } from '@/lib/site-days-queries'

export function SwmsSignon({
  swms,
  crewCount,
}: {
  swms: DayDetail['swms']
  crewCount: number
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">SWMS</h2>
      {swms.length === 0 ? (
        <p className="text-sm text-muted-foreground">No SWMS is active on this work.</p>
      ) : crewCount === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody has hours on this day, so there is no crew to check.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border text-sm">
          {swms.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                {s.title} <span className="text-muted-foreground">· v{s.version}</span>
              </span>
              {s.unsigned.length === 0 ? (
                <span className="text-green-700 dark:text-green-300">All signed</span>
              ) : (
                <span className="text-amber-700 dark:text-amber-300">
                  Not signed: {s.unsigned.join(', ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
