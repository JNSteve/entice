'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangleIcon,
  DownloadIcon,
  FlagIcon,
  RotateCcwIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { fmtDate } from '@/lib/format'
import {
  formatMonth,
  lodgementStatus,
  outstandingParts,
  type LodgementUrgency,
} from '@/lib/waste/lodgement'
import { markLodged, reopenPart } from './actions'

export interface MovementRow {
  id: string
  load_seq: number
  collection_date: string
  received_date: string | null
  generator_name: string
  transporter_name: string
  receiver_name: string
  waste_code: string
  waste_amount: number
  waste_unit: string
  receiver_amount: number | null
  receiver_unit: string | null
  disposal_code: string | null
  part2_submitted_at: string | null
  part2_submitted_by: string | null
  part3_submitted_at: string | null
  part3_submitted_by: string | null
  transporter_declared_variance: Record<string, string> | null
  transporter_discrepancy: string | null
  receiver_discrepancy: string | null
  wtc_reference: string | null
  lodged_at: string | null
  lodgement_method: string | null
}

interface BudfProblem {
  loadSeq: number
  field: number | null
  fieldName: string
  message: string
}

const URGENCY_CLASS: Record<LodgementUrgency, string> = {
  lodged: 'bg-green-500/10 text-green-700 dark:text-green-300',
  overdue: 'bg-red-500/15 text-red-700 dark:text-red-300 font-semibold',
  'due-today': 'bg-red-500/10 text-red-700 dark:text-red-300 font-medium',
  soon: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium',
  ok: 'text-muted-foreground',
}

function LodgeDialog({
  movement,
  open,
  onOpenChange,
}: {
  movement: MovementRow | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [method, setMethod] = useState<'connect' | 'bulk_upload'>('connect')
  const [reference, setReference] = useState('')

  if (!movement) return null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const m = movement
    if (!m) return
    startTransition(async () => {
      const result = await markLodged(m.id, method, reference)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Load ${String(m.load_seq).padStart(7, '0')} marked lodged`)
      onOpenChange(false)
      setReference('')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Mark load {String(movement.load_seq).padStart(7, '0')} lodged
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>How was it given to the department?</Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['connect', 'Connect (WTC)'],
                  ['bulk_upload', 'Bulk upload'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMethod(value)}
                  aria-pressed={method === value}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    method === value
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-muted-foreground/30'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>
              WTC reference{method === 'bulk_upload' ? ' (optional)' : ''}
            </Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={
                method === 'connect'
                  ? 'Certificate reference from Connect'
                  : 'Not issued for bulk upload'
              }
              required={method === 'connect'}
            />
          </div>

          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            Once lodged, this record is frozen — only the WTC reference and
            notes can change afterwards. Record a discrepancy rather than
            editing the details.
          </p>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Mark lodged'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MovementCard({
  m,
  today,
  canManage,
  onLodge,
}: {
  m: MovementRow
  today: string
  canManage: boolean
  onLodge: (m: MovementRow) => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const status = lodgementStatus(m.collection_date, m.lodged_at, today)
  const missing = outstandingParts(m)
  const variance = m.transporter_declared_variance

  function reopen(part: 'transporter' | 'receiver') {
    startTransition(async () => {
      const result = await reopenPart(m.id, part)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`${part === 'transporter' ? 'Transport' : 'Receipt'} reopened`)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-mono text-sm font-semibold">
            {String(m.load_seq).padStart(7, '0')}
          </span>
          <span className="text-sm">
            {m.waste_code} · {m.waste_amount} {m.waste_unit} · {m.generator_name}
          </span>
          <span className="text-xs text-muted-foreground">
            Collected {fmtDate(m.collection_date)} · {m.transporter_name} →{' '}
            {m.receiver_name}
          </span>
        </div>
        <span
          className={cn(
            'rounded-full px-2.5 py-1 text-xs tabular-nums',
            URGENCY_CLASS[status.urgency]
          )}
        >
          {status.label}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={m.part2_submitted_at ? 'secondary' : 'outline'}>
          Part 2{' '}
          {m.part2_submitted_at
            ? `· ${m.part2_submitted_by ?? 'submitted'}`
            : '· outstanding'}
        </Badge>
        <Badge variant={m.part3_submitted_at ? 'secondary' : 'outline'}>
          Part 3{' '}
          {m.part3_submitted_at
            ? `· ${m.disposal_code ?? ''} ${m.receiver_amount ?? ''} ${m.receiver_unit ?? ''}`.trim()
            : '· outstanding'}
        </Badge>
        {m.lodged_at && (
          <Badge variant="secondary">
            Lodged{m.wtc_reference ? ` · ${m.wtc_reference}` : ''}
            {m.lodgement_method === 'bulk_upload' ? ' (bulk)' : ''}
          </Badge>
        )}
      </div>

      {variance && Object.keys(variance).length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs dark:border-amber-700 dark:bg-amber-950">
          <FlagIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="flex flex-col gap-0.5 text-amber-800 dark:text-amber-200">
            <span className="font-medium">
              The transporter corrected their own details — review and update
              the vendor record if right.
            </span>
            {Object.entries(variance).map(([k, v]) => (
              <span key={k}>
                {k.replace(/_/g, ' ')}: {v || '(cleared)'}
              </span>
            ))}
          </div>
        </div>
      )}

      {(m.transporter_discrepancy || m.receiver_discrepancy) && (
        <div className="flex flex-col gap-1 rounded-lg border p-2.5 text-xs">
          {m.transporter_discrepancy && (
            <span>
              <span className="text-muted-foreground">Transporter: </span>
              {m.transporter_discrepancy}
            </span>
          )}
          {m.receiver_discrepancy && (
            <span>
              <span className="text-muted-foreground">Receiver: </span>
              {m.receiver_discrepancy}
            </span>
          )}
        </div>
      )}

      {canManage && !m.lodged_at && (
        <div className="flex flex-wrap gap-2">
          {m.part2_submitted_at && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => reopen('transporter')}
            >
              <RotateCcwIcon className="size-3.5" />
              Reopen Part 2
            </Button>
          )}
          {m.part3_submitted_at && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => reopen('receiver')}
            >
              <RotateCcwIcon className="size-3.5" />
              Reopen Part 3
            </Button>
          )}
          <Button
            size="sm"
            disabled={pending || missing.length > 0}
            onClick={() => onLodge(m)}
            title={
              missing.length > 0
                ? `Still waiting on: ${missing.join(', ')}`
                : undefined
            }
          >
            Mark lodged
          </Button>
          {missing.length > 0 && (
            <span className="self-center text-xs text-muted-foreground">
              Waiting on {missing.join(' and ').toLowerCase()}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export function RegulatedRegisterClient({
  month,
  months,
  today,
  disposed,
  pending: pendingRows,
  budfIdentifier,
  budfApprovedAt,
  canManage,
}: {
  month: string
  months: string[]
  today: string
  disposed: MovementRow[]
  pending: MovementRow[]
  budfIdentifier: string | null
  budfApprovedAt: string | null
  canManage: boolean
}) {
  const router = useRouter()
  const [lodging, setLodging] = useState<MovementRow | null>(null)
  const [problems, setProblems] = useState<BudfProblem[] | null>(null)
  const [downloading, setDownloading] = useState(false)

  async function downloadFile() {
    setDownloading(true)
    setProblems(null)
    try {
      const res = await fetch(`/api/waste/budf?month=${month}`)
      if (res.status === 409) {
        const body = (await res.json()) as { problems: BudfProblem[] }
        setProblems(body.problems)
        toast.error('The file was not produced — see what is missing below')
        return
      }
      if (!res.ok) {
        toast.error('Could not build the file')
        return
      }
      const blob = await res.blob()
      const name =
        res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ??
        `BUDF_${month}.csv`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`${name} downloaded`)
    } finally {
      setDownloading(false)
    }
  }

  const overdue = [...disposed, ...pendingRows].filter(
    (m) => lodgementStatus(m.collection_date, m.lodged_at, today).urgency === 'overdue'
  ).length

  return (
    <div className="flex flex-col gap-5">
      {!budfIdentifier && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="text-amber-800 dark:text-amber-200">
            No bulk upload identifier is set. DETSI must approve bulk upload and
            allocate a 3-letter identifier before a file can be lodged —
            waste.track@des.qld.gov.au, 07 3330 5677. Movements can still be
            recorded and lodged through Connect in the meantime.
          </span>
        </div>
      )}
      {budfIdentifier && !budfApprovedAt && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          Identifier {budfIdentifier} is set but no DETSI approval date is
          recorded. Approval must be granted before bulk upload files may be
          lodged lawfully.
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="month">Disposal month</Label>
          <select
            id="month"
            className="rounded-lg border bg-background px-3 py-2 text-base md:text-sm"
            value={month}
            onChange={(e) => router.push(`/whs/env/regulated?month=${e.target.value}`)}
          >
            {months.map((mo) => (
              <option key={mo} value={mo}>
                {formatMonth(mo)}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={downloadFile} disabled={downloading || disposed.length === 0}>
          <DownloadIcon className="size-4" />
          {downloading ? 'Building…' : 'Download bulk upload file'}
        </Button>
      </div>

      {overdue > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-red-400 bg-red-50 p-3 text-sm dark:border-red-700 dark:bg-red-950">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
          <span className="text-red-800 dark:text-red-200">
            {overdue} movement{overdue === 1 ? ' is' : 's are'} past the 7-day
            window for giving the information to the department.
          </span>
        </div>
      )}

      {problems && (
        <div className="flex flex-col gap-2 rounded-xl border border-red-400 bg-red-50 p-4 text-sm dark:border-red-700 dark:bg-red-950">
          <p className="font-semibold text-red-900 dark:text-red-100">
            The file was not produced. A non-conforming file is rejected by the
            department in full, so nothing is emitted until these are fixed.
          </p>
          <ul className="flex flex-col gap-1 text-red-800 dark:text-red-200">
            {problems.map((p, i) => (
              <li key={i}>
                {p.loadSeq > 0 && (
                  <span className="font-mono">
                    {String(p.loadSeq).padStart(7, '0')}{' '}
                  </span>
                )}
                {p.field !== null && <span>[field {p.field}] </span>}
                <span className="font-medium">{p.fieldName}</span>: {p.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Disposed in {formatMonth(month)} ({disposed.length})
        </h2>
        {disposed.length === 0 ? (
          <p className="rounded-xl border p-4 text-sm text-muted-foreground">
            Nothing was disposed of in this month. The monthly file is selected
            by disposal date, not collection date.
          </p>
        ) : (
          disposed.map((m) => (
            <MovementCard
              key={m.id}
              m={m}
              today={today}
              canManage={canManage}
              onLodge={setLodging}
            />
          ))
        )}
      </section>

      {pendingRows.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Awaiting receipt ({pendingRows.length})
          </h2>
          <p className="text-xs text-muted-foreground">
            No disposal date yet, so these belong to no month and cannot be
            lodged. Chase the receiving facility.
          </p>
          {pendingRows.map((m) => (
            <MovementCard
              key={m.id}
              m={m}
              today={today}
              canManage={canManage}
              onLodge={setLodging}
            />
          ))}
        </section>
      )}

      <LodgeDialog
        movement={lodging}
        open={lodging !== null}
        onOpenChange={(v) => !v && setLodging(null)}
      />
    </div>
  )
}
