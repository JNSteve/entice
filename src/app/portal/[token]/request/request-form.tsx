'use client'

import React, { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { CircleCheckIcon, ImagePlusIcon, XIcon } from 'lucide-react'
import {
  MAX_REQUEST_PHOTOS,
  photoUploadProblem,
  REQUEST_URGENCIES,
  REQUEST_URGENCY_LABELS,
  type RequestUrgency,
} from '@/lib/portal-interactions'
import { submitPortalRequest } from '../actions'

interface SiteOption {
  id: string
  name: string
}

const URGENCY_CHIP_ACTIVE: Record<RequestUrgency, string> = {
  low: 'border-slate-400 bg-slate-100 text-slate-800',
  normal: 'border-blue-400 bg-blue-50 text-blue-800',
  high: 'border-amber-400 bg-amber-50 text-amber-800',
  urgent: 'border-red-400 bg-red-50 text-red-800',
}

/**
 * "Request work" form: property, title, description, urgency picker and up to
 * five photos (client-side previews; uploaded through the guarded
 * /request-upload route, then referenced by path in the submit RPC). Success
 * swaps the form for a confirmation card carrying the REQ number.
 */
export function RequestForm({
  token,
  sites,
  initialSiteId,
  companyName,
}: {
  token: string
  sites: SiteOption[]
  initialSiteId?: string
  companyName: string
}) {
  const [pending, startTransition] = useTransition()
  const [siteId, setSiteId] = useState(
    initialSiteId && sites.some((s) => s.id === initialSiteId)
      ? initialSiteId
      : (sites[0]?.id ?? '')
  )
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [urgency, setUrgency] = useState<RequestUrgency>('normal')
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ number: string; siteName: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Revoke object URLs when previews change/unmount.
  useEffect(() => {
    return () => previews.forEach((p) => URL.revokeObjectURL(p))
  }, [previews])

  function handleFilesPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    if (picked.length === 0) return
    const next = [...files, ...picked].slice(0, MAX_REQUEST_PHOTOS)
    const problem = photoUploadProblem(
      next.map((f) => ({ type: f.type, size: f.size }))
    )
    if (problem) {
      setError(problem)
    } else {
      setError(null)
      setFiles(next)
      setPreviews((old) => {
        old.forEach((p) => URL.revokeObjectURL(p))
        return next.map((f) => URL.createObjectURL(f))
      })
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeFile(index: number) {
    const next = files.filter((_, i) => i !== index)
    setFiles(next)
    setPreviews((old) => {
      old.forEach((p) => URL.revokeObjectURL(p))
      return next.map((f) => URL.createObjectURL(f))
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      // 1. Upload photos (if any) through the guarded route.
      let photoPaths: string[] = []
      if (files.length > 0) {
        setUploading(true)
        try {
          const form = new FormData()
          files.forEach((f) => form.append('files', f))
          const res = await fetch(`/portal/${token}/request-upload`, {
            method: 'POST',
            body: form,
          })
          const payload = (await res.json().catch(() => null)) as
            | { paths?: string[]; error?: string }
            | null
          if (!res.ok || !payload?.paths) {
            setError(payload?.error ?? 'Photo upload failed — please try again.')
            return
          }
          photoPaths = payload.paths
        } catch {
          setError('Photo upload failed — please try again.')
          return
        } finally {
          setUploading(false)
        }
      }

      // 2. Submit the request itself.
      const result = await submitPortalRequest({
        token,
        siteId,
        title,
        description,
        urgency,
        photoPaths,
      })
      if ('error' in result) {
        setError(result.error)
        return
      }
      setDone({
        number: result.number ?? '',
        siteName: sites.find((s) => s.id === siteId)?.name ?? '',
      })
    })
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border bg-white px-6 py-12 text-center shadow-sm">
        <span className="flex size-14 items-center justify-center rounded-full bg-green-50 text-green-600 ring-2 ring-green-500/40">
          <CircleCheckIcon className="size-7" />
        </span>
        <h2 className="text-lg font-bold text-slate-900">Request received</h2>
        <p className="text-sm text-slate-600">
          Your request{' '}
          <span className="font-semibold text-slate-900">{done.number}</span>
          {done.siteName ? (
            <>
              {' '}
              for <span className="font-semibold">{done.siteName}</span>
            </>
          ) : null}{' '}
          has been sent to {companyName}. You can track its progress from the
          property&apos;s Requests tab.
        </p>
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          <Link
            href={`/portal/${token}/sites/${siteId}?tab=requests`}
            className="flex min-h-11 items-center rounded-xl bg-[#1e3a5f] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            View your requests
          </Link>
          <Link
            href={`/portal/${token}`}
            className="flex min-h-11 items-center rounded-xl border bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Back to properties
          </Link>
        </div>
      </div>
    )
  }

  const busy = pending || uploading

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-2xl border bg-white p-4 shadow-sm sm:p-5"
    >
      {/* Property */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="req-site" className="text-sm font-medium text-slate-700">
          Property
        </label>
        {sites.length === 1 ? (
          <p className="flex min-h-11 items-center rounded-xl border bg-slate-50 px-3 text-sm font-medium text-slate-800">
            {sites[0].name}
          </p>
        ) : (
          <select
            id="req-site"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            required
            className="h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none transition-colors focus:border-[#1e3a5f]"
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Title */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="req-title" className="text-sm font-medium text-slate-700">
          What do you need?
        </label>
        <input
          id="req-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Asbestos removal to storeroom ceiling"
          maxLength={200}
          required
          className="h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none transition-colors focus:border-[#1e3a5f]"
        />
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="req-desc" className="text-sm font-medium text-slate-700">
          Details
        </label>
        <textarea
          id="req-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the work, access details, and anything else we should know…"
          maxLength={4000}
          rows={5}
          required
          className="w-full resize-y rounded-xl border bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-[#1e3a5f]"
        />
      </div>

      {/* Urgency */}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium text-slate-700">Urgency</legend>
        <div className="grid grid-cols-4 gap-2">
          {REQUEST_URGENCIES.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUrgency(u)}
              aria-pressed={urgency === u}
              className={`flex min-h-11 items-center justify-center rounded-xl border px-2 text-sm font-medium transition-colors ${
                urgency === u
                  ? URGENCY_CHIP_ACTIVE[u]
                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              {REQUEST_URGENCY_LABELS[u]}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Photos */}
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium text-slate-700">
          Photos{' '}
          <span className="font-normal text-slate-400">
            (optional, up to {MAX_REQUEST_PHOTOS})
          </span>
        </p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {previews.map((src, i) => (
            <div
              key={src}
              className="relative aspect-square overflow-hidden rounded-xl border bg-slate-100"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`Photo ${i + 1}`}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeFile(i)}
                aria-label={`Remove photo ${i + 1}`}
                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-slate-900/70 text-white transition-colors hover:bg-slate-900"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          ))}
          {files.length < MAX_REQUEST_PHOTOS && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-600"
              aria-label="Add photos"
            >
              <ImagePlusIcon className="size-5" />
              <span className="text-[11px] font-medium">Add</span>
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={handleFilesPicked}
          className="hidden"
          aria-hidden
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={busy || !title.trim() || !description.trim() || !siteId}
        className="flex min-h-12 items-center justify-center rounded-xl bg-[#1e3a5f] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {uploading ? 'Uploading photos…' : pending ? 'Sending…' : 'Send request'}
      </button>
    </form>
  )
}
