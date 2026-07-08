import Link from 'next/link'
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  FileSignatureIcon,
  XCircleIcon,
} from 'lucide-react'
import { createPublicClient } from '@/lib/supabase/public'
import { aud, fmtDate } from '@/lib/format'
import {
  EmptyState,
  LinkInactivePage,
  isRegisterScope,
  PortalCard,
  PortalShell,
  type PortalApprovalsPayload,
  type PortalBranding,
} from '../portal-ui'
import { redirect } from 'next/navigation'

// Public, token-gated, no auth — always resolve the token fresh, never cache.
export const dynamic = 'force-dynamic'

/**
 * Approvals: everything published for this client's signature — quotes and
 * variations awaiting a decision, plus what was already decided through the
 * portal. Amounts appear here by design (an approval needs its total); this
 * is the portal's ONLY money surface.
 */
export default async function PortalApprovalsPage({
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
  // Register-scope links (site QR posters) only see their property's register.
  if (isRegisterScope(branding)) {
    redirect(`/portal/${token}/sites/${branding.site_id}`)
  }

  const [{ data: approvalsData }] = await Promise.all([
    supabase.rpc('portal_approvals', { p_token: token }),
    supabase.rpc('portal_log_view', {
      p_token: token,
      p_site: null,
      p_path: '/portal/approvals',
    }),
  ])
  const approvals = ((approvalsData ?? null) as PortalApprovalsPayload | null) ?? {
    pending: [],
    decided: [],
  }

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
            Approvals
          </h1>
          <p className="text-sm text-slate-500">
            Quotes and variations awaiting your sign-off — review and sign
            right here.
          </p>
        </div>
      </div>

      {/* Pending */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Awaiting your approval
        </h2>
        {approvals.pending.length === 0 ? (
          <EmptyState>Nothing waiting on you — all caught up.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {approvals.pending.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <Link
                  href={`/portal/${token}/approvals/${item.kind}/${item.id}`}
                  className="block rounded-2xl border bg-white p-4 shadow-sm transition-all hover:border-slate-300 hover:shadow"
                >
                  <div className="flex items-center gap-3.5">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-2 ring-amber-500/40">
                      <FileSignatureIcon className="size-5" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        {item.kind === 'quote' ? 'Quotation' : 'Variation'} {item.number}
                        {item.date ? (
                          <span className="font-normal normal-case tracking-normal">
                            {' '}
                            · {fmtDate(item.date)}
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-[15px] font-semibold text-slate-900">
                        {item.title}
                      </p>
                      {item.context && (
                        <p className="truncate text-xs text-slate-500">{item.context}</p>
                      )}
                      {item.amount != null && (
                        <p className="pt-0.5 text-sm font-bold tabular-nums text-slate-900">
                          {aud(item.amount)}{' '}
                          <span className="text-xs font-normal text-slate-400">
                            {item.gst_inclusive ? 'incl. GST' : 'excl. GST'}
                          </span>
                        </p>
                      )}
                    </div>
                    <ChevronRightIcon className="size-5 shrink-0 text-slate-300" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Decided */}
      {approvals.decided.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Signed through the portal
          </h2>
          <PortalCard className="divide-y">
            {approvals.decided.map((item) => (
              <div
                key={`${item.kind}-${item.id}-${item.action}`}
                className="flex items-center gap-3 px-4 py-3"
              >
                {item.action === 'accepted' ? (
                  <CircleCheckIcon className="size-5 shrink-0 text-green-600" />
                ) : (
                  <XCircleIcon className="size-5 shrink-0 text-red-500" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {item.number} — {item.title}
                  </p>
                  <p className="text-xs text-slate-500">
                    {item.action === 'accepted' ? 'Accepted' : 'Declined'} by{' '}
                    {item.signer_name}
                    {item.signed_on ? ` on ${fmtDate(item.signed_on)}` : ''}
                  </p>
                </div>
                {item.kind === 'quote' && (
                  <a
                    href={`/portal/${token}/approval-pdf/quote/${item.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-xs font-medium text-[#162040] hover:underline"
                  >
                    View PDF
                  </a>
                )}
              </div>
            ))}
          </PortalCard>
        </div>
      )}
    </PortalShell>
  )
}
