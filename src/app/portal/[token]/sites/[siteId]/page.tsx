import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  ArrowLeftIcon,
  CalendarClockIcon,
  CalendarIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  DownloadIcon,
  FileSignatureIcon,
  FileTextIcon,
  MapPinIcon,
  PlusIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { createPublicClient } from '@/lib/supabase/public'
import { todayAU } from '@/lib/tz'
import { aud, fmtDate } from '@/lib/format'
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
  BillingStatusChip,
  EmptyState,
  LinkInactivePage,
  PortalCard,
  PortalLight,
  PortalShell,
  ProgressBar,
  RequestStatusChip,
  RequestTimeline,
  StatusRing,
  WorkStatusBadge,
  type PortalApprovalsPayload,
  isRegisterScope,
  type PortalBillingRow,
  type PortalBranding,
  type PortalMessageRow,
  type PortalRequestRow,
} from '../../portal-ui'
import { HANDOVER_PACK_CAPTION } from '@/lib/feedback'
import { DocumentBrowser } from './document-browser'
import { FeedbackCard } from './feedback-card'
import { MessageThread, type PortalMessageDisplay } from './message-thread'
import { UploadDocumentCard } from './upload-document'

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

/** Minimal shape the thumbnail row + doc links need — satisfied by both the
 * works PortalAttachment and the leaner maintenance attachment payload. */
interface PortalFileRef {
  id: string
  filename: string
  content_type: string | null
  caption: string | null
}

/** Maintenance evidence: parent_type 'maintenance' attachments, portal-visible
 * off the ENTRY's client_visible (no size/timestamps in this payload). */
interface PortalMaintenanceAttachment {
  id: string
  filename: string
  kind: string
  content_type: string | null
  caption: string | null
}

interface PortalMaintenanceEntry {
  id: string
  kind: string
  title: string
  description: string | null
  done_at: string
  status: 'open' | 'resolved'
  follow_up: string | null
  job_number: string | null
  project_number: string | null
  attachments: PortalMaintenanceAttachment[]
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
  /** scope='full' links only — always [] for register-scope links. */
  maintenance: PortalMaintenanceEntry[]
}

/** One shape for job + project works, grouped live/history. */
interface WorkEntry {
  key: string
  kind: 'job' | 'project'
  id: string
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

/** This link's prior feedback (portal_my_feedback payload). */
interface PortalFeedbackRow {
  job_id: string | null
  project_id: string | null
  rating: number
}

// ─── Building blocks ─────────────────────────────────────────────────────────

function PhotoGallery({
  token,
  photos,
}: {
  token: string
  photos: PortalFileRef[]
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

const isPhoto = (a: PortalFileRef) => a.content_type?.startsWith('image/')

const MAINTENANCE_KIND_LABELS: Record<string, string> = {
  make_safe: 'Make-safe',
  repair: 'Repair',
  maintenance: 'Maintenance',
  inspection: 'Inspection',
}

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
const SITE_TABS = [
  'compliance',
  'documents',
  'works',
  'maintenance',
  'messages',
  'requests',
  'billing',
] as const

type SiteTab = (typeof SITE_TABS)[number]

/** Brisbane display datetime for message bubbles (rendered server-side). */
function fmtMessageTime(iso: string): string {
  return new Date(iso).toLocaleString('en-AU', {
    timeZone: 'Australia/Brisbane',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default async function PortalSitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; siteId: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { token, siteId } = await params
  const { tab } = await searchParams

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

  // Register-scope links (site QR posters): pinned to ONE property, register
  // view only — no requests/messages/approvals/billing/uploads.
  const registerOnly = isRegisterScope(branding)
  if (registerOnly && siteId !== branding.site_id) {
    redirect(`/portal/${token}/sites/${branding.site_id}`)
  }

  let activeTab: SiteTab = SITE_TABS.includes(tab as SiteTab)
    ? (tab as SiteTab)
    : 'compliance'
  if (activeTab === 'billing' && !branding.show_financials) {
    activeTab = 'compliance'
  }
  if (registerOnly && activeTab !== 'compliance' && activeTab !== 'documents') {
    activeTab = 'compliance'
  }

  const [{ data: detailData }, { data: approvalsData }] = await Promise.all([
    supabase.rpc('portal_site_detail', { p_token: token, p_site: siteId }),
    supabase.rpc('portal_approvals', { p_token: token, p_site: siteId }),
    supabase.rpc('portal_log_view', {
      p_token: token,
      p_site: siteId,
      p_path: `/portal/sites/${siteId}?tab=${activeTab}`,
    }),
  ])
  const detail = (detailData ?? null) as PortalSiteDetail | null
  if (!detail) notFound()

  // Client-filed documents awaiting (or refused) office review — compliance
  // tab only.
  interface PortalUpload {
    id: string
    kind: string
    title: string
    status: 'pending' | 'rejected'
    issue_date: string
    review_due: string | null
    review_note: string | null
  }
  let myUploads: PortalUpload[] = []
  if (activeTab === 'compliance') {
    const { data: uploadsData } = await supabase.rpc('portal_my_uploads', {
      p_token: token,
      p_site: siteId,
    })
    myUploads = ((uploadsData ?? []) as PortalUpload[]) ?? []
  }

  const approvals = ((approvalsData ?? null) as PortalApprovalsPayload | null) ?? {
    pending: [],
    decided: [],
  }

  // Tab-specific data (the thread RPC also marks office replies read).
  let messages: PortalMessageDisplay[] = []
  if (activeTab === 'messages') {
    const { data } = await supabase.rpc('portal_thread', {
      p_token: token,
      p_site: siteId,
    })
    messages = (((data ?? []) as PortalMessageRow[]) ?? []).map((m) => ({
      ...m,
      created_display: fmtMessageTime(m.created_at),
    }))
  }

  let requests: PortalRequestRow[] = []
  if (activeTab === 'requests') {
    const { data } = await supabase.rpc('portal_my_requests', {
      p_token: token,
      p_site: siteId,
    })
    requests = ((data ?? []) as PortalRequestRow[]) ?? []
  }

  let billing: PortalBillingRow[] = []
  if (activeTab === 'billing') {
    const { data } = await supabase.rpc('portal_billing', {
      p_token: token,
      p_site: siteId,
    })
    billing = ((data ?? []) as PortalBillingRow[]) ?? []
  }

  // Feedback this link already gave (drives rate vs thank-you per work).
  let myFeedback: PortalFeedbackRow[] = []
  if (activeTab === 'works') {
    const { data } = await supabase.rpc('portal_my_feedback', {
      p_token: token,
      p_site: siteId,
    })
    myFeedback = ((data ?? []) as PortalFeedbackRow[]) ?? []
  }
  const ratingByWork = new Map<string, number>()
  for (const f of myFeedback) {
    if (f.job_id) ratingByWork.set(`job-${f.job_id}`, f.rating)
    if (f.project_id) ratingByWork.set(`project-${f.project_id}`, f.rating)
  }

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
      kind: 'project' as const,
      id: p.id,
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
      kind: 'job' as const,
      id: j.id,
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

  // ── Maintenance log (RPC returns [] for register-scope links) ──────────────
  const maintenance = detail.maintenance ?? []
  const hasOpenMaintenance = maintenance.some((m) => m.status === 'open')

  const tabClass = (active: boolean) =>
    `flex min-h-11 flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors ${
      active
        ? 'bg-white text-slate-900 shadow-sm'
        : 'text-slate-500 hover:text-slate-800'
    }`

  const tabs: { key: SiteTab; label: string; href: string }[] = registerOnly
    ? [
        { key: 'compliance', label: 'Compliance', href: `/portal/${token}/sites/${siteId}` },
        { key: 'documents', label: 'Documents', href: `/portal/${token}/sites/${siteId}?tab=documents` },
      ]
    : [
        { key: 'compliance', label: 'Compliance', href: `/portal/${token}/sites/${siteId}` },
        { key: 'documents', label: 'Documents', href: `/portal/${token}/sites/${siteId}?tab=documents` },
        { key: 'works', label: 'Works', href: `/portal/${token}/sites/${siteId}?tab=works` },
        { key: 'maintenance', label: 'Maintenance', href: `/portal/${token}/sites/${siteId}?tab=maintenance` },
        { key: 'messages', label: 'Messages', href: `/portal/${token}/sites/${siteId}?tab=messages` },
        { key: 'requests', label: 'Requests', href: `/portal/${token}/sites/${siteId}?tab=requests` },
        ...(branding.show_financials
          ? [{ key: 'billing' as SiteTab, label: 'Billing', href: `/portal/${token}/sites/${siteId}?tab=billing` }]
          : []),
      ]

  return (
    <PortalShell branding={branding} token={token} active="properties">
      {/* Property header */}
      <div className="flex flex-col gap-3">
        {!registerOnly && (
          <Link
            href={`/portal/${token}`}
            className="flex min-h-6 w-fit items-center gap-1 text-sm text-slate-500 transition-colors hover:text-slate-900"
          >
            <ArrowLeftIcon className="size-3.5" />
            All properties
          </Link>
        )}
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

      {/* Awaiting approvals banner */}
      {!registerOnly && approvals.pending.length > 0 && (
        <Link
          href={`/portal/${token}/approvals`}
          className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm transition-colors hover:bg-amber-100/70"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-amber-600 ring-2 ring-amber-500/40">
            <FileSignatureIcon className="size-5" />
          </span>
          <span className="min-w-0 flex-1 text-sm font-semibold text-amber-900">
            {approvals.pending.length === 1
              ? '1 item awaiting your approval'
              : `${approvals.pending.length} items awaiting your approval`}
          </span>
          <ChevronRightIcon className="size-5 shrink-0 text-amber-400" />
        </Link>
      )}

      {/* Tabs (links, not JS — every switch is a logged page view) */}
      <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-200/70 p-1">
        {tabs.map((t) => (
          <Link key={t.key} href={t.href} className={tabClass(activeTab === t.key)}>
            {t.label}
            {t.key === 'maintenance' && hasOpenMaintenance && (
              <span
                className="ml-1.5 inline-block size-2 shrink-0 rounded-full bg-amber-500"
                aria-label="Open items"
              />
            )}
          </Link>
        ))}
      </div>

      {/* ── Compliance ─────────────────────────────────────────────────────── */}
      {activeTab === 'compliance' && (
        <div className="flex flex-col gap-3">
        {detail.items.length === 0 ? (
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
                    {(item.has_file || itemStatus !== 'green') && (
                      <div className="flex flex-wrap items-center gap-2">
                        {item.has_file && (
                          <a
                            href={`/portal/${token}/file/item/${item.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex min-h-11 w-fit items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium text-[#162040] transition-colors hover:bg-slate-50"
                          >
                            <DownloadIcon className="size-4" />
                            <span className="max-w-60 truncate">
                              {item.filename ?? 'View document'}
                            </span>
                          </a>
                        )}
                        {itemStatus !== 'green' && !registerOnly && (
                          <Link
                            href={`/portal/${token}/request?site=${siteId}&item=${item.id}`}
                            className="flex min-h-11 w-fit items-center gap-2 rounded-xl bg-[#162040] px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
                          >
                            <CalendarClockIcon className="size-4" />
                            Request re-inspection
                          </Link>
                        )}
                      </div>
                    )}
                  </PortalCard>
                </li>
              )
            })}
          </ul>
        )}

        {/* Client-filed documents awaiting / refused review */}
        {myUploads.length > 0 && (
          <ul className="flex flex-col gap-3">
            {myUploads.map((u) => (
              <li key={u.id}>
                <PortalCard className="flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        {PROPERTY_COMPLIANCE_KIND_LABELS[u.kind as PropertyComplianceKind] ?? u.kind}
                      </p>
                      <p className="text-[15px] font-semibold text-slate-900">
                        {u.title}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                        u.status === 'pending'
                          ? 'border-amber-200 bg-amber-50 text-amber-700'
                          : 'border-red-200 bg-red-50 text-red-700'
                      }`}
                    >
                      {u.status === 'pending' ? 'Awaiting review' : 'Not added'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Issued {fmtDate(u.issue_date)}
                    {u.review_due ? ` · review due ${fmtDate(u.review_due)}` : ''}
                  </p>
                  {u.status === 'rejected' && u.review_note && (
                    <p className="text-sm text-red-700">{u.review_note}</p>
                  )}
                </PortalCard>
              </li>
            ))}
          </ul>
        )}

        {!registerOnly && (
          <UploadDocumentCard
            token={token}
            siteId={siteId}
            companyName={branding.company_name}
          />
        )}
        </div>
      )}

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
                  {historyWorks.map((w) => {
                    const handoverPack = w.attachments.find(
                      (a) => a.caption === HANDOVER_PACK_CAPTION && !isPhoto(a)
                    )
                    const givenRating = ratingByWork.get(w.key)
                    return (
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
                        {handoverPack && (
                          <a
                            href={`/portal/${token}/file/attachment/${handoverPack.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex min-h-11 w-fit items-center gap-2 rounded-xl bg-[#162040] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                          >
                            <FileTextIcon className="size-4" />
                            Handover pack
                            <DownloadIcon className="size-3.5 opacity-70" />
                          </a>
                        )}
                        <PhotoGallery token={token} photos={w.attachments.filter(isPhoto)} />
                        <DocRows
                          token={token}
                          docs={w.attachments.filter(
                            (a) => !isPhoto(a) && a.id !== handoverPack?.id
                          )}
                        />
                        {givenRating ? (
                          <p className="text-xs font-medium text-slate-500">
                            {'★'.repeat(givenRating)}
                            <span className="text-slate-300">
                              {'★'.repeat(5 - givenRating)}
                            </span>{' '}
                            Thanks for your feedback
                          </p>
                        ) : (
                          <FeedbackCard
                            token={token}
                            kind={w.kind}
                            id={w.id}
                            companyName={branding.company_name}
                          />
                        )}
                      </li>
                    )
                  })}
                </ol>
              </PortalCard>
            </div>
          )}
        </div>
      )}

      {/* ── Maintenance ────────────────────────────────────────────────────── */}
      {activeTab === 'maintenance' && (
        <div className="flex flex-col gap-3">
          {maintenance.length === 0 ? (
            <EmptyState>
              No maintenance recorded for this property yet.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {maintenance.map((m) => {
                const photos = m.attachments.filter(isPhoto)
                const docs = m.attachments.filter((a) => !isPhoto(a))
                const openLabel =
                  m.follow_up?.trim() ||
                  'Make-safe in place — permanent repair recommended'
                const linked = m.job_number
                  ? `Job ${m.job_number}`
                  : m.project_number
                    ? `Project ${m.project_number}`
                    : null
                return (
                  <li key={m.id}>
                    <PortalCard className="flex flex-col gap-2.5 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                            {MAINTENANCE_KIND_LABELS[m.kind] ?? m.kind}
                          </p>
                          <p className="text-[15px] font-semibold text-slate-900">
                            {m.title}
                          </p>
                        </div>
                        <span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
                          <CalendarIcon className="size-3.5 text-slate-400" />
                          {fmtDate(m.done_at)}
                        </span>
                      </div>

                      {m.description && (
                        <p className="whitespace-pre-wrap text-sm text-slate-600">
                          {m.description}
                        </p>
                      )}

                      {m.status === 'open' && (
                        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
                          <p className="text-sm font-semibold text-amber-900">
                            {openLabel}
                          </p>
                        </div>
                      )}

                      <PhotoGallery token={token} photos={photos} />
                      <DocRows token={token} docs={docs} />

                      {linked && (
                        <p className="text-xs text-slate-400">{linked}</p>
                      )}
                    </PortalCard>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* ── Messages ───────────────────────────────────────────────────────── */}
      {activeTab === 'messages' && (
        <MessageThread
          token={token}
          siteId={siteId}
          companyName={branding.company_name}
          messages={messages}
        />
      )}

      {/* ── Requests ───────────────────────────────────────────────────────── */}
      {activeTab === 'requests' && (
        <div className="flex flex-col gap-4">
          <Link
            href={`/portal/${token}/request?site=${siteId}`}
            className="flex min-h-12 w-fit items-center gap-2 rounded-xl bg-[#162040] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            <PlusIcon className="size-4" />
            Request work
          </Link>

          {requests.length === 0 ? (
            <EmptyState>
              No requests for this property yet. Need something done? Use the
              button above and we&apos;ll take it from there.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {requests.map((r) => (
                <li key={r.id}>
                  <PortalCard className="flex flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          {r.number} · {fmtDate(r.created_at)}
                        </p>
                        <p className="text-[15px] font-semibold text-slate-900">
                          {r.title}
                        </p>
                      </div>
                      <RequestStatusChip status={r.status} />
                    </div>
                    <p className="line-clamp-3 whitespace-pre-wrap text-sm text-slate-600">
                      {r.description}
                    </p>
                    <RequestTimeline
                      status={r.status}
                      scheduledFor={r.scheduled_for}
                      scheduledNote={r.scheduled_note}
                    />
                  </PortalCard>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Billing (only when the office enabled financials for this link) ── */}
      {activeTab === 'billing' && (
        <div className="flex flex-col gap-3">
          {billing.length === 0 ? (
            <EmptyState>
              No invoices or payment claims issued for this property yet.
            </EmptyState>
          ) : (
            <PortalCard className="divide-y">
              {billing.map((b, i) => (
                <div key={`${b.kind}-${b.number}-${i}`} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {b.number}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {b.kind === 'invoice' ? 'Invoice' : 'Payment claim'}
                      {b.context ? ` — ${b.context}` : ''}
                    </p>
                  </div>
                  {b.kind === 'invoice' && b.id && (
                    <a
                      href={`/portal/${token}/invoice-pdf/${b.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Download ${b.number}`}
                      className="flex size-9 shrink-0 items-center justify-center rounded-xl border text-[#162040] transition-colors hover:bg-slate-50"
                    >
                      <DownloadIcon className="size-4" />
                    </a>
                  )}
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-bold tabular-nums text-slate-900">
                      {b.amount != null ? aud(b.amount) : '—'}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-slate-400">
                      {fmtDate(b.date)}
                      <BillingStatusChip status={b.status} />
                    </span>
                  </div>
                </div>
              ))}
            </PortalCard>
          )}
        </div>
      )}
    </PortalShell>
  )
}
