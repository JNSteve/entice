'use client'

import React, { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { format, parseISO, differenceInCalendarDays } from 'date-fns'
import {
  ArchiveIcon,
  CornerDownRightIcon,
  DownloadIcon,
  FileTextIcon,
  FolderOpenIcon,
  HistoryIcon,
  PencilIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { AuditHistory } from '@/components/AuditHistory'
import type { AuditRow } from '@/lib/audit-queries'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { downloadCsv } from '@/lib/csv'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  WHS_DOC_CATEGORIES,
  WHS_DOC_CATEGORY_LABELS,
  type WhsDocCategory,
  type WhsDocStatus,
} from '@/lib/zod'
import {
  archiveWhsDocument,
  createWhsDocument,
  deleteWhsDocument,
  updateWhsDocument,
} from './actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WhsDocumentRow {
  id: string
  title: string
  category: WhsDocCategory
  doc_number: string | null
  version: string
  status: WhsDocStatus
  supersedes_id: string | null
  file_path: string
  filename: string
  review_due: string | null
  notes: string | null
  created_at: string
  uploaded_by_name: string | null
  /** Signed URL for the file (1h), generated server-side. */
  file_url: string | null
}

// ─── Category config ──────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<WhsDocCategory, string> = {
  policy: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300',
  procedure: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300',
  plan: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300',
  sds: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  register: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300',
  form: 'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950 dark:text-pink-300',
  other: 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300',
}

function CategoryBadge({ category }: { category: WhsDocCategory }) {
  return (
    <Badge variant="outline" className={`border font-medium ${CATEGORY_COLORS[category]}`}>
      {WHS_DOC_CATEGORY_LABELS[category]}
    </Badge>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MAX_SIZE = 25 * 1024 * 1024 // 25 MB

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/** "report.pdf" → "report"; cleans common separators for a title default. */
function titleFromFilename(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
}

/**
 * Suggest the next version: trailing letter increments ('Rev A' → 'Rev B',
 * 'A' → 'B'), trailing number increments ('Rev 1' → 'Rev 2', 'v2' → 'v3').
 * Anything else comes back unchanged for free-text editing.
 */
export function suggestNextVersion(version: string): string {
  const v = version.trim()
  const letter = v.match(/^(.*?)([A-Y])$/)
  if (letter) {
    return letter[1] + String.fromCharCode(letter[2].charCodeAt(0) + 1)
  }
  const num = v.match(/^(.*?)(\d+)$/)
  if (num) {
    return num[1] + String(Number(num[2]) + 1)
  }
  return v
}

/** Review due rendering: red overdue / amber ≤30 days, current docs only. */
function ReviewDueCell({ row }: { row: WhsDocumentRow }) {
  if (!row.review_due) {
    return <span className="text-sm text-muted-foreground">—</span>
  }
  const days = differenceInCalendarDays(parseISO(row.review_due), new Date())
  const highlight =
    row.status === 'current'
      ? days < 0
        ? 'font-medium text-red-600 dark:text-red-400'
        : days <= 30
          ? 'font-medium text-amber-600 dark:text-amber-400'
          : ''
      : ''
  return (
    <span className={cn('whitespace-nowrap text-sm tabular-nums', highlight)}>
      {fmtDate(row.review_due)}
      {row.status === 'current' && days < 0 && (
        <span className="block text-xs">{Math.abs(days)}d overdue</span>
      )}
    </span>
  )
}

// ─── Upload / new-version dialog ──────────────────────────────────────────────

function DocumentDialog({
  open,
  supersedes,
  onClose,
}: {
  open: boolean
  /** When set, this is a "new version" of the given document. */
  supersedes: WhsDocumentRow | null
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<WhsDocCategory>('other')
  const [docNumber, setDocNumber] = useState('')
  const [version, setVersion] = useState('Rev A')
  const [reviewDue, setReviewDue] = useState('')
  const [notes, setNotes] = useState('')

  // Re-seed when the dialog opens (and per target row for "new version").
  const [seedKey, setSeedKey] = useState<string | null>(null)
  const key = open ? (supersedes?.id ?? '__new') : null
  if (key !== seedKey) {
    setSeedKey(key)
    if (key !== null) {
      setFile(null)
      setTitle(supersedes?.title ?? '')
      setCategory(supersedes?.category ?? 'other')
      setDocNumber(supersedes?.doc_number ?? '')
      setVersion(supersedes ? suggestNextVersion(supersedes.version) : 'Rev A')
      setReviewDue('')
      setNotes('')
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    if (f && f.size > MAX_SIZE) {
      toast.error(`${f.name} exceeds the 25 MB limit`)
      e.target.value = ''
      setFile(null)
      return
    }
    setFile(f)
    if (f && !title.trim()) setTitle(titleFromFilename(f.name))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) {
      toast.error('Choose a file to upload')
      return
    }
    startTransition(async () => {
      const path = `whs-documents/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`
      const supabase = createClient()

      const { error: storageError } = await supabase.storage
        .from('attachments')
        .upload(path, file, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        })
      if (storageError) {
        toast.error(storageError.message)
        return
      }

      const result = await createWhsDocument({
        title: title.trim(),
        category,
        doc_number: docNumber,
        version,
        file_path: path,
        filename: file.name,
        content_type: file.type || 'application/octet-stream',
        size: file.size,
        review_due: reviewDue,
        notes,
        supersedes_id: supersedes?.id ?? null,
      })

      if (result.error) {
        // Row failed — clean up the storage object best-effort.
        await supabase.storage.from('attachments').remove([path])
        toast.error(result.error)
        return
      }

      toast.success(supersedes ? 'New version published' : 'Document added')
      onClose()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {supersedes ? `New version — ${supersedes.title}` : 'Add document'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {supersedes && (
            <p className="text-sm text-muted-foreground">
              {supersedes.version} will be marked superseded and kept for the
              record.
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="whs-doc-file">File (max 25 MB)</Label>
            <Input id="whs-doc-file" type="file" onChange={handleFileChange} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="whs-doc-title">Title</Label>
            <Input
              id="whs-doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. WHS Management Plan"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Category</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory((v as WhsDocCategory) ?? 'other')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WHS_DOC_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {WHS_DOC_CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="whs-doc-number">Doc number</Label>
              <Input
                id="whs-doc-number"
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
                placeholder="e.g. WHS-PLN-001"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="whs-doc-version">Version</Label>
              <Input
                id="whs-doc-version"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="whs-doc-review">Review due (optional)</Label>
              <Input
                id="whs-doc-review"
                type="date"
                value={reviewDue}
                onChange={(e) => setReviewDue(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="whs-doc-notes">Notes (optional)</Label>
            <Textarea
              id="whs-doc-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !file || !title.trim() || !version.trim()}>
              {pending ? 'Uploading…' : supersedes ? 'Publish new version' : 'Add document'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Edit metadata dialog ─────────────────────────────────────────────────────

function EditDocumentDialog({
  row,
  onClose,
}: {
  row: WhsDocumentRow | null
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<WhsDocCategory>('other')
  const [docNumber, setDocNumber] = useState('')
  const [version, setVersion] = useState('')
  const [reviewDue, setReviewDue] = useState('')
  const [notes, setNotes] = useState('')

  const [seedId, setSeedId] = useState<string | null>(null)
  if (row && row.id !== seedId) {
    setSeedId(row.id)
    setTitle(row.title)
    setCategory(row.category)
    setDocNumber(row.doc_number ?? '')
    setVersion(row.version)
    setReviewDue(row.review_due ?? '')
    setNotes(row.notes ?? '')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!row) return
    startTransition(async () => {
      const result = await updateWhsDocument(row.id, {
        title: title.trim(),
        category,
        doc_number: docNumber,
        version,
        review_due: reviewDue,
        notes,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Document updated')
      onClose()
    })
  }

  return (
    <Dialog open={Boolean(row)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit document</DialogTitle>
        </DialogHeader>
        {row && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="whs-edit-title">Title</Label>
              <Input
                id="whs-edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Category</Label>
                <Select
                  value={category}
                  onValueChange={(v) => setCategory((v as WhsDocCategory) ?? 'other')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WHS_DOC_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {WHS_DOC_CATEGORY_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="whs-edit-number">Doc number</Label>
                <Input
                  id="whs-edit-number"
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="whs-edit-version">Version</Label>
                <Input
                  id="whs-edit-version"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="whs-edit-review">Review due</Label>
                <Input
                  id="whs-edit-review"
                  type="date"
                  value={reviewDue}
                  onChange={(e) => setReviewDue(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="whs-edit-notes">Notes</Label>
              <Textarea
                id="whs-edit-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending || !title.trim() || !version.trim()}
              >
                {pending ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── History dialog ───────────────────────────────────────────────────────────

function DocumentHistoryDialog({
  rowId,
  onClose,
}: {
  rowId: string | null
  onClose: () => void
}) {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(false)

  React.useEffect(() => {
    if (!rowId) return
    async function fetchHistory() {
      setLoading(true)
      const supabase = createClient()
      const { data } = await supabase
        .from('audit_log')
        .select('id, at, actor_id, actor_name, entity_type, entity_id, project_id, action, detail')
        .eq('entity_type', 'whs_documents')
        .eq('entity_id', rowId!)
        .order('at', { ascending: false })
        .limit(100)
      setRows(
        (data ?? []).map((r) => ({
          id: r.id as string,
          at: r.at as string,
          actor_id: (r.actor_id as string | null) ?? null,
          actor_name: (r.actor_name as string | null) ?? null,
          entity_type: r.entity_type as string,
          entity_id: r.entity_id as string,
          project_id: (r.project_id as string | null) ?? null,
          action: r.action as string,
          detail: (r.detail ?? {}) as Record<string, unknown>,
        }))
      )
      setLoading(false)
    }
    void fetchHistory()
  }, [rowId])

  return (
    <Dialog open={Boolean(rowId)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Document History</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground py-4">Loading…</p>
        ) : (
          <AuditHistory rows={rows} />
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Main table ───────────────────────────────────────────────────────────────

interface DocumentsTableProps {
  rows: WhsDocumentRow[]
  /** Upload / version / edit / archive are admin+office. */
  canManage: boolean
  /** Delete is admin only. */
  isAdmin: boolean
}

type DisplayRow = { row: WhsDocumentRow; depth: number }

export function DocumentsTable({ rows, canManage, isAdmin }: DocumentsTableProps) {
  const [categoryFilter, setCategoryFilter] = useState<'all' | WhsDocCategory>('all')
  const [search, setSearch] = useState('')
  const [showSuperseded, setShowSuperseded] = useState(false)

  const [uploadOpen, setUploadOpen] = useState(false)
  const [versionRow, setVersionRow] = useState<WhsDocumentRow | null>(null)
  const [editRow, setEditRow] = useState<WhsDocumentRow | null>(null)
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])
  // A superseded row is "attached" when its successor still exists.
  const attachedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const r of rows) {
      if (r.supersedes_id && byId.has(r.supersedes_id)) ids.add(r.supersedes_id)
    }
    return ids
  }, [rows, byId])

  function matches(row: WhsDocumentRow): boolean {
    if (categoryFilter !== 'all' && row.category !== categoryFilter) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (
      row.title.toLowerCase().includes(q) ||
      (row.doc_number ?? '').toLowerCase().includes(q)
    )
  }

  const display: DisplayRow[] = useMemo(() => {
    const categoryIndex = (c: WhsDocCategory) => WHS_DOC_CATEGORIES.indexOf(c)
    // Top level: current/archived docs, plus orphaned superseded rows (their
    // successor was deleted) when the toggle is on.
    const topLevel = rows
      .filter((r) =>
        r.status !== 'superseded' ? true : showSuperseded && !attachedIds.has(r.id)
      )
      .filter(matches)
      .sort(
        (a, b) =>
          categoryIndex(a.category) - categoryIndex(b.category) ||
          a.title.localeCompare(b.title) ||
          b.created_at.localeCompare(a.created_at)
      )

    const out: DisplayRow[] = []
    for (const top of topLevel) {
      out.push({ row: top, depth: 0 })
      if (!showSuperseded) continue
      // Walk the supersedes chain: direct predecessor first.
      let prevId = top.supersedes_id
      let depth = 1
      const seen = new Set<string>([top.id])
      while (prevId && !seen.has(prevId)) {
        const prev = byId.get(prevId)
        if (!prev) break
        seen.add(prev.id)
        out.push({ row: prev, depth })
        prevId = prev.supersedes_id
        depth += 1
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, byId, attachedIds, categoryFilter, search, showSuperseded])

  const chipCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of rows) {
      if (r.status === 'superseded') continue
      counts.set(r.category, (counts.get(r.category) ?? 0) + 1)
      counts.set('all', (counts.get('all') ?? 0) + 1)
    }
    return counts
  }, [rows])

  function handleArchive(row: WhsDocumentRow) {
    if (!confirm(`Archive "${row.title}" (${row.version})? It stays on the register but leaves the field app.`)) return
    setBusyId(row.id)
    startTransition(async () => {
      const result = await archiveWhsDocument(row.id)
      setBusyId(null)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Document archived')
    })
  }

  function handleDelete(row: WhsDocumentRow) {
    if (!confirm(`Delete "${row.title}" (${row.version})? The file is removed from storage. This cannot be undone.`)) return
    setBusyId(row.id)
    startTransition(async () => {
      const result = await deleteWhsDocument(row.id)
      setBusyId(null)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Document deleted')
    })
  }

  function handleCsvExport() {
    downloadCsv(
      'whs-documents.csv',
      display.map(({ row }) => ({
        doc_number: row.doc_number ?? '',
        title: row.title,
        category: WHS_DOC_CATEGORY_LABELS[row.category],
        version: row.version,
        status: row.status,
        review_due: row.review_due ? fmtDate(row.review_due) : '',
        uploaded: format(parseISO(row.created_at), 'dd/MM/yyyy'),
      }))
    )
  }

  const filtersActive = categoryFilter !== 'all' || search.trim() !== ''

  return (
    <div className="flex flex-col gap-4">
      {/* Category chips + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto">
          {(['all', ...WHS_DOC_CATEGORIES] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategoryFilter(c)}
              className={cn(
                'whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors',
                categoryFilter === c
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {c === 'all' ? 'All' : WHS_DOC_CATEGORY_LABELS[c]}{' '}
              <span className="text-xs opacity-70">{chipCounts.get(c) ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCsvExport}
            disabled={display.length === 0}
          >
            <DownloadIcon className="size-4" />
            CSV
          </Button>
          {canManage && (
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <UploadIcon className="size-4" />
              Add document
            </Button>
          )}
        </div>
      </div>

      {/* Search + superseded toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title or doc number"
          className="w-64"
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={showSuperseded}
            onCheckedChange={(checked) => setShowSuperseded(checked === true)}
          />
          Show superseded versions
        </label>
      </div>

      {display.length === 0 ? (
        <EmptyState
          icon={<FolderOpenIcon className="size-8" />}
          title="No documents"
          description={
            filtersActive
              ? 'No documents match the current filter.'
              : 'Upload WHS policies, procedures, plans, SDS and blank forms to build the controlled document library.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Doc #</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Review due</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {display.map(({ row, depth }) => {
                const muted = row.status !== 'current'
                return (
                  <TableRow key={row.id} className={muted ? 'text-muted-foreground' : undefined}>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums">
                      {row.doc_number ?? '—'}
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <div
                        className={cn('flex items-start gap-1.5', depth > 0 && 'pl-5')}
                        style={depth > 1 ? { paddingLeft: `${depth * 1.25}rem` } : undefined}
                      >
                        {depth > 0 && (
                          <CornerDownRightIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <div className="flex min-w-0 flex-col">
                          <span
                            className={cn('truncate text-sm', !muted && 'font-medium')}
                            title={row.notes ? `${row.title}\n${row.notes}` : row.title}
                          >
                            {row.title}
                          </span>
                          <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                            <FileTextIcon className="size-3 shrink-0" />
                            <span className="truncate">{row.filename}</span>
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <CategoryBadge category={row.category} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{row.version}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      <ReviewDueCell row={row} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-sm">{row.uploaded_by_name ?? '—'}</span>
                        <span className="text-xs text-muted-foreground">
                          {format(parseISO(row.created_at), 'dd/MM/yyyy')}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title="History"
                          onClick={() => setHistoryId(row.id)}
                        >
                          <HistoryIcon className="size-3.5" />
                        </Button>
                        {row.file_url && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            title={`Download ${row.filename}`}
                            render={
                              <a
                                href={row.file_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Download ${row.filename}`}
                              />
                            }
                          >
                            <DownloadIcon className="size-3.5" />
                          </Button>
                        )}
                        {canManage && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            title="Edit metadata"
                            onClick={() => setEditRow(row)}
                          >
                            <PencilIcon className="size-3.5" />
                          </Button>
                        )}
                        {canManage && row.status === 'current' && (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setVersionRow(row)}
                            >
                              New version
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              title="Archive"
                              disabled={busyId === row.id}
                              onClick={() => handleArchive(row)}
                            >
                              <ArchiveIcon className="size-3.5" />
                            </Button>
                          </>
                        )}
                        {isAdmin && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            title="Delete"
                            className="text-destructive hover:text-destructive"
                            disabled={busyId === row.id}
                            onClick={() => handleDelete(row)}
                          >
                            <Trash2Icon className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <DocumentDialog
        open={uploadOpen || Boolean(versionRow)}
        supersedes={versionRow}
        onClose={() => {
          setUploadOpen(false)
          setVersionRow(null)
        }}
      />
      <EditDocumentDialog row={editRow} onClose={() => setEditRow(null)} />
      <DocumentHistoryDialog rowId={historyId} onClose={() => setHistoryId(null)} />
    </div>
  )
}
