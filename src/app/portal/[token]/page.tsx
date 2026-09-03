import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  Building2Icon,
  ChevronRightIcon,
  CircleCheckIcon,
  ClockIcon,
  FileSignatureIcon,
  FileTextIcon,
  InboxIcon,
  MapPinIcon,
  PlusIcon,
  TriangleAlertIcon,
  WrenchIcon,
} from 'lucide-react'
import { createPublicClient } from '@/lib/supabase/public'
import { todayAU } from '@/lib/tz'
import { aud, fmtDate } from '@/lib/format'
import { derivePortalPropertyStatus } from '@/lib/portal'
import {
  propertyStatusPhrase,
  summarisePortfolio,
  workGroupForJob,
  workGroupForProject,
} from '@/lib/portal-experience'
import {
  isRegisterScope,
  LinkInactivePage,
  PortalCard,
  PortalLight,
  PortalShell,
  RequestStatusChip,
  StatusRing,
  type PortalApprovalsPayload,
  type PortalBranding,
  type PortalRequestRow,
  type PortalSiteRow,
  type PortalWorkSummary,
} from './portal-ui'
import { WorkCard } from './work-ui'

// Public, token-gated, no auth — always resolve the token fresh, never cache.
export const dynamic = 'force-dynamic'

/**
 * Overview (works-first): approvals banner, headline cards, current works
 * across every property, pending quotes, a compact property list and open
 * requests. Compliance only takes a card when the client keeps a register.
 * No login — the token is the credential; every load is logged.
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
  if (isRegisterScope(branding)) {
    redirect(`/portal/${token}/sites/${branding.site_id}`)
  }

  const [
    { data: sitesData },
    { data: approvalsData },
    { data: requestsData },
    { data: worksData },
  ] = await Promise.all([
    supabase.rpc('portal_sites', { p_token: token }),
    supabase.rpc('portal_approvals', { p_token: token }),
    supabase.rpc('portal_my_requests', { p_token: token }),
    supabase.rpc('portal_works', { p_token: token }),
    supabase.rpc('portal_log_view', {
      p_token: token,
      p_site: null,
      p_path: '/portal',
    }),
  ])
  const sites = ((sitesData ?? []) as PortalSiteRow[]) ?? []
  const approvals = ((approvalsData ?? null) as PortalApprovalsPayload | null) ?? {
    pending: [],
    decided: [],
  }
  const requests = ((requestsData ?? []) as PortalRequestRow[]) ?? []
  const works = ((worksData ?? []) as PortalWorkSummary[]) ?? []

  const openRequests = requests.filter(
    (r) => r.status !== 'completed' && r.status !== 'declined'
  )
  const currentWorks = works.filter((w) =>
    (w.kind === 'job' ? workGroupForJob(w.status) : workGroupForProject(w.status)) === 'live'
  )
  const today = todayAU()
  const summary = summarisePortfolio(sites, today)
  const keepsRegister = sites.some((s) => (s.review_dues ?? []).length > 0)

  return (
    <PortalShell branding={branding} token={token} active="overview">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Welcome, {branding.client_name}
          </h1>
          <p className="text-sm text-slate-500">
            Your quotes, works and property records with {branding.company_name} —{' '}
            all in one place.
          </p>
        </div>
        {keepsRegister && (
          <a
            href={`/portal/${token}/report-pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center gap-2 rounded-xl border bg-white px-3.5 text-sm font-medium text-[#162040] transition-colors hover:bg-slate-50"
          >
            <FileTextIcon className="size-4" />
            Compliance report (PDF)
          </a>
        )}
      </div>

      {/* Awaiting approvals */}
      {approvals.pending.length > 0 && (
        <Link
          href={`/portal/${token}/approvals`}
          className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm transition-colors hover:bg-amber-100/70"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white text-amber-600 ring-2 ring-amber-500/40">
            <FileSignatureIcon className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-amber-900">
              {approvals.pending.length === 1
                ? '1 quote awaiting your approval'
                : `${approvals.pending.length} items awaiting your approval`}
            </span>
            <span className="block text-xs text-amber-700">
              Review and sign online — it takes less than a minute.
            </span>
          </span>
          <ChevronRightIcon className="size-5 shrink-0 text-amber-400" />
        </Link>
      )}

      {/* Headline summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard
          icon={<WrenchIcon className="size-4" />}
          iconClass="bg-blue-50 text-blue-600"
          value={String(currentWorks.length)}
          label={currentWorks.length === 1 ? 'Active work' : 'Active works'}
          valueClass={currentWorks.length > 0 ? 'text-blue-700' : undefined}
        />
        <SummaryCard
          icon={<FileSignatureIcon className="size-4" />}
          iconClass={
            approvals.pending.length > 0 ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-600'
          }
          value={String(approvals.pending.length)}
          label="Awaiting approval"
          valueClass={approvals.pending.length > 0 ? 'text-amber-600' : undefined}
        />
        <SummaryCard
          icon={<InboxIcon className="size-4" />}
          iconClass="bg-slate-100 text-slate-600"
          value={String(openRequests.length)}
          label={openRequests.length === 1 ? 'Open request' : 'Open requests'}
        />
        {!keepsRegister ? (
          <SummaryCard
            icon={<Building2Icon className="size-4" />}
            iconClass="bg-slate-100 text-slate-600"
            value={String(summary.properties)}
            label={summary.properties === 1 ? 'Property' : 'Properties'}
          />
        ) : summary.overdue > 0 ? (
          <SummaryCard
            icon={<TriangleAlertIcon className="size-4" />}
            iconClass="bg-red-50 text-red-600"
            value={String(summary.overdue)}
            label={summary.overdue === 1 ? 'Item needs attention' : 'Items need attention'}
            valueClass="text-red-600"
          />
        ) : summary.dueSoon30 > 0 ? (
          <SummaryCard
            icon={<ClockIcon className="size-4" />}
            iconClass="bg-amber-50 text-amber-600"
            value={`${summary.dueSoon30} due soon`}
            label="Compliance"
            valueClass="text-amber-600"
          />
        ) : (
          <SummaryCard
            icon={<CircleCheckIcon className="size-4" />}
            iconClass="bg-green-50 text-green-600"
            value="All current"
            label="Compliance"
            valueClass="text-green-700"
          />
        )}
      </div>

      {/* Current works */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Current works
          </h2>
          {works.length > currentWorks.length && (
            <Link
              href={`/portal/${token}/works`}
              className="flex min-h-6 items-center gap-1 text-sm font-medium text-[#162040] hover:underline"
            >
              All works <ChevronRightIcon className="size-4" />
            </Link>
          )}
        </div>
        {currentWorks.length === 0 ? (
          <p className="rounded-2xl border border-dashed bg-white px-4 py-10 text-center text-sm text-slate-500">
            No works under way right now.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {currentWorks.map((w) => (
              <li key={`${w.kind}-${w.id}`}>
                <WorkCard token={token} work={w} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pending quotes */}
      {approvals.pending.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Your quotes
            </h2>
            <Link
              href={`/portal/${token}/approvals`}
              className="flex min-h-6 items-center gap-1 text-sm font-medium text-[#162040] hover:underline"
            >
              All quotes <ChevronRightIcon className="size-4" />
            </Link>
          </div>
          <PortalCard className="divide-y">
            {approvals.pending.slice(0, 3).map((item) => (
              <Link
                key={`${item.kind}-${item.id}`}
                href={`/portal/${token}/approvals/${item.kind}/${item.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {item.number} — {item.title}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {item.context ?? (item.kind === 'quote' ? 'Quotation' : 'Variation')}
                    {item.date ? ` · ${fmtDate(item.date)}` : ''}
                  </p>
                </div>
                {item.amount != null && (
                  <span className="text-sm font-semibold tabular-nums text-slate-900">
                    {aud(item.amount)}
                  </span>
                )}
                <ChevronRightIcon className="size-4 shrink-0 text-slate-300" />
              </Link>
            ))}
          </PortalCard>
        </div>
      )}

      {/* Properties */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Your properties
          </h2>
          <Link
            href={`/portal/${token}/request`}
            className="flex min-h-11 items-center gap-1.5 rounded-xl bg-[#162040] px-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            <PlusIcon className="size-4" />
            Request work
          </Link>
        </div>
        {sites.length === 0 ? (
          <p className="rounded-2xl border border-dashed bg-white px-4 py-10 text-center text-sm text-slate-500">
            No properties on record yet.
          </p>
        ) : (
          <PortalCard className="divide-y">
            {sites.map((site) => {
              const address = [site.address, site.suburb, site.state, site.postcode]
                .filter(Boolean)
                .join(', ')
              const dues = site.review_dues ?? []
              const status = derivePortalPropertyStatus(dues, today)
              const { phrase } = propertyStatusPhrase(dues, today)
              return (
                <Link
                  key={site.id}
                  href={`/portal/${token}/sites/${site.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
                >
                  <StatusRing status={status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{site.name}</p>
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
                  <ChevronRightIcon className="size-4 shrink-0 text-slate-300" />
                </Link>
              )
            })}
          </PortalCard>
        )}
      </div>

      {/* Your requests */}
      {openRequests.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Your requests
          </h2>
          <PortalCard className="divide-y">
            {openRequests.slice(0, 5).map((r) => (
              <Link
                key={r.id}
                href={`/portal/${token}/sites/${r.site_id}?tab=requests`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {r.number} — {r.title}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {r.site_name} · {fmtDate(r.created_at)}
                  </p>
                </div>
                <RequestStatusChip status={r.status} />
                <ChevronRightIcon className="size-4 shrink-0 text-slate-300" />
              </Link>
            ))}
            {openRequests.length > 5 && (
              <p className="px-4 py-2.5 text-xs text-slate-400">
                +{openRequests.length - 5} more on their property pages
              </p>
            )}
          </PortalCard>
        </div>
      )}
    </PortalShell>
  )
}

function SummaryCard({
  icon,
  iconClass,
  value,
  label,
  valueClass = 'text-slate-900',
}: {
  icon: React.ReactNode
  iconClass: string
  value: string
  label: string
  valueClass?: string
}) {
  return (
    <PortalCard className="flex flex-col gap-2 p-3.5">
      <span className={`flex size-8 items-center justify-center rounded-lg ${iconClass}`}>
        {icon}
      </span>
      <div className="flex flex-col">
        <span className={`truncate text-lg font-bold leading-tight tracking-tight ${valueClass}`}>
          {value}
        </span>
        <span className="text-xs text-slate-500">{label}</span>
      </div>
    </PortalCard>
  )
}
