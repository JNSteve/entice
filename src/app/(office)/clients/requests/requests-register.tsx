'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CalendarIcon, FileTextIcon, InboxIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { fmtDate } from '@/lib/format'
import {
  canConvertRequest,
  canTransitionRequest,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUSES,
  REQUEST_URGENCY_LABELS,
  type RequestStatus,
  type RequestUrgency,
} from '@/lib/portal-interactions'
import {
  convertRequestToQuote,
  setRequestSchedule,
  setRequestStatus,
} from './actions'

export interface OfficeRequestRow {
  id: string
  number: string
  title: string
  description: string
  urgency: string
  status: string
  created_at: string
  client_id: string
  client_name: string
  site_id: string
  site_name: string
  quote_id: string | null
  quote_number: string | null
  scheduled_for: string | null
  scheduled_note: string | null
  /** "Kind — title" of the compliance item this request renews, if any. */
  renewal_of: string | null
  /** Signed photo URLs (admin/office only). */
  photos: string[]
}

const URGENCY_BADGE: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300',
  normal: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300',
  high: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  urgent: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300',
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  return (
    <Badge
      variant="outline"
      className={`border font-medium ${URGENCY_BADGE[urgency] ?? URGENCY_BADGE.normal}`}
    >
      {REQUEST_URGENCY_LABELS[urgency as RequestUrgency] ?? urgency}
    </Badge>
  )
}

/** Manual (non-convert) transitions offered on the drawer, in offer order. */
const MANUAL_TRANSITIONS: RequestStatus[] = [
  'reviewed',
  'scheduled',
  'completed',
  'declined',
]

export function RequestsRegister({
  requests,
  canManage,
}: {
  requests: OfficeRequestRow[]
  canManage: boolean
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<'all' | RequestStatus>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // "Mark scheduled" / "Edit schedule" dialog (planned date + note).
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleNote, setScheduleNote] = useState('')

  const selected = requests.find((r) => r.id === selectedId) ?? null
  const filtered =
    filter === 'all' ? requests : requests.filter((r) => r.status === filter)

  const countByStatus = requests.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})

  function handleTransition(request: OfficeRequestRow, status: RequestStatus) {
    // Scheduling prompts for the planned date + note first.
    if (status === 'scheduled') {
      openScheduleDialog(request)
      return
    }
    if (
      status === 'declined' &&
      !confirm(`Decline ${request.number}? The client will see this on their portal.`)
    ) {
      return
    }
    startTransition(async () => {
      const result = await setRequestStatus(request.id, { status })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`${request.number} ${REQUEST_STATUS_LABELS[status].toLowerCase()}`)
      router.refresh()
    })
  }

  function openScheduleDialog(request: OfficeRequestRow) {
    setScheduleDate(request.scheduled_for ?? '')
    setScheduleNote(request.scheduled_note ?? '')
    setScheduleOpen(true)
  }

  function handleScheduleSave(request: OfficeRequestRow) {
    const payload = {
      scheduled_for: scheduleDate || null,
      scheduled_note: scheduleNote || null,
    }
    const alreadyScheduled = request.status === 'scheduled'
    startTransition(async () => {
      const result = alreadyScheduled
        ? await setRequestSchedule(request.id, payload)
        : await setRequestStatus(request.id, { status: 'scheduled', ...payload })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(
        alreadyScheduled
          ? `${request.number} schedule updated`
          : `${request.number} scheduled`
      )
      setScheduleOpen(false)
      router.refresh()
    })
  }

  function handleConvert(request: OfficeRequestRow) {
    startTransition(async () => {
      const result = await convertRequestToQuote(request.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Draft quote created')
      if (result.quoteId) router.push(`/quotes/${result.quoteId}`)
    })
  }

  if (requests.length === 0) {
    return (
      <EmptyState
        icon={<InboxIcon className="size-8" />}
        title="No work requests yet"
        description="When clients raise requests through their portal links, they land here for triage, quoting and scheduling."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Status filter */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('all')}
        >
          All ({requests.length})
        </Button>
        {REQUEST_STATUSES.map((s) =>
          countByStatus[s] ? (
            <Button
              key={s}
              variant={filter === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter(s)}
            >
              {REQUEST_STATUS_LABELS[s]} ({countByStatus[s]})
            </Button>
          ) : null
        )}
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Property</TableHead>
              <TableHead>Urgency</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Scheduled</TableHead>
              <TableHead>Quote</TableHead>
              <TableHead>Received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow
                key={r.id}
                className="cursor-pointer"
                onClick={() => setSelectedId(r.id)}
              >
                <TableCell className="font-medium">{r.number}</TableCell>
                <TableCell className="max-w-56 truncate">{r.title}</TableCell>
                <TableCell className="text-muted-foreground">{r.client_name}</TableCell>
                <TableCell className="text-muted-foreground">{r.site_name}</TableCell>
                <TableCell>
                  <UrgencyBadge urgency={r.urgency} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={r.status} />
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {r.scheduled_for ? fmtDate(r.scheduled_for) : '—'}
                </TableCell>
                <TableCell>
                  {r.quote_id && r.quote_number ? (
                    <Link
                      href={`/quotes/${r.quote_id}`}
                      className="text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.quote_number}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {fmtDate(r.created_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Detail drawer */}
      <Dialog open={selected !== null} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {selected && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="font-mono">{selected.number}</DialogTitle>
                  <UrgencyBadge urgency={selected.urgency} />
                  <StatusBadge status={selected.status} />
                </div>
              </DialogHeader>

              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-base font-semibold">{selected.title}</p>
                  <p className="text-sm text-muted-foreground">
                    Received {fmtDate(selected.created_at)} from{' '}
                    <Link
                      href={`/clients/${selected.client_id}`}
                      className="text-primary hover:underline"
                    >
                      {selected.client_name}
                    </Link>{' '}
                    —{' '}
                    <Link
                      href={`/clients/${selected.client_id}/sites/${selected.site_id}`}
                      className="text-primary hover:underline"
                    >
                      {selected.site_name}
                    </Link>
                  </p>
                </div>

                {selected.renewal_of && (
                  <p className="w-fit rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    Renewal of: {selected.renewal_of}
                  </p>
                )}

                <p className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-sm">
                  {selected.description}
                </p>

                {selected.photos.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">
                      Photos ({selected.photos.length})
                    </p>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {selected.photos.map((url, i) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block aspect-square overflow-hidden rounded-lg border bg-muted"
                          aria-label={`View photo ${i + 1}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`Request photo ${i + 1}`}
                            className="h-full w-full object-cover transition-transform hover:scale-105"
                            loading="lazy"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {selected.quote_id && selected.quote_number && (
                  <p className="flex items-center gap-2 text-sm">
                    <FileTextIcon className="size-4 text-muted-foreground" />
                    Quote{' '}
                    <Link
                      href={`/quotes/${selected.quote_id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {selected.quote_number}
                    </Link>
                  </p>
                )}

                {(selected.scheduled_for || selected.scheduled_note) && (
                  <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
                    <CalendarIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="font-medium">
                        Scheduled
                        {selected.scheduled_for
                          ? ` — ${fmtDate(selected.scheduled_for)}`
                          : ' — no date set'}
                      </p>
                      {selected.scheduled_note && (
                        <p className="whitespace-pre-wrap text-muted-foreground">
                          {selected.scheduled_note}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {canManage && (
                <DialogFooter className="flex-col gap-2 sm:flex-row">
                  {canConvertRequest(selected.status, selected.quote_id) && (
                    <Button
                      type="button"
                      disabled={pending}
                      onClick={() => handleConvert(selected)}
                    >
                      <FileTextIcon className="size-4" />
                      Convert to quote
                    </Button>
                  )}
                  {selected.status === 'scheduled' && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pending}
                      onClick={() => openScheduleDialog(selected)}
                    >
                      <CalendarIcon className="size-4" />
                      Edit schedule
                    </Button>
                  )}
                  {MANUAL_TRANSITIONS.filter((s) =>
                    canTransitionRequest(selected.status, s)
                  ).map((s) => (
                    <Button
                      key={s}
                      type="button"
                      variant={s === 'declined' ? 'destructive' : 'outline'}
                      disabled={pending}
                      onClick={() => handleTransition(selected, s)}
                    >
                      {s === 'declined'
                        ? 'Decline'
                        : `Mark ${REQUEST_STATUS_LABELS[s].toLowerCase()}`}
                    </Button>
                  ))}
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Schedule dialog — planned date + note ("Mark scheduled" / edit). */}
      <Dialog open={scheduleOpen && selected !== null} onOpenChange={setScheduleOpen}>
        <DialogContent className="sm:max-w-md">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {selected.status === 'scheduled'
                    ? `Edit schedule — ${selected.number}`
                    : `Schedule ${selected.number}`}
                </DialogTitle>
              </DialogHeader>

              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  handleScheduleSave(selected)
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="request-scheduled-for">
                    Planned date (optional)
                  </Label>
                  <Input
                    id="request-scheduled-for"
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Shown to the client on their portal timeline — add it when
                    you can.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="request-scheduled-note">Note (optional)</Label>
                  <Textarea
                    id="request-scheduled-note"
                    value={scheduleNote}
                    onChange={(e) => setScheduleNote(e.target.value)}
                    maxLength={500}
                    rows={3}
                    placeholder="e.g. Morning start, access via rear lane"
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setScheduleOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={pending}>
                    {selected.status === 'scheduled'
                      ? 'Save schedule'
                      : 'Mark scheduled'}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
