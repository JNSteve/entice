'use client'

import React, { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CircleCheckIcon, TriangleAlertIcon } from 'lucide-react'
import { SignaturePad } from '@/components/SignaturePad'
import { fmtDate } from '@/lib/format'
import {
  fmtQty,
  MAX_DISPUTE_REASON,
  SIGNOFF_SECTION_LABELS,
  SIGNOFF_SECTIONS,
  validateDisputes,
} from '@/lib/signoffs'
import type { PortalSignoffLine } from '../../portal-ui'
import { respondPortalSignoff } from '../../actions'

type DisputeDraft = { qty: string; reason: string }

/**
 * Sign-on-the-glass flow for one released daily sheet: the client reviews
 * each line, may dispute any of them (their figure + a reason), then signs.
 * A sheet with disputes is still signed — it lands as 'disputed' and the
 * office issues a revision. Quantities only, never money.
 */
export function SignoffRespond({
  token,
  id,
  date,
  workKind,
  workId,
  lines,
}: {
  token: string
  id: string
  date: string
  workKind: 'job' | 'project'
  workId: string
  lines: PortalSignoffLine[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [disputes, setDisputes] = useState<Record<string, DisputeDraft>>({})
  const [signerName, setSignerName] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ status: 'signed' | 'disputed'; count: number } | null>(
    null
  )

  const groups = useMemo(
    () =>
      SIGNOFF_SECTIONS.map((section) => ({
        section,
        label: SIGNOFF_SECTION_LABELS[section],
        lines: lines.filter((l) => l.section === section),
      })).filter((g) => g.lines.length > 0),
    [lines]
  )

  const disputedIds = Object.keys(disputes)
  const n = disputedIds.length

  function toggleDispute(line: PortalSignoffLine) {
    setError(null)
    setDisputes((prev) => {
      const next = { ...prev }
      if (next[line.id]) delete next[line.id]
      else next[line.id] = { qty: fmtQty(line.qty), reason: '' }
      return next
    })
  }

  function updateDispute(lineId: string, patch: Partial<DisputeDraft>) {
    setDisputes((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!signature) {
      setError('Please sign in the box before submitting.')
      return
    }
    const raw = disputedIds.map((lineId) => {
      const d = disputes[lineId]
      const qtyText = d.qty.trim()
      return {
        line_id: lineId,
        // Empty → NaN so validateDisputes asks for a figure instead of
        // silently treating it as 0.
        client_qty: qtyText === '' ? Number.NaN : Number(qtyText),
        reason: d.reason,
      }
    })
    const checked = validateDisputes(raw, new Set(lines.map((l) => l.id)))
    if ('error' in checked) {
      setError(checked.error)
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await respondPortalSignoff({
        token,
        id,
        signerName,
        signature,
        disputes: checked.disputes,
      })
      if ('error' in result) {
        setError(result.error)
        return
      }
      setDone({
        status: result.status ?? (checked.disputes.length ? 'disputed' : 'signed'),
        count: checked.disputes.length,
      })
      router.refresh()
    })
  }

  if (done) {
    const signed = done.status === 'signed'
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border bg-white px-6 py-12 text-center shadow-sm">
        <span
          className={`flex size-14 items-center justify-center rounded-full ring-2 ${
            signed
              ? 'bg-green-50 text-green-600 ring-green-500/40'
              : 'bg-amber-50 text-amber-600 ring-amber-500/40'
          }`}
        >
          <CircleCheckIcon className="size-7" />
        </span>
        <h2 className="text-lg font-bold text-slate-900">
          {signed ? 'Sheet signed' : 'Signed with disputes'}
        </h2>
        <p className="max-w-sm text-sm text-slate-600">
          {signed
            ? `Thank you — your confirmation for ${fmtDate(date)} has been recorded and our team has been notified.`
            : `Thank you — we have recorded your signature and ${done.count} disputed line${done.count === 1 ? '' : 's'}. Our team will review and send a revised sheet.`}
        </p>
        <Link
          href={`/portal/${token}/works/${workKind}/${workId}`}
          className="mt-1 flex min-h-11 items-center rounded-xl bg-[#162040] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Back to the work
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {groups.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-white px-4 py-10 text-center text-sm text-slate-500">
          No lines on this sheet.
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.section} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {group.label}
            </h2>
            <div className="divide-y overflow-hidden rounded-2xl border bg-white shadow-sm">
              {group.lines.map((line) => {
                const dispute = disputes[line.id]
                return (
                  <div
                    key={line.id}
                    className={`flex flex-col gap-2 px-4 py-3 transition-colors ${
                      dispute ? 'bg-amber-50/70' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900">{line.description}</p>
                        {line.detail && <p className="text-xs text-slate-500">{line.detail}</p>}
                        {line.scope_label && (
                          <p className="text-xs text-slate-400">{`Scope: ${line.scope_label}`}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <p className="text-sm font-semibold tabular-nums text-slate-900">
                          {`${fmtQty(line.qty)} ${line.unit}`}
                        </p>
                        <button
                          type="button"
                          onClick={() => toggleDispute(line)}
                          aria-pressed={!!dispute}
                          className={`min-h-8 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                            dispute
                              ? 'border-amber-300 bg-amber-100 text-amber-800'
                              : 'border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                          }`}
                        >
                          {dispute ? 'Undo dispute' : 'Dispute'}
                        </button>
                      </div>
                    </div>
                    {dispute && (
                      <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-white p-3">
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor={`qty-${line.id}`}
                            className="text-xs font-medium text-slate-700"
                          >
                            {`Your figure (${line.unit})`}
                          </label>
                          <input
                            id={`qty-${line.id}`}
                            type="text"
                            inputMode="decimal"
                            value={dispute.qty}
                            onChange={(e) => updateDispute(line.id, { qty: e.target.value })}
                            className="h-11 w-32 rounded-xl border bg-white px-3 text-base tabular-nums outline-none transition-colors focus:border-[#162040] md:text-sm"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor={`reason-${line.id}`}
                            className="text-xs font-medium text-slate-700"
                          >
                            Reason
                          </label>
                          <textarea
                            id={`reason-${line.id}`}
                            value={dispute.reason}
                            onChange={(e) => updateDispute(line.id, { reason: e.target.value })}
                            maxLength={MAX_DISPUTE_REASON}
                            rows={2}
                            placeholder="What's different from what you saw on site?"
                            className="w-full resize-y rounded-xl border bg-white px-3 py-2.5 text-base outline-none transition-colors focus:border-[#162040] md:text-sm"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}

      <div className="flex flex-col gap-4 rounded-2xl border bg-white p-4 shadow-sm sm:p-5">
        {n > 0 && (
          <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
            <TriangleAlertIcon className="size-4 shrink-0" />
            {`${n} line${n === 1 ? '' : 's'} disputed`}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="signoff-name" className="text-sm font-medium text-slate-700">
            Your full name
          </label>
          <input
            id="signoff-name"
            type="text"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder="Full name"
            maxLength={120}
            required
            className="h-11 w-full rounded-xl border bg-white px-3 text-base outline-none transition-colors focus:border-[#162040] md:text-sm"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-slate-700">Signature</p>
          <SignaturePad onChange={setSignature} />
        </div>

        <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
          {`I confirm the labour, plant and materials listed above for ${fmtDate(date)}${n ? ', except the lines I have disputed' : ''}.`}
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={pending || !signerName.trim() || !signature}
          className={`flex min-h-12 items-center justify-center rounded-xl px-4 text-sm font-semibold text-white transition-colors disabled:opacity-40 ${
            n > 0 ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {pending
            ? 'Recording…'
            : n === 0
              ? 'Sign and confirm'
              : `Sign with ${n} disputed line${n === 1 ? '' : 's'}`}
        </button>
      </div>
    </form>
  )
}
