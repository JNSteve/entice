'use client'

import React, { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StatusBadge } from '@/components/StatusBadge'
import { PhotoUpload } from '@/components/PhotoUpload'
import { AttachmentList, type AttachmentItem } from '@/components/AttachmentList'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ClipboardCopyIcon, MailIcon, SendIcon } from 'lucide-react'
import {
  deriveComplianceStatus,
  type ComplianceDocSummary,
  type ComplianceStatus,
} from '../../../../vendors/vendors-table'
import { markRfqSent, setRfqStatus } from './actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RfqVendorOption {
  id: string
  name: string
  email: string | null
  trades: string[]
  compliance_docs: ComplianceDocSummary[]
}

export interface RfqRow {
  id: string
  vendor_id: string
  vendor_name: string
  status: string
  invited_at: string
}

interface RfqSectionProps {
  projectId: string
  packageId: string
  packageName: string
  projectName: string
  packageNotes: string | null
  letByDate: string | null
  companyName: string
  vendors: RfqVendorOption[]
  rfqs: RfqRow[]
  attachments: AttachmentItem[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ALL_TRADES = '__all__'
const MAILTO_BODY_LIMIT = 1800

// RFQs open in Gmail web compose signed in as this account (via authuser).
// Change this if the mailbox that sends procurement RFQs ever changes.
const RFQ_GMAIL_ACCOUNT = 'nick@ecr.com.au'

const COMPLIANCE_COLOURS: Record<ComplianceStatus, string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-400',
  red: 'bg-red-500',
}

function nextRfqStatus(status: string): 'invited' | 'quoted' | 'declined' {
  if (status === 'invited') return 'quoted'
  if (status === 'quoted') return 'declined'
  return 'invited'
}

function buildEmailBody(opts: {
  packageName: string
  projectName: string
  packageNotes: string | null
  letByDate: string | null
  attachmentFilenames: string[]
  companyName: string
}): string {
  const lines: string[] = []
  lines.push('Hi,')
  lines.push('')
  lines.push(
    `We invite you to quote on the ${opts.packageName} package for project ${opts.projectName}.`
  )
  lines.push('')
  if (opts.packageNotes) {
    lines.push('Scope summary:')
    lines.push(opts.packageNotes)
    lines.push('')
  }
  if (opts.letByDate) {
    lines.push(`Please respond by ${fmtDate(opts.letByDate)}.`)
    lines.push('')
  }
  if (opts.attachmentFilenames.length > 0) {
    lines.push('Attached scope documents:')
    for (const f of opts.attachmentFilenames) {
      lines.push(`- ${f}`)
    }
    lines.push('')
  }
  lines.push('Please include any inclusions, exclusions and lead times with your price.')
  lines.push('')
  lines.push('Kind regards,')
  lines.push(opts.companyName)
  return lines.join('\n')
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RfqSection({
  projectId,
  packageId,
  packageName,
  projectName,
  packageNotes,
  letByDate,
  companyName,
  vendors,
  rfqs,
  attachments,
}: RfqSectionProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [statusPending, startStatusTransition] = useTransition()

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [tradeFilter, setTradeFilter] = useState(ALL_TRADES)

  const subject = `RFQ: ${packageName} — ${projectName}`
  const [body, setBody] = useState(() =>
    buildEmailBody({
      packageName,
      projectName,
      packageNotes,
      letByDate,
      attachmentFilenames: attachments.map((a) => a.filename),
      companyName,
    })
  )

  const invitedVendorIds = useMemo(
    () => new Set(rfqs.map((r) => r.vendor_id)),
    [rfqs]
  )

  const allTrades = useMemo(() => {
    const set = new Set<string>()
    for (const v of vendors) for (const t of v.trades) set.add(t)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [vendors])

  const filteredVendors = useMemo(() => {
    const q = search.trim().toLowerCase()
    return vendors.filter((v) => {
      if (tradeFilter !== ALL_TRADES && !v.trades.includes(tradeFilter)) {
        return false
      }
      if (
        q &&
        !v.name.toLowerCase().includes(q) &&
        !v.trades.some((t) => t.toLowerCase().includes(q))
      ) {
        return false
      }
      return true
    })
  }, [vendors, search, tradeFilter])

  function toggleVendor(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedVendors = vendors.filter((v) => selected.has(v.id))
  const selectedEmails = selectedVendors
    .map((v) => v.email)
    .filter((e): e is string => !!e)

  async function copyEmailText() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`)
      toast.success('Email text copied to clipboard')
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  function openInGmail() {
    if (body.length > MAILTO_BODY_LIMIT) {
      void copyEmailText()
      toast.info('Body too long for a mail link — text copied instead')
      return
    }
    if (selectedVendors.length > selectedEmails.length) {
      toast.warning(
        `${selectedVendors.length - selectedEmails.length} selected supplier(s) have no email address`
      )
    }
    // Gmail web compose. view=cm/fs=1 opens a full compose window; authuser
    // biases Gmail to the ECR account when several Googles are signed in.
    const params = new URLSearchParams()
    params.set('view', 'cm')
    params.set('fs', '1')
    params.set('authuser', RFQ_GMAIL_ACCOUNT)
    if (selectedEmails.length > 0) params.set('bcc', selectedEmails.join(','))
    params.set('su', subject) // Gmail uses 'su' for subject
    params.set('body', body)
    // URLSearchParams encodes spaces as '+'; normalise to %20 for the URL
    const query = params.toString().replace(/\+/g, '%20')
    window.open(`https://mail.google.com/mail/?${query}`, '_blank', 'noopener,noreferrer')
  }

  function handleMarkSent() {
    if (selected.size === 0) {
      toast.error('Select at least one supplier')
      return
    }
    startTransition(async () => {
      const result = await markRfqSent(packageId, projectId, {
        vendor_ids: Array.from(selected),
        email_snapshot: body,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('RFQ marked as sent')
      setSelected(new Set())
      router.refresh()
    })
  }

  function cycleRfqStatus(rfq: RfqRow) {
    const next = nextRfqStatus(rfq.status)
    startStatusTransition(async () => {
      const result = await setRfqStatus(rfq.id, packageId, projectId, {
        status: next,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">Request for quotes</h2>

      {/* Invited vendors */}
      {rfqs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {rfqs.map((rfq) => (
            <button
              key={rfq.id}
              type="button"
              disabled={statusPending}
              onClick={() => cycleRfqStatus(rfq)}
              className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-sm hover:bg-muted/60 disabled:opacity-60"
              title="Click to cycle status: invited → quoted → declined"
            >
              <span className="font-medium">{rfq.vendor_name}</span>
              <StatusBadge status={rfq.status} />
              <span className="text-xs text-muted-foreground">
                {fmtDate(rfq.invited_at)}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Vendor multi-select */}
        <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Select suppliers</h3>
          <div className="flex gap-2">
            <Input
              placeholder="Search suppliers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1"
            />
            <Select value={tradeFilter} onValueChange={(v) => v && setTradeFilter(v)}>
              <SelectTrigger className="w-36 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TRADES}>All trades</SelectItem>
                {allTrades.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="max-h-72 overflow-y-auto rounded-lg border divide-y">
            {filteredVendors.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                No suppliers match.
              </p>
            ) : (
              filteredVendors.map((v) => {
                const alreadyInvited = invitedVendorIds.has(v.id)
                const compliance = deriveComplianceStatus(v.compliance_docs)
                return (
                  <label
                    key={v.id}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 text-sm',
                      alreadyInvited
                        ? 'opacity-50'
                        : 'cursor-pointer hover:bg-muted/50'
                    )}
                  >
                    <Checkbox
                      checked={alreadyInvited || selected.has(v.id)}
                      disabled={alreadyInvited}
                      onCheckedChange={() => toggleVendor(v.id)}
                    />
                    <span
                      className={cn(
                        'inline-block size-2.5 shrink-0 rounded-full',
                        COMPLIANCE_COLOURS[compliance]
                      )}
                      title={`Compliance: ${compliance}`}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="font-medium">{v.name}</span>
                      {v.trades.length > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {v.trades.join(', ')}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground truncate max-w-[160px]">
                      {alreadyInvited ? 'Invited' : v.email ?? 'No email'}
                    </span>
                  </label>
                )
              })
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {selected.size} supplier{selected.size === 1 ? '' : 's'} selected
          </p>

          {/* Scope documents */}
          <div className="flex flex-col gap-2 border-t pt-3">
            <h3 className="text-sm font-semibold">Scope documents</h3>
            <PhotoUpload
              parentType="package"
              parentId={packageId}
              kind="document"
              multiple
              onUploaded={() => router.refresh()}
            />
            {attachments.length > 0 ? (
              <AttachmentList items={attachments} canDelete />
            ) : (
              <p className="text-sm text-muted-foreground">
                No scope documents yet.
              </p>
            )}
          </div>
        </div>

        {/* Email preview */}
        <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Email preview</h3>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rfq-subject">Subject</Label>
            <Input id="rfq-subject" value={subject} readOnly />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rfq-body">Body</Label>
            <Textarea
              id="rfq-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="font-mono text-xs"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={copyEmailText}>
              <ClipboardCopyIcon className="size-4" />
              Copy email text
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={openInGmail}>
              <MailIcon className="size-4" />
              Open in Gmail
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending || selected.size === 0}
              onClick={handleMarkSent}
            >
              <SendIcon className="size-4" />
              {pending ? 'Marking…' : 'Mark RFQ sent'}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
