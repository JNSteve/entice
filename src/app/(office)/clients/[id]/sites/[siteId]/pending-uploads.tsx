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
import { Textarea } from '@/components/ui/textarea'
import { fmtDate } from '@/lib/format'
import {
  PROPERTY_COMPLIANCE_KIND_LABELS,
  type PropertyComplianceKind,
} from '@/lib/portal'
import { DownloadIcon, InboxIcon } from 'lucide-react'
import { approvePortalUpload, rejectPortalUpload } from './actions'

export interface PendingUploadRow {
  id: string
  kind: string
  title: string
  issue_date: string
  review_due: string | null
  notes: string | null
  filename: string
  signedUrl: string | null
  created_at: string
}

/**
 * Client-filed documents awaiting review. Approve copies the file into the
 * compliance register (becomes a normal item, visible in the portal);
 * reject sends the note back to the client's portal.
 */
export function PendingUploads({
  clientId,
  uploads,
}: {
  clientId: string
  uploads: PendingUploadRow[]
}) {
  const [pending, startTransition] = useTransition()
  const [rejectTarget, setRejectTarget] = useState<PendingUploadRow | null>(null)
  const [rejectNote, setRejectNote] = useState('')

  if (uploads.length === 0) return null

  function handleApprove(upload: PendingUploadRow) {
    startTransition(async () => {
      const result = await approvePortalUpload(clientId, upload.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Added to the compliance register')
    })
  }

  function handleReject() {
    if (!rejectTarget) return
    const target = rejectTarget
    startTransition(async () => {
      const result = await rejectPortalUpload(clientId, target.id, rejectNote)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Returned to the client with your note')
      setRejectTarget(null)
      setRejectNote('')
    })
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <InboxIcon className="size-4 text-amber-600 dark:text-amber-400" />
        Client-submitted documents
        <span className="text-sm font-normal text-muted-foreground">
          awaiting review
        </span>
      </h2>
      <div className="flex flex-col gap-2">
        {uploads.map((u) => (
          <div
            key={u.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/30"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {PROPERTY_COMPLIANCE_KIND_LABELS[u.kind as PropertyComplianceKind] ?? u.kind}
              </p>
              <p className="font-medium">{u.title}</p>
              <p className="text-xs text-muted-foreground">
                Issued {fmtDate(u.issue_date)}
                {u.review_due ? ` · review due ${fmtDate(u.review_due)}` : ''}
                {' · '}filed {fmtDate(u.created_at.slice(0, 10))}
              </p>
              {u.notes && <p className="text-sm text-muted-foreground">{u.notes}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {u.signedUrl && (
                <a
                  href={u.signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-8 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-sm font-medium hover:bg-muted"
                >
                  <DownloadIcon className="size-3.5" />
                  <span className="max-w-40 truncate">{u.filename}</span>
                </a>
              )}
              <Button
                variant="outline"
                size="sm"
                className="text-destructive border-destructive/30 hover:bg-destructive/10"
                disabled={pending}
                onClick={() => setRejectTarget(u)}
              >
                Reject
              </Button>
              <Button size="sm" disabled={pending} onClick={() => handleApprove(u)}>
                {pending ? 'Working…' : 'Approve'}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Return to client?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {rejectTarget ? `"${rejectTarget.title}" won't be added to the register. Your note is shown on their portal.` : ''}
          </p>
          <Textarea
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="e.g. This clearance doesn't cover the storeroom area — please upload the full certificate."
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending || !rejectNote.trim()}
              onClick={handleReject}
            >
              {pending ? 'Returning…' : 'Return with note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
