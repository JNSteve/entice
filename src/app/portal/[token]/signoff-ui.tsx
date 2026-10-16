import Link from 'next/link'
import { ChevronRightIcon, ClipboardCheckIcon } from 'lucide-react'
import { fmtDate } from '@/lib/format'
import {
  fmtQty,
  SIGNOFF_SECTION_LABELS,
  SIGNOFF_SECTIONS,
} from '@/lib/signoffs'
import {
  PortalCard,
  type PortalSignoffDetail,
  type PortalSignoffLine,
  type PortalSignoffRow,
  type PortalSignoffStatus,
} from './portal-ui'

/**
 * Daily sign-off building blocks shared by the approvals list, the work page
 * and the sign-off page. Quantities only — the portal never sees a rate or
 * an amount for these sheets.
 */

const STATUS_PILL: Record<PortalSignoffStatus, { label: string; className: string }> = {
  released: {
    label: 'Awaiting your signature',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  signed: { label: 'Signed', className: 'bg-green-50 text-green-700 border-green-200' },
  disputed: {
    label: 'Disputed — under review',
    className: 'bg-red-50 text-red-700 border-red-200',
  },
  superseded: {
    label: 'Replaced by a revision',
    className: 'bg-slate-100 text-slate-600 border-slate-200',
  },
}

export function SignoffStatusPill({ status }: { status: PortalSignoffStatus }) {
  const pill = STATUS_PILL[status] ?? STATUS_PILL.superseded
  return (
    <span
      className={`inline-flex w-fit shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${pill.className}`}
    >
      {pill.label}
    </span>
  )
}

export function SignoffList({
  token,
  rows,
  showWork = false,
}: {
  token: string
  rows: PortalSignoffRow[]
  showWork?: boolean
}) {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={`/portal/${token}/signoffs/${row.id}`}
            className="block rounded-2xl border bg-white p-4 shadow-sm transition-all hover:border-slate-300 hover:shadow"
          >
            <div className="flex items-center gap-3.5">
              <span
                className={`flex size-11 shrink-0 items-center justify-center rounded-full ring-2 ${
                  row.status === 'released'
                    ? 'bg-amber-50 text-amber-600 ring-amber-500/40'
                    : row.status === 'signed'
                      ? 'bg-green-50 text-green-600 ring-green-500/40'
                      : 'bg-slate-100 text-slate-500 ring-slate-400/40'
                }`}
              >
                <ClipboardCheckIcon className="size-5" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {`Daily sign-off · ${fmtDate(row.date)}`}
                  {row.version > 1 ? (
                    <span className="font-normal normal-case tracking-normal">
                      {` · Revision ${row.version}`}
                    </span>
                  ) : null}
                </p>
                {showWork && (
                  <p className="truncate text-[15px] font-semibold text-slate-900">
                    {`${row.work_number} — ${row.work_title}`}
                  </p>
                )}
                <p className="text-xs text-slate-500">
                  {`${row.line_count} line${row.line_count === 1 ? '' : 's'}`}
                  {row.signer_name && row.status !== 'released'
                    ? ` · Signed by ${row.signer_name}${row.signed_on ? ` on ${fmtDate(row.signed_on)}` : ''}`
                    : ''}
                </p>
                <div className="pt-1">
                  <SignoffStatusPill status={row.status} />
                </div>
              </div>
              <ChevronRightIcon className="size-5 shrink-0 text-slate-300" />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** Lines grouped by section in SIGNOFF_SECTIONS order (empty sections skipped). */
export function groupSignoffLines(lines: PortalSignoffLine[]) {
  return SIGNOFF_SECTIONS.map((section) => ({
    section,
    label: SIGNOFF_SECTION_LABELS[section],
    lines: lines.filter((l) => l.section === section),
  })).filter((g) => g.lines.length > 0)
}

/**
 * Read-only sheet: one card per section. Disputed lines (from the client's
 * response) are tinted amber with their figure and reason underneath.
 */
export function SignoffLinesReadOnly({
  lines,
  disputes = [],
}: {
  lines: PortalSignoffLine[]
  disputes?: NonNullable<PortalSignoffDetail['response']>['disputes']
}) {
  const disputeByLine = new Map(disputes.map((d) => [d.line_id, d]))
  const groups = groupSignoffLines(lines)
  if (groups.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed bg-white px-4 py-10 text-center text-sm text-slate-500">
        No lines on this sheet.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.section} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {group.label}
          </h2>
          <PortalCard className="divide-y overflow-hidden">
            {group.lines.map((line) => {
              const dispute = disputeByLine.get(line.id)
              return (
                <div
                  key={line.id}
                  className={`flex flex-col gap-1 px-4 py-3 ${dispute ? 'bg-amber-50/70' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">{line.description}</p>
                      {line.detail && <p className="text-xs text-slate-500">{line.detail}</p>}
                      {line.scope_label && (
                        <p className="text-xs text-slate-400">{`Scope: ${line.scope_label}`}</p>
                      )}
                    </div>
                    <p
                      className={`shrink-0 text-sm font-semibold tabular-nums ${
                        dispute ? 'text-slate-400 line-through' : 'text-slate-900'
                      }`}
                    >
                      {`${fmtQty(line.qty)} ${line.unit}`}
                    </p>
                  </div>
                  {dispute && (
                    <div className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-amber-800">
                      <p className="font-semibold">
                        {`Your figure: ${fmtQty(dispute.client_qty)} ${line.unit}`}
                      </p>
                      <p className="whitespace-pre-wrap text-amber-700">{dispute.reason}</p>
                    </div>
                  )}
                </div>
              )
            })}
          </PortalCard>
        </div>
      ))}
    </div>
  )
}
