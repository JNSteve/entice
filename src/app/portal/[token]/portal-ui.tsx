import Link from 'next/link'
import {
  Building2Icon,
  CalendarDaysIcon,
  CheckIcon,
  ClockIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { fmtDate } from '@/lib/format'
import { todayAU } from '@/lib/tz'
import { complianceTitle, type ComplianceStatus } from '@/lib/compliance'
import {
  REQUEST_STATUS_LABELS,
  REQUEST_TIMELINE,
  requestTimelineIndex,
  type RequestStatus,
} from '@/lib/portal-interactions'

/**
 * Shared building blocks for the anonymous client portal (/portal/[token]).
 * This is ECR's client-facing shopfront: professional, calm, trust-building.
 * Mobile-first (property managers live on phones) — no horizontal scroll,
 * tap targets ≥ 44px, one consistent colour language:
 *   compliance green/amber/red · works/info blue · neutral slate text.
 * Server components only, except the document browser (search needs state).
 */

export interface PortalBranding {
  client_name: string
  label: string | null
  company_name: string
  logo_path: string | null
  company_phone: string | null
  company_email: string | null
  company_address: string | null
  company_abn: string | null
  /** Billing tab gate (client_links.show_financials, default off). */
  show_financials: boolean
}

// ─── CP2b payload shapes (portal RPCs) ───────────────────────────────────────

export interface PortalMessageRow {
  id: string
  sender: 'client' | 'office'
  sender_name: string
  body: string
  created_at: string
}

export interface PortalRequestRow {
  id: string
  number: string
  site_id: string
  site_name: string
  title: string
  description: string
  urgency: string
  status: string
  scheduled_for: string | null
  scheduled_note: string | null
  photo_count: number
  created_at: string
}

export interface PortalApprovalItem {
  kind: 'quote' | 'variation'
  id: string
  number: string
  title: string
  context: string | null
  site_id: string | null
  amount: number | null
  gst_inclusive: boolean
  date: string | null
}

export interface PortalDecidedItem extends PortalApprovalItem {
  action: 'accepted' | 'declined'
  signer_name: string
  signed_on: string | null
}

export interface PortalApprovalsPayload {
  pending: PortalApprovalItem[]
  decided: PortalDecidedItem[]
}

export interface PortalBillingRow {
  kind: 'invoice' | 'claim'
  number: string
  context: string | null
  date: string
  amount: number | null
  status: string
}

// Brand navy — matches the app's themeColor (#1e3a5f).
const BRAND_BG = 'bg-[#1e3a5f]'

export function PortalShell({
  branding,
  token,
  active,
  children,
}: {
  branding: PortalBranding
  token: string
  active: 'properties' | 'calendar'
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-dvh w-full flex-1 flex-col bg-slate-100">
      {/* Brand band */}
      <div className={`${BRAND_BG} text-white`}>
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {branding.logo_path && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.logo_path}
                alt={`${branding.company_name} logo`}
                className="h-9 w-auto shrink-0 rounded bg-white/95 p-1"
              />
            )}
            <div className="min-w-0">
              <p className="truncate text-lg font-bold leading-tight tracking-tight">
                {branding.company_name}
              </p>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-blue-200">
                Client portal
              </p>
            </div>
          </div>
          <p className="max-w-[45%] truncate text-right text-sm font-medium text-blue-100">
            {branding.client_name}
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="border-b bg-white">
        <div className="mx-auto flex w-full max-w-4xl gap-1 px-4">
          <PortalNavLink
            href={`/portal/${token}`}
            label="Properties"
            icon={<Building2Icon className="size-4" />}
            active={active === 'properties'}
          />
          <PortalNavLink
            href={`/portal/${token}/calendar`}
            label="Calendar"
            icon={<CalendarDaysIcon className="size-4" />}
            active={active === 'calendar'}
          />
        </div>
      </nav>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-4 py-5 pb-10">
        {children}
      </main>

      <footer className="border-t bg-white">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-slate-800">
              {branding.company_name}
            </p>
            <div className="flex flex-col gap-1.5 text-sm text-slate-600 sm:flex-row sm:flex-wrap sm:gap-x-6">
              {branding.company_phone && (
                <a
                  href={`tel:${branding.company_phone.replace(/\s+/g, '')}`}
                  className="flex min-h-6 items-center gap-2 hover:text-slate-900"
                >
                  <PhoneIcon className="size-3.5 shrink-0 text-slate-400" />
                  {branding.company_phone}
                </a>
              )}
              {branding.company_email && (
                <a
                  href={`mailto:${branding.company_email}`}
                  className="flex min-h-6 items-center gap-2 hover:text-slate-900"
                >
                  <MailIcon className="size-3.5 shrink-0 text-slate-400" />
                  {branding.company_email}
                </a>
              )}
              {branding.company_address && (
                <span className="flex min-h-6 items-center gap-2">
                  <MapPinIcon className="size-3.5 shrink-0 text-slate-400" />
                  {branding.company_address}
                </span>
              )}
            </div>
            {branding.company_abn && (
              <p className="text-xs text-slate-400">ABN {branding.company_abn}</p>
            )}
          </div>
          <p className="border-t pt-3 text-xs text-slate-400">
            Issued via the {branding.company_name} client portal —{' '}
            {branding.client_name} — {fmtDate(todayAU())}
          </p>
        </div>
      </footer>
    </div>
  )
}

function PortalNavLink({
  href,
  label,
  icon,
  active,
}: {
  href: string
  label: string
  icon: React.ReactNode
  active: boolean
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-11 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
        active
          ? 'border-[#1e3a5f] text-[#1e3a5f]'
          : 'border-transparent text-slate-500 hover:text-slate-800'
      }`}
    >
      {icon}
      {label}
    </Link>
  )
}

/** Friendly dead-link page: no data, no error codes, no leak. */
export function LinkInactivePage() {
  return (
    <div className="flex min-h-dvh w-full flex-1 flex-col bg-slate-100">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4 pb-10">
        <div className="mt-10 flex flex-col items-center gap-3 rounded-2xl border bg-white px-6 py-12 text-center shadow-sm">
          <ShieldCheckIcon className="size-10 text-slate-400" />
          <h1 className="text-lg font-bold">This link is no longer active</h1>
          <p className="text-sm text-slate-500">
            The portal link may have expired or been replaced. Please contact
            your account manager for a new link.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Status language ─────────────────────────────────────────────────────────

export const STATUS_DOT: Record<ComplianceStatus, string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-400',
  red: 'bg-red-500',
}

const STATUS_LABELS: Record<ComplianceStatus, string> = {
  green: 'Current',
  amber: 'Review due soon',
  red: 'Attention required',
}

/** Traffic-light dot + label, sized for compliance rows. */
export function PortalLight({
  status,
  label,
}: {
  status: ComplianceStatus
  label?: string
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600"
      title={complianceTitle(status)}
    >
      <span
        className={`inline-block size-2.5 shrink-0 rounded-full ${STATUS_DOT[status]}`}
      />
      {label ?? STATUS_LABELS[status]}
    </span>
  )
}

/**
 * At-a-glance compliance ring for property cards: a circled status icon in
 * the property's aggregate colour.
 */
export function StatusRing({ status }: { status: ComplianceStatus }) {
  const styles: Record<ComplianceStatus, string> = {
    green: 'bg-green-50 text-green-600 ring-green-500/40',
    amber: 'bg-amber-50 text-amber-600 ring-amber-500/50',
    red: 'bg-red-50 text-red-600 ring-red-500/40',
  }
  const Icon =
    status === 'green' ? CheckIcon : status === 'amber' ? ClockIcon : TriangleAlertIcon
  return (
    <span
      className={`flex size-11 shrink-0 items-center justify-center rounded-full ring-2 ${styles[status]}`}
      title={complianceTitle(status)}
    >
      <Icon className="size-5" strokeWidth={2.5} />
    </span>
  )
}

// ─── Works status ────────────────────────────────────────────────────────────

/** Works status chip — portal-safe vocabulary (no internal jargon). */
const WORK_STATUS: Record<string, { label: string; className: string }> = {
  scheduled: { label: 'Scheduled', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  in_progress: { label: 'In progress', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  completed: { label: 'Completed', className: 'bg-green-50 text-green-700 border-green-200' },
  invoiced: { label: 'Completed', className: 'bg-green-50 text-green-700 border-green-200' },
  paid: { label: 'Completed', className: 'bg-green-50 text-green-700 border-green-200' },
  active: { label: 'In progress', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  practical_completion: {
    label: 'Practical completion',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  defects_liability: {
    label: 'Defects liability',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  closed: { label: 'Closed', className: 'bg-slate-100 text-slate-600 border-slate-200' },
}

export function workStatusLabel(status: string): string {
  return WORK_STATUS[status]?.label ?? status
}

export function WorkStatusBadge({ status }: { status: string }) {
  const meta = WORK_STATUS[status] ?? {
    label: status,
    className: 'bg-slate-100 text-slate-600 border-slate-200',
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  )
}

/** Blue works progress bar (programme-driven). */
export function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)))
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-blue-600"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-xs font-semibold tabular-nums text-blue-700">
        {clamped}%
      </span>
    </div>
  )
}

// ─── Cards ───────────────────────────────────────────────────────────────────

/** White content card — the portal's base surface. */
export function PortalCard({
  className = '',
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`rounded-2xl border bg-white shadow-sm ${className}`}>
      {children}
    </div>
  )
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed bg-white px-4 py-10 text-center text-sm text-slate-500">
      {children}
    </p>
  )
}

// ─── Work request status language ────────────────────────────────────────────

/** Portal colour discipline: in-motion blue, waiting slate, ready amber,
 *  done green, declined red. */
const REQUEST_STATUS_CHIP: Record<string, string> = {
  submitted: 'bg-slate-100 text-slate-600 border-slate-200',
  reviewed: 'bg-blue-50 text-blue-700 border-blue-200',
  quoted: 'bg-amber-50 text-amber-700 border-amber-200',
  scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
  declined: 'bg-red-50 text-red-700 border-red-200',
}

export function RequestStatusChip({ status }: { status: string }) {
  const className =
    REQUEST_STATUS_CHIP[status] ?? 'bg-slate-100 text-slate-600 border-slate-200'
  const label = REQUEST_STATUS_LABELS[status as RequestStatus] ?? status
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  )
}

/**
 * The request's progress along submitted → reviewed → quoted → scheduled →
 * completed. Declined requests render a red branch note instead of the steps.
 * While the request sits at 'scheduled', the planned date + office note
 * (when provided) render under the step.
 */
export function RequestTimeline({
  status,
  scheduledFor,
  scheduledNote,
}: {
  status: string
  scheduledFor?: string | null
  scheduledNote?: string | null
}) {
  if (status === 'declined') {
    return (
      <p className="text-xs font-medium text-red-600">
        This request was declined — contact us if you would like to discuss it.
      </p>
    )
  }
  const index = requestTimelineIndex(status)
  const showSchedule =
    status === 'scheduled' && Boolean(scheduledFor || scheduledNote)
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex items-center" aria-label="Request progress">
        {REQUEST_TIMELINE.map((step, i) => {
          const reached = i <= index
          const isCurrent = i === index
          return (
            <li key={step} className="flex min-w-0 flex-1 items-center last:flex-none">
              <span className="flex flex-col items-center gap-1">
                <span
                  className={`flex size-4 items-center justify-center rounded-full ring-2 ${
                    reached
                      ? 'bg-blue-600 ring-blue-600'
                      : 'bg-white ring-slate-300'
                  }`}
                >
                  {reached && <CheckIcon className="size-2.5 text-white" strokeWidth={3.5} />}
                </span>
                <span
                  className={`whitespace-nowrap text-[10px] leading-none ${
                    isCurrent ? 'font-semibold text-blue-700' : 'text-slate-400'
                  }`}
                >
                  {REQUEST_STATUS_LABELS[step]}
                </span>
              </span>
              <span
                className={`mx-1 mb-4 h-0.5 flex-1 rounded ${
                  i < index ? 'bg-blue-600' : 'bg-slate-200'
                } ${i === REQUEST_TIMELINE.length - 1 ? 'hidden' : ''}`}
              />
            </li>
          )
        })}
      </ol>
      {showSchedule && (
        <div className="flex items-start gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1.5">
          <CalendarDaysIcon className="mt-px size-3.5 shrink-0 text-blue-600" />
          <p className="min-w-0 text-xs text-blue-900">
            {scheduledFor && (
              <span className="font-semibold">
                Scheduled — {fmtDate(scheduledFor)}
              </span>
            )}
            {scheduledFor && scheduledNote && <br />}
            {scheduledNote && (
              <span className="text-blue-800/80">{scheduledNote}</span>
            )}
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Billing status chip (portal-safe vocabulary) ────────────────────────────

const BILLING_STATUS: Record<string, { label: string; className: string }> = {
  sent: { label: 'Issued', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  submitted: { label: 'Submitted', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  certified: { label: 'Certified', className: 'bg-green-50 text-green-700 border-green-200' },
  paid: { label: 'Paid', className: 'bg-green-50 text-green-700 border-green-200' },
}

export function BillingStatusChip({ status }: { status: string }) {
  const meta = BILLING_STATUS[status] ?? {
    label: status,
    className: 'bg-slate-100 text-slate-600 border-slate-200',
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  )
}
