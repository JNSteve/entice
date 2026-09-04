import Link from 'next/link'
import { ArrowLeftIcon } from 'lucide-react'
import { createPublicClient } from '@/lib/supabase/public'
import { fmtDate } from '@/lib/format'
import {
  PROPERTY_COMPLIANCE_KIND_LABELS,
  type PropertyComplianceKind,
} from '@/lib/portal'
import { redirect } from 'next/navigation'
import {
  isRegisterScope,
  LinkInactivePage,
  PortalShell,
  type PortalBranding,
} from '../portal-ui'
import { RequestForm, type RequestPrefill } from './request-form'

// Public, token-gated, no auth — always resolve the token fresh, never cache.
export const dynamic = 'force-dynamic'

interface PortalSiteRow {
  id: string
  name: string
}

/**
 * "Request work" — one form for the whole portfolio, reachable from the
 * landing page and each property's Requests tab (?site= preselects). The
 * submission itself goes through the rate-limited portal_submit_request RPC.
 */
export default async function PortalRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ site?: string; item?: string }>
}) {
  const { token } = await params
  const { site, item } = await searchParams
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

  const [{ data: sitesData }] = await Promise.all([
    supabase.rpc('portal_sites', { p_token: token }),
    supabase.rpc('portal_log_view', {
      p_token: token,
      p_site: null,
      p_path: '/portal/request',
    }),
  ])
  const sites = ((sitesData ?? []) as PortalSiteRow[]).map((s) => ({
    id: s.id,
    name: s.name,
  }))

  // Renewal mode (?site=&item=): prefill from the due compliance item so a
  // red light becomes a one-tap re-inspection request.
  let prefill: RequestPrefill | null = null
  if (site && item) {
    const { data: detailData } = await supabase.rpc('portal_site_detail', {
      p_token: token,
      p_site: site,
    })
    const detail = (detailData ?? null) as {
      items?: { id: string; kind: string; title: string; review_due: string | null }[]
    } | null
    const found = detail?.items?.find((i) => i.id === item)
    if (found) {
      const kindLabel =
        PROPERTY_COMPLIANCE_KIND_LABELS[found.kind as PropertyComplianceKind] ??
        found.kind
      prefill = {
        itemId: found.id,
        itemLabel: `${kindLabel} — ${found.title}`,
        title: `Re-inspection — ${kindLabel}: ${found.title}`,
        description: found.review_due
          ? `Our ${kindLabel.toLowerCase()} "${found.title}" is due for review on ${fmtDate(found.review_due)}. Please arrange a re-inspection/renewal.`
          : `Please arrange a re-inspection/renewal of our ${kindLabel.toLowerCase()} "${found.title}".`,
      }
    }
  }

  return (
    <PortalShell branding={branding} token={token} active="overview">
      <div className="flex flex-col gap-3">
        <Link
          href={`/portal/${token}`}
          className="flex min-h-6 w-fit items-center gap-1 text-sm text-slate-500 transition-colors hover:text-slate-900"
        >
          <ArrowLeftIcon className="size-3.5" />
          Overview
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Request work
          </h1>
          <p className="text-sm text-slate-500">
            Tell us what you need on your property — we&apos;ll review it and
            come back to you with the next steps.
          </p>
        </div>
      </div>

      {sites.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-white px-4 py-10 text-center text-sm text-slate-500">
          No properties on record yet — contact us to set one up.
        </p>
      ) : (
        <RequestForm
          token={token}
          sites={sites}
          initialSiteId={site}
          companyName={branding.company_name}
          prefill={prefill}
        />
      )}
    </PortalShell>
  )
}
