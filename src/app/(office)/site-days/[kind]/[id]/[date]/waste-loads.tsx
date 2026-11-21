import Link from 'next/link'
import {
  WASTE_CLASSIFICATION_LABELS,
  WASTE_UNIT_LABELS,
  type WasteClassification,
  type WasteUnitKey,
} from '@/lib/zod'
import type { DayDetail } from '@/lib/site-days-queries'

export function WasteLoads({ loads }: { loads: DayDetail['wasteLoads'] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Waste loads</h2>
      {loads.length === 0 ? (
        <p className="text-sm text-muted-foreground">No waste loads were logged on this day.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border text-sm">
          {loads.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span>
                <span className="font-mono text-xs text-muted-foreground">{l.number}</span>{' '}
                {WASTE_CLASSIFICATION_LABELS[l.classification as WasteClassification] ?? l.classification}
                {' · '}
                {l.qty} {WASTE_UNIT_LABELS[l.unit as WasteUnitKey] ?? l.unit}
              </span>
              <Link href={`/whs/env/loads/${l.id}`} className="underline underline-offset-2">
                Open load
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
