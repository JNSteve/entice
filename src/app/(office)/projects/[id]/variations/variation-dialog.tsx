'use client'

import { useState, useTransition } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import { MoneyInput } from '@/components/MoneyInput'
import { AttachmentList, type AttachmentItem } from '@/components/AttachmentList'
import { PhotoUpload } from '@/components/PhotoUpload'
import { StatusBadge } from '@/components/StatusBadge'
import { GlobeIcon, PlusIcon } from 'lucide-react'
import {
  createVariation,
  updateVariation,
  setVariationPortalPublished,
  setVariationStatus,
} from './actions'
import type { VariationRow } from './variations-table'

// ─── New variation dialog ─────────────────────────────────────────────────────

interface NewVariationDialogProps {
  projectId: string
}

export function NewVariationDialog({ projectId }: NewVariationDialogProps) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [costEstimate, setCostEstimate] = useState<number | null>(null)
  const [sellAmount, setSellAmount] = useState<number | null>(null)
  const [clientRef, setClientRef] = useState('')
  const [timeBarDate, setTimeBarDate] = useState('')
  const [notes, setNotes] = useState('')

  function reset() {
    setTitle('')
    setDescription('')
    setCostEstimate(null)
    setSellAmount(null)
    setClientRef('')
    setTimeBarDate('')
    setNotes('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await createVariation({
        project_id: projectId,
        title,
        description: description || null,
        cost_estimate: costEstimate,
        sell_amount: sellAmount,
        client_ref: clientRef || null,
        time_bar_date: timeBarDate || null,
        notes: notes || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Variation created')
      setOpen(false)
      reset()
    })
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <PlusIcon className="size-4" />
        New variation
      </Button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New variation</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vo-title">Title <span className="text-destructive">*</span></Label>
              <Input
                id="vo-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Brief description of the variation"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vo-description">Description</Label>
              <Textarea
                id="vo-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detailed scope of works…"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="vo-cost">Cost estimate</Label>
                <MoneyInput
                  value={costEstimate}
                  onChange={setCostEstimate}
                  placeholder="0.00"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="vo-sell">Sell amount</Label>
                <MoneyInput
                  value={sellAmount}
                  onChange={setSellAmount}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="vo-ref">Client ref</Label>
                <Input
                  id="vo-ref"
                  value={clientRef}
                  onChange={(e) => setClientRef(e.target.value)}
                  placeholder="RFV-001"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="vo-timebar">Time bar date</Label>
                <Input
                  id="vo-timebar"
                  type="date"
                  value={timeBarDate}
                  onChange={(e) => setTimeBarDate(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vo-notes">Notes</Label>
              <Textarea
                id="vo-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Internal notes…"
                rows={2}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setOpen(false); reset() }}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !title.trim()}>
                {pending ? 'Creating…' : 'Create variation'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Status transition labels / confirm messages ─────────────────────────────

type TransitionButton = {
  label: string
  toStatus: string
  confirmMessage: string
  variant?: 'default' | 'destructive'
}

const STATUS_TRANSITIONS: Record<string, TransitionButton | null> = {
  notified: {
    label: 'Mark priced',
    toStatus: 'priced',
    confirmMessage: 'Mark this variation as priced?',
  },
  priced: {
    label: 'Submit to client',
    toStatus: 'submitted',
    confirmMessage: 'Submit this variation to the client? This will record today as the submission date.',
  },
  submitted: null, // handled with two buttons below
  approved: null,
  rejected: null,
}

// ─── Variation detail dialog ──────────────────────────────────────────────────

interface VariationDetailDialogProps {
  projectId: string
  variation: VariationRow
  attachments: AttachmentItem[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

const TERMINAL = new Set(['approved', 'rejected'])

export function VariationDetailDialog({
  projectId,
  variation,
  attachments,
  open,
  onOpenChange,
}: VariationDetailDialogProps) {
  const [pending, startTransition] = useTransition()
  const [statusPending, startStatusTransition] = useTransition()

  const isLocked = TERMINAL.has(variation.status)

  const [title, setTitle] = useState(variation.title)
  const [description, setDescription] = useState(variation.description ?? '')
  const [costEstimate, setCostEstimate] = useState<number | null>(variation.cost_estimate)
  const [sellAmount, setSellAmount] = useState<number | null>(variation.sell_amount)
  const [clientRef, setClientRef] = useState(variation.client_ref ?? '')
  const [timeBarDate, setTimeBarDate] = useState(variation.time_bar_date ?? '')
  const [notes, setNotes] = useState(variation.notes ?? '')
  const [dirty, setDirty] = useState(false)

  function markDirty() { setDirty(true) }

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const payload: Record<string, unknown> = { notes: notes || null }
      if (!isLocked) {
        Object.assign(payload, {
          title,
          description: description || null,
          cost_estimate: costEstimate,
          sell_amount: sellAmount,
          client_ref: clientRef || null,
          time_bar_date: timeBarDate || null,
        })
      }
      const result = await updateVariation(variation.id, projectId, payload)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Variation updated')
      setDirty(false)
    })
  }

  function handleTransition(toStatus: string, confirmMsg: string) {
    if (!confirm(confirmMsg)) return
    startStatusTransition(async () => {
      const result = await setVariationStatus(variation.id, projectId, { status: toStatus })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Variation ${toStatus}`)
      onOpenChange(false)
    })
  }

  function handlePortalPublish(published: boolean) {
    startStatusTransition(async () => {
      const result = await setVariationPortalPublished(
        variation.id,
        projectId,
        published
      )
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(
        published
          ? 'Published — the client can now approve this variation in their portal'
          : 'Removed from the client portal'
      )
    })
  }

  const singleTransition = STATUS_TRANSITIONS[variation.status]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DialogTitle className="font-mono">V-{variation.number}</DialogTitle>
            <StatusBadge status={variation.status} />
          </div>
        </DialogHeader>

        {/* Client portal: publish-for-approval toggle + signed evidence */}
        {variation.status === 'submitted' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
            <p className="flex items-center gap-2 text-sm">
              <GlobeIcon className="size-4 shrink-0 text-muted-foreground" />
              {variation.portal_published ? (
                <span className="font-medium">
                  Published — the client can approve this variation in their portal.
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Publish to let the client approve this variation online.
                </span>
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={statusPending}
              onClick={() => handlePortalPublish(!variation.portal_published)}
            >
              {variation.portal_published ? 'Unpublish' : 'Publish to portal'}
            </Button>
          </div>
        )}

        {variation.portal_acceptance?.action === 'accepted' && (
          <div className="flex flex-col gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 dark:border-green-800 dark:bg-green-950">
            <p className="text-sm font-medium text-green-800 dark:text-green-300">
              Approved via client portal
            </p>
            <p className="text-sm text-green-700 dark:text-green-300/80">
              Signed by {variation.portal_acceptance.signer_name} on{' '}
              {variation.portal_acceptance.signed_display}
            </p>
            {variation.portal_acceptance.signature_data && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={variation.portal_acceptance.signature_data}
                alt={`Signature of ${variation.portal_acceptance.signer_name}`}
                className="h-16 w-fit max-w-56 rounded border bg-white object-contain"
              />
            )}
          </div>
        )}

        {variation.portal_acceptance?.action === 'declined' &&
          variation.status === 'submitted' && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm dark:border-red-900 dark:bg-red-950">
              <p className="font-medium text-red-700 dark:text-red-300">
                Declined via client portal
              </p>
              <p className="text-red-600 dark:text-red-300/80">
                {variation.portal_acceptance.signer_name} on{' '}
                {variation.portal_acceptance.signed_display}
                {variation.portal_acceptance.reason
                  ? ` — “${variation.portal_acceptance.reason}”`
                  : ''}
              </p>
            </div>
          )}

        <form onSubmit={handleSave} className="flex flex-col gap-4">
          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vd-title">Title {!isLocked && <span className="text-destructive">*</span>}</Label>
            {isLocked ? (
              <p className="text-sm">{title}</p>
            ) : (
              <Input
                id="vd-title"
                value={title}
                onChange={(e) => { setTitle(e.target.value); markDirty() }}
                required
              />
            )}
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vd-description">Description</Label>
            {isLocked ? (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{description || '—'}</p>
            ) : (
              <Textarea
                id="vd-description"
                value={description}
                onChange={(e) => { setDescription(e.target.value); markDirty() }}
                rows={3}
              />
            )}
          </div>

          {/* Amounts */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Cost estimate</Label>
              {isLocked ? (
                <p className="text-sm tabular-nums text-right pr-3">
                  {costEstimate != null ? `$${costEstimate.toLocaleString('en-AU', { minimumFractionDigits: 2 })}` : '—'}
                </p>
              ) : (
                <MoneyInput value={costEstimate} onChange={(v) => { setCostEstimate(v); markDirty() }} />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Sell amount</Label>
              {/* Sell is locked once approved */}
              {isLocked || variation.status === 'approved' ? (
                <p className="text-sm tabular-nums text-right pr-3">
                  {sellAmount != null ? `$${sellAmount.toLocaleString('en-AU', { minimumFractionDigits: 2 })}` : '—'}
                </p>
              ) : (
                <MoneyInput value={sellAmount} onChange={(v) => { setSellAmount(v); markDirty() }} />
              )}
            </div>
          </div>

          {/* Client ref + time bar */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vd-ref">Client ref</Label>
              {isLocked ? (
                <p className="text-sm text-muted-foreground">{clientRef || '—'}</p>
              ) : (
                <Input
                  id="vd-ref"
                  value={clientRef}
                  onChange={(e) => { setClientRef(e.target.value); markDirty() }}
                  placeholder="RFV-001"
                />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vd-timebar">Time bar date</Label>
              {isLocked ? (
                <p className="text-sm tabular-nums text-muted-foreground">{timeBarDate || '—'}</p>
              ) : (
                <Input
                  id="vd-timebar"
                  type="date"
                  value={timeBarDate}
                  onChange={(e) => { setTimeBarDate(e.target.value); markDirty() }}
                />
              )}
            </div>
          </div>

          {/* Notes — always editable */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vd-notes">Notes</Label>
            <Textarea
              id="vd-notes"
              value={notes}
              onChange={(e) => { setNotes(e.target.value); markDirty() }}
              rows={2}
              placeholder="Internal notes…"
            />
          </div>

          {/* Attachments */}
          <div className="flex flex-col gap-2">
            <Label>Attachments</Label>
            <PhotoUpload
              parentType="variation"
              parentId={variation.id}
              kind="document"
              multiple
            />
            {attachments.length > 0 && (
              <AttachmentList items={attachments} canDelete />
            )}
          </div>

          {/* Footer: save + status transitions */}
          <DialogFooter className="flex-col sm:flex-row gap-2">
            {/* Status transition buttons */}
            {variation.status === 'submitted' && (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={statusPending}
                  onClick={() =>
                    handleTransition(
                      'rejected',
                      'Reject this variation? This action cannot be undone.'
                    )
                  }
                >
                  Reject
                </Button>
                <Button
                  type="button"
                  disabled={statusPending}
                  className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={() =>
                    handleTransition(
                      'approved',
                      'Approve this variation? The sell amount will be locked and added to the contract sum.'
                    )
                  }
                >
                  Approve
                </Button>
              </>
            )}
            {singleTransition && (
              <Button
                type="button"
                variant="default"
                disabled={statusPending}
                onClick={() =>
                  handleTransition(
                    singleTransition.toStatus,
                    singleTransition.confirmMessage
                  )
                }
              >
                {singleTransition.label}
              </Button>
            )}

            {/* Save */}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
            {dirty && (
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Save changes'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
