'use client'

import { useMemo, useState } from 'react'
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FolderIcon,
  ImageIcon,
  SearchIcon,
} from 'lucide-react'
import { fmtDate } from '@/lib/format'
import {
  filterEntries,
  fmtBytes,
  groupEntriesByYear,
  PORTAL_FOLDER_DESCRIPTIONS,
  PORTAL_FOLDER_LABELS,
  PORTAL_FOLDER_ORDER,
  type PortalDocEntry,
  type PortalFileType,
  type PortalFolder,
} from '@/lib/portal-experience'

/**
 * The property's document library: auto-organised folders (Compliance /
 * Certificates / Works records / Reports) with search across everything.
 * Folder navigation is local state — the tab load itself is the logged page
 * view, and every download still goes through the logged file route.
 */
export function DocumentBrowser({ entries }: { entries: PortalDocEntry[] }) {
  const [folder, setFolder] = useState<PortalFolder | null>(null)
  const [query, setQuery] = useState('')

  const searching = query.trim().length > 0
  const counts = useMemo(() => {
    const map = new Map<PortalFolder, number>()
    for (const entry of entries) {
      map.set(entry.folder, (map.get(entry.folder) ?? 0) + 1)
    }
    return map
  }, [entries])

  const visible = useMemo(() => {
    const inScope = searching
      ? entries
      : entries.filter((e) => e.folder === folder)
    return filterEntries(inScope, query)
  }, [entries, folder, query, searching])

  if (entries.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed bg-white px-4 py-10 text-center text-sm text-slate-500">
        No documents shared for this property yet.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Search across every folder */}
      <label className="relative block">
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents…"
          className="h-11 w-full rounded-xl border bg-white pl-10 pr-4 text-sm shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-[#1e3a5f]/50 focus:ring-2 focus:ring-[#1e3a5f]/15"
        />
      </label>

      {searching ? (
        <FileList
          entries={visible}
          showFolder
          emptyText={`No documents match “${query.trim()}”.`}
        />
      ) : folder === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PORTAL_FOLDER_ORDER.map((f) => {
            const count = counts.get(f) ?? 0
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFolder(f)}
                disabled={count === 0}
                className={`flex min-h-11 items-center gap-3.5 rounded-2xl border bg-white p-4 text-left shadow-sm transition-all ${
                  count === 0
                    ? 'opacity-45'
                    : 'hover:border-slate-300 hover:shadow'
                }`}
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                  <FolderIcon className="size-5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-semibold text-slate-900">
                    {PORTAL_FOLDER_LABELS[f]}
                  </span>
                  <span className="truncate text-xs text-slate-500">
                    {PORTAL_FOLDER_DESCRIPTIONS[f]}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600">
                    {count}
                  </span>
                  {count > 0 && (
                    <ChevronRightIcon className="size-4 text-slate-300" />
                  )}
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setFolder(null)}
            className="flex min-h-11 w-fit items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
          >
            <ArrowLeftIcon className="size-4" />
            All folders
            <span className="text-slate-300">/</span>
            <span className="text-slate-900">{PORTAL_FOLDER_LABELS[folder]}</span>
          </button>
          <FileList
            entries={visible}
            emptyText="Nothing in this folder yet."
          />
        </div>
      )}
    </div>
  )
}

const FILE_ICONS: Record<PortalFileType, typeof FileIcon> = {
  pdf: FileTextIcon,
  image: ImageIcon,
  sheet: FileSpreadsheetIcon,
  doc: FileTextIcon,
  other: FileIcon,
}

function FileList({
  entries,
  showFolder = false,
  emptyText,
}: {
  entries: PortalDocEntry[]
  showFolder?: boolean
  emptyText: string
}) {
  if (entries.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed bg-white px-4 py-8 text-center text-sm text-slate-500">
        {emptyText}
      </p>
    )
  }

  const groups = groupEntriesByYear(entries)

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.year ?? 'all'} className="flex flex-col gap-2">
          {group.year && (
            <p className="pl-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {group.year}
            </p>
          )}
          <ul className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            {group.entries.map((entry) => {
              const Icon = FILE_ICONS[entry.fileType]
              const meta = [
                showFolder ? PORTAL_FOLDER_LABELS[entry.folder] : entry.sublabel,
                entry.date ? fmtDate(entry.date) : null,
                fmtBytes(entry.size) || null,
              ].filter(Boolean)
              return (
                <li key={entry.id} className="border-b last:border-b-0">
                  <a
                    href={entry.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-11 items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                      <Icon className="size-4.5" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-slate-900">
                        {entry.name}
                      </span>
                      <span className="truncate text-xs text-slate-500">
                        {meta.join(' · ')}
                      </span>
                    </span>
                    <DownloadIcon className="size-4 shrink-0 text-slate-300" />
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
