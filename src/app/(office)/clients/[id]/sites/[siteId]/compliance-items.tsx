'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  DownloadIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react'
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
import { ComplianceLight } from '@/components/ComplianceLight'
import { StatusBadge } from '@/components/StatusBadge'
import { createClient } from '@/lib/supabase/client'
import {
  buildStorageKey,
  removeUploadedObject,
  safeContentType,
  validateUploadFile,
} from '@/lib/storage-keys'
import { fmtDate } from '@/lib/format'
import { todayAUClient } from '@/lib/tz-client'
import { expiryColour } from '@/lib/compliance'
import {
  derivePropertyItemStatus,
  PROPERTY_COMPLIANCE_KIND_LABELS,
  PROPERTY_COMPLIANCE_KINDS,
  type PropertyComplianceKind,
} from '@/lib/portal'
import {
  createPropertyComplianceItem,
  deletePropertyComplianceItem,
  updatePropertyComplianceItem,
} from './actions'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PropertyItemRow {
  id: string
  kind: PropertyComplianceKind
  title: string
  issue_date: string
  review_due: string | null
  notes: string | null
  evidence_path: string | null
  evidence_filename: string | null
  evidenceUrl: string | null
  document_id: string | null
  document_label: string | null
  status: 'active' | 'superseded'
}

export interface DocumentOption {
  id: string
  label: string
}

interface ComplianceItemsProps {
  clientId: string
  siteId: string
  items: PropertyItemRow[]
  documents: DocumentOption[]
  canEdit: boolean
  canDelete: boolean
}

// ─── Add / edit / replace dialog ─────────────────────────────────────────────

type DialogMode =
  | { mode: 'create' }
  | { mode: 'edit'; item: PropertyItemRow }
  | { mode: 'replace'; item: PropertyItemRow }

function ItemDialog({
  clientId,
  siteId,
  documents,
  state,
  onClose,
}: {
  clientId: string
  siteId: string
  documents: DocumentOption[]
  state: DialogMode
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const seed = state.mode === 'create' ? null : state.item

  const [kind, setKind] = useState<PropertyComplianceKind>(seed?.kind ?? 'asbestos_register')
  const [title, setTitle] = useState(seed?.title ?? '')
  const [issueDate, setIssueDate] = useState(
    state.mode === 'edit' ? (seed?.issue_date ?? '') : todayAUClient()
  )
  const [reviewDue, setReviewDue] = useState(
    state.mode === 'edit' ? (seed?.review_due ?? '') : ''
  )
  const [notes, setNotes] = useState(state.mode === 'edit' ? (seed?.notes ?? '') : '')
  const [documentId, setDocumentId] = useState(
    state.mode === 'edit' ? (seed?.document_id ?? 'none') : 'none'
  )
  const [file, setFile] = useState<File | null>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    const problem = f ? validateUploadFile(f) : null
    if (problem) {
      toast.error(problem)
      e.target.value = ''
      setFile(null)
      return
    }
    setFile(f)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      let evidence: { evidence_path: string | null; evidence_filename: string | null } = {
        evidence_path: null,
        evidence_filename: null,
      }

      const supabase = createClient()

      // Two-phase upload: storage object first, row second (documents/
      // competency pattern — a failed row insert compensates the object).
      if (file) {
        const path = buildStorageKey('property-compliance', file.name)
        const { error: storageError } = await supabase.storage
          .from('attachments')
          .upload(path, file, {
            contentType: safeContentType(file.type),
            upsert: false,
          })
        if (storageError) {
          toast.error(storageError.message)
          return
        }
        evidence = { evidence_path: path, evidence_filename: file.name }
      }

      const payload = {
        site_id: siteId,
        kind,
        title,
        issue_date: issueDate,
        review_due: reviewDue || null,
        notes,
        document_id: documentId === 'none' ? null : documentId,
        supersedes_id: state.mode === 'replace' ? state.item.id : null,
        ...evidence,
      }

      const result =
        state.mode === 'edit'
          ? await updatePropertyComplianceItem(clientId, state.item.id, payload)
          : await createPropertyComplianceItem(clientId, payload)

      if (result.error) {
        if (evidence.evidence_path) {
          await removeUploadedObject(supabase, evidence.evidence_path)
        }
        toast.error(result.error)
        return
      }

      toast.success(
        state.mode === 'replace'
          ? 'Item recorded — the previous one is superseded'
          : state.mode === 'edit'
            ? 'Item updated'
            : 'Compliance item added'
      )
      onClose()
    })
  }

  const heading =
    state.mode === 'replace'
      ? `Replace: ${state.item.title}`
      : state.mode === 'edit'
        ? 'Edit compliance item'
        : 'Add compliance item'

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {state.mode === 'replace' && (
            <p className="text-sm text-muted-foreground">
              Recording the replacement supersedes the current item — the
              portal and register will show only the new one.
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>
              Kind <span className="text-destructive">*</span>
            </Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind((v ?? 'other') as PropertyComplianceKind)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROPERTY_COMPLIANCE_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {PROPERTY_COMPLIANCE_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pci-title">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="pci-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Asbestos register — Rev 3"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pci-issue">
                Issue date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="pci-issue"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pci-review">Review due</Label>
              <Input
                id="pci-review"
                type="date"
                value={reviewDue}
                onChange={(e) => setReviewDue(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">
                Leave empty if it never expires
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pci-evidence">
              {state.mode === 'edit' && seed?.evidence_path
                ? 'Replace evidence file'
                : 'Evidence file'}
            </Label>
            <Input id="pci-evidence" type="file" onChange={handleFileChange} />
            {state.mode === 'edit' && seed?.evidence_filename && !file && (
              <span className="text-xs text-muted-foreground">
                Current: {seed.evidence_filename}
              </span>
            )}
          </div>
          {documents.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>Controlled document (optional)</Label>
              <Select value={documentId} onValueChange={(v) => setDocumentId(v ?? 'none')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {documents.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pci-notes">Notes</Label>
            <Textarea
              id="pci-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending
                ? 'Saving…'
                : state.mode === 'replace'
                  ? 'Record replacement'
                  : state.mode === 'edit'
                    ? 'Save changes'
                    : 'Add item'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Register table ──────────────────────────────────────────────────────────

export function ComplianceItems({
  clientId,
  siteId,
  items,
  documents,
  canEdit,
  canDelete,
}: ComplianceItemsProps) {
  const [dialog, setDialog] = useState<DialogMode | null>(null)
  const [pending, startTransition] = useTransition()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const today = todayAUClient()

  function handleDelete(item: PropertyItemRow) {
    if (!confirm(`Delete "${item.title}"? This cannot be undone.`)) return
    setDeletingId(item.id)
    startTransition(async () => {
      const result = await deletePropertyComplianceItem(clientId, item.id)
      setDeletingId(null)
      if (result.error) toast.error(result.error)
      else toast.success('Item deleted')
    })
  }

  const active = items.filter((i) => i.status === 'active')
  const superseded = items.filter((i) => i.status === 'superseded')

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Property compliance</h2>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setDialog({ mode: 'create' })}>
            <PlusIcon />
            Add item
          </Button>
        )}
      </div>

      {active.length === 0 && superseded.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No compliance items recorded for this property yet.
        </p>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Kind</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Review due</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead>Status</TableHead>
                {canEdit && <TableHead className="w-28" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...active, ...superseded].map((item) => (
                <TableRow
                  key={item.id}
                  className={item.status === 'superseded' ? 'opacity-60' : undefined}
                >
                  <TableCell>
                    {item.status === 'active' && (
                      <ComplianceLight
                        status={derivePropertyItemStatus(item.review_due, today)}
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {PROPERTY_COMPLIANCE_KIND_LABELS[item.kind] ?? item.kind}
                  </TableCell>
                  <TableCell className="font-medium">
                    {item.title}
                    {item.document_label && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        Doc: {item.document_label}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {fmtDate(item.issue_date)}
                  </TableCell>
                  <TableCell
                    className={`tabular-nums ${
                      item.status === 'active' && item.review_due
                        ? expiryColour(item.review_due, today)
                        : 'text-muted-foreground'
                    }`}
                  >
                    {item.review_due ? fmtDate(item.review_due) : 'No review'}
                  </TableCell>
                  <TableCell>
                    {item.evidenceUrl ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        render={
                          <a
                            href={item.evidenceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            download={item.evidence_filename ?? undefined}
                            aria-label={`Download evidence for ${item.title}`}
                          />
                        }
                      >
                        <DownloadIcon className="size-3.5" />
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={item.status} />
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      {item.status === 'active' && (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDialog({ mode: 'edit', item })}
                            aria-label={`Edit ${item.title}`}
                          >
                            <PencilIcon />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDialog({ mode: 'replace', item })}
                            aria-label={`Replace ${item.title}`}
                            title="Replace with a newer document"
                          >
                            <RefreshCwIcon />
                          </Button>
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={pending && deletingId === item.id}
                              onClick={() => handleDelete(item)}
                              aria-label={`Delete ${item.title}`}
                            >
                              <Trash2Icon className="text-destructive" />
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {dialog && (
        <ItemDialog
          clientId={clientId}
          siteId={siteId}
          documents={documents}
          state={dialog}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  )
}
