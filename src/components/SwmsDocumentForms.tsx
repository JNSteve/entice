'use client'

import React, { useState, useTransition } from 'react'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { fmtDate } from '@/lib/format'
import { createDocumentSwmsInstance, reviseDocumentSwmsInstance } from '@/lib/swms-actions'
import { isPdfFile, titleFromFilename } from '@/lib/swms-document'
import type { SwmsDocumentOption } from '@/lib/swms-queries'
import { uploadAttachmentFile } from '@/lib/upload-attachment-client'

type PdfChoice =
  | { mode: 'existing'; attachmentId: string }
  | { mode: 'upload'; file: File | null }

/** Pick an existing job/project PDF or choose a new one to upload. */
function PdfPicker({
  idPrefix,
  documents,
  excludeId,
  value,
  onChange,
}: {
  idPrefix: string
  documents: SwmsDocumentOption[]
  excludeId?: string
  value: PdfChoice
  onChange: (choice: PdfChoice, suggestedTitle: string) => void
}) {
  const options = documents.filter((d) => d.id !== excludeId)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={value.mode === 'existing' ? 'secondary' : 'outline'}
          onClick={() => onChange({ mode: 'existing', attachmentId: '' }, '')}
          disabled={options.length === 0}
        >
          From Documents
        </Button>
        <Button
          type="button"
          size="sm"
          variant={value.mode === 'upload' ? 'secondary' : 'outline'}
          onClick={() => onChange({ mode: 'upload', file: null }, '')}
        >
          Upload new PDF
        </Button>
      </div>
      {value.mode === 'existing' ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-existing`}>PDF</Label>
          <Select
            value={value.attachmentId}
            onValueChange={(v) => {
              const id = v ?? ''
              const doc = options.find((d) => d.id === id)
              onChange({ mode: 'existing', attachmentId: id }, doc ? titleFromFilename(doc.filename) : '')
            }}
          >
            <SelectTrigger id={`${idPrefix}-existing`} className="w-full">
              <SelectValue placeholder="Pick a PDF from Documents" />
            </SelectTrigger>
            <SelectContent>
              {options.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.filename} · {fmtDate(d.created_at)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-upload`}>PDF</Label>
          <Input
            id={`${idPrefix}-upload`}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null
              onChange({ mode: 'upload', file }, file ? titleFromFilename(file.name) : '')
            }}
          />
          <p className="text-xs text-muted-foreground">
            The file is also added to this page&apos;s Documents.
          </p>
        </div>
      )}
    </div>
  )
}

function initialChoice(documents: SwmsDocumentOption[], excludeId?: string): PdfChoice {
  return documents.some((d) => d.id !== excludeId)
    ? { mode: 'existing', attachmentId: '' }
    : { mode: 'upload', file: null }
}

/** Resolve the choice to an attachment id, uploading first when needed. */
async function resolveAttachmentId(
  choice: PdfChoice,
  parentType: 'project' | 'job',
  parentId: string
): Promise<{ id: string } | { error: string }> {
  if (choice.mode === 'existing') {
    return choice.attachmentId ? { id: choice.attachmentId } : { error: 'Pick a PDF' }
  }
  if (!choice.file) return { error: 'Choose a PDF to upload' }
  if (!isPdfFile(choice.file.type, choice.file.name)) {
    return { error: 'The SWMS must be a PDF' }
  }
  return uploadAttachmentFile({ parentType, parentId, file: choice.file, kind: 'document' })
}

export function AddDocumentSwmsForm({
  parentType,
  parentId,
  documents,
  onDone,
}: {
  parentType: 'project' | 'job'
  parentId: string
  documents: SwmsDocumentOption[]
  onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [choice, setChoice] = useState<PdfChoice>(() => initialChoice(documents))
  const [title, setTitle] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const att = await resolveAttachmentId(choice, parentType, parentId)
      if ('error' in att) {
        toast.error(att.error)
        return
      }
      const result = await createDocumentSwmsInstance({
        title,
        attachment_id: att.id,
        project_id: parentType === 'project' ? parentId : null,
        job_id: parentType === 'job' ? parentId : null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('SWMS issued — field staff can now sign on')
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <PdfPicker
        idPrefix="swms-doc"
        documents={documents}
        value={choice}
        onChange={(next, suggested) => {
          setChoice(next)
          if (suggested && !title.trim()) setTitle(suggested)
        }}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="swms-doc-title">Title</Label>
        <Input
          id="swms-doc-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Asbestos removal SWMS"
          required
        />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? 'Issuing…' : 'Issue SWMS'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function ReviseDocumentSwmsDialog({
  instanceId,
  parentType,
  parentId,
  documents,
  currentAttachmentId,
  disabled,
}: {
  instanceId: string
  parentType: 'project' | 'job'
  parentId: string
  documents: SwmsDocumentOption[]
  currentAttachmentId: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [choice, setChoice] = useState<PdfChoice>(() =>
    initialChoice(documents, currentAttachmentId)
  )

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const att = await resolveAttachmentId(choice, parentType, parentId)
      if ('error' in att) {
        toast.error(att.error)
        return
      }
      const result = await reviseDocumentSwmsInstance({
        instance_id: instanceId,
        attachment_id: att.id,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('SWMS revised — everyone must sign on again')
      setOpen(false)
    })
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => {
          // Fresh choice each time: the current file may have changed since.
          setChoice(initialChoice(documents, currentAttachmentId))
          setOpen(true)
        }} disabled={disabled}>
        Revise
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Revise SWMS with a new PDF</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              The version goes up and everyone who signed must sign on again. The
              current PDF stays in Documents.
            </p>
            <PdfPicker
              idPrefix={`swms-revise-${instanceId}`}
              documents={documents}
              excludeId={currentAttachmentId}
              value={choice}
              onChange={(next) => setChoice(next)}
            />
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? 'Revising…' : 'Revise SWMS'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
