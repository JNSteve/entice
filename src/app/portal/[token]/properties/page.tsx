import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRightIcon, MapPinIcon, PlusIcon } from 'lucide-react'
import { createPublicClient } from '@/lib/supabase/public'
import { todayAU } from '@/lib/tz'
import { derivePortalPropertyStatus } from '@/lib/portal'
import { propertyStatusPhrase } from '@/lib/portal-experience'
import {
  EmptyState,
  isRegisterScope,
  LinkInactivePage,
  PortalLight,
  PortalShell,
  StatusRing,
  type PortalBranding,
  type PortalSiteRow,
} from '../portal-ui'

// Public, token-gated, no auth — always resolve the token fresh, never cache.
export const dynamic = 'force-dynamic'

/** Every property ECR serves for this client, with its compliance ring. */
export default async function PortalPropertiesPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = createPublicClient()

  const { data: resolved } = await supabase.rpc('portal_resolve_link', {
    p_token: token,
  })
  const branding = (resolved ?? null) as PortalBranding | null
  if (!branding) return <LinkInactivePage />
  if (isRegisterScope(branding)) {
    redirect(`/portal/${token}/sites/${branding.site_id}`)
  }

  const [{ data: sitesData }] = await Promise.all([
    supabase.rpc('portal_sites', { p_token: token }),
    supabase.rpc('portal_log_view', {
      p_token: token,
      p_site: null,
      p_path: '/portal/properties',
    }),
  ])
  const sites = ((sitesData ?? []) as PortalSiteRow[]) ?? []
  const today = todayAU()

  return (
    <PortalShell branding={branding} token={token} active="properties">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Your properties</h1>
          <p className="text-sm text-slate-500">
            Every site we look after for {branding.client_name}.
          </p>
        </div>
        <Link
          href={`/portal/${token}/request`}
          className="flex min-h-11 items-center gap-1.5 rounded-xl bg-[#162040] px-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          <PlusIcon className="size-4" />
          Request work
        </Link>
      </div>

      {sites.length === 0 ? (
        <EmptyState>No properties on record yet.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {sites.map((site) => {
            const address = [site.address, site.suburb, site.state, site.postcode]
              .filter(Boolean)
              .join(', ')
            const dues = site.review_dues ?? []
            const status = derivePortalPropertyStatus(dues, today)
            const { phrase } = propertyStatusPhrase(dues, today)
            return (
              <li key={site.id}>
                <Link
                  href={`/portal/${token}/sites/${site.id}`}
                  className="block rounded-2xl border bg-white p-4 shadow-sm transition-all hover:border-slate-300 hover:shadow"
                >
                  <div className="flex items-center gap-3.5">
                    <StatusRing status={status} />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <p className="truncate text-[15px] font-semibold text-slate-900">
                        {site.name}
                      </p>
                      {address && (
                        <p className="flex items-center gap-1 truncate text-xs text-slate-500">
                          <MapPinIcon className="size-3 shrink-0" />
                          <span className="truncate">{address}</span>
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
                        <PortalLight status={status} label={phrase} />
                        <span
                          className={`text-xs ${
                            site.open_works > 0 ? 'font-medium text-blue-700' : 'text-slate-400'
                          }`}
                        >
                          {site.open_works === 0
                            ? 'No open works'
                            : `${site.open_works} open work${site.open_works === 1 ? '' : 's'}`}
                        </span>
                      </div>
                    </div>
                    <ChevronRightIcon className="size-5 shrink-0 text-slate-300" />
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </PortalShell>
  )
}
