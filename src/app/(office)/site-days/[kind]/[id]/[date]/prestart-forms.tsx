import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { timeOfDayAU } from '@/lib/site-days'
import type { DayDetail } from '@/lib/site-days-queries'

export function PrestartForms({
  hasHours,
  prestart,
  otherForms,
}: {
  hasHours: boolean
  prestart: DayDetail['prestart']
  otherForms: DayDetail['otherForms']
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Pre-start and forms</h2>
        {prestart ? (
          <Badge
            variant="outline"
            className="border-green-200 bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
          >
            Pre-start done {timeOfDayAU(prestart.submittedAt)}
          </Badge>
        ) : hasHours ? (
          <Badge
            variant="outline"
            className="border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
          >
            No pre-start
          </Badge>
        ) : null}
      </div>

      {prestart ? (
        <div className="text-sm">
          <p>
            Submitted by {prestart.submittedBy}.{' '}
            <Link href={`/whs/forms?highlight=${prestart.id}`} className="underline underline-offset-2">
              Open form
            </Link>
          </p>
          <p className="text-muted-foreground">
            {prestart.signons.length > 0
              ? `Signed on: ${prestart.signons.join(', ')}`
              : 'Nobody has signed on.'}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {hasHours
            ? 'Hours were recorded on this day but no pre-start meeting was filed.'
            : 'No pre-start meeting was filed.'}
        </p>
      )}

      {otherForms.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border text-sm">
          {otherForms.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span>
                {f.name} <span className="text-muted-foreground">· {f.kindLabel}</span>
              </span>
              <span className="flex items-center gap-3 text-muted-foreground">
                {f.submittedBy} · {timeOfDayAU(f.submittedAt)}
                <Link
                  href={`/whs/forms?highlight=${f.id}`}
                  className="text-foreground underline underline-offset-2"
                >
                  Open
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        A submitted form cannot be changed. Its author corrects it with Amend, which keeps the original.
      </p>
    </section>
  )
}
