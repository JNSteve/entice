import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeftIcon,
  CalendarIcon,
  CircleCheckIcon,
  DownloadIcon,
  FileTextIcon,
  MapPinIcon,
} from 'lucide-react'
import { createPublicClient } from '@/lib/supabase/public'
import { todayAU } from '@/lib/tz'
import { fmtDate } from '@/lib/format'
import {
  derivePropertyItemStatus,
  derivePropertyStatus,
  PROPERTY_COMPLIANCE_KIND_LABELS,
  type PropertyComplianceKind,
} from '@/lib/portal'
import {
  fileTypeOf,
  folderForItemKind,
  propertyStatusPhrase,
  workGroupForJob,
  workGroupForProject,
  type PortalDocEntry,
} from '@/lib/portal-experience'
import {
  EmptyState,
  LinkInactivePage,
  PortalCard,
  PortalLight,
  PortalShell,
  ProgressBar,
  StatusRing,
  WorkStatusBadge,
  type PortalBranding,
} from '../../portal-ui'
import { DocumentBrowser } from './document-browser'

// Public, token-gated, no auth — always resolve the token fresh, never cache.
export const dynamic = 'force-dynamic'

// ─── portal_site_detail payload shapes ───────────────────────────────────────

interface PortalAttachment {
  id: string
  filename: string
  kind: string
  content_type: string | null
  caption: string | null
  size: number | null
  created_at: string
  created_on: string | null
}

interface PortalItem {
  id: string
  kind: PropertyComplianceKind
  title: string
  issue_date: string
  review_due: string | null
  notes: string | null
  filename: string | null
  has_file: boolean
}

interface PortalJob {
  id: string
  number: string
  title: string
  status: string
  scheduled_start: string | null
  scheduled_end: string | null
  completed_on: string | null
  attachments: PortalAttachment[]
}

interface PortalProject {
  id: string
  number: string
  name: string
  status: string
  start_date: string | null
  practical_completion_date: string | null
  progress_pct: number | null
  attachments: PortalAttachment[]
}

interface PortalSiteDetail {
  site: {
    id: string
    name: string
    address: string | null
    suburb: string | null
    state: string | null
    postcode: string | null
  }
  items: PortalItem[]
  jobs: PortalJob[]
  projects: PortalProject[]
}

/** One shape for job + project works, grouped live/history. */
interface WorkEntry {
  key: string
  number: string
  title: string
  status: string
  from: string | null
  to: string | null
  /** Best 'happened on' date for the history timeline. */
  historyDate: string | null
  progressPct: number | null
  attachments: PortalAttachment[]
}

// ─── Building blocks ─────────────────────────────────────────────────────────

function PhotoGallery({
  token,
  photos,
}: {
  token: string
  photos: PortalAttachment[]
}) {
  if (photos.length === 0) return null
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {photos.map((p) => (
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

function DocRows({
  token,
  docs,
}: {
  token: string
  docs: PortalAttachment[]
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

const isPhoto = (a: PortalAttachment) => a.content_type?.startsWith('image/')

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * One property, three tabs:
 *   Compliance — the property's compliance register with traffic lights and
 *                logged evidence downloads.
 *   Documents  — the document library: auto-organised folders + search.
 *   Works      — live works as rich cards (status, programme progress,
 *                photos) and a completed-works timeline. NO money, ever.
 * Tabs are links, not JS — every switch is a logged page view.
 */
export default async function PortalSitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; siteId: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { token, siteId } = await params
  const { tab } = await searchParams
  const activeTab =
    tab === 'works' ? 'works' : tab === 'documents' ? 'documents' : 'compliance'

  // Reject junk before it reaches the RPC (uuid cast errors → 500s otherwise).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(siteId)) {
    notFound()
  }

  const supabase = createPublicClient()

  const { data: resolved } = await supabase.rpc('portal_resolve_link', {
    p_token: token,
  })
  const branding = (resolved ?? null) as PortalBranding | null
  if (!branding) return <LinkInactivePage />

  const [{ data: detailData }] = await Promise.all([
    supabase.rpc('portal_site_detail', { p_token: token, p_site: siteId }),
    supabase.rpc('portal_log_view', {
      p_token: token,
      p_site: siteId,
      p_path: `/portal/sites/${siteId}?tab=${activeTab}`,
    }),
  ])
  const detail = (detailData ?? null) as PortalSiteDetail | null
  if (!detail) notFound()

  const today = todayAU()
  const address = [
    detail.site.address,
    detail.site.suburb,
    detail.site.state,
    detail.site.postcode,
  ]
    .filter(Boolean)
    .join(', ')

  const dues = detail.items.map((i) => i.review_due)
  const siteStatus = derivePropertyStatus(dues, today)
  const { phrase } = propertyStatusPhrase(dues, today)

  // ── Works: one shape, grouped live vs history ──────────────────────────────
  const works: (WorkEntry & { group: 'live' | 'history' })[] = [
    ...detail.projects.map((p) => ({
      key: `project-${p.id}`,
      number: p.number,
      title: p.name,
      status: p.status,
      from: p.start_date,
      to: p.practical_completion_date,
      historyDate: p.practical_completion_date ?? p.start_date,
      progressPct: p.progress_pct,
      attachments: p.attachments,
      group: workGroupForProject(p.status),
    })),
    ...detail.jobs.map((j) => ({
      key: `job-${j.id}`,
      number: j.number,
      title: j.title,
      status: j.status,
      from: j.scheduled_start,
      to: j.scheduled_end,
      historyDate: j.completed_on ?? j.scheduled_end ?? j.scheduled_start,
      progressPct: null,
      attachments: j.attachments,
      group: workGroupForJob(j.status),
    })),
  ]
  const liveWorks = works.filter((w) => w.group === 'live')
  const historyWorks = works
    .filter((w) => w.group === 'history')
    .sort((a, b) => (b.historyDate ?? '').localeCompare(a.historyDate ?? ''))

  // ── Document library entries ───────────────────────────────────────────────
  const docEntries: PortalDocEntry[] = [
    ...detail.items
      .filter((i) => i.has_file)
      .map((i) => ({
        id: `item-${i.id}`,
        folder: folderForItemKind(i.kind),
        name: i.filename ?? i.title,
        sublabel: PROPERTY_COMPLIANCE_KIND_LABELS[i.kind] ?? i.kind,
        date: i.issue_date,
        size: null,
        fileType: fileTypeOf(i.filename, null),
        href: `/portal/${token}/file/item/${i.id}`,
      })),
    ...works.flatMap((w) =>
      w.attachments.map((a) => ({
        id: `attachment-${a.id}`,
        folder: 'works' as const,
        name: a.filename,
        sublabel: `${w.number} — ${w.title}`,
        date: a.created_on,
        size: a.size,
        fileType: fileTypeOf(a.filename, a.content_type),
        href: `/portal/${token}/file/attachment/${a.id}`,
      }))
    ),
  ]

  const tabClass = (active: boolean) =>
    `flex min-h-11 flex-1 items-center justify-center rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors ${
      active
        ? 'bg-white text-slate-900 shadow-sm'
        : 'text-slate-500 hover:text-slate-800'
    }`

  return (
    <PortalShell branding={branding} token={token} active="properties">
      {/* Property header */}
      <div className="flex flex-col gap-3">
        <Link
          href={`/portal/${token}`}
          className="flex min-h-6 w-fit items-center gap-1 text-sm text-slate-500 transition-colors hover:text-slate-900"
        >
          <ArrowLeftIcon className="size-3.5" />
          All properties
        </Link>
        <div className="flex items-center gap-3.5">
          <StatusRing status={siteStatus} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              {detail.site.name}
            </h1>
            {address && (
              <p className="flex items-center gap-1 text-sm text-slate-500">
                <MapPinIcon className="size-3.5 shrink-0" />
                <span className="truncate">{address}</span>
              </p>
            )}
            <div className="pt-1">
              <PortalLight status={siteStatus} label={phrase} />
            </div>
          </div>
        </div>
      </div>

      {/* Tabs (links, not JS — every switch is a logged page view) */}
      <div className="flex gap-1 rounded-xl bg-slate-200/70 p-1">
        <Link
          href={`/portal/${token}/sites/${siteId}`}
          className={tabClass(activeTab === 'compliance')}
        >
          Compliance
        </Link>
        <Link
          href={`/portal/${token}/sites/${siteId}?tab=documents`}
          className={tabClass(activeTab === 'documents')}
        >
          Documents
        </Link>
        <Link
          href={`/portal/${token}/sites/${siteId}?tab=works`}
          className={tabClass(activeTab === 'works')}
        >
          Works
        </Link>
      </div>

      {/* ── Compliance ─────────────────────────────────────────────────────── */}
      {activeTab === 'compliance' &&
        (detail.items.length === 0 ? (
          <EmptyState>
            No compliance documents on record for this property yet.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {detail.items.map((item) => {
              const itemStatus = derivePropertyItemStatus(item.review_due, today)
              return (
                <li key={item.id}>
                  <PortalCard className="flex flex-col gap-2.5 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          {PROPERTY_COMPLIANCE_KIND_LABELS[item.kind] ?? item.kind}
                        </p>
                        <p className="text-[15px] font-semibold text-slate-900">
                          {item.title}
                        </p>
                      </div>
                      <PortalLight status={itemStatus} />
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span className="flex items-center gap-1.5">
                        <CalendarIcon className="size-3.5 text-slate-400" />
                        Issued {fmtDate(item.issue_date)}
                      </span>
                      <span
                        className={`flex items-center gap-1.5 ${
                          itemStatus === 'red'
                            ? 'font-semibold text-red-600'
                            : itemStatus === 'amber'
                              ? 'font-semibold text-amber-600'
                              : ''
                        }`}
                      >
                        {item.review_due ? (
                          <>
                            <CalendarIcon
                              className={`size-3.5 ${
                                itemStatus === 'green' ? 'text-slate-400' : ''
                              }`}
                            />
                            Review due {fmtDate(item.review_due)}
                          </>
                        ) : (
                          <>
                            <CircleCheckIcon className="size-3.5 text-slate-400" />
                            No review required
                          </>
                        )}
                      </span>
                    </div>
                    {item.notes && (
                      <p className="text-sm text-slate-600">{item.notes}</p>
                    )}
                    {item.has_file && (
                      <a
                        href={`/portal/${token}/file/item/${item.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-h-11 w-fit items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium text-[#1e3a5f] transition-colors hover:bg-slate-50"
                      >
                        <DownloadIcon className="size-4" />
                        <span className="max-w-60 truncate">
                          {item.filename ?? 'View document'}
                        </span>
                      </a>
                    )}
                  </PortalCard>
                </li>
              )
            })}
          </ul>
        ))}

      {/* ── Documents ──────────────────────────────────────────────────────── */}
      {activeTab === 'documents' && <DocumentBrowser entries={docEntries} />}

      {/* ── Works ──────────────────────────────────────────────────────────── */}
      {activeTab === 'works' && (
        <div className="flex flex-col gap-5">
          {works.length === 0 && (
            <EmptyState>No works recorded on this property yet.</EmptyState>
          )}

          {liveWorks.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Current works
              </h2>
              <ul className="flex flex-col gap-3">
                {liveWorks.map((w) => (
                  <li key={w.key}>
                    <PortalCard className="flex flex-col gap-3 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                            {w.number}
                          </p>
                          <p className="text-[15px] font-semibold text-slate-900">
                            {w.title}
                          </p>
                        </div>
                        <WorkStatusBadge status={w.status} />
                      </div>
                      {(w.from || w.to) && (
                        <p className="flex items-center gap-1.5 text-xs text-slate-500">
                          <CalendarIcon className="size-3.5 text-slate-400" />
                          {[
                            w.from ? `From ${fmtDate(w.from)}` : null,
                            w.to ? `to ${fmtDate(w.to)}` : null,
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        </p>
                      )}
                      {w.progressPct !== null && (
                        <ProgressBar pct={w.progressPct} />
                      )}
                      <PhotoGallery token={token} photos={w.attachments.filter(isPhoto)} />
                      <DocRows
                        token={token}
                        docs={w.attachments.filter((a) => !isPhoto(a))}
                      />
                    </PortalCard>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {historyWorks.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Works history
              </h2>
              <PortalCard className="p-4 sm:p-5">
                <ol className="relative ml-1.5 flex flex-col gap-6 border-l-2 border-slate-200 pl-5">
                  {historyWorks.map((w) => (
                    <li key={w.key} className="relative flex flex-col gap-2">
                      <span className="absolute -left-[27px] top-1 size-3 rounded-full bg-green-500 ring-4 ring-white" />
                      <div className="flex flex-col gap-0.5">
                        {w.historyDate && (
                          <p className="text-xs text-slate-400">
                            {fmtDate(w.historyDate)}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p className="text-sm font-semibold text-slate-900">
                            {w.title}
                          </p>
                          <span className="text-xs text-slate-400">{w.number}</span>
                          <WorkStatusBadge status={w.status} />
                        </div>
                      </div>
                      <PhotoGallery token={token} photos={w.attachments.filter(isPhoto)} />
                      <DocRows
                        token={token}
                        docs={w.attachments.filter((a) => !isPhoto(a))}
                      />
                    </li>
                  ))}
                </ol>
              </PortalCard>
            </div>
          )}
        </div>
      )}
    </PortalShell>
  )
}
