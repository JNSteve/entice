import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  ArrowLeftIcon,
  CircleCheckIcon,
  FileTextIcon,
  HistoryIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { createPublicClient } from '@/lib/supabase/public'
import { fmtDate } from '@/lib/format'
import {
  LinkInactivePage,
  isRegisterScope,
  PortalCard,
  PortalShell,
  type PortalBranding,
  type PortalSignoffDetail,
} from '../../portal-ui'
import { PhotoGallery } from '../../work-ui'
import { SignoffLinesReadOnly, SignoffStatusPill } from '../../signoff-ui'
import { SignoffRespond } from './signoff-respond'

// Public, token-gated, no auth — always resolve the token fresh, never cache.
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One daily sign-off sheet: what was on site that day (labour per person,
 * subcontractors, plant, materials — quantities only, NO money), the day's
 * summary and photos, and the sign-on-the-glass flow while it's released.
 * Entitlement is re-proved by portal_signoff — a draft, or a sheet for
 * another client's work, simply doesn't exist here.
 */
export default async function PortalSignoffPage({
  params,
}: {
  params: Promise<{ token: string; id: string }>
}) {
  const { token, id } = await params
  if (!UUID_RE.test(id)) notFound()

  const supabase = createPublicClient()

  const { data: resolved } = await supabase.rpc('portal_resolve_link', {
    p_token: token,
  })
  const branding = (resolved ?? null) as PortalBranding | null
  if (!branding) return <LinkInactivePage />
  // Register-scope links (site QR posters) only see their property's register.
  if (isRegisterScope(branding)) {
    redirect(`/portal/${token}/sites/${branding.site_id}`)
  }

  const [{ data: signoffData }] = await Promise.all([
    supabase.rpc('portal_signoff', { p_token: token, p_id: id }),
    supabase.rpc('portal_log_view', {
      p_token: token,
      p_site: null,
      p_path: `/portal/signoffs/${id}`,
    }),
  ])
  const sheet = (signoffData ?? null) as PortalSignoffDetail | null
  if (!sheet) notFound()

  const superseded = sheet.status === 'superseded' || !!sheet.replaced_by
  const respond = sheet.status === 'released' && !superseded
  const disputes = sheet.response?.disputes ?? []
  const disputeCount = disputes.length

  return (
    <PortalShell branding={branding} token={token} active="works">
      <div className="flex flex-col gap-3">
        <Link
          href={`/portal/${token}/works/${sheet.kind}/${sheet.work_id}`}
          className="flex min-h-6 w-fit items-center gap-1 text-sm text-slate-500 transition-colors hover:text-slate-900"
        >
          <ArrowLeftIcon className="size-3.5" />
          {`Back to ${sheet.work_number}`}
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {`Daily sign-off · ${fmtDate(sheet.date)}${sheet.version > 1 ? ` · Revision ${sheet.version}` : ''}`}
            </p>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              {sheet.work_title}
            </h1>
            <p className="text-sm text-slate-500">
              {`${sheet.work_number}${sheet.site_name ? ` — ${sheet.site_name}` : ''}`}
            </p>
          </div>
          <SignoffStatusPill status={superseded ? 'superseded' : sheet.status} />
        </div>
      </div>

      {/* Replaced by a revision */}
      {superseded && (
        <PortalCard className="flex items-start gap-3 p-4">
          <HistoryIcon className="mt-0.5 size-5 shrink-0 text-slate-500" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-slate-900">
              This sheet was replaced by a revised version
            </p>
            {sheet.replaced_by ? (
              <Link
                href={`/portal/${token}/signoffs/${sheet.replaced_by}`}
                className="text-sm font-medium text-[#162040] hover:underline"
              >
                View the revised sheet
              </Link>
            ) : (
              <p className="text-sm text-slate-500">
                The lines below are kept for your records only.
              </p>
            )}
          </div>
        </PortalCard>
      )}

      {/* Summary */}
      {sheet.summary?.trim() && (
        <PortalCard className="flex flex-col gap-2 p-4 sm:p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Work carried out
          </h2>
          <p className="whitespace-pre-wrap text-sm text-slate-600">{sheet.summary}</p>
        </PortalCard>
      )}

      {/* Photos */}
      {sheet.photos.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {`Photos (${sheet.photos.length})`}
          </h2>
          <PhotoGallery token={token} photos={sheet.photos} />
        </div>
      )}

      {respond ? (
        <SignoffRespond
          token={token}
          id={sheet.id}
          date={sheet.date}
          workKind={sheet.kind}
          workId={sheet.work_id}
          lines={sheet.lines}
        />
      ) : (
        <>
          <SignoffLinesReadOnly lines={sheet.lines} disputes={disputes} />

          {sheet.response && (
            <PortalCard className="flex items-center gap-3 p-4">
              {sheet.status === 'disputed' || disputeCount > 0 ? (
                <TriangleAlertIcon className="size-6 shrink-0 text-amber-500" />
              ) : (
                <CircleCheckIcon className="size-6 shrink-0 text-green-600" />
              )}
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {`Signed by ${sheet.response.signer_name} on ${fmtDate(sheet.response.signed_on)}`}
                  {disputeCount > 0
                    ? ` with ${disputeCount} disputed line${disputeCount === 1 ? '' : 's'}`
                    : ''}
                </p>
                <p className="text-sm text-slate-500">
                  {disputeCount > 0
                    ? superseded
                      ? 'Our team reviewed your disputes and issued a revised sheet.'
                      : 'Our team will review and send a revised sheet.'
                    : 'This sheet has been confirmed through the portal.'}
                </p>
              </div>
            </PortalCard>
          )}
        </>
      )}

      <a
        href={`/portal/${token}/signoff-pdf/${sheet.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-11 w-fit items-center gap-2 rounded-xl border bg-white px-3.5 py-2 text-sm font-medium text-[#162040] transition-colors hover:bg-slate-50"
      >
        <FileTextIcon className="size-4" />
        Download PDF
      </a>
    </PortalShell>
  )
}
