import Link from 'next/link'
import { ArrowLeftIcon } from 'lucide-react'
import { createPublicClient } from '@/lib/supabase/public'
import {
  LinkInactivePage,
  PortalShell,
  type PortalBranding,
} from '../portal-ui'
import { RequestForm } from './request-form'

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
  searchParams: Promise<{ site?: string }>
}) {
  const { token } = await params
  const { site } = await searchParams
  const supabase = createPublicClient()

  const { data: resolved } = await supabase.rpc('portal_resolve_link', {
    p_token: token,
  })
  const branding = (resolved ?? null) as PortalBranding | null
  if (!branding) return <LinkInactivePage />

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

  return (
    <PortalShell branding={branding} token={token} active="properties">
      <div className="flex flex-col gap-3">
        <Link
          href={`/portal/${token}`}
          className="flex min-h-6 w-fit items-center gap-1 text-sm text-slate-500 transition-colors hover:text-slate-900"
        >
          <ArrowLeftIcon className="size-3.5" />
          All properties
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
        />
      )}
    </PortalShell>
  )
}
