'use client'

import { CheckCircle2Icon, MailIcon, TriangleAlertIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  EMAIL_TEMPLATE_LABELS,
  type EmailTemplate,
} from '@/lib/email'

export interface EmailLogRow {
  id: string
  to_address: string
  subject: string
  template: string
  status: string
  entity_kind: string | null
  error: string | null
  created_at: string
}

const STATUS_BADGE: Record<string, string> = {
  sent: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300',
  failed: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300',
  skipped:
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-AU', {
    timeZone: 'Australia/Brisbane',
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

/**
 * Settings → Email (admin only, matching email_log RLS): the outbound email
 * log plus the sending configuration state. Nothing sends until BOTH
 * RESEND_API_KEY and EMAIL_FROM exist in the environment — until then every
 * attempt is recorded as 'skipped' so the owner can see exactly what WILL go
 * out the moment sending is switched on.
 */
export function EmailSection({
  keyPresent,
  fromPresent,
  rows,
}: {
  keyPresent: boolean
  fromPresent: boolean
  rows: EmailLogRow[]
}) {
  const configured = keyPresent && fromPresent

  return (
    <div className="flex flex-col gap-4">
      {/* Config-state banner */}
      {configured ? (
        <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Email sending is configured</p>
            <p className="mt-0.5">
              Notifications and daily digests are delivered through Resend.
              Every attempt is recorded below.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Email sending is not configured</p>
            <p className="mt-0.5">
              Attempts are logged below as <strong>skipped</strong> — nothing
              is sent. To go live, add{' '}
              {[
                !keyPresent ? 'RESEND_API_KEY (from resend.com)' : null,
                !fromPresent
                  ? 'EMAIL_FROM (a verified sender, e.g. noreply@yourdomain.com.au)'
                  : null,
              ]
                .filter(Boolean)
                .join(' and ')}{' '}
              to the Vercel environment and redeploy. Notifications start
              flowing immediately — no code change needed.
            </p>
          </div>
        </div>
      )}

      {/* The log */}
      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <MailIcon className="size-4 text-muted-foreground" />
          Email log
          <span className="text-sm font-normal text-muted-foreground">
            {rows.length === 0
              ? ''
              : `latest ${rows.length} attempt${rows.length === 1 ? '' : 's'}`}
          </span>
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No email attempts yet. Office alerts fire on new portal messages
            and work requests; clients are emailed on request updates and
            office replies; the daily digest runs at 6&nbsp;am Brisbane.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {fmtWhen(row.created_at)}
                    </TableCell>
                    <TableCell className="max-w-48 truncate font-medium">
                      {row.to_address}
                    </TableCell>
                    <TableCell className="max-w-72 truncate">{row.subject}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {EMAIL_TEMPLATE_LABELS[row.template as EmailTemplate] ??
                        row.template}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={STATUS_BADGE[row.status] ?? ''}
                      >
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-80 truncate text-xs text-muted-foreground">
                      {row.error ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}
