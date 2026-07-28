import { ShieldCheckIcon } from 'lucide-react'
import { formatLoadNumber, type WasteLinkView } from '@/lib/waste/link-payload'

/**
 * Chrome for the two public waste-tracking pages (/haul and /receive). No auth
 * — the token is the credential, exactly like /sign, /submit and /portal.
 */
export function WastePublicShell({ children }: { children: React.ReactNode }) {
  return (
    // Drivers and weighbridge operators open this on a phone, often as a
    // standalone-ish full screen page — keep it clear of the notch and the
    // home indicator.
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))]">
      <div className="border-b pb-3">
        <p className="text-2xl font-bold tracking-tight text-[#162040] dark:text-blue-200">
          Entice
        </p>
        <p className="text-xs text-muted-foreground">
          Queensland waste tracking
        </p>
      </div>
      {children}
    </div>
  )
}

export function WasteLinkExpired({ what }: { what: string }) {
  return (
    <WastePublicShell>
      <div className="flex flex-col items-center gap-3 rounded-xl border px-6 py-12 text-center">
        <ShieldCheckIcon className="size-10 text-muted-foreground" />
        <h1 className="text-lg font-bold">
          This link has expired or been deactivated
        </h1>
        <p className="text-sm text-muted-foreground">
          Ask your contact at Entice for a new {what} link.
        </p>
      </div>
    </WastePublicShell>
  )
}

/** Read-only receipt shown once a part has been submitted (locked on submit). */
export function WasteLinkReceipt({
  view,
  what,
}: {
  view: WasteLinkView
  what: string
}) {
  return (
    <WastePublicShell>
      <div className="flex flex-col gap-3 rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-4">
        <h1 className="text-lg font-bold">
          Load {formatLoadNumber(view.load_seq)} — {what} already recorded
        </h1>
        <p className="text-sm">
          Submitted{view.submitted_by ? ` by ${view.submitted_by}` : ''}
          {view.submitted_at
            ? ` on ${new Date(view.submitted_at).toLocaleString('en-AU', {
                timeZone: 'Australia/Brisbane',
              })}`
            : ''}
          .
        </p>
        <p className="text-sm text-muted-foreground">
          If something needs correcting, contact Entice — the record is locked
          so it cannot be changed twice without a trace.
        </p>
      </div>
    </WastePublicShell>
  )
}

/** The load summary both parties see — what is on the docket in their hand. */
export function WasteLoadSummary({ view }: { view: WasteLinkView }) {
  const g = view.generator
  const w = view.waste
  const dg = view.dangerous_goods

  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Load {formatLoadNumber(view.load_seq)}
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Waste</dt>
        <dd className="font-medium">
          {w.code} · {w.amount} {w.unit}
          {w.description ? ` · ${w.description}` : ''}
        </dd>
        <dt className="text-muted-foreground">Collected from</dt>
        <dd>
          {g.name}
          <br />
          {[g.street_number, g.street_name].filter(Boolean).join(' ')}
          {g.suburb ? `, ${g.suburb}` : ''} {g.postcode ?? ''}
        </dd>
        <dt className="text-muted-foreground">Collection date</dt>
        <dd>{g.collection_date}</dd>
      </dl>

      {dg && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-700 dark:bg-amber-950">
          <p className="font-medium text-amber-900 dark:text-amber-100">
            Dangerous goods
          </p>
          <p className="text-amber-800 dark:text-amber-200">
            {[
              dg.un_class && `Class ${dg.un_class}`,
              dg.un_number && `UN ${dg.un_number}`,
              dg.subsidiary_risk && `Subsidiary ${dg.subsidiary_risk}`,
              dg.packing_group && `Packing group ${dg.packing_group}`,
              dg.packaging_count && `${dg.packaging_count} × ${dg.packaging_type ?? 'packages'}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      )}
    </section>
  )
}
