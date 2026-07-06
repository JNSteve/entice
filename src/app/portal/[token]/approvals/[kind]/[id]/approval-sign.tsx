'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CircleCheckIcon } from 'lucide-react'
import { SignaturePad } from '@/components/SignaturePad'
import { acceptanceWording } from '@/lib/portal-interactions'
import { acceptPortalApproval, declinePortalApproval } from '../../../actions'

/**
 * Sign-on-the-glass flow for one published quote/variation: signer name +
 * signature pad + the acceptance wording, or a decline path with a reason
 * box. Success swaps in a confirmation card; the office side is updated by
 * the same RPC that records the signature.
 */
export function ApprovalSign({
  token,
  kind,
  id,
  number,
  clientName,
}: {
  token: string
  kind: 'quote' | 'variation'
  id: string
  number: string
  clientName: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [mode, setMode] = useState<'accept' | 'decline'>('accept')
  const [signerName, setSignerName] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<'accepted' | 'declined' | null>(null)

  function handleAccept(e: React.FormEvent) {
    e.preventDefault()
    if (!signature) {
      setError('Please sign in the box before accepting.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await acceptPortalApproval({
        token,
        kind,
        id,
        signerName,
        signature,
      })
      if ('error' in result) {
        setError(result.error)
        return
      }
      setDone('accepted')
      router.refresh()
    })
  }

  function handleDecline(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await declinePortalApproval({
        token,
        kind,
        id,
        signerName,
        reason,
      })
      if ('error' in result) {
        setError(result.error)
        return
      }
      setDone('declined')
      router.refresh()
    })
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border bg-white px-6 py-12 text-center shadow-sm">
        <span
          className={`flex size-14 items-center justify-center rounded-full ring-2 ${
            done === 'accepted'
              ? 'bg-green-50 text-green-600 ring-green-500/40'
              : 'bg-slate-100 text-slate-600 ring-slate-400/40'
          }`}
        >
          <CircleCheckIcon className="size-7" />
        </span>
        <h2 className="text-lg font-bold text-slate-900">
          {done === 'accepted' ? `${number} accepted` : 'Response recorded'}
        </h2>
        <p className="max-w-sm text-sm text-slate-600">
          {done === 'accepted'
            ? 'Thank you — your acceptance has been recorded and our team has been notified.'
            : 'Thank you — we have recorded your response and our team will be in touch.'}
        </p>
        <Link
          href={`/portal/${token}/approvals`}
          className="mt-1 flex min-h-11 items-center rounded-xl bg-[#162040] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Back to approvals
        </Link>
      </div>
    )
  }

  const tabClass = (active: boolean) =>
    `flex min-h-11 flex-1 items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors ${
      active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
    }`

  return (
    <div className="flex flex-col gap-4">
      {/* Accept / decline switch */}
      <div className="flex gap-1 rounded-xl bg-slate-200/70 p-1">
        <button
          type="button"
          className={tabClass(mode === 'accept')}
          onClick={() => {
            setMode('accept')
            setError(null)
          }}
        >
          Accept
        </button>
        <button
          type="button"
          className={tabClass(mode === 'decline')}
          onClick={() => {
            setMode('decline')
            setError(null)
          }}
        >
          Decline
        </button>
      </div>

      {mode === 'accept' ? (
        <form
          onSubmit={handleAccept}
          className="flex flex-col gap-4 rounded-2xl border bg-white p-4 shadow-sm sm:p-5"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sig-name" className="text-sm font-medium text-slate-700">
              Your full name
            </label>
            <input
              id="sig-name"
              type="text"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Full name"
              maxLength={120}
              required
              className="h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none transition-colors focus:border-[#162040]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-slate-700">Signature</p>
            <SignaturePad onChange={setSignature} />
          </div>

          <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
            {acceptanceWording(number, clientName)}
          </p>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={pending || !signerName.trim() || !signature}
            className="flex min-h-12 items-center justify-center rounded-xl bg-green-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-40"
          >
            {pending ? 'Recording…' : `Sign and accept ${number}`}
          </button>
        </form>
      ) : (
        <form
          onSubmit={handleDecline}
          className="flex flex-col gap-4 rounded-2xl border bg-white p-4 shadow-sm sm:p-5"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="dec-name" className="text-sm font-medium text-slate-700">
              Your full name
            </label>
            <input
              id="dec-name"
              type="text"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Full name"
              maxLength={120}
              required
              className="h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none transition-colors focus:border-[#162040]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="dec-reason" className="text-sm font-medium text-slate-700">
              Why are you declining?
            </label>
            <textarea
              id="dec-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Let us know what doesn't work — price, scope, timing…"
              maxLength={1000}
              rows={4}
              required
              className="w-full resize-y rounded-xl border bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-[#162040]"
            />
          </div>

          <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
            Declining doesn&apos;t cancel anything — our team will review your
            feedback and come back to you.
          </p>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={pending || !signerName.trim() || !reason.trim()}
            className="flex min-h-12 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:opacity-40"
          >
            {pending ? 'Recording…' : `Decline ${number}`}
          </button>
        </form>
      )}
    </div>
  )
}
