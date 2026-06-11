'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { addMonths, format } from 'date-fns'
import { round2 } from '@/lib/money'
import { aud, fmtDate } from '@/lib/format'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MoneyInput } from '@/components/MoneyInput'
import { PlusIcon } from 'lucide-react'
import { recordRetentionRelease } from './retention-actions'

export type RetentionEntry = {
  id: string
  kind: 'withheld' | 'release_pc' | 'release_final'
  amount: number
  date: string
  notes: string | null
  claim_number: number | null
}

export type RetentionCardProps = {
  projectId: string
  entries: RetentionEntry[]
  retentionHeld: number
  retentionCapPct: number
  adjustedSum: number
  pcReleaseFraction: number
  practicalCompletionDate: string | null
  dlpMonths: number
}

function kindLabel(entry: RetentionEntry): string {
  if (entry.kind === 'withheld') {
    return entry.claim_number != null
      ? `Withheld — Claim ${entry.claim_number}`
      : 'Withheld'
  }
  if (entry.kind === 'release_pc') return 'PC release'
  return 'Final release'
}

function signedAmount(entry: RetentionEntry): number {
  return entry.kind === 'withheld' ? entry.amount : -entry.amount
}

export function RetentionCard({
  projectId,
  entries,
  retentionHeld,
  retentionCapPct,
  adjustedSum,
  pcReleaseFraction,
  practicalCompletionDate,
  dlpMonths,
}: RetentionCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  // Suggested defaults for release dialog
  const suggestedPc = round2(retentionHeld * pcReleaseFraction)
  const suggestedFinal = round2(retentionHeld - suggestedPc)

  const [kind, setKind] = useState<'release_pc' | 'release_final'>('release_pc')
  const [amount, setAmount] = useState<number | null>(suggestedPc)
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [notes, setNotes] = useState('')

  function resetDialog() {
    setKind('release_pc')
    setAmount(suggestedPc)
    setDate(format(new Date(), 'yyyy-MM-dd'))
    setNotes('')
  }

  function handleKindChange(v: 'release_pc' | 'release_final') {
    setKind(v)
    setAmount(v === 'release_pc' ? suggestedPc : suggestedFinal)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await recordRetentionRelease(projectId, {
        kind,
        amount,
        date,
        notes: notes || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Retention release recorded')
      setDialogOpen(false)
      resetDialog()
    })
  }

  // Cap calculation
  const retentionCap = round2((retentionCapPct / 100) * adjustedSum)
  const capPct = retentionCap > 0 ? Math.min(100, round2((retentionHeld / retentionCap) * 100)) : 0

  // Expected release dates
  const pcDate = practicalCompletionDate ? new Date(practicalCompletionDate) : null
  const finalReleaseDate = pcDate ? addMonths(pcDate, dlpMonths) : null
  const pcReleaseEst = round2(retentionHeld * pcReleaseFraction)
  const finalReleaseEst = round2(retentionHeld - pcReleaseEst)

  // Running balance for ledger — use reduce to avoid mutable variable assignment
  const ledgerRows = entries.reduce<(RetentionEntry & { runningBalance: number })[]>(
    (acc, entry) => {
      const prev = acc.length > 0 ? acc[acc.length - 1].runningBalance : 0
      return [...acc, { ...entry, runningBalance: round2(prev + signedAmount(entry)) }]
    },
    []
  )

  const showLedger = entries.length > 0

  return (
    <>
      <Card size="sm" className="xl:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm text-muted-foreground">
            Retention held
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { resetDialog(); setDialogOpen(true) }}
          >
            <PlusIcon className="size-4" />
            Record release
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* Headline + cap bar */}
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-semibold tabular-nums">{aud(retentionHeld)}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                Cap: {aud(retentionCap)} ({retentionCapPct}%)
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-amber-500"
                style={{ width: `${capPct}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {capPct}% of cap reached
            </span>
          </div>

          {/* Expected releases */}
          {retentionHeld > 0 && (
            <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              <span className="tabular-nums">
                PC release: {aud(pcReleaseEst)}
                {pcDate ? ` on ${fmtDate(pcDate)}` : ' (on PC)'}
              </span>
              <span className="tabular-nums">
                Final release: {aud(finalReleaseEst)}
                {finalReleaseDate ? ` on ${fmtDate(finalReleaseDate)}` : ' (end of DLP)'}
              </span>
            </div>
          )}

          {/* Ledger table */}
          {showLedger && (
            <div className="mt-1 overflow-hidden rounded border text-xs">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Kind</TableHead>
                    <TableHead className="text-right text-xs">Amount</TableHead>
                    <TableHead className="text-right text-xs">Balance</TableHead>
                    <TableHead className="text-xs">Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledgerRows.map((row) => {
                    const signed = signedAmount(row)
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="text-xs tabular-nums">{fmtDate(row.date)}</TableCell>
                        <TableCell className="text-xs">{kindLabel(row)}</TableCell>
                        <TableCell
                          className={`text-right text-xs tabular-nums ${signed < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}
                        >
                          {signed >= 0 ? '+' : ''}{aud(signed)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{aud(row.runningBalance)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{row.notes ?? '—'}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {!showLedger && (
            <span className="text-xs text-muted-foreground">
              No retention withheld yet.
            </span>
          )}
        </CardContent>
      </Card>

      {/* Record release dialog */}
      <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) resetDialog() }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Record retention release</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Kind</Label>
              <Select
                value={kind}
                onValueChange={(v) => handleKindChange(v as 'release_pc' | 'release_final')}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="release_pc">PC release</SelectItem>
                  <SelectItem value="release_final">Final release</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>
                Amount{' '}
                <span className="text-muted-foreground font-normal">
                  (held: {aud(retentionHeld)})
                </span>
              </Label>
              <MoneyInput value={amount} onChange={setAmount} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ret-date">
                Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ret-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ret-notes">Notes</Label>
              <Textarea
                id="ret-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes…"
                rows={2}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => { setDialogOpen(false); resetDialog() }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !amount || amount <= 0 || !date}>
                {pending ? 'Saving…' : 'Record release'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
