import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeftIcon, DownloadIcon, FileTextIcon, MapPinIcon } from 'lucide-react'
import { createPublicClient } from '@/lib/supabase/public'
import { todayAU } from '@/lib/tz'
import { fmtDate } from '@/lib/format'
import {
  derivePropertyItemStatus,
  PROPERTY_COMPLIANCE_KIND_LABELS,
  type PropertyComplianceKind,
} from '@/lib/portal'
import {
  LinkInactivePage,
  PortalLight,
  PortalShell,
  WorkStatusBadge,
  type PortalBranding,
} from '../../portal-ui'

// Public, token-gated, no auth — always resolve the token fresh, never cache.
export const dynamic = 'force-dynamic'

// ─── portal_site_detail payload shapes ───────────────────────────────────────

interface PortalAttachment {
  id: string
  filename: string
  kind: string
  content_type: string | null
  caption: string | null
  created_at: string
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
  attachments: PortalAttachment[]
}

interface PortalProject {
  id: string
  number: string
  name: string
  status: string
  start_date: string | null
  practical_completion_date: string | null
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

// ─── Building blocks ─────────────────────────────────────────────────────────

function AttachmentGallery({
  token,
  attachments,
}: {
  token: string
  attachments: PortalAttachment[]
}) {
  const photos = attachments.filter((a) => a.content_type?.startsWith('image/'))
  const docs = attachments.filter((a) => !a.content_type?.startsWith('image/'))
  if (attachments.length === 0) return null

  return (
    <div className="flex flex-col gap-2 pt-1">
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p) => (
            <a
              key={p.id}
              href={`/portal/${token}/file/attachment/${p.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block aspect-square overflow-hidden rounded-lg border bg-muted"
              aria-label={`View ${p.filename}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/portal/${token}/file/attachment/${p.id}`}
                alt={p.caption ?? p.filename}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}
      {docs.map((d) => (
        <a
          key={d.id}
          href={`/portal/${token}/file/attachment/${d.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/50"
        >
          <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{d.filename}</span>
          <DownloadIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </a>
      ))}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * One property, two tabs:
 *   Compliance — the property's compliance register with traffic lights and
 *                logged evidence downloads.
 *   Works      — jobs/projects on the property (status + dates only, NO money)
 *                with explicitly shared photos and documents.
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
  const activeTab = tab === 'works' ? 'works' : 'compliance'

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

  const works: {
    key: string
    number: string
    title: string
    status: string
    from: string | null
    to: string | null
    attachments: PortalAttachment[]
  }[] = [
    ...detail.projects.map((p) => ({
      key: `project-${p.id}`,
      number: p.number,
      title: p.name,
      status: p.status,
      from: p.start_date,
      to: p.practical_completion_date,
      attachments: p.attachments,
    })),
    ...detail.jobs.map((j) => ({
      key: `job-${j.id}`,
      number: j.number,
      title: j.title,
      status: j.status,
      from: j.scheduled_start,
      to: j.scheduled_end,
      attachments: j.attachments,
    })),
  ]

  const tabClass = (active: boolean) =>
    `flex-1 rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors ${
      active
        ? 'bg-background shadow-sm'
        : 'text-muted-foreground hover:text-foreground'
    }`

  return (
    <PortalShell branding={branding}>
      <div className="flex flex-col gap-1">
        <Link
          href={`/portal/${token}`}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          All properties
        </Link>
        <h1 className="text-lg font-bold">{detail.site.name}</h1>
        {address && (
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <MapPinIcon className="size-3.5 shrink-0" />
            {address}
          </p>
        )}
      </div>

      {/* Tabs (links, not JS — every switch is a logged page view) */}
      <div className="flex gap-1 rounded-xl bg-muted p-1">
        <Link
          href={`/portal/${token}/sites/${siteId}`}
          className={tabClass(activeTab === 'compliance')}
        >
          Compliance
        </Link>
        <Link
          href={`/portal/${token}/sites/${siteId}?tab=works`}
          className={tabClass(activeTab === 'works')}
        >
          Works
        </Link>
      </div>

      {activeTab === 'compliance' ? (
        detail.items.length === 0 ? (
          <p className="rounded-xl border px-4 py-8 text-center text-sm text-muted-foreground">
            No compliance documents on record for this property yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {detail.items.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 rounded-xl border p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {PROPERTY_COMPLIANCE_KIND_LABELS[item.kind] ?? item.kind}
                    </p>
                    <p className="text-sm font-semibold">{item.title}</p>
                  </div>
                  <PortalLight status={derivePropertyItemStatus(item.review_due, today)} />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Issued {fmtDate(item.issue_date)}</span>
                  <span>
                    {item.review_due
                      ? `Review due ${fmtDate(item.review_due)}`
                      : 'No review required'}
                  </span>
                </div>
                {item.notes && <p className="text-sm">{item.notes}</p>}
                {item.has_file && (
                  <a
                    href={`/portal/${token}/file/item/${item.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-fit items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted/50"
                  >
                    <DownloadIcon className="size-3.5" />
                    {item.filename ?? 'View document'}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )
      ) : works.length === 0 ? (
        <p className="rounded-xl border px-4 py-8 text-center text-sm text-muted-foreground">
          No works recorded on this property yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {works.map((w) => (
            <li key={w.key} className="flex flex-col gap-2 rounded-xl border p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {w.number}
                  </p>
                  <p className="text-sm font-semibold">{w.title}</p>
                </div>
                <WorkStatusBadge status={w.status} />
              </div>
              {(w.from || w.to) && (
                <p className="text-xs text-muted-foreground">
                  {[
                    w.from ? `From ${fmtDate(w.from)}` : null,
                    w.to ? `to ${fmtDate(w.to)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                </p>
              )}
              <AttachmentGallery token={token} attachments={w.attachments} />
            </li>
          ))}
        </ul>
      )}
    </PortalShell>
  )
}
