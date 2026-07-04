import Link from 'next/link'
import { ChevronRightIcon, MapPinIcon } from 'lucide-react'
import { createPublicClient } from '@/lib/supabase/public'
import { todayAU } from '@/lib/tz'
import { derivePropertyStatus } from '@/lib/portal'
import {
  LinkInactivePage,
  PortalLight,
  PortalShell,
  type PortalBranding,
} from './portal-ui'

// Public, token-gated, no auth — always resolve the token fresh, never cache.
export const dynamic = 'force-dynamic'

interface PortalSiteRow {
  id: string
  name: string
  address: string | null
  suburb: string | null
  state: string | null
  postcode: string | null
  review_dues: (string | null)[]
  open_works: number
}

/**
 * Client portal home: the client organisation's property list, each with a
 * compliance traffic light and open-works count. No login — the token is the
 * credential; everything runs through anon security-definer RPCs and every
 * load is logged to portal_views.
 */
export default async function PortalHomePage({
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

  const [{ data: sitesData }] = await Promise.all([
    supabase.rpc('portal_sites', { p_token: token }),
    supabase.rpc('portal_log_view', {
      p_token: token,
      p_site: null,
      p_path: '/portal',
    }),
  ])
  const sites = ((sitesData ?? []) as PortalSiteRow[]) ?? []
  const today = todayAU()

  return (
    <PortalShell branding={branding}>
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-bold">Your properties</h1>
        <p className="text-sm text-muted-foreground">
          Compliance status and works for each property we look after.
        </p>
      </div>

      {sites.length === 0 ? (
        <p className="rounded-xl border px-4 py-8 text-center text-sm text-muted-foreground">
          No properties on record yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {sites.map((site) => {
            const address = [site.address, site.suburb, site.state, site.postcode]
              .filter(Boolean)
              .join(', ')
            return (
              <li key={site.id}>
                <Link
                  href={`/portal/${token}/sites/${site.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border p-4 transition-colors hover:bg-muted/50"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="truncate text-sm font-semibold">{site.name}</p>
                    {address && (
                      <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <MapPinIcon className="size-3 shrink-0" />
                        {address}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-3 pt-0.5">
                      <PortalLight
                        status={derivePropertyStatus(site.review_dues ?? [], today)}
                      />
                      <span className="text-xs text-muted-foreground">
                        {site.open_works === 0
                          ? 'No open works'
                          : `${site.open_works} open work${site.open_works === 1 ? '' : 's'}`}
                      </span>
                    </div>
                  </div>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </PortalShell>
  )
}
