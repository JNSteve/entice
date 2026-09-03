import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  ArrowLeftIcon,
  CalendarIcon,
  CircleCheckIcon,
  DownloadIcon,
  FileSignatureIcon,
  FileTextIcon,
  MapPinIcon,
  MessageSquareIcon,
} from 'lucide-react'
import { createPublicClient } from '@/lib/supabase/public'
import { fmtDate } from '@/lib/format'
import { HANDOVER_PACK_CAPTION } from '@/lib/feedback'
import { workGroupForJob, workGroupForProject } from '@/lib/portal-experience'
import {
  EmptyState,
  isRegisterScope,
  LinkInactivePage,
  PortalCard,
  PortalShell,
  ProgressBar,
  WorkStatusBadge,
  WorkTimeline,
  type PortalBranding,
  type PortalWorkDetail,
} from '../../../portal-ui'
import { DocRows, isPhoto, PhotoGallery } from '../../../work-ui'
import { FeedbackCard } from '../../../sites/[siteId]/feedback-card'

// Public, token-gated, no auth — always resolve the token fresh, never cache.
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PortalFeedbackRow {
  job_id: string | null
  project_id: string | null
  rating: number
}

/**
 * One work: timeline, dates, linked quote, photos, documents, close-out pack
 * and the feedback card once completed. Entitlement is re-proved by
 * portal_work_detail (null → 404). NO money.
 */
export default async function PortalWorkPage({
  params,
}: {
  params: Promise<{ token: string; kind: string; id: string }>
}) {
  const { token, kind, id } = await params
  if ((kind !== 'job' && kind !== 'project') || !UUID_RE.test(id)) notFound()

  const supabase = createPublicClient()
  const { data: resolved } = await supabase.rpc('portal_resolve_link', {
    p_token: token,
  })
  const branding = (resolved ?? null) as PortalBranding | null
  if (!branding) return <LinkInactivePage />
  if (isRegisterScope(branding)) {
    redirect(`/portal/${token}/sites/${branding.site_id}`)
  }

  const [{ data: detailData }, { data: feedbackData }] = await Promise.all([
    supabase.rpc('portal_work_detail', { p_token: token, p_kind: kind, p_id: id }),
    supabase.rpc('portal_my_feedback', { p_token: token, p_site: null }),
    supabase.rpc('portal_log_view', {
      p_token: token,
      p_site: null,
      p_path: `/portal/works/${kind}/${id}`,
    }),
  ])
  const work = (detailData ?? null) as PortalWorkDetail | null
  if (!work) notFound()

  const feedback = ((feedbackData ?? []) as PortalFeedbackRow[]) ?? []
  const givenRating = feedback.find((f) =>
    work.kind === 'job' ? f.job_id === work.id : f.project_id === work.id
  )?.rating

  const completed =
    (work.kind === 'job' ? workGroupForJob(work.status) : workGroupForProject(work.status)) ===
    'history'
  const photos = work.attachments.filter(isPhoto)
  const handoverPack = work.attachments.find(
    (a) => a.caption === HANDOVER_PACK_CAPTION && !isPhoto(a)
  )
  const docs = work.attachments.filter((a) => !isPhoto(a) && a.id !== handoverPack?.id)
  const dates = [
    work.from ? `From ${fmtDate(work.from)}` : null,
    work.to ? `to ${fmtDate(work.to)}` : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <PortalShell branding={branding} token={token} active="works">
      <div className="flex flex-col gap-3">
        <Link
          href={`/portal/${token}/works`}
          className="flex min-h-6 w-fit items-center gap-1 text-sm text-slate-500 transition-colors hover:text-slate-900"
        >
          <ArrowLeftIcon className="size-3.5" />
          All works
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {work.number}
            </p>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">{work.title}</h1>
            {work.site_id ? (
              <Link
                href={`/portal/${token}/sites/${work.site_id}`}
                className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
              >
                <MapPinIcon className="size-3.5 shrink-0" />
                <span className="truncate">
                  {work.site_name}
                  {work.site_address ? ` — ${work.site_address}` : ''}
                </span>
              </Link>
            ) : (
              <p className="text-sm text-slate-400">No property recorded</p>
            )}
          </div>
          <WorkStatusBadge status={work.status} />
        </div>
      </div>

      {/* Progress */}
      <PortalCard className="flex flex-col gap-4 p-4 sm:p-5">
        <WorkTimeline kind={work.kind} status={work.status} />
        {dates && (
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <CalendarIcon className="size-3.5 text-slate-400" />
            {dates}
          </p>
        )}
        {work.progress_pct !== null && <ProgressBar pct={work.progress_pct} />}
        {work.description && (
          <p className="whitespace-pre-wrap text-sm text-slate-600">{work.description}</p>
        )}
      </PortalCard>

      {/* Quote */}
      {work.quote && (
        <Link
          href={`/portal/${token}/approvals/quote/${work.quote.id}`}
          className="flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm transition-all hover:border-slate-300 hover:shadow"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[#162040]">
            {work.quote.decided === 'accepted' || work.quote.status === 'accepted' ? (
              <CircleCheckIcon className="size-5 text-green-600" />
            ) : (
              <FileSignatureIcon className="size-5" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-900">
              Quotation {work.quote.number}
            </span>
            <span className="block text-xs text-slate-500">
              {work.quote.status === 'accepted'
                ? 'Accepted — view the signed quotation'
                : work.quote.status === 'sent'
                  ? 'Awaiting your approval'
                  : 'View the quotation'}
            </span>
          </span>
          <FileTextIcon className="size-4 shrink-0 text-slate-300" />
        </Link>
      )}

      {/* Close-out pack */}
      {handoverPack && (
        <a
          href={`/portal/${token}/file/attachment/${handoverPack.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 w-fit items-center gap-2 rounded-xl bg-[#162040] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          <FileTextIcon className="size-4" />
          Close-out pack
          <DownloadIcon className="size-3.5 opacity-70" />
        </a>
      )}

      {/* Photos */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Photos{photos.length > 0 ? ` (${photos.length})` : ''}
        </h2>
        {photos.length === 0 ? (
          <EmptyState>No photos shared for this work yet.</EmptyState>
        ) : (
          <PhotoGallery token={token} photos={photos} />
        )}
      </div>

      {/* Documents */}
      {docs.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Documents
          </h2>
          <DocRows token={token} docs={docs} />
        </div>
      )}

      {/* Feedback once completed */}
      {completed &&
        (givenRating ? (
          <p className="text-xs font-medium text-slate-500">
            {'★'.repeat(givenRating)}
            <span className="text-slate-300">{'★'.repeat(5 - givenRating)}</span> Thanks for
            your feedback
          </p>
        ) : (
          <FeedbackCard
            token={token}
            kind={work.kind}
            id={work.id}
            companyName={branding.company_name}
          />
        ))}

      {work.site_id && (
        <Link
          href={`/portal/${token}/sites/${work.site_id}?tab=messages`}
          className="flex min-h-11 w-fit items-center gap-2 rounded-xl border bg-white px-3.5 text-sm font-medium text-[#162040] transition-colors hover:bg-slate-50"
        >
          <MessageSquareIcon className="size-4" />
          Message us about this work
        </Link>
      )}
    </PortalShell>
  )
}
