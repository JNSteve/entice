import { ShieldCheckIcon } from 'lucide-react'
import { fmtDate } from '@/lib/format'
import { todayAU } from '@/lib/tz'
import { complianceTitle, type ComplianceStatus } from '@/lib/compliance'

/**
 * Shared building blocks for the anonymous client portal (/portal/[token]).
 * Server components only — the portal ships no interactive JS beyond links.
 * Mobile-first: property managers live on phones.
 */

export interface PortalBranding {
  client_name: string
  label: string | null
  company_name: string
  logo_path: string | null
}

export function PortalShell({
  branding,
  children,
}: {
  branding: PortalBranding
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 p-4 pb-6">
      <header className="flex items-center justify-between gap-3 border-b pb-3">
        <div className="flex items-center gap-3">
          {branding.logo_path && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logo_path}
              alt={`${branding.company_name} logo`}
              className="h-9 w-auto"
            />
          )}
          <div>
            <p className="text-xl font-bold tracking-tight text-[#1e3a5f] dark:text-blue-200">
              {branding.company_name}
            </p>
            <p className="text-xs text-muted-foreground">Client portal</p>
          </div>
        </div>
        <p className="text-right text-sm font-medium">{branding.client_name}</p>
      </header>

      <main className="flex flex-1 flex-col gap-5">{children}</main>

      <footer className="border-t pt-3">
        <p className="text-xs text-muted-foreground">
          Issued via the {branding.company_name} client portal —{' '}
          {branding.client_name} — {fmtDate(todayAU())}
        </p>
      </footer>
    </div>
  )
}

/** Friendly dead-link page: no data, no error codes, no leak. */
export function LinkInactivePage() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4 pb-10">
      <div className="mt-10 flex flex-col items-center gap-3 rounded-xl border px-6 py-12 text-center">
        <ShieldCheckIcon className="size-10 text-muted-foreground" />
        <h1 className="text-lg font-bold">This link is no longer active</h1>
        <p className="text-sm text-muted-foreground">
          The portal link may have expired or been replaced. Please contact
          your account manager for a new link.
        </p>
      </div>
    </div>
  )
}

/** Traffic-light dot + label, sized for the portal's property cards. */
export function PortalLight({ status }: { status: ComplianceStatus }) {
  const colours: Record<ComplianceStatus, string> = {
    green: 'bg-green-500',
    amber: 'bg-amber-400',
    red: 'bg-red-500',
  }
  const labels: Record<ComplianceStatus, string> = {
    green: 'Compliant',
    amber: 'Review due soon',
    red: 'Attention required',
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium"
      title={complianceTitle(status)}
    >
      <span className={`inline-block size-2.5 shrink-0 rounded-full ${colours[status]}`} />
      {labels[status]}
    </span>
  )
}

/** Works status chip — portal-safe vocabulary (no internal jargon). */
const WORK_STATUS: Record<string, { label: string; className: string }> = {
  scheduled: {
    label: 'Scheduled',
    className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300',
  },
  in_progress: {
    label: 'In progress',
    className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300',
  },
  completed: {
    label: 'Completed',
    className: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300',
  },
  invoiced: {
    label: 'Completed',
    className: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300',
  },
  paid: {
    label: 'Completed',
    className: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300',
  },
  active: {
    label: 'In progress',
    className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300',
  },
  practical_completion: {
    label: 'Practical completion',
    className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  },
  defects_liability: {
    label: 'Defects liability',
    className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  },
  closed: {
    label: 'Closed',
    className: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300',
  },
}

export function WorkStatusBadge({ status }: { status: string }) {
  const meta = WORK_STATUS[status] ?? {
    label: status,
    className: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  )
}
