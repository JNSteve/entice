'use client'

import React, { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { format, parseISO, differenceInCalendarDays } from 'date-fns'
import {
  ArchiveIcon,
  CheckCircle2Icon,
  CornerDownRightIcon,
  DownloadIcon,
  FileTextIcon,
  FolderOpenIcon,
  HistoryIcon,
  PencilIcon,
  SendIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { AuditHistory } from '@/components/AuditHistory'
import type { AuditRow } from '@/lib/audit-queries'
import type { AckRegisterRow } from '@/lib/document-queries'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { downloadCsv } from '@/lib/csv'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  DOC_CATEGORIES,
  DOC_CATEGORY_LABELS,
  DOC_SYSTEMS,
  DOC_SYSTEM_LABELS,
  DOC_LIFECYCLE,
  type DocCategory,
  type DocSystem,
  type DocStatus,
} from '@/lib/zod'
import {
  acknowledgeDocument,
  approveDocument,
  archiveDocument,
  attachDocumentFile,
  createDocument,
  deleteDocument,
  issueDocument,
  submitForReview,
  supersedeDocument,
  updateDocument,
} from './actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DocumentRow {
  id: string
  title: string
  category: DocCategory
  system: DocSystem
  doc_number: string | null
  version: string
  versionOrdinal: number
  status: DocStatus
  supersedes_id: string | null
  file_path: string | null
  filename: string | null
  review_due: string | null
  notes: string | null
  approved_at: string | null
  issued_at: string | null
  created_at: string
  uploaded_by_name: string | null
  approved_by_name: string | null
  /** Signed URL for the file (1h), generated server-side. Null when no file. */
  file_url: string | null
  /** Acknowledgement register (issued docs only); null otherwise. */
  register: AckRegisterRow[] | null
  /** When I (the viewer) acknowledged the current version, or null. */
  myAcknowledgedAt: string | null
}

// ─── Category / system config ─────────────────────────────────────────────────

const CATEGORY_COLORS: Record<DocCategory, string> = {
  policy: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300',
  procedure: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300',
  work_instruction: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300',
  form: 'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950 dark:text-pink-300',
  register: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300',
  plan: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300',
  sds: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
  external: 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-300',
  other: 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300',
}

function CategoryBadge({ category }: { category: DocCategory }) {
  return (
    <Badge variant="outline" className={`border font-medium ${CATEGORY_COLORS[category]}`}>
      {DOC_CATEGORY_LABELS[category]}
    </Badge>
  )
}

function SystemBadge({ system }: { system: DocSystem }) {
  return (
    <Badge variant="secondary" className="font-medium uppercase">
      {DOC_SYSTEM_LABELS[system]}
    </Badge>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MAX_SIZE = 25 * 1024 * 1024 // 25 MB

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function titleFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
}

export function suggestNextVersion(version: string): string {
  const v = version.trim()
  const letter = v.match(/^(.*?)([A-Y])$/)
  if (letter) return letter[1] + String.fromCharCode(letter[2].charCodeAt(0) + 1)
  const num = v.match(/^(.*?)(\d+)$/)
  if (num) return num[1] + String(Number(num[2]) + 1)
  return v
}

/** Review due rendering: red overdue / amber ≤30 days, issued docs only. */
function ReviewDueCell({ row }: { row: DocumentRow }) {
  if (!row.review_due) return <span className="text-sm text-muted-foreground">—</span>
  const days = differenceInCalendarDays(parseISO(row.review_due), new Date())
  const highlight =
    row.status === 'issued'
      ? days < 0
        ? 'font-medium text-red-600 dark:text-red-400'
        : days <= 30
          ? 'font-medium text-amber-600 dark:text-amber-400'
          : ''
      : ''
  return (
    <span className={cn('whitespace-nowrap text-sm tabular-nums', highlight)}>
      {fmtDate(row.review_due)}
      {row.status === 'issued' && days < 0 && (
        <span className="block text-xs">{Math.abs(days)}d overdue</span>
      )}
    </span>
  )
}

/** Linear lifecycle stepper draft → in_review → approved → issued. */
function LifecycleStepper({ status }: { status: DocStatus }) {
  // Terminal off-ramps don't sit on the linear track.
  if (status === 'superseded' || status === 'archived') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <StatusBadge status={status} />
        <span>— no longer in force</span>
      </div>
    )
  }
  const currentIdx = DOC_LIFECYCLE.indexOf(status)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {DOC_LIFECYCLE.map((step, i) => {
        const done = i < currentIdx
        const active = i === currentIdx
        return (
          <React.Fragment key={step}>
            <span
              className={cn(
                'rounded-md px-2 py-0.5 text-xs font-medium',
                active
                  ? 'bg-foreground text-background'
                  : done
                    ? 'bg-muted text-foreground'
                    : 'bg-muted/40 text-muted-foreground'
              )}
            >
              {step === 'in_review' ? 'In Review' : step.charAt(0).toUpperCase() + step.slice(1)}
            </span>
            {i < DOC_LIFECYCLE.length - 1 && (
              <span className="text-muted-foreground">→</span>
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ─── Upload / new-version dialog ──────────────────────────────────────────────

function DocumentDialog({
  open,
  supersedes,
  onClose,
}: {
  open: boolean
  supersedes: DocumentRow | null
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<DocCategory>('other')
  const [system, setSystem] = useState<DocSystem>('integrated')
  const [docNumber, setDocNumber] = useState('')
  const [version, setVersion] = useState('Rev A')
  const [reviewDue, setReviewDue] = useState('')
  const [notes, setNotes] = useState('')

  const [seedKey, setSeedKey] = useState<string | null>(null)
  const key = open ? (supersedes?.id ?? '__new') : null
  if (key !== seedKey) {
    setSeedKey(key)
    if (key !== null) {
      setFile(null)
      setTitle(supersedes?.title ?? '')
      setCategory(supersedes?.category ?? 'other')
      setSystem(supersedes?.system ?? 'integrated')
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
    startTransition(async () => {
      let filePayload: {
        file_path: string | null
        filename: string | null
        content_type: string | null
        size: number | null
      } = { file_path: null, filename: null, content_type: null, size: null }

      const supabase = createClient()

      if (file) {
        const path = `documents/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`
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
        filePayload = {
          file_path: path,
          filename: file.name,
          content_type: file.type || 'application/octet-stream',
          size: file.size,
        }
      }

      const result = await createDocument({
        title: title.trim(),
        category,
        system,
        doc_number: docNumber,
        version,
        ...filePayload,
        review_due: reviewDue,
        notes,
        supersedes_id: supersedes?.id ?? null,
      })

      if (result.error) {
        if (filePayload.file_path) {
          await supabase.storage.from('attachments').remove([filePayload.file_path])
        }
        toast.error(result.error)
        return
      }

      toast.success(supersedes ? 'New version drafted' : 'Document drafted')
      onClose()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {supersedes ? `New version — ${supersedes.title}` : 'New document'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {supersedes ? (
            <p className="text-sm text-muted-foreground">
              {supersedes.version} will be marked superseded. The new version
              starts as a draft and goes through the approval workflow.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              The document starts as a draft. Submit it for review, approve, then
              issue it. A file can be uploaded now or before issuing.
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doc-file">File (optional for a draft, max 25 MB)</Label>
            <Input id="doc-file" type="file" onChange={handleFileChange} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doc-title">Title</Label>
            <Input
              id="doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Quality Policy"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={(v) => setCategory((v as DocCategory) ?? 'other')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOC_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {DOC_CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>System</Label>
              <Select value={system} onValueChange={(v) => setSystem((v as DocSystem) ?? 'integrated')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOC_SYSTEMS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {DOC_SYSTEM_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="doc-number">Doc number</Label>
              <Input
                id="doc-number"
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
                placeholder="e.g. QMS-POL-001"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="doc-version">Version</Label>
              <Input
                id="doc-version"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doc-review">Review due (optional)</Label>
            <Input
              id="doc-review"
              type="date"
              value={reviewDue}
              onChange={(e) => setReviewDue(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doc-notes">Notes (optional)</Label>
            <Textarea id="doc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !title.trim() || !version.trim()}>
              {pending ? 'Saving…' : supersedes ? 'Draft new version' : 'Create draft'}
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
  row: DocumentRow | null
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<DocCategory>('other')
  const [system, setSystem] = useState<DocSystem>('integrated')
  const [docNumber, setDocNumber] = useState('')
  const [version, setVersion] = useState('')
  const [reviewDue, setReviewDue] = useState('')
  const [notes, setNotes] = useState('')
  // Optional replacement file (e.g. attach a file to a draft before issuing).
  const [file, setFile] = useState<File | null>(null)

  const [seedId, setSeedId] = useState<string | null>(null)
  if (row && row.id !== seedId) {
    setSeedId(row.id)
    setTitle(row.title)
    setCategory(row.category)
    setSystem(row.system)
    setDocNumber(row.doc_number ?? '')
    setVersion(row.version)
    setReviewDue(row.review_due ?? '')
    setNotes(row.notes ?? '')
    setFile(null)
  }

  const canAttach = row ? row.status !== 'issued' && row.status !== 'superseded' && row.status !== 'archived' : false

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!row) return
    startTransition(async () => {
      const result = await updateDocument(row.id, {
        title: title.trim(),
        category,
        system,
        doc_number: docNumber,
        version,
        review_due: reviewDue,
        notes,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }

      if (file && canAttach) {
        if (file.size > MAX_SIZE) {
          toast.error(`${file.name} exceeds the 25 MB limit`)
          return
        }
        const supabase = createClient()
        const path = `documents/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`
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
        const attach = await attachDocumentFile(row.id, {
          file_path: path,
          filename: file.name,
          content_type: file.type || 'application/octet-stream',
          size: file.size,
        })
        if (attach.error) {
          await supabase.storage.from('attachments').remove([path])
          toast.error(attach.error)
          return
        }
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
              <Label htmlFor="doc-edit-title">Title</Label>
              <Input id="doc-edit-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Category</Label>
                <Select value={category} onValueChange={(v) => setCategory((v as DocCategory) ?? 'other')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOC_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {DOC_CATEGORY_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>System</Label>
                <Select value={system} onValueChange={(v) => setSystem((v as DocSystem) ?? 'integrated')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOC_SYSTEMS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {DOC_SYSTEM_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="doc-edit-number">Doc number</Label>
                <Input id="doc-edit-number" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="doc-edit-version">Version</Label>
                <Input id="doc-edit-version" value={version} onChange={(e) => setVersion(e.target.value)} required />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="doc-edit-review">Review due</Label>
              <Input
                id="doc-edit-review"
                type="date"
                value={reviewDue}
                onChange={(e) => setReviewDue(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="doc-edit-notes">Notes</Label>
              <Textarea id="doc-edit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            {canAttach && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="doc-edit-file">
                  {row.file_path ? 'Replace file (optional)' : 'Attach file (optional)'}
                </Label>
                <Input
                  id="doc-edit-file"
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !title.trim() || !version.trim()}>
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

function DocumentHistoryDialog({ rowId, onClose }: { rowId: string | null; onClose: () => void }) {
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
        .eq('entity_type', 'documents')
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

// ─── Detail dialog: stepper + acknowledgement register ────────────────────────

function DocumentDetailDialog({
  row,
  canManage,
  onAcknowledge,
  onSupersede,
  busy,
  onClose,
}: {
  row: DocumentRow | null
  canManage: boolean
  onAcknowledge: (row: DocumentRow) => void
  onSupersede: (row: DocumentRow) => void
  busy: boolean
  onClose: () => void
}) {
  return (
    <Dialog open={Boolean(row)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row?.title}</DialogTitle>
        </DialogHeader>
        {row && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {row.doc_number && (
                <span className="font-mono text-muted-foreground">{row.doc_number}</span>
              )}
              <SystemBadge system={row.system} />
              <CategoryBadge category={row.category} />
              <Badge variant="secondary" className="tabular-nums">
                {row.version}
              </Badge>
            </div>

            <LifecycleStepper status={row.status} />

            {row.status === 'issued' && (
              <div className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">Read acknowledgement register</h3>
                  {row.myAcknowledgedAt ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                      <CheckCircle2Icon className="size-3.5" /> You acknowledged{' '}
                      {fmtDate(row.myAcknowledgedAt)}
                    </span>
                  ) : (
                    <Button size="sm" disabled={busy} onClick={() => onAcknowledge(row)}>
                      Acknowledge
                    </Button>
                  )}
                </div>
                {row.register && row.register.length > 0 ? (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Acknowledged</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {row.register.map((r) => (
                          <TableRow key={r.user_id}>
                            <TableCell>{r.name}</TableCell>
                            <TableCell className="capitalize text-muted-foreground">{r.role}</TableCell>
                            <TableCell>
                              {r.acknowledged_at ? (
                                <span className="tabular-nums">{fmtDate(r.acknowledged_at)}</span>
                              ) : (
                                <span className="font-medium text-amber-600 dark:text-amber-400">
                                  Outstanding
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No active staff to acknowledge.</p>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {row.file_url && (
                <Button
                  variant="outline"
                  render={<a href={row.file_url} target="_blank" rel="noopener noreferrer" />}
                >
                  <DownloadIcon className="size-4" />
                  Open file
                </Button>
              )}
              {canManage && row.status === 'issued' && (
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={busy}
                  onClick={() => onSupersede(row)}
                >
                  Supersede (no replacement)
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Main table ───────────────────────────────────────────────────────────────

interface DocumentsTableProps {
  rows: DocumentRow[]
  canManage: boolean
  isAdmin: boolean
}

type DisplayRow = { row: DocumentRow; depth: number }

export function DocumentsTable({ rows, canManage, isAdmin }: DocumentsTableProps) {
  const [systemFilter, setSystemFilter] = useState<'all' | DocSystem>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | DocCategory>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | DocStatus>('all')
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const [uploadOpen, setUploadOpen] = useState(false)
  const [versionRow, setVersionRow] = useState<DocumentRow | null>(null)
  const [editRow, setEditRow] = useState<DocumentRow | null>(null)
  const [detailRow, setDetailRow] = useState<DocumentRow | null>(null)
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])
  const attachedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const r of rows) {
      if (r.supersedes_id && byId.has(r.supersedes_id)) ids.add(r.supersedes_id)
    }
    return ids
  }, [rows, byId])

  function matches(row: DocumentRow): boolean {
    if (systemFilter !== 'all' && row.system !== systemFilter) return false
    if (categoryFilter !== 'all' && row.category !== categoryFilter) return false
    if (statusFilter !== 'all' && row.status !== statusFilter) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (
      row.title.toLowerCase().includes(q) ||
      (row.doc_number ?? '').toLowerCase().includes(q)
    )
  }

  // A row is "inactive" once it leaves the working/live set.
  const isInactive = (s: DocStatus) => s === 'superseded' || s === 'archived'

  const display: DisplayRow[] = useMemo(() => {
    const categoryIndex = (c: DocCategory) => DOC_CATEGORIES.indexOf(c)
    const topLevel = rows
      .filter((r) => (isInactive(r.status) ? showInactive && !attachedIds.has(r.id) : true))
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
      if (!showInactive) continue
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
  }, [rows, byId, attachedIds, systemFilter, categoryFilter, statusFilter, search, showInactive])

  const catCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of rows) {
      if (isInactive(r.status)) continue
      counts.set(r.category, (counts.get(r.category) ?? 0) + 1)
      counts.set('all', (counts.get('all') ?? 0) + 1)
    }
    return counts
  }, [rows])

  function runAction(
    row: DocumentRow,
    fn: () => Promise<{ error?: string }>,
    success: string
  ) {
    setBusyId(row.id)
    startTransition(async () => {
      const result = await fn()
      setBusyId(null)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(success)
    })
  }

  function handleAcknowledge(row: DocumentRow) {
    setBusyId(row.id)
    startTransition(async () => {
      const result = await acknowledgeDocument(row.id, row.versionOrdinal)
      setBusyId(null)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Acknowledged — recorded on the register')
      setDetailRow(null)
    })
  }

  function handleSupersede(row: DocumentRow) {
    if (!confirm(`Supersede "${row.title}" (${row.version}) with no replacement? It leaves the issued register.`))
      return
    runAction(row, () => supersedeDocument(row.id), 'Document superseded')
    setDetailRow(null)
  }

  function handleDelete(row: DocumentRow) {
    if (!confirm(`Delete "${row.title}" (${row.version})? The file is removed from storage. This cannot be undone.`))
      return
    runAction(row, () => deleteDocument(row.id), 'Document deleted')
  }

  function handleCsvExport() {
    downloadCsv(
      'document-register.csv',
      display.map(({ row }) => ({
        doc_number: row.doc_number ?? '',
        title: row.title,
        category: DOC_CATEGORY_LABELS[row.category],
        system: DOC_SYSTEM_LABELS[row.system],
        version: row.version,
        status: row.status,
        review_due: row.review_due ? fmtDate(row.review_due) : '',
        approver: row.approved_by_name ?? '',
        issued: row.issued_at ? format(parseISO(row.issued_at), 'dd/MM/yyyy') : '',
      }))
    )
  }

  const filtersActive =
    systemFilter !== 'all' || categoryFilter !== 'all' || statusFilter !== 'all' || search.trim() !== ''

  return (
    <div className="flex flex-col gap-4">
      {/* System chips + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto">
          {(['all', ...DOC_SYSTEMS] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSystemFilter(s)}
              className={cn(
                'whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors',
                systemFilter === s ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {s === 'all' ? 'All systems' : DOC_SYSTEM_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open('/api/pdf/document-register/list', '_blank')}
          >
            <FileTextIcon className="size-4" />
            Register PDF
          </Button>
          <Button variant="outline" size="sm" onClick={handleCsvExport} disabled={display.length === 0}>
            <DownloadIcon className="size-4" />
            CSV
          </Button>
          {canManage && (
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <UploadIcon className="size-4" />
              New document
            </Button>
          )}
        </div>
      </div>

      {/* Category chips */}
      <div className="flex gap-1 overflow-x-auto">
        {(['all', ...DOC_CATEGORIES] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategoryFilter(c)}
            className={cn(
              'whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors',
              categoryFilter === c ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'
            )}
          >
            {c === 'all' ? 'All' : DOC_CATEGORY_LABELS[c]}{' '}
            <span className="text-xs opacity-70">{catCounts.get(c) ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Search + status filter + inactive toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title or doc number"
          className="w-64"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter((v as 'all' | DocStatus) ?? 'all')}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="in_review">In Review</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="issued">Issued</SelectItem>
            <SelectItem value="superseded">Superseded</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="size-4"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show superseded / archived
        </label>
      </div>

      {display.length === 0 ? (
        <EmptyState
          icon={<FolderOpenIcon className="size-8" />}
          title="No documents"
          description={
            filtersActive
              ? 'No documents match the current filter.'
              : 'Create the company policies, procedures, work instructions, forms and registers that make up the controlled document register.'
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
                <TableHead>System</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Review due</TableHead>
                <TableHead>Approver</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {display.map(({ row, depth }) => {
                const muted = isInactive(row.status)
                return (
                  <TableRow key={row.id} className={muted ? 'text-muted-foreground' : undefined}>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums">
                      {row.doc_number ?? '—'}
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <div
                        className={cn('flex items-start gap-1.5', depth > 0 && 'pl-5')}
                        style={depth > 1 ? { paddingLeft: `${depth * 1.25}rem` } : undefined}
                      >
                        {depth > 0 && (
                          <CornerDownRightIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <div className="flex min-w-0 flex-col">
                          <button
                            type="button"
                            onClick={() => setDetailRow(row)}
                            className={cn('truncate text-left text-sm hover:underline', !muted && 'font-medium')}
                            title={row.notes ? `${row.title}\n${row.notes}` : row.title}
                          >
                            {row.title}
                          </button>
                          <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                            <FileTextIcon className="size-3 shrink-0" />
                            <span className="truncate">{row.filename ?? 'No file'}</span>
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <CategoryBadge category={row.category} />
                    </TableCell>
                    <TableCell>
                      <SystemBadge system={row.system} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{row.version}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      <ReviewDueCell row={row} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {row.approved_by_name ?? '—'}
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
                        {/* Workflow actions */}
                        {canManage && row.status === 'draft' && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busyId === row.id}
                            onClick={() => runAction(row, () => submitForReview(row.id), 'Submitted for review')}
                          >
                            <SendIcon className="size-3.5" />
                            Submit
                          </Button>
                        )}
                        {canManage && row.status === 'in_review' && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busyId === row.id}
                            onClick={() => runAction(row, () => approveDocument(row.id), 'Document approved')}
                          >
                            Approve
                          </Button>
                        )}
                        {canManage && row.status === 'approved' && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busyId === row.id}
                            onClick={() => runAction(row, () => issueDocument(row.id), 'Document issued')}
                          >
                            Issue
                          </Button>
                        )}
                        {canManage && row.status === 'issued' && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setVersionRow(row)}
                          >
                            New version
                          </Button>
                        )}
                        {canManage &&
                          (row.status === 'draft' ||
                            row.status === 'in_review' ||
                            row.status === 'approved') && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              title="Edit"
                              onClick={() => setEditRow(row)}
                            >
                              <PencilIcon className="size-3.5" />
                            </Button>
                          )}
                        {canManage && row.status === 'issued' && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            title="Archive"
                            disabled={busyId === row.id}
                            onClick={() => {
                              if (
                                confirm(
                                  `Archive "${row.title}" (${row.version})? It stays on the register but leaves the field app.`
                                )
                              )
                                runAction(row, () => archiveDocument(row.id), 'Document archived')
                            }}
                          >
                            <ArchiveIcon className="size-3.5" />
                          </Button>
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
      <DocumentDetailDialog
        row={detailRow}
        canManage={canManage}
        busy={busyId === detailRow?.id}
        onAcknowledge={handleAcknowledge}
        onSupersede={handleSupersede}
        onClose={() => setDetailRow(null)}
      />
      <DocumentHistoryDialog rowId={historyId} onClose={() => setHistoryId(null)} />
    </div>
  )
}
