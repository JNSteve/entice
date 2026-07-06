'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  CheckIcon,
  FileTextIcon,
  FlagIcon,
  PlusIcon,
  XIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge } from '@/components/StatusBadge'
import { PhotoUpload } from '@/components/PhotoUpload'
import { AttachmentList, type AttachmentItem } from '@/components/AttachmentList'
import { AuditHistory } from '@/components/AuditHistory'
import { ReleaseDialog } from '../../../programme/hold-points'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AuditRow } from '@/lib/audit-queries'
import type { Role } from '@/lib/auth'
import {
  ITP_POINT_TYPE_LABELS,
  LOT_TEST_TYPES,
  LOT_TEST_TYPE_LABELS,
  type ItpItemStatus,
  type ItpPointType,
  type LotStatus,
  type LotTestType,
} from '@/lib/zod'
import {
  addTestResult,
  closeLot,
  raiseNcrFromLot,
  recordInspection,
  reopenLot,
  setItpItemNa,
} from '../../actions'

// ─── Row types (shaped by the server page) ────────────────────────────────────

export type LotDetailData = {
  id: string
  number: string
  description: string
  location: string | null
  status: LotStatus
  opened_on: string
  closed_at: string | null
  closed_by_name: string | null
  created_by_name: string | null
  itpNumber: string
  itpTitle: string
  itpActivity: string
  /** Live verdict from the SQL fn lot_conformance() at render time. */
  conformance: string
}

export type LotItemRow = {
  id: string
  position: number
  description: string
  acceptance_criteria: string
  spec_ref: string | null
  point_type: ItpPointType
  record_required: boolean
  responsible: string | null
  item_status: ItpItemStatus
  latest: {
    inspection_id: string
    result: 'pass' | 'fail'
    notes: string | null
    inspected_at: string
    inspector_name: string | null
    ncr_id: string | null
    ncr_number: string | null
    ncr_status: string | null
  } | null
  /** Newest inspection with a linked NCR — the disposition trail survives a
   *  later passing re-inspection. */
  ncr: { id: string; number: string; status: string } | null
}

export type LotTestRow = {
  id: string
  test_type: LotTestType
  description: string
  value: number | null
  uom: string | null
  spec_min: number | null
  spec_max: number | null
  pass: boolean
  lab_ref: string | null
  tested_on: string | null
  ncr_id: string | null
  ncr_number: string | null
  ncr_status: string | null
}

export type LotHoldPointRow = {
  id: string
  title: string
  required_by: string
  date: string
  status: string
  released_at: string | null
  released_by: string | null
  release_ref: string | null
}

const POINT_BADGE: Record<ItpPointType, string> = {
  hold: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300',
  witness:
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  surveillance:
    'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300',
}

// ─── Detail ───────────────────────────────────────────────────────────────────

export function LotDetailClient({
  projectId,
  lot,
  items,
  tests,
  holdPoints,
  attachments,
  auditHistory,
  role,
}: {
  projectId: string
  lot: LotDetailData
  items: LotItemRow[]
  tests: LotTestRow[]
  holdPoints: LotHoldPointRow[]
  attachments: AttachmentItem[]
  auditHistory: AuditRow[]
  role: Role
}) {
  const [pending, startTransition] = useTransition()
  const [inspect, setInspect] = useState<{ item: LotItemRow; result: 'pass' | 'fail' } | null>(null)
  const [raiseNcr, setRaiseNcr] = useState<{ kind: 'inspection' | 'test'; recordId: string; context: string } | null>(null)
  const [release, setRelease] = useState<LotHoldPointRow | null>(null)
  const [testOpen, setTestOpen] = useState(false)

  const isAdmin = role === 'admin'
  const isClosed = lot.status === 'closed'
  const canManage = !isClosed

  function handleClose() {
    if (!confirm('Close this lot? Closing records the conformance verdict.')) return
    startTransition(async () => {
      const res = await closeLot(lot.id, projectId)
      if (res.error) toast.error(res.error)
      else toast.success('Lot closed — conforming')
    })
  }

  function handleReopen() {
    if (!confirm('Reopen this closed lot?')) return
    startTransition(async () => {
      const res = await reopenLot(lot.id, projectId)
      if (res.error) toast.error(res.error)
      else toast.success('Lot reopened')
    })
  }

  function handleNa(item: LotItemRow, na: boolean) {
    startTransition(async () => {
      const res = await setItpItemNa(item.id, projectId, na)
      if (res.error) toast.error(res.error)
      else toast.success(na ? 'Item marked N/A' : 'Item restored to pending')
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-xl font-semibold">{lot.number}</h1>
            <StatusBadge status={lot.status} />
          </div>
          <p className="text-sm">{lot.description}</p>
          <p className="text-xs text-muted-foreground">
            {lot.itpNumber} — {lot.itpTitle} · {lot.itpActivity}
            {lot.location ? ` · ${lot.location}` : ''}
            {' · '}Opened {fmtDate(lot.opened_on)}
            {lot.created_by_name ? ` by ${lot.created_by_name}` : ''}
            {lot.closed_at
              ? ` · Closed ${fmtDate(lot.closed_at)}${lot.closed_by_name ? ` by ${lot.closed_by_name}` : ''}`
              : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/pdf/lot/${lot.id}`}
            target="_blank"
            rel="noreferrer"
          >
            <Button type="button" variant="outline" size="sm">
              <FileTextIcon className="size-4" />
              Conformance report
            </Button>
          </a>
          {!isClosed && (
            <Button type="button" size="sm" disabled={pending} onClick={handleClose}>
              Close lot
            </Button>
          )}
          {isClosed && isAdmin && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={handleReopen}
            >
              Reopen
            </Button>
          )}
        </div>
      </div>

      {/* ITP checklist */}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">
            ITP checklist — pass/fail per item for this lot
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Inspection / test</TableHead>
                  <TableHead>Point</TableHead>
                  <TableHead>Result (this lot)</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => {
                  const isNa = it.item_status === 'na'
                  const latest = it.latest
                  const failedNoNcr =
                    latest?.result === 'fail' && !latest.ncr_id
                  return (
                    <TableRow key={it.id} className={cn(isNa && 'opacity-50')}>
                      <TableCell className="tabular-nums">{it.position}</TableCell>
                      <TableCell>
                        <div className="flex min-w-0 flex-col">
                          <span className={cn('font-medium', isNa && 'line-through')}>
                            {it.description}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {it.acceptance_criteria}
                            {it.spec_ref ? ` — ${it.spec_ref}` : ''}
                            {it.responsible ? ` · ${it.responsible}` : ''}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn('text-xs', POINT_BADGE[it.point_type])}
                        >
                          {ITP_POINT_TYPE_LABELS[it.point_type]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {isNa ? (
                          <span className="text-xs text-muted-foreground">N/A</span>
                        ) : latest ? (
                          <div className="flex min-w-0 flex-col">
                            <span
                              className={cn(
                                'text-sm font-medium',
                                latest.result === 'pass'
                                  ? 'text-green-600 dark:text-green-400'
                                  : 'text-red-600 dark:text-red-400'
                              )}
                            >
                              {latest.result === 'pass' ? 'Pass' : 'Fail'}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {fmtDate(latest.inspected_at)}
                              {latest.inspector_name ? ` · ${latest.inspector_name}` : ''}
                              {latest.notes ? ` · ${latest.notes}` : ''}
                            </span>
                            {it.ncr && (
                              <Link
                                href={`/whs/ncr/${it.ncr.id}`}
                                className="text-xs underline underline-offset-2"
                              >
                                {it.ncr.number} ({it.ncr.status})
                              </Link>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Not inspected
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {canManage && !isNa && (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={pending}
                                title="Record a passing inspection"
                                onClick={() => setInspect({ item: it, result: 'pass' })}
                              >
                                <CheckIcon className="size-3.5 text-green-600" />
                                Pass
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={pending}
                                title="Record a failed inspection"
                                onClick={() => setInspect({ item: it, result: 'fail' })}
                              >
                                <XIcon className="size-3.5 text-red-600" />
                                Fail
                              </Button>
                            </>
                          )}
                          {canManage && failedNoNcr && latest && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={pending}
                              onClick={() =>
                                setRaiseNcr({
                                  kind: 'inspection',
                                  recordId: latest.inspection_id,
                                  context: `${lot.number} — ${it.description}`,
                                })
                              }
                            >
                              <FlagIcon className="size-3.5" />
                              Raise NCR
                            </Button>
                          )}
                          {canManage &&
                            (role === 'admin' || role === 'office') &&
                            !latest &&
                            (isNa ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={pending}
                                onClick={() => handleNa(it, false)}
                              >
                                Restore
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={pending}
                                onClick={() => handleNa(it, true)}
                              >
                                N/A
                              </Button>
                            ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Hold points */}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Hold points</CardTitle>
        </CardHeader>
        <CardContent>
          {holdPoints.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hold points on this lot — the ITP has no hold-type items.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hold point</TableHead>
                    <TableHead>Required by</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holdPoints.map((hp) => (
                    <TableRow key={hp.id}>
                      <TableCell>
                        <div className="flex min-w-0 flex-col">
                          <span className="font-medium">{hp.title}</span>
                          {hp.status === 'released' && hp.released_by && (
                            <span className="text-xs text-muted-foreground">
                              Released by {hp.released_by}
                              {hp.release_ref ? ` · ${hp.release_ref}` : ''}
                              {hp.released_at ? ` · ${fmtDate(hp.released_at)}` : ''}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {hp.required_by}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {fmtDate(hp.date)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={hp.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end">
                          {canManage && hp.status !== 'released' && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={pending}
                              onClick={() => setRelease(hp)}
                            >
                              Release…
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test results */}
      <Card size="sm">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">Test results</CardTitle>
            {canManage && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setTestOpen(true)}
              >
                <PlusIcon className="size-4" />
                Add test
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {tests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No test results recorded — add compaction, concrete, survey or
              validation results as they come back from the lab.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Spec</TableHead>
                    <TableHead>Lab ref</TableHead>
                    <TableHead>Tested</TableHead>
                    <TableHead>Pass</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tests.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="whitespace-nowrap">
                        {LOT_TEST_TYPE_LABELS[t.test_type]}
                      </TableCell>
                      <TableCell className="font-medium">{t.description}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {t.value !== null ? `${t.value}${t.uom ? ` ${t.uom}` : ''}` : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {t.spec_min !== null || t.spec_max !== null
                          ? `${t.spec_min ?? '—'} to ${t.spec_max ?? '—'}`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {t.lab_ref ?? '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {t.tested_on ? fmtDate(t.tested_on) : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-0 flex-col">
                          <span
                            className={cn(
                              'text-sm font-medium',
                              t.pass
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-red-600 dark:text-red-400'
                            )}
                          >
                            {t.pass ? 'Pass' : 'Fail'}
                          </span>
                          {t.ncr_number && (
                            <Link
                              href={`/whs/ncr/${t.ncr_id}`}
                              className="text-xs underline underline-offset-2"
                            >
                              {t.ncr_number} ({t.ncr_status})
                            </Link>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end">
                          {canManage && !t.pass && !t.ncr_id && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={pending}
                              onClick={() =>
                                setRaiseNcr({
                                  kind: 'test',
                                  recordId: t.id,
                                  context: `${lot.number} — ${t.description}`,
                                })
                              }
                            >
                              <FlagIcon className="size-3.5" />
                              Raise NCR
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Evidence */}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Evidence</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canManage && (
            <PhotoUpload parentType="lot" parentId={lot.id} kind="photo" multiple />
          )}
          {canManage && (
            <PhotoUpload parentType="lot" parentId={lot.id} kind="document" multiple />
          )}
          {attachments.length > 0 ? (
            <AttachmentList
              items={attachments}
              canDelete={role === 'admin' || role === 'office'}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No evidence uploaded — attach test certificates, survey reports
              and photos.
            </p>
          )}
        </CardContent>
      </Card>

      <AuditHistory rows={auditHistory} />

      {inspect && (
        <InspectionDialog
          lotId={lot.id}
          item={inspect.item}
          result={inspect.result}
          onClose={() => setInspect(null)}
        />
      )}
      {raiseNcr && (
        <RaiseNcrDialog
          kind={raiseNcr.kind}
          recordId={raiseNcr.recordId}
          context={raiseNcr.context}
          onClose={() => setRaiseNcr(null)}
        />
      )}
      {release && (
        <ReleaseDialog
          projectId={projectId}
          holdPoint={{ id: release.id, title: release.title }}
          onClose={() => setRelease(null)}
        />
      )}
      {testOpen && (
        <AddTestDialog lotId={lot.id} onClose={() => setTestOpen(false)} />
      )}
    </div>
  )
}

// ─── Record inspection dialog ─────────────────────────────────────────────────

function InspectionDialog({
  lotId,
  item,
  result,
  onClose,
}: {
  lotId: string
  item: LotItemRow
  result: 'pass' | 'fail'
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [notes, setNotes] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const res = await recordInspection({
        lot_id: lotId,
        itp_instance_item_id: item.id,
        result,
        notes: notes || null,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(
        result === 'pass'
          ? 'Inspection recorded — pass'
          : 'Failure recorded — raise an NCR to disposition it'
      )
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {result === 'pass' ? 'Record pass' : 'Record failure'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{item.description}</span>
            <span className="text-xs text-muted-foreground">
              {item.acceptance_criteria}
              {item.spec_ref ? ` — ${item.spec_ref}` : ''}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="insp-notes">
              Notes{result === 'fail' ? ' (what failed)' : ''}
            </Label>
            <Textarea
              id="insp-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder={
                result === 'fail'
                  ? 'e.g. Density ratio 92% at ch 80 — below 95% requirement'
                  : ''
              }
            />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending
                ? 'Saving…'
                : result === 'pass'
                  ? 'Record pass'
                  : 'Record failure'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Raise NCR dialog ─────────────────────────────────────────────────────────

function RaiseNcrDialog({
  kind,
  recordId,
  context,
  onClose,
}: {
  kind: 'inspection' | 'test'
  recordId: string
  context: string
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState(`Nonconforming work — ${context}`)
  const [description, setDescription] = useState(
    `${kind === 'inspection' ? 'Inspection' : 'Test'} failure on ${context}. ` +
      'Describe the nonconformance, extent and proposed disposition (rework / repair / use-as-is with concession).'
  )
  const [severity, setSeverity] = useState('3')
  const [category, setCategory] = useState('ITP / Lot conformance')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const res = await raiseNcrFromLot({
        kind,
        record_id: recordId,
        severity: Number(severity),
        title,
        description,
        category: category || null,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('NCR raised and linked — the lot cannot close until it is closed')
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Raise NCR from failure</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ncr-title">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="ncr-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ncr-description">
              Description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="ncr-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ncr-severity">Severity</Label>
              <Select value={severity} onValueChange={(v) => v && setSeverity(v)}>
                <SelectTrigger id="ncr-severity" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['1', '2', '3', '4', '5'].map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}/5
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ncr-category">Category</Label>
              <Input
                id="ncr-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || !title.trim() || !description.trim()}
            >
              {pending ? 'Raising…' : 'Raise NCR'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Add test dialog ──────────────────────────────────────────────────────────

function AddTestDialog({
  lotId,
  onClose,
}: {
  lotId: string
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [testType, setTestType] = useState<LotTestType>('compaction')
  const [description, setDescription] = useState('')
  const [value, setValue] = useState('')
  const [uom, setUom] = useState('')
  const [specMin, setSpecMin] = useState('')
  const [specMax, setSpecMax] = useState('')
  const [pass, setPass] = useState('pass')
  const [labRef, setLabRef] = useState('')
  const [testedOn, setTestedOn] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const res = await addTestResult({
        lot_id: lotId,
        test_type: testType,
        description,
        value: value === '' ? null : Number(value),
        uom: uom || null,
        spec_min: specMin === '' ? null : Number(specMin),
        spec_max: specMax === '' ? null : Number(specMax),
        pass: pass === 'pass',
        lab_ref: labRef || null,
        tested_on: testedOn || null,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(
        pass === 'pass'
          ? 'Test result recorded'
          : 'Failed test recorded — raise an NCR to disposition it'
      )
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add test result</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="test-type">Type</Label>
              <Select
                value={testType}
                onValueChange={(v) => v && setTestType(v as LotTestType)}
              >
                <SelectTrigger id="test-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOT_TEST_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {LOT_TEST_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="test-pass">Outcome</Label>
              <Select value={pass} onValueChange={(v) => v && setPass(v)}>
                <SelectTrigger id="test-pass" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pass">Pass</SelectItem>
                  <SelectItem value="fail">Fail</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="test-description">
              Description <span className="text-destructive">*</span>
            </Label>
            <Input
              id="test-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Density ratio — layer 2, ch 40–120"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="test-value">Value</Label>
              <Input
                id="test-value"
                type="number"
                step="any"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="e.g. 97.5"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="test-uom">Unit</Label>
              <Input
                id="test-uom"
                value={uom}
                onChange={(e) => setUom(e.target.value)}
                placeholder="e.g. % MDD, MPa, f/mL"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="test-spec-min">Spec min</Label>
              <Input
                id="test-spec-min"
                type="number"
                step="any"
                value={specMin}
                onChange={(e) => setSpecMin(e.target.value)}
                placeholder="e.g. 95"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="test-spec-max">Spec max</Label>
              <Input
                id="test-spec-max"
                type="number"
                step="any"
                value={specMax}
                onChange={(e) => setSpecMax(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="test-lab-ref">Lab / docket ref</Label>
              <Input
                id="test-lab-ref"
                value={labRef}
                onChange={(e) => setLabRef(e.target.value)}
                placeholder="e.g. NATA report 24-1187"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="test-tested-on">Tested on</Label>
              <Input
                id="test-tested-on"
                type="date"
                value={testedOn}
                onChange={(e) => setTestedOn(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !description.trim()}>
              {pending ? 'Saving…' : 'Add test result'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
