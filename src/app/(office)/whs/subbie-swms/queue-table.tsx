'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'
import { FileCheckIcon, FileTextIcon, LinkIcon } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { cn } from '@/lib/utils'
import type { SubbieSwmsStatus } from '@/lib/zod'
import { RequestSubbieSwmsDialog, type RequestProjectOption } from './request-dialog'
import { setSubbieSwmsStatus } from './actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubbieSwmsRow {
  id: string
  created_at: string
  company_name: string
  contact_name: string
  email: string | null
  title: string
  status: SubbieSwmsStatus
  project_id: string
  project_label: string
  vendor_name: string | null
  review_notes: string | null
  reviewed_by_name: string | null
  reviewed_at: string | null
  /** Label of the share link the subbie submitted through (from audit log). */
  link_label: string | null
  /** Signed URL for the uploaded PDF (1h), generated server-side. */
  pdf_url: string | null
}

export interface VendorOption {
  id: string
  name: string
}

type StatusTab = 'pending' | 'accepted' | 'rejected' | 'all'

const STATUS_TABS: { key: StatusTab; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
]

function inTab(row: SubbieSwmsRow, tab: StatusTab): boolean {
  if (tab === 'all') return true
  if (tab === 'pending')
    return row.status === 'submitted' || row.status === 'under_review'
  return row.status === tab
}

/** Best-effort vendor preselect: vendor name contains company or vice versa. */
function fuzzyVendorMatch(company: string, vendors: VendorOption[]): string {
  const needle = company.trim().toLowerCase()
  if (!needle) return ''
  const hit = vendors.find((v) => {
    const name = v.name.trim().toLowerCase()
    return name.includes(needle) || needle.includes(name)
  })
  return hit?.id ?? ''
}

// ─── Review dialog (accept / reject) ─────────────────────────────────────────

interface ReviewDialogProps {
  row: SubbieSwmsRow | null
  verdict: 'accepted' | 'rejected'
  vendors: VendorOption[]
  onClose: () => void
}

function ReviewDialog({ row, verdict, vendors, onClose }: ReviewDialogProps) {
  const [pending, startTransition] = useTransition()
  const [notes, setNotes] = useState('')
  const [vendorId, setVendorId] = useState('')

  // Re-seed per submission so the fuzzy default tracks the open row.
  const [seedId, setSeedId] = useState<string | null>(null)
  if (row && row.id !== seedId) {
    setSeedId(row.id)
    setNotes('')
    setVendorId(fuzzyVendorMatch(row.company_name, vendors))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!row) return
    if (verdict === 'rejected' && !notes.trim()) {
      toast.error('Add a note explaining the rejection')
      return
    }
    startTransition(async () => {
      const result = await setSubbieSwmsStatus(row.id, {
        status: verdict,
        notes: notes.trim() || null,
        vendor_id: verdict === 'accepted' && vendorId ? vendorId : null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(verdict === 'accepted' ? 'SWMS accepted' : 'SWMS rejected')
      onClose()
    })
  }

  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {verdict === 'accepted' ? 'Accept' : 'Reject'} SWMS
          </DialogTitle>
        </DialogHeader>
        {row && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {row.company_name} — {row.title}
            </p>
            {verdict === 'accepted' && vendors.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label>Vendor (optional)</Label>
                <Select
                  value={vendorId}
                  onValueChange={(v) => setVendorId(!v || v === '__none' ? '' : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No vendor match" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">No vendor match</SelectItem>
                    {vendors.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="review-notes">
                Review notes{verdict === 'rejected' ? '' : ' (optional)'}
              </Label>
              <Textarea
                id="review-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder={
                  verdict === 'rejected'
                    ? 'What needs fixing before resubmission?'
                    : 'Anything worth noting'
                }
                required={verdict === 'rejected'}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={verdict === 'rejected' ? 'destructive' : 'default'}
                disabled={pending || (verdict === 'rejected' && !notes.trim())}
              >
                {pending
                  ? 'Saving…'
                  : verdict === 'accepted'
                    ? 'Accept SWMS'
                    : 'Reject SWMS'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Main queue ───────────────────────────────────────────────────────────────

interface SubbieSwmsQueueProps {
  rows: SubbieSwmsRow[]
  projects: RequestProjectOption[]
  vendors: VendorOption[]
  /** Review actions are admin/office; supervisors get a read-only queue. */
  canReview: boolean
}

export function SubbieSwmsQueue({
  rows,
  projects,
  vendors,
  canReview,
}: SubbieSwmsQueueProps) {
  const [tab, setTab] = useState<StatusTab>('pending')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const [review, setReview] = useState<{
    row: SubbieSwmsRow
    verdict: 'accepted' | 'rejected'
  } | null>(null)

  const filtered = rows.filter((r) => inTab(r, tab))
  const tabCounts = Object.fromEntries(
    STATUS_TABS.map(({ key }) => [key, rows.filter((r) => inTab(r, key)).length])
  )

  function handleStartReview(row: SubbieSwmsRow) {
    setPendingId(row.id)
    startTransition(async () => {
      const result = await setSubbieSwmsStatus(row.id, {
        status: 'under_review',
        notes: null,
        vendor_id: null,
      })
      setPendingId(null)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Review started')
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto">
          {STATUS_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                tab === key
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {label} <span className="text-xs opacity-70">{tabCounts[key]}</span>
            </button>
          ))}
        </div>
        <RequestSubbieSwmsDialog projects={projects} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<FileCheckIcon className="size-8" />}
          title="No subbie SWMS"
          description={
            tab === 'pending'
              ? 'Nothing waiting for review. Send a request link to a subcontractor to get their SWMS in.'
              : 'No submissions match the current filter.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Received</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Link</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(parseISO(row.created_at), 'dd/MM/yyyy HH:mm')}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{row.company_name}</span>
                      {row.vendor_name && (
                        <span className="text-xs text-muted-foreground">
                          Vendor: {row.vendor_name}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-sm">{row.contact_name}</span>
                      {row.email && (
                        <a
                          href={`mailto:${row.email}`}
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          {row.email}
                        </a>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    <span
                      className="block truncate text-sm"
                      title={
                        row.review_notes
                          ? `${row.title}\nNotes: ${row.review_notes}`
                          : row.title
                      }
                    >
                      {row.title}
                    </span>
                    {row.reviewed_by_name && row.reviewed_at && (
                      <span className="block text-xs text-muted-foreground">
                        Reviewed by {row.reviewed_by_name},{' '}
                        {format(parseISO(row.reviewed_at), 'dd/MM/yyyy')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[160px]">
                    <Link
                      href={`/projects/${row.project_id}`}
                      className="block truncate text-sm hover:underline"
                    >
                      {row.project_label}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[160px]">
                    {row.link_label ? (
                      <span
                        className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                        title={row.link_label}
                      >
                        <LinkIcon className="size-3 shrink-0" />
                        <span className="truncate">{row.link_label}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {row.pdf_url && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          render={
                            <a
                              href={row.pdf_url}
                              target="_blank"
                              rel="noopener noreferrer"
                            />
                          }
                        >
                          <FileTextIcon className="size-3.5" />
                          View PDF
                        </Button>
                      )}
                      {canReview && row.status === 'submitted' && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={pendingId === row.id}
                          onClick={() => handleStartReview(row)}
                        >
                          Start review
                        </Button>
                      )}
                      {canReview &&
                        (row.status === 'submitted' ||
                          row.status === 'under_review') && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() =>
                                setReview({ row, verdict: 'accepted' })
                              }
                            >
                              Accept
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() =>
                                setReview({ row, verdict: 'rejected' })
                              }
                            >
                              Reject
                            </Button>
                          </>
                        )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ReviewDialog
        row={review?.row ?? null}
        verdict={review?.verdict ?? 'accepted'}
        vendors={vendors}
        onClose={() => setReview(null)}
      />
    </div>
  )
}
