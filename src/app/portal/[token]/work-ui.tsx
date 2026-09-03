import Link from 'next/link'
import {
  CalendarIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileCheckIcon,
  FileTextIcon,
  ImageIcon,
  MapPinIcon,
} from 'lucide-react'
import { fmtDate } from '@/lib/format'
import {
  ProgressBar,
  WorkStatusBadge,
  type PortalFileRef,
  type PortalWorkSummary,
} from './portal-ui'

/** Shared work building blocks: photo grid, document rows, list cards. */

export const isPhoto = (a: PortalFileRef) => a.content_type?.startsWith('image/')

export function PhotoGallery({
  token,
  photos,
  limit,
}: {
  token: string
  photos: PortalFileRef[]
  /** Show only the first N (the site page previews; the work page shows all). */
  limit?: number
}) {
  if (photos.length === 0) return null
  const shown = limit ? photos.slice(0, limit) : photos
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {shown.map((p) => (
        <a
          key={p.id}
          href={`/portal/${token}/file/attachment/${p.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block aspect-square overflow-hidden rounded-xl border bg-slate-100"
          aria-label={`View ${p.filename}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/portal/${token}/file/attachment/${p.id}`}
            alt={p.caption ?? p.filename}
            className="h-full w-full object-cover transition-transform hover:scale-105"
            loading="lazy"
          />
        </a>
      ))}
    </div>
  )
}

export function DocRows({
  token,
  docs,
}: {
  token: string
  docs: PortalFileRef[]
}) {
  if (docs.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      {docs.map((d) => (
        <a
          key={d.id}
          href={`/portal/${token}/file/attachment/${d.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition-colors hover:bg-slate-50"
        >
          <FileTextIcon className="size-4 shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1 truncate font-medium text-slate-700">
            {d.filename}
          </span>
          <DownloadIcon className="size-3.5 shrink-0 text-slate-300" />
        </a>
      ))}
    </div>
  )
}

/** One work in a list (Overview "Current works", Works page). */
export function WorkCard({
  token,
  work,
}: {
  token: string
  work: PortalWorkSummary
}) {
  const dates = [
    work.from ? `From ${fmtDate(work.from)}` : null,
    work.to ? `to ${fmtDate(work.to)}` : null,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <Link
      href={`/portal/${token}/works/${work.kind}/${work.id}`}
      className="block rounded-2xl border bg-white p-4 shadow-sm transition-all hover:border-slate-300 hover:shadow"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {work.number}
          </p>
          <p className="truncate text-[15px] font-semibold text-slate-900">{work.title}</p>
          {work.site_name && (
            <p className="flex items-center gap-1 truncate text-xs text-slate-500">
              <MapPinIcon className="size-3 shrink-0" />
              <span className="truncate">{work.site_name}</span>
            </p>
          )}
        </div>
        <WorkStatusBadge status={work.status} />
      </div>
      {dates && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
          <CalendarIcon className="size-3.5 text-slate-400" />
          {dates}
        </p>
      )}
      {work.progress_pct !== null && (
        <div className="mt-2">
          <ProgressBar pct={work.progress_pct} />
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        {work.photo_count > 0 && (
          <span className="flex items-center gap-1">
            <ImageIcon className="size-3.5 text-slate-400" />
            {work.photo_count} photo{work.photo_count === 1 ? '' : 's'}
          </span>
        )}
        {work.doc_count > 0 && (
          <span className="flex items-center gap-1">
            <FileTextIcon className="size-3.5 text-slate-400" />
            {work.doc_count} document{work.doc_count === 1 ? '' : 's'}
          </span>
        )}
        {work.has_handover && (
          <span className="flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 font-medium text-green-700">
            <FileCheckIcon className="size-3.5" />
            Close-out pack
          </span>
        )}
        <ChevronRightIcon className="ml-auto size-4 text-slate-300" />
      </div>
    </Link>
  )
}
