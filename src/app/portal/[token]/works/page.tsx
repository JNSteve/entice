import { redirect } from 'next/navigation'
import { createPublicClient } from '@/lib/supabase/public'
import { workGroupForJob, workGroupForProject } from '@/lib/portal-experience'
import {
  EmptyState,
  isRegisterScope,
  LinkInactivePage,
  PortalShell,
  type PortalBranding,
  type PortalWorkSummary,
} from '../portal-ui'
import { WorkCard } from '../work-ui'

// Public, token-gated, no auth — always resolve the token fresh, never cache.
export const dynamic = 'force-dynamic'

/** All works for the client — current first, then completed. NO money. */
export default async function PortalWorksPage({
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

  const [{ data: worksData }] = await Promise.all([
    supabase.rpc('portal_works', { p_token: token }),
    supabase.rpc('portal_log_view', {
      p_token: token,
      p_site: null,
      p_path: '/portal/works',
    }),
  ])
  const works = ((worksData ?? []) as PortalWorkSummary[]) ?? []
  const group = (w: PortalWorkSummary) =>
    w.kind === 'job' ? workGroupForJob(w.status) : workGroupForProject(w.status)
  const current = works.filter((w) => group(w) === 'live')
  const completed = works
    .filter((w) => group(w) === 'history')
    .sort((a, b) => (b.completed_on ?? b.from ?? '').localeCompare(a.completed_on ?? a.from ?? ''))

  return (
    <PortalShell branding={branding} token={token} active="works">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Works</h1>
        <p className="text-sm text-slate-500">
          Every job and project {branding.company_name} has under way or completed for you.
        </p>
      </div>

      {works.length === 0 && <EmptyState>No works recorded yet.</EmptyState>}

      {current.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Current
          </h2>
          <ul className="flex flex-col gap-3">
            {current.map((w) => (
              <li key={`${w.kind}-${w.id}`}>
                <WorkCard token={token} work={w} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {completed.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Completed
          </h2>
          <ul className="flex flex-col gap-3">
            {completed.map((w) => (
              <li key={`${w.kind}-${w.id}`}>
                <WorkCard token={token} work={w} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </PortalShell>
  )
}
