'use client'

import React, { useRef, useState, useTransition } from 'react'
import { CircleCheckIcon, FilePlusIcon, XIcon } from 'lucide-react'
import {
  PROPERTY_COMPLIANCE_KIND_LABELS,
  type PropertyComplianceKind,
} from '@/lib/portal'
import { submitPortalUpload } from '../../actions'

const KINDS = Object.keys(
  PROPERTY_COMPLIANCE_KIND_LABELS
) as PropertyComplianceKind[]

const MAX_BYTES = 10 * 1024 * 1024
const ACCEPTED = 'application/pdf,image/jpeg,image/png,image/webp,image/gif'

/**
 * "Add a document" — clients file their own compliance documents (e.g. a
 * clearance issued by another contractor) into the property register.
 * Nothing appears in the register until the office reviews and approves it;
 * the pending state is shown alongside the register items.
 */
export function UploadDocumentCard({
  token,
  siteId,
  companyName,
}: {
  token: string
  siteId: string
  companyName: string
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [kind, setKind] = useState<PropertyComplianceKind>('clearance_certificate')
  const [title, setTitle] = useState('')
  const [issueDate, setIssueDate] = useState('')
  const [reviewDue, setReviewDue] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null
    if (!picked) return
    if (picked.size === 0 || picked.size > MAX_BYTES) {
      setError('Files must be under 10MB')
    } else {
      setError(null)
      setFile(picked)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) {
      setError('Attach the document file')
      return
    }
    setError(null)
    startTransition(async () => {
      // 1. Upload the blob through the guarded route.
      setUploading(true)
      let path: string
      try {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch(`/portal/${token}/document-upload`, {
          method: 'POST',
          body: form,
        })
        const payload = (await res.json().catch(() => null)) as
          | { path?: string; error?: string }
          | null
        if (!res.ok || !payload?.path) {
          setError(payload?.error ?? 'Upload failed — please try again.')
          return
        }
        path = payload.path
      } catch {
        setError('Upload failed — please try again.')
        return
      } finally {
        setUploading(false)
      }

      // 2. File the metadata for office review.
      const result = await submitPortalUpload({
        token,
        siteId,
        kind,
        title,
        issueDate,
        reviewDue: reviewDue || null,
        notes: notes || null,
        path,
        filename: file.name,
        contentType: file.type || null,
        size: file.size || null,
      })
      if ('error' in result) {
        setError(result.error)
        return
      }
      setDone(true)
    })
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border bg-white px-6 py-8 text-center shadow-sm">
        <span className="flex size-12 items-center justify-center rounded-full bg-green-50 text-green-600 ring-2 ring-green-500/40">
          <CircleCheckIcon className="size-6" />
        </span>
        <h3 className="text-base font-bold text-slate-900">
          Sent to {companyName} for review
        </h3>
        <p className="max-w-md text-sm text-slate-600">
          It&apos;ll appear in your property register once verified. You can
          see its review status here in the meantime.
        </p>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed bg-white px-4 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
      >
        <FilePlusIcon className="size-4" />
        Add a document to this property&apos;s register
      </button>
    )
  }

  const busy = pending || uploading

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-2xl border bg-white p-4 shadow-sm sm:p-5"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-base font-bold text-slate-900">Add a document</h3>
          <p className="text-sm text-slate-500">
            e.g. a clearance or survey from another contractor —{' '}
            {companyName} will verify it before it joins the register.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="up-kind" className="text-sm font-medium text-slate-700">
            Document type
          </label>
          <select
            id="up-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as PropertyComplianceKind)}
            className="h-11 w-full rounded-xl border bg-white px-3 text-base outline-none transition-colors focus:border-[#162040] md:text-sm"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {PROPERTY_COMPLIANCE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="up-title" className="text-sm font-medium text-slate-700">
            Title
          </label>
          <input
            id="up-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Clearance certificate — storeroom"
            maxLength={200}
            required
            className="h-11 w-full rounded-xl border bg-white px-3 text-base outline-none transition-colors focus:border-[#162040] md:text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="up-issued" className="text-sm font-medium text-slate-700">
            Issue date
          </label>
          <input
            id="up-issued"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            required
            className="h-11 w-full rounded-xl border bg-white px-3 text-base outline-none transition-colors focus:border-[#162040] md:text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="up-review" className="text-sm font-medium text-slate-700">
            Review due{' '}
            <span className="font-normal text-slate-400">(if known)</span>
          </label>
          <input
            id="up-review"
            type="date"
            value={reviewDue}
            onChange={(e) => setReviewDue(e.target.value)}
            className="h-11 w-full rounded-xl border bg-white px-3 text-base outline-none transition-colors focus:border-[#162040] md:text-sm"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="up-notes" className="text-sm font-medium text-slate-700">
          Notes <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea
          id="up-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder="Who issued it, which area it covers…"
          className="w-full resize-y rounded-xl border bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-[#162040]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium text-slate-700">File (PDF or image, under 10MB)</p>
        {file ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border bg-slate-50 px-3 py-2.5">
            <span className="min-w-0 truncate text-sm font-medium text-slate-800">
              {file.name}
            </span>
            <button
              type="button"
              onClick={() => setFile(null)}
              aria-label="Remove file"
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-dashed text-sm font-medium text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-800"
          >
            <FilePlusIcon className="size-4" />
            Choose file
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          onChange={handleFilePicked}
          className="hidden"
          aria-hidden
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={busy || !title.trim() || !issueDate || !file}
        className="flex min-h-12 items-center justify-center rounded-xl bg-[#162040] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {uploading ? 'Uploading…' : pending ? 'Sending…' : 'Send for review'}
      </button>
    </form>
  )
}
