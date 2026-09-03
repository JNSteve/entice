'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { EmptyState } from '@/components/EmptyState'
import { DocBlocksEditor } from '@/components/DocBlocksEditor'
import { createClient } from '@/lib/supabase/client'
import { buildStorageKey, removeUploadedObject } from '@/lib/storage-keys'
import {
  DEFAULT_PRICING,
  MAX_TEMPLATE_PDF_BYTES,
  PRICING_MODES,
  PRICING_MODE_LABELS,
  starterDoc,
  type PricingDisplay,
  type QuoteTemplateInput,
  type QuoteTemplateRow,
} from '@/lib/quote-doc'
import { fmtDate } from '@/lib/format'
import { ActiveBadge, ToggleActiveButton } from './users-section'
import {
  createQuoteTemplate,
  importQuoteTemplate,
  quoteTemplateOriginalUrl,
  setDefaultQuoteTemplate,
  setQuoteTemplateActive,
  updateQuoteTemplate,
} from './actions'
import { FileTextIcon, PencilIcon, PlusIcon, StarIcon, UploadIcon } from 'lucide-react'

type Draft = QuoteTemplateInput & { id?: string }

export function QuoteTemplatesSection({
  templates,
  importEnabled,
}: {
  templates: QuoteTemplateRow[]
  importEnabled: boolean
}) {
  const [editing, setEditing] = useState<{
    draft: Draft
    notes: string[]
    uploadPath: string | null
  } | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)

  function startBlank() {
    setEditing({
      draft: { ...starterDoc(), name: '', pricing_defaults: DEFAULT_PRICING },
      notes: [],
      uploadPath: null,
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Templates shape the quote PDF: headings, boilerplate text and how pricing is
          shown. Cost and markup never print.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={startBlank}>
            <PlusIcon />
            New template
          </Button>
          <Button
            onClick={() => setUploadOpen(true)}
            disabled={!importEnabled}
            title={importEnabled ? undefined : 'Add OPENAI_API_KEY to enable PDF import'}
          >
            <UploadIcon />
            Upload template
          </Button>
        </div>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={<FileTextIcon className="size-8" />}
          title="No quote templates yet"
          description="Upload an existing quote PDF or start from the standard structure."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Heading</TableHead>
              <TableHead>Pricing</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">
                  {t.name}
                  {t.is_default && (
                    <Badge variant="secondary" className="ml-2 font-normal">
                      Default
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{t.heading ?? '—'}</TableCell>
                <TableCell>{PRICING_MODE_LABELS[t.pricing_defaults.mode]}</TableCell>
                <TableCell>
                  <ActiveBadge active={t.active} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {fmtDate(t.updated_at)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {t.source_path && <ViewOriginalButton id={t.id} />}
                    {!t.is_default && t.active && <SetDefaultButton id={t.id} />}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Edit"
                      onClick={() =>
                        setEditing({ draft: { ...t }, notes: [], uploadPath: null })
                      }
                    >
                      <PencilIcon />
                      <span className="sr-only">Edit</span>
                    </Button>
                    <ToggleActiveButton
                      active={t.active}
                      label={t.name}
                      onToggle={(active) => setQuoteTemplateActive(t.id, active)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onDraft={(draft, notes, uploadPath) => {
          setUploadOpen(false)
          setEditing({ draft, notes, uploadPath })
        }}
      />

      {editing && (
        <TemplateEditorDialog
          initial={editing.draft}
          notes={editing.notes}
          uploadPath={editing.uploadPath}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

/** Pending-guarded so a double click cannot race the server's two-step default swap. */
function SetDefaultButton({ id }: { id: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title="Set as default"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await setDefaultQuoteTemplate(id)
          if (r.error) {
            toast.error(r.error)
            return
          }
          toast.success('Default template set')
          router.refresh()
        })
      }
    >
      <StarIcon />
      <span className="sr-only">Set as default</span>
    </Button>
  )
}

function ViewOriginalButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={pending}
      title="View original PDF"
      onClick={() =>
        startTransition(async () => {
          const r = await quoteTemplateOriginalUrl(id)
          if (r.url) window.open(r.url, '_blank', 'noopener')
          else toast.error(r.error ?? 'Unavailable')
        })
      }
    >
      <FileTextIcon />
      <span className="sr-only">View original</span>
    </Button>
  )
}

// ─── Upload / import ─────────────────────────────────────────────────────────

function UploadDialog({
  open,
  onClose,
  onDraft,
}: {
  open: boolean
  onClose: () => void
  onDraft: (draft: QuoteTemplateInput, notes: string[], uploadPath: string) => void
}) {
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) {
      toast.error('Choose a PDF')
      return
    }
    if (file.size === 0) {
      toast.error('That file is empty')
      return
    }
    if (file.size > MAX_TEMPLATE_PDF_BYTES) {
      toast.error('PDF must be under 20 MB')
      return
    }

    startTransition(async () => {
      const supabase = createClient()
      const path = buildStorageKey('quote-templates', file.name)
      const { error: upErr } = await supabase.storage
        .from('attachments')
        .upload(path, file, { contentType: 'application/pdf', upsert: false })
      if (upErr) {
        toast.error(upErr.message)
        return
      }

      let result: Awaited<ReturnType<typeof importQuoteTemplate>>
      try {
        result = await importQuoteTemplate({
          path,
          filename: file.name,
          name: name.trim(),
        })
      } catch (err) {
        await removeUploadedObject(supabase, path)
        toast.error(err instanceof Error ? err.message : 'Import failed')
        return
      }
      if (result.error || !result.draft) {
        await removeUploadedObject(supabase, path)
        toast.error(result.error ?? 'Import failed')
        return
      }
      toast.success('Template read. Check it, then save.')
      setName('')
      setFile(null)
      onDraft(result.draft, result.notes ?? [], path)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o || pending) return
        setName('')
        setFile(null)
        onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload template</DialogTitle>
          <DialogDescription>
            Pick an existing quote PDF. The app reads it into sections and swaps job
            details for merge fields; you review before saving. Reading takes 30 to 90
            seconds.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qt-name">Template name</Label>
            <Input
              id="qt-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Asbestos inspection"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qt-file">Quote PDF</Label>
            <Input
              id="qt-file"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !file || !name.trim()}>
              {pending ? 'Reading PDF…' : 'Read PDF'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Editor ──────────────────────────────────────────────────────────────────

function TemplateEditorDialog({
  initial,
  notes,
  uploadPath,
  onClose,
}: {
  initial: Draft
  notes: string[]
  uploadPath: string | null
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [draft, setDraft] = useState<Draft>(initial)
  const isNew = !initial.id

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }))
  }
  function patchPricing(p: Partial<PricingDisplay>) {
    setDraft((d) => ({ ...d, pricing_defaults: { ...d.pricing_defaults, ...p } }))
  }

  async function cancel() {
    // An imported-but-unsaved upload is removed so nothing orphans in storage.
    if (isNew && uploadPath) await removeUploadedObject(createClient(), uploadPath)
    onClose()
  }

  function save() {
    startTransition(async () => {
      const { id, ...payload } = draft
      const result = id
        ? await updateQuoteTemplate(id, payload)
        : await createQuoteTemplate(payload)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(id ? 'Template updated' : 'Template saved')
      onClose()
      router.refresh()
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && void cancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isNew ? 'New quote template' : `Edit ${initial.name}`}</DialogTitle>
          {notes.length > 0 && (
            <DialogDescription>
              Check these before saving: {notes.join(' · ')}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qte-name">Name</Label>
            <Input
              id="qte-name"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qte-title">Document title</Label>
            <Input
              id="qte-title"
              value={draft.doc_title}
              onChange={(e) => patch({ doc_title: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="qte-heading">Service heading (optional)</Label>
            <Input
              id="qte-heading"
              value={draft.heading ?? ''}
              onChange={(e) => patch({ heading: e.target.value || null })}
              placeholder="Asbestos Inspection, Sampling and Close-out"
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="qte-validity">Validity text</Label>
            <Input
              id="qte-validity"
              value={draft.validity_text}
              onChange={(e) => patch({ validity_text: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qte-mode">Default pricing display</Label>
            <Select
              value={draft.pricing_defaults.mode}
              onValueChange={(v) => v && patchPricing({ mode: v as PricingDisplay['mode'] })}
            >
              <SelectTrigger id="qte-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRICING_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {PRICING_MODE_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qte-fee">Fee label (lump sum)</Label>
            <Input
              id="qte-fee"
              value={draft.pricing_defaults.fee_label}
              onChange={(e) => patchPricing({ fee_label: e.target.value })}
            />
          </div>
          <div className="flex flex-wrap gap-4 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={draft.pricing_defaults.show_qty_unit}
                onCheckedChange={(c) => patchPricing({ show_qty_unit: Boolean(c) })}
              />
              Show qty and unit columns
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={draft.pricing_defaults.list_items}
                onCheckedChange={(c) => patchPricing({ list_items: Boolean(c) })}
              />
              List included items under a lump sum
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={draft.pricing_defaults.show_gst}
                onCheckedChange={(c) => patchPricing({ show_gst: Boolean(c) })}
              />
              Show GST breakdown
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={draft.number_headings}
                onCheckedChange={(c) => patch({ number_headings: Boolean(c) })}
              />
              Number the headings
            </label>
          </div>
        </div>

        <h3 className="mt-2 text-sm font-semibold">Sections</h3>
        <DocBlocksEditor value={draft.blocks} onChange={(blocks) => patch({ blocks })} />

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => void cancel()}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={pending || !draft.name.trim()}>
            {pending ? 'Saving…' : 'Save template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
