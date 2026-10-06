'use client'

import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { DownloadIcon, LockIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  buildStorageKey,
  removeUploadedObject,
  safeContentType,
  validateUploadFile,
} from '@/lib/storage-keys'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { RECORD_FOLDERS, type RecordFolder } from '@/lib/zod'
import { createRecord, deleteDocument } from './actions'

export interface RecordRow {
  id: string
  title: string
  /** e.g. CAR-2026-05, ECRQ01-02, IA-2026-01. */
  reference: string | null
  folder: string | null
  /** The record's own date (Brisbane calendar date). */
  dated: string | null
  filename: string | null
  /** Signed URL (1h), generated server-side. */
  file_url: string | null
  restricted: boolean
}

function titleFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim()
}

// ─── File a record ────────────────────────────────────────────────────────────

function RecordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pending, startTransition] = useTransition()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [reference, setReference] = useState('')
  const [folder, setFolder] = useState<RecordFolder>('Management review')
  const [dated, setDated] = useState('')

  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setFile(null)
      setTitle('')
      setReference('')
      setFolder('Management review')
      setDated('')
    }
  }

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
    if (f && !title.trim()) setTitle(titleFromFilename(f.name))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    startTransition(async () => {
      const supabase = createClient()
      const path = buildStorageKey('documents', file.name)
      const { error: storageError } = await supabase.storage
        .from('attachments')
        .upload(path, file, { contentType: safeContentType(file.type), upsert: false })
      if (storageError) {
        toast.error(storageError.message)
        return
      }

      const result = await createRecord({
        title: title.trim(),
        reference,
        folder,
        dated,
        file_path: path,
        filename: file.name,
        content_type: safeContentType(file.type),
        size: file.size,
      })
      if (result.error) {
        await removeUploadedObject(supabase, path)
        toast.error(result.error)
        return
      }
      toast.success('Record filed')
      onClose()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>File a record</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Minutes, audit checklists and reports, CARs, certificates, inductions and
            insurance. A record is filed as it is and is not edited afterwards.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rec-file">File (max 25 MB)</Label>
            <Input id="rec-file" type="file" onChange={handleFileChange} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rec-title">Title</Label>
            <Input
              id="rec-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Management Review Minutes"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Folder</Label>
              <Select value={folder} onValueChange={(v) => setFolder((v as RecordFolder) ?? 'Other')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECORD_FOLDERS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rec-dated">Dated</Label>
              <Input
                id="rec-dated"
                type="date"
                value={dated}
                onChange={(e) => setDated(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rec-ref">Reference (optional)</Label>
            <Input
              id="rec-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. CAR-2026-05, IA-2026-01, ECRQ01-02"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !file || !title.trim() || !dated}>
              {pending ? 'Filing…' : 'File record'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Records register ─────────────────────────────────────────────────────────

export function RecordsSection({
  records,
  canManage,
  isAdmin,
}: {
  records: RecordRow[]
  canManage: boolean
  isAdmin: boolean
}) {
  const [open, setOpen] = useState(false)
  const [folderFilter, setFolderFilter] = useState<'all' | string>('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const folders = useMemo(
    () => RECORD_FOLDERS.filter((f) => records.some((r) => r.folder === f)),
    [records]
  )
  const shown = useMemo(
    () =>
      records
        .filter((r) => folderFilter === 'all' || r.folder === folderFilter)
        .sort(
          (a, b) =>
            (a.folder ?? '').localeCompare(b.folder ?? '') ||
            (b.dated ?? '').localeCompare(a.dated ?? '') ||
            a.title.localeCompare(b.title)
        ),
    [records, folderFilter]
  )

  function handleDelete(row: RecordRow) {
    if (!confirm(`Delete the record "${row.title}"? The file is removed from storage. This cannot be undone.`))
      return
    setBusyId(row.id)
    startTransition(async () => {
      const result = await deleteDocument(row.id)
      setBusyId(null)
      if (result.error) toast.error(result.error)
      else toast.success('Record deleted')
    })
  }

  return (
    <section className="flex flex-col gap-3 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold">Records</h2>
          <p className="text-sm text-muted-foreground">
            6. Records — evidence the system ran: review minutes, audit reports, CARs,
            certificates, inductions and insurance. Filed, not revised.
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <UploadIcon className="size-4" />
            File a record
          </Button>
        )}
      </div>

      {folders.length > 1 && (
        <div className="flex gap-1 overflow-x-auto">
          {(['all', ...folders] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFolderFilter(f)}
              className={cn(
                'whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors',
                folderFilter === f ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {f === 'all' ? 'All folders' : f}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="rounded-lg border px-4 py-6 text-center text-sm text-muted-foreground">
          No records filed yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Folder</TableHead>
                <TableHead>Record</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Dated</TableHead>
                <TableHead className="text-right">File</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {r.folder ?? '—'}
                  </TableCell>
                  <TableCell className="max-w-[320px]">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium" title={r.title}>
                        {r.title}
                      </span>
                      {r.restricted && (
                        <span className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                          <LockIcon className="size-3 shrink-0" />
                          Directors only
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {r.reference ?? '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm tabular-nums">
                    {r.dated ? fmtDate(r.dated) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {r.file_url && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title={`Open ${r.filename}`}
                          render={
                            <a
                              href={r.file_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open ${r.filename}`}
                            />
                          }
                        >
                          <DownloadIcon className="size-3.5" />
                        </Button>
                      )}
                      {isAdmin && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title="Delete"
                          className="text-destructive hover:text-destructive"
                          disabled={busyId === r.id}
                          onClick={() => handleDelete(r)}
                        >
                          <Trash2Icon className="size-3.5" />
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

      <RecordDialog open={open} onClose={() => setOpen(false)} />
    </section>
  )
}
