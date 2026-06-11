'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/StatusBadge'
import { MoneyInput } from '@/components/MoneyInput'
import { computeClaim, type ClaimLineInput, type RetentionRules } from '@/lib/claims'
import { aud, fmtDate, pct } from '@/lib/format'
import { round2 } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  BanknoteIcon,
  CheckCircleIcon,
  FileTextIcon,
  LockIcon,
  RefreshCwIcon,
  SendIcon,
  UnlockIcon,
} from 'lucide-react'
import {
  certifyClaim,
  markClaimPaid,
  refreshClaimLines,
  submitClaim,
  updateClaimLine,
} from '../actions'

export interface ClaimLineRow {
  id: string
  source_type: 'budget_line' | 'variation'
  source_id: string
  description: string
  line_value: number
  pct_complete: number
  previous_claimed: number
}

export interface ClaimHeader {
  id: string
  number: number
  status: string
  reference_date: string
  gst_rate: number
  gross_this_claim: number | null
  retention_this_claim: number | null
  subtotal: number | null
  gst: number | null
  total_inc_gst: number | null
  total_claimed_to_date: number | null
  submitted_at: string | null
  certified_amount: number | null
  certified_at: string | null
  schedule_received_at: string | null
  paid_at: string | null
}

export interface ClaimEditorProps {
  projectId: string
  claim: ClaimHeader
  lines: ClaimLineRow[]
  /** Retention rules with ADJUSTED contract sum (base + approved VOs) and the
   *  retention position before this claim. */
  retention: RetentionRules
}

/** Previously-claimed floor as a percentage, capped at 100. */
function floorPct(line: ClaimLineRow): number {
  if (line.line_value <= 0) return 0
  return Math.min(round2((line.previous_claimed / line.line_value) * 100), 100)
}

// ─── % complete input (commit on blur) ────────────────────────────────────────

function PctInput({
  value,
  min,
  onCommit,
}: {
  value: number
  min: number
  onCommit: (v: number) => void
}) {
  const [focused, setFocused] = useState(false)
  const [raw, setRaw] = useState('')

  return (
    <Input
      type="number"
      inputMode="decimal"
      step={0.5}
      min={min}
      max={100}
      value={focused ? raw : String(value)}
      className="ml-auto h-8 w-24 text-right tabular-nums"
      onFocus={() => {
        setFocused(true)
        setRaw(String(value))
      }}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => {
        setFocused(false)
        const parsed = parseFloat(raw)
        if (isNaN(parsed)) return
        const clamped = Math.min(Math.max(round2(parsed), min), 100)
        onCommit(clamped)
      }}
    />
  )
}

// ─── Editor ───────────────────────────────────────────────────────────────────

export function ClaimEditor({ projectId, claim: initialClaim, lines: initialLines, retention }: ClaimEditorProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [claim, setClaim] = useState(initialClaim)
  const [lines, setLines] = useState<ClaimLineRow[]>(initialLines)
  const [allowReduction, setAllowReduction] = useState<Set<string>>(new Set())

  const [refreshConfirmOpen, setRefreshConfirmOpen] = useState(false)
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false)
  const [certifyOpen, setCertifyOpen] = useState(false)
  const [paidConfirmOpen, setPaidConfirmOpen] = useState(false)

  const [certifiedAmount, setCertifiedAmount] = useState<number | null>(
    initialClaim.total_inc_gst
  )
  const [scheduleDate, setScheduleDate] = useState(
    new Date().toISOString().slice(0, 10)
  )

  const isDraft = claim.status === 'draft'
  const isSubmitted = claim.status === 'submitted'
  const isCertified = claim.status === 'certified'

  // ── Single source of truth: the tested claims engine ────────────────────────
  const inputs: ClaimLineInput[] = lines.map((l) => ({
    sourceType: l.source_type,
    sourceId: l.source_id,
    description: l.description,
    lineValue: l.line_value,
    pctComplete: l.pct_complete,
    previousClaimed: l.previous_claimed,
  }))
  const live = computeClaim(inputs, retention, claim.gst_rate)
  const lineResults = new Map(live.lines.map((l, i) => [lines[i].id, l]))

  // Draft shows live numbers; submitted+ shows the immutable snapshot.
  const totals = isDraft
    ? {
        gross: live.grossThisClaim,
        retention: live.retentionThisClaim,
        subtotal: live.subtotal,
        gst: live.gst,
        total: live.totalIncGst,
        claimedToDate: live.totalClaimedToDate,
      }
    : {
        gross: claim.gross_this_claim ?? 0,
        retention: claim.retention_this_claim ?? 0,
        subtotal: claim.subtotal ?? 0,
        gst: claim.gst ?? 0,
        total: claim.total_inc_gst ?? 0,
        claimedToDate: claim.total_claimed_to_date ?? 0,
      }

  const retentionCap = round2((retention.capPct / 100) * retention.contractSum)
  const retentionHeldAfter = round2(retention.previouslyWithheld + totals.retention)

  // ── Line edits ───────────────────────────────────────────────────────────────

  function commitPct(line: ClaimLineRow, nextPct: number) {
    if (nextPct === line.pct_complete) return
    const prevPct = line.pct_complete
    setLines((prev) =>
      prev.map((l) => (l.id === line.id ? { ...l, pct_complete: nextPct } : l))
    )
    startTransition(async () => {
      const result = await updateClaimLine(line.id, claim.id, projectId, {
        pct_complete: nextPct,
        allow_reduction: allowReduction.has(line.id),
      })
      if (result.error) {
        toast.error(result.error)
        setLines((prev) =>
          prev.map((l) => (l.id === line.id ? { ...l, pct_complete: prevPct } : l))
        )
      }
    })
  }

  function commitClaimedToDate(line: ClaimLineRow, value: number | null) {
    if (value == null) return
    const min = allowReduction.has(line.id) ? 0 : floorPct(line)
    const nextPct =
      line.line_value > 0
        ? Math.min(Math.max(round2((value / line.line_value) * 100), min), 100)
        : 0
    commitPct(line, nextPct)
  }

  function toggleReduction(lineId: string) {
    setAllowReduction((prev) => {
      const next = new Set(prev)
      if (next.has(lineId)) next.delete(lineId)
      else next.add(lineId)
      return next
    })
  }

  // ── Status actions ───────────────────────────────────────────────────────────

  function handleRefresh() {
    startTransition(async () => {
      const result = await refreshClaimLines(claim.id, projectId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      setRefreshConfirmOpen(false)
      toast.success('Lines re-synced with budget and approved variations')
      router.refresh()
    })
  }

  function handleSubmit() {
    startTransition(async () => {
      const result = await submitClaim(claim.id, projectId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      setSubmitConfirmOpen(false)
      toast.success('Claim submitted — lines are now locked')
      router.refresh()
      setClaim((prev) => ({
        ...prev,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        gross_this_claim: live.grossThisClaim,
        retention_this_claim: live.retentionThisClaim,
        subtotal: live.subtotal,
        gst: live.gst,
        total_inc_gst: live.totalIncGst,
        total_claimed_to_date: live.totalClaimedToDate,
      }))
      setCertifiedAmount(live.totalIncGst)
    })
  }

  function handleCertify(e: React.FormEvent) {
    e.preventDefault()
    if (certifiedAmount == null) {
      toast.error('Enter the certified amount')
      return
    }
    startTransition(async () => {
      const result = await certifyClaim(claim.id, projectId, {
        certified_amount: certifiedAmount,
        schedule_received_at: scheduleDate,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      setCertifyOpen(false)
      toast.success('Claim certified')
      setClaim((prev) => ({
        ...prev,
        status: 'certified',
        certified_amount: certifiedAmount,
        schedule_received_at: scheduleDate,
        certified_at: new Date().toISOString(),
      }))
      router.refresh()
    })
  }

  function handleMarkPaid() {
    startTransition(async () => {
      const result = await markClaimPaid(claim.id, projectId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      setPaidConfirmOpen(false)
      toast.success('Claim marked paid')
      setClaim((prev) => ({ ...prev, status: 'paid', paid_at: new Date().toISOString() }))
      router.refresh()
    })
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  const contractLines = lines.filter((l) => l.source_type === 'budget_line')
  const variationLines = lines.filter((l) => l.source_type === 'variation')

  function renderGroup(title: string, group: ClaimLineRow[]) {
    if (group.length === 0) return null
    return (
      <>
        <TableRow className="bg-muted/60 hover:bg-muted/60">
          <TableCell
            colSpan={isDraft ? 7 : 6}
            className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {title}
          </TableCell>
        </TableRow>
        {group.map((line) => {
          const r = lineResults.get(line.id)
          const claimedToDate = r?.claimedToDate ?? 0
          const thisClaim = r?.thisClaim ?? 0
          const floor = floorPct(line)
          const reduce = allowReduction.has(line.id)
          return (
            <TableRow key={line.id}>
              <TableCell className="max-w-[260px]">{line.description}</TableCell>
              <TableCell className="text-right tabular-nums">{aud(line.line_value)}</TableCell>
              <TableCell className="text-right">
                {isDraft ? (
                  <PctInput
                    value={line.pct_complete}
                    min={reduce ? 0 : floor}
                    onCommit={(v) => commitPct(line, v)}
                  />
                ) : (
                  <span className="tabular-nums">{pct(line.pct_complete)}</span>
                )}
              </TableCell>
              {isDraft && (
                <TableCell className="px-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'size-7',
                      reduce
                        ? 'text-amber-600 hover:text-amber-700'
                        : 'text-muted-foreground/50 hover:text-muted-foreground'
                    )}
                    title={
                      reduce
                        ? `Reduction allowed — values below the previous ${floor}% accepted (credit)`
                        : `Locked at the previously claimed floor (${floor}%) — click to allow reduction`
                    }
                    onClick={() => toggleReduction(line.id)}
                  >
                    {reduce ? <UnlockIcon className="size-3.5" /> : <LockIcon className="size-3.5" />}
                    <span className="sr-only">Allow reduction</span>
                  </Button>
                </TableCell>
              )}
              <TableCell className="text-right">
                {isDraft ? (
                  <MoneyInput
                    value={claimedToDate}
                    onChange={(v) => commitClaimedToDate(line, v)}
                    className="ml-auto h-8 w-32"
                  />
                ) : (
                  <span className="tabular-nums">{aud(claimedToDate)}</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {aud(line.previous_claimed)}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right tabular-nums font-medium',
                  thisClaim < 0 && 'text-red-600 dark:text-red-400'
                )}
              >
                {aud(thisClaim)}
              </TableCell>
            </TableRow>
          )
        })}
      </>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight font-mono">
              PC-{claim.number}
            </h1>
            <StatusBadge status={claim.status} />
            {!isDraft && <LockIcon className="size-4 text-muted-foreground" />}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>
              Reference date:{' '}
              <span className="font-medium text-foreground tabular-nums">
                {fmtDate(claim.reference_date)}
              </span>
            </span>
            {claim.submitted_at && (
              <span>
                Submitted:{' '}
                <span className="font-medium text-foreground tabular-nums">
                  {fmtDate(claim.submitted_at)}
                </span>
              </span>
            )}
            {claim.certified_at && (
              <span>
                Certified:{' '}
                <span className="font-medium text-foreground tabular-nums">
                  {aud(claim.certified_amount ?? 0)} on {fmtDate(claim.certified_at)}
                </span>
              </span>
            )}
            {claim.schedule_received_at && (
              <span>
                Schedule received:{' '}
                <span className="font-medium text-foreground tabular-nums">
                  {fmtDate(claim.schedule_received_at)}
                </span>
              </span>
            )}
            {claim.paid_at && (
              <span>
                Paid:{' '}
                <span className="font-medium text-foreground tabular-nums">
                  {fmtDate(claim.paid_at)}
                </span>
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(`/api/pdf/claim/${claim.id}`, '_blank')}
          >
            <FileTextIcon className="size-4" />
            PDF
          </Button>
          {isDraft && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRefreshConfirmOpen(true)}
                disabled={pending}
              >
                <RefreshCwIcon className="size-4" />
                Refresh lines
              </Button>
              <Button
                size="sm"
                onClick={() => setSubmitConfirmOpen(true)}
                disabled={pending || lines.length === 0}
              >
                <SendIcon className="size-4" />
                Submit claim
              </Button>
            </>
          )}
          {isSubmitted && (
            <Button size="sm" onClick={() => setCertifyOpen(true)} disabled={pending}>
              <CheckCircleIcon className="size-4" />
              Certify
            </Button>
          )}
          {isCertified && (
            <Button size="sm" onClick={() => setPaidConfirmOpen(true)} disabled={pending}>
              <BanknoteIcon className="size-4" />
              Mark paid
            </Button>
          )}
        </div>
      </div>

      {/* Lines */}
      {lines.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No lines in this claim. Add budget lines or approve variations, then use
          “Refresh lines”.
        </p>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Contract value</TableHead>
                <TableHead className="text-right">% complete</TableHead>
                {isDraft && <TableHead className="w-8" />}
                <TableHead className="text-right">Claimed to date</TableHead>
                <TableHead className="text-right">Previous</TableHead>
                <TableHead className="text-right">This claim</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {renderGroup('Contract works', contractLines)}
              {renderGroup('Variations', variationLines)}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Totals — sticky so the position stays visible while editing lines */}
      <div className="sticky bottom-0 z-10 ml-auto w-full rounded-xl border bg-background/95 p-4 shadow-sm backdrop-blur sm:w-96">
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Gross this claim</span>
            <span className="tabular-nums font-medium">{aud(totals.gross)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              Retention this claim ({pct(retention.pctPerClaim)})
            </span>
            <span className="tabular-nums">−{aud(totals.retention)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Retention held after this claim:{' '}
            <span className="tabular-nums font-medium text-foreground">
              {aud(retentionHeldAfter)}
            </span>{' '}
            of {aud(retentionCap)} cap ({pct(retention.capPct)} of adjusted contract sum)
          </p>
          <div className="flex justify-between border-t pt-2">
            <span className="text-muted-foreground">Subtotal (ex GST)</span>
            <span className="tabular-nums font-medium">{aud(totals.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">GST ({pct(claim.gst_rate)})</span>
            <span className="tabular-nums">{aud(totals.gst)}</span>
          </div>
          <div className="flex justify-between border-t pt-2 font-semibold">
            <span>Total inc GST</span>
            <span className="tabular-nums">{aud(totals.total)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Claimed to date: <span className="tabular-nums">{aud(totals.claimedToDate)}</span>
          </p>
        </div>
      </div>

      {/* Refresh confirm */}
      <Dialog open={refreshConfirmOpen} onOpenChange={setRefreshConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Refresh claim lines?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The snapshot will be re-synced with the current budget lines and approved
            variations: new lines are added, contract values updated, and removed
            sources dropped. Your entered % complete is preserved for surviving lines.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefreshConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRefresh} disabled={pending}>
              {pending ? 'Refreshing…' : 'Refresh lines'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Submit confirm */}
      <Dialog open={submitConfirmOpen} onOpenChange={setSubmitConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Submit claim PC-{claim.number}?</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Gross this claim</span>
              <span className="tabular-nums">{aud(live.grossThisClaim)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Retention</span>
              <span className="tabular-nums">−{aud(live.retentionThisClaim)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">GST</span>
              <span className="tabular-nums">{aud(live.gst)}</span>
            </div>
            <div className="flex justify-between border-t pt-1.5 font-semibold">
              <span>Total inc GST</span>
              <span className="tabular-nums">{aud(live.totalIncGst)}</span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Totals are recomputed and locked on submission. Lines cannot be edited
            afterwards.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={pending}>
              {pending ? 'Submitting…' : 'Submit claim'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Certify dialog */}
      <Dialog open={certifyOpen} onOpenChange={setCertifyOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Certify claim PC-{claim.number}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCertify} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cert-amount">Certified amount (inc GST)</Label>
              <MoneyInput value={certifiedAmount} onChange={setCertifiedAmount} />
              <p className="text-xs text-muted-foreground">
                Claimed: {aud(claim.total_inc_gst ?? 0)}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cert-schedule">Payment schedule received</Label>
              <Input
                id="cert-schedule"
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCertifyOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Certifying…' : 'Certify'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Mark paid confirm */}
      <Dialog open={paidConfirmOpen} onOpenChange={setPaidConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark claim PC-{claim.number} as paid?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            A payment of{' '}
            <span className="font-medium text-foreground tabular-nums">
              {aud(claim.certified_amount ?? claim.total_inc_gst ?? 0)}
            </span>{' '}
            will be recorded against this claim.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaidConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleMarkPaid} disabled={pending}>
              {pending ? 'Saving…' : 'Mark paid'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
