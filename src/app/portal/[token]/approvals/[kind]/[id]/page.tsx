import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeftIcon, CircleCheckIcon, FileTextIcon, XCircleIcon } from 'lucide-react'
import { createPublicClient } from '@/lib/supabase/public'
import { aud, fmtDate } from '@/lib/format'
import {
  LinkInactivePage,
  isRegisterScope,
  PortalCard,
  PortalShell,
  type PortalApprovalsPayload,
  type PortalBranding,
} from '../../../portal-ui'
import { ApprovalSign } from './approval-sign'

// Public, token-gated, no auth — always resolve the token fresh, never cache.
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One approval: number, title, amount, PDF (quotes) and the sign-on-the-glass
 * accept/decline flow. Entitlement is re-proved by portal_approvals — an item
 * that isn't published for this client simply doesn't exist here.
 */
export default async function PortalApprovalDetailPage({
  params,
}: {
  params: Promise<{ token: string; kind: string; id: string }>
}) {
  const { token, kind, id } = await params
  if ((kind !== 'quote' && kind !== 'variation') || !UUID_RE.test(id)) {
    notFound()
  }

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
      p_path: `/portal/approvals/${kind}/${id}`,
    }),
  ])
  const approvals = ((approvalsData ?? null) as PortalApprovalsPayload | null) ?? {
    pending: [],
    decided: [],
  }

  const pending = approvals.pending.find((i) => i.kind === kind && i.id === id)
  const decided = approvals.decided.find((i) => i.kind === kind && i.id === id)
  const item = pending ?? decided
  if (!item) notFound()

  return (
    <PortalShell branding={branding} token={token} active="quotes">
      <div className="flex flex-col gap-3">
        <Link
          href={`/portal/${token}/approvals`}
          className="flex min-h-6 w-fit items-center gap-1 text-sm text-slate-500 transition-colors hover:text-slate-900"
        >
          <ArrowLeftIcon className="size-3.5" />
          All approvals
        </Link>
        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {item.kind === 'quote' ? 'Quotation' : 'Variation'} {item.number}
            {item.date ? (
              <span className="font-normal normal-case tracking-normal">
                {' '}
                · {fmtDate(item.date)}
              </span>
            ) : null}
          </p>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            {item.title}
          </h1>
          {item.context && <p className="text-sm text-slate-500">{item.context}</p>}
        </div>
      </div>

      {/* Amount + document */}
      <PortalCard className="flex flex-col gap-3 p-4 sm:p-5">
        {item.amount != null && (
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-slate-500">
              {item.kind === 'quote' ? 'Quoted amount' : 'Variation amount'}
            </span>
            <span className="text-xl font-bold tabular-nums text-slate-900">
              {aud(item.amount)}{' '}
              <span className="text-xs font-normal text-slate-400">
                {item.gst_inclusive ? 'incl. GST' : 'excl. GST'}
              </span>
            </span>
          </div>
        )}
        {item.kind === 'quote' && (
          <a
            href={`/portal/${token}/approval-pdf/quote/${item.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 w-fit items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium text-[#162040] transition-colors hover:bg-slate-50"
          >
            <FileTextIcon className="size-4" />
            View the full quotation (PDF)
          </a>
        )}
      </PortalCard>

      {pending ? (
        <ApprovalSign
          token={token}
          kind={pending.kind}
          id={pending.id}
          number={pending.number}
          clientName={branding.client_name}
        />
      ) : decided ? (
        <PortalCard className="flex items-center gap-3 p-4">
          {decided.action === 'accepted' ? (
            <CircleCheckIcon className="size-6 shrink-0 text-green-600" />
          ) : (
            <XCircleIcon className="size-6 shrink-0 text-red-500" />
          )}
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {decided.action === 'accepted' ? 'Accepted' : 'Declined'} by{' '}
              {decided.signer_name}
              {decided.signed_on ? ` on ${fmtDate(decided.signed_on)}` : ''}
            </p>
            <p className="text-sm text-slate-500">
              {decided.action === 'accepted'
                ? 'This document has been signed through the portal.'
                : 'Our team has been notified and will be in touch.'}
            </p>
          </div>
        </PortalCard>
      ) : null}
    </PortalShell>
  )
}
