'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  CheckIcon,
  EyeOffIcon,
  FileIcon,
  FlagIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
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
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PhotoUpload } from '@/components/PhotoUpload'
import {
  MaintenanceKindBadge,
  MAINTENANCE_KIND_LABELS,
} from '@/components/MaintenanceLog'
import { fmtDate } from '@/lib/format'
import { todayAUClient } from '@/lib/tz-client'
import { MAINTENANCE_KINDS, type MaintenanceKind } from '@/lib/zod'
import {
  createMaintenanceEntry,
  createQuoteFromMaintenance,
  deleteMaintenanceEntry,
  resolveMaintenanceEntry,
  setMaintenanceFlag,
  updateMaintenanceEntry,
} from '@/lib/maintenance'
import { deleteAttachment } from '@/lib/attachments'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MaintenanceEvidence {
  id: string
  filename: string
  content_type: string | null
  kind: 'photo' | 'docket' | 'document' | 'pdf'
  signedUrl: string | null
}

export interface MaintenanceEntryRow {
  id: string
  kind: MaintenanceKind
  title: string
  description: string | null
  done_at: string
  status: 'open' | 'resolved'
  follow_up: string | null
  follow_up_due: string | null
  quote_id: string | null
  quote_number: string | null
  flagged: boolean
  flag_note: string | null
  client_visible: boolean
  job_id: string | null
  project_id: string | null
  job_number: string | null
  project_number: string | null
  evidence: MaintenanceEvidence[]
}

export interface MaintenanceWorkOption {
  id: string
  number: string
  label: string
}

interface MaintenanceSectionProps {
  siteId: string
  entries: MaintenanceEntryRow[]
  jobs: MaintenanceWorkOption[]
  projects: MaintenanceWorkOption[]
  canEdit: boolean
}

type DialogMode =
  | { mode: 'create' }
  | { mode: 'edit'; entry: MaintenanceEntryRow }

// ─── Add / edit dialog ───────────────────────────────────────────────────────

function EntryDialog({
  siteId,
  jobs,
  projects,
  state,
  onClose,
}: {
  siteId: string
  jobs: MaintenanceWorkOption[]
  projects: MaintenanceWorkOption[]
  state: DialogMode
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const seed = state.mode === 'edit' ? state.entry : null

  const [kind, setKind] = useState<MaintenanceKind>(seed?.kind ?? 'repair')
  const [title, setTitle] = useState(seed?.title ?? '')
  const [description, setDescription] = useState(seed?.description ?? '')
  const [doneAt, setDoneAt] = useState(seed?.done_at ?? todayAUClient())
  const [temporary, setTemporary] = useState(seed?.status === 'open')
  const [followUp, setFollowUp] = useState(
    seed?.follow_up ?? 'Permanent repair recommended'
  )
  const [followUpDue, setFollowUpDue] = useState(seed?.follow_up_due ?? '')
  const [jobId, setJobId] = useState(seed?.job_id ?? 'none')
  const [projectId, setProjectId] = useState(seed?.project_id ?? 'none')
  const [clientVisible, setClientVisible] = useState(seed?.client_visible ?? true)

  // Two-step create: once the row exists, hold its id and swap the form for a
  // photo-evidence uploader (mirrors how compliance evidence is added).
  const [createdId, setCreatedId] = useState<string | null>(null)
  const inPhotoPhase = createdId !== null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const payload = {
        kind,
        title,
        description,
        done_at: doneAt,
        status: temporary ? 'open' : 'resolved',
        follow_up: temporary ? followUp : null,
        follow_up_due: temporary ? followUpDue || null : null,
        job_id: jobId === 'none' ? null : jobId,
        project_id: projectId === 'none' ? null : projectId,
        client_visible: clientVisible,
      }

      if (state.mode === 'edit') {
        const result = await updateMaintenanceEntry(state.entry.id, payload)
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success('Entry updated')
        router.refresh()
        onClose()
        return
      }

      const result = await createMaintenanceEntry({ site_id: siteId, ...payload })
      if (result.error || !result.id) {
        toast.error(result.error ?? 'Could not save entry')
        return
      }
      toast.success('Entry recorded — add photos if you have them')
      setCreatedId(result.id)
    })
  }

  function handleDone() {
    router.refresh()
    onClose()
  }

  const heading =
    state.mode === 'edit'
      ? 'Edit maintenance entry'
      : inPhotoPhase
        ? 'Add evidence photos'
        : 'Add maintenance entry'

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && (inPhotoPhase ? handleDone() : onClose())}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
        </DialogHeader>

        {inPhotoPhase && createdId ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Attach photo evidence for this entry, then finish.
            </p>
            <PhotoUpload
              parentType="maintenance"
              parentId={createdId}
              kind="photo"
              capture
              multiple
            />
            <DialogFooter>
              <Button type="button" onClick={handleDone}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>
                Kind <span className="text-destructive">*</span>
              </Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind((v ?? 'repair') as MaintenanceKind)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAINTENANCE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {MAINTENANCE_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="m-title">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="m-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Made safe leaking meter box"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="m-desc">Description</Label>
              <Textarea
                id="m-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What was done, and what remains."
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="m-done">
                Date done <span className="text-destructive">*</span>
              </Label>
              <Input
                id="m-done"
                type="date"
                value={doneAt}
                onChange={(e) => setDoneAt(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="m-temp"
                  checked={temporary}
                  onCheckedChange={(v) => setTemporary(v === true)}
                />
                <Label htmlFor="m-temp" className="cursor-pointer">
                  Temporary measure — needs permanent fix
                </Label>
              </div>
              {temporary && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="m-followup">Follow-up needed</Label>
                    <Input
                      id="m-followup"
                      value={followUp}
                      onChange={(e) => setFollowUp(e.target.value)}
                      placeholder="Permanent repair recommended"
                    />
                    <span className="text-xs text-muted-foreground">
                      Shows as an open flag until resolved.
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="m-followup-due">Follow-up due (optional)</Label>
                    <Input
                      id="m-followup-due"
                      type="date"
                      value={followUpDue}
                      onChange={(e) => setFollowUpDue(e.target.value)}
                    />
                    <span className="text-xs text-muted-foreground">
                      Puts the deadline on the client calendar and the office
                      dashboard so it gets chased.
                    </span>
                  </div>
                </>
              )}
            </div>

            {(jobs.length > 0 || projects.length > 0) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {jobs.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <Label>Linked job</Label>
                    <Select value={jobId} onValueChange={(v) => setJobId(v ?? 'none')}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {jobs.map((j) => (
                          <SelectItem key={j.id} value={j.id}>
                            {j.number} — {j.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {projects.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <Label>Linked project</Label>
                    <Select
                      value={projectId}
                      onValueChange={(v) => setProjectId(v ?? 'none')}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.number} — {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Checkbox
                id="m-visible"
                checked={clientVisible}
                onCheckedChange={(v) => setClientVisible(v === true)}
              />
              <Label htmlFor="m-visible" className="cursor-pointer">
                Visible to client
              </Label>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending
                  ? 'Saving…'
                  : state.mode === 'edit'
                    ? 'Save changes'
                    : 'Add entry'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Flag dialog (flagging asks for a note; unflagging is a direct toggle) ────

function FlagDialog({
  entry,
  onClose,
}: {
  entry: MaintenanceEntryRow
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [note, setNote] = useState('')

  function handleConfirm() {
    startTransition(async () => {
      const result = await setMaintenanceFlag(entry.id, true, note)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Entry flagged')
      router.refresh()
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Flag for attention</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="flag-note">Note (optional)</Label>
            <Textarea
              id="flag-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What needs attention?"
            />
          </div>
          <DialogFooter>
            <Button type="button" onClick={handleConfirm} disabled={pending}>
              {pending ? 'Flagging…' : 'Flag entry'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Entry row ───────────────────────────────────────────────────────────────

/** Office-only: remove a bad evidence photo (row + storage object). */
function EvidenceDeleteButton({
  attachmentId,
  inline,
}: {
  attachmentId: string
  inline?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <button
      type="button"
      disabled={pending}
      aria-label="Remove evidence"
      onClick={() =>
        startTransition(async () => {
          const result = await deleteAttachment(attachmentId)
          if (result.error) {
            toast.error(result.error)
            return
          }
          toast.success('Evidence removed')
          router.refresh()
        })
      }
      className={
        inline
          ? 'text-muted-foreground hover:text-destructive disabled:opacity-50'
          : 'absolute -top-1.5 -right-1.5 rounded-full border bg-background p-0.5 text-muted-foreground shadow-sm hover:text-destructive disabled:opacity-50'
      }
    >
      <XIcon className="size-3.5" />
    </button>
  )
}

/** "Quote this" — draft quote for the permanent fix, linked back here. */
function QuoteThisButton({ entryId }: { entryId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await createQuoteFromMaintenance(entryId)
          if (result.error || !result.quoteId) {
            toast.error(result.error ?? 'Could not create the quote')
            return
          }
          toast.success('Draft quote created')
          router.push(`/quotes/${result.quoteId}`)
        })
      }
      className="font-semibold underline underline-offset-2 disabled:opacity-50"
    >
      {pending ? 'Creating…' : 'Quote this'}
    </button>
  )
}

/** Amber inside 30 days, red once overdue — matches the compliance lights. */
function dueTone(due: string): string {
  const today = todayAUClient()
  if (due < today) return 'bg-red-600 text-white'
  const soon = new Date(due) <= new Date(Date.now() + 30 * 86400000)
  return soon
    ? 'bg-amber-500 text-white'
    : 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100'
}

function EntryRow({
  entry,
  canEdit,
  busy,
  onEdit,
  onResolve,
  onFlagClick,
  onDelete,
}: {
  entry: MaintenanceEntryRow
  canEdit: boolean
  busy: boolean
  onEdit: () => void
  onResolve: () => void
  onFlagClick: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <MaintenanceKindBadge kind={entry.kind} />
        <span className="text-xs text-muted-foreground tabular-nums">
          {fmtDate(entry.done_at)}
        </span>
        <span className="font-medium">{entry.title}</span>
        {!entry.client_visible && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <EyeOffIcon className="size-3.5" />
            Hidden from client
          </span>
        )}
        {canEdit && (
          <div className="ml-auto flex items-center gap-1">
            {entry.status === 'open' && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={onResolve}
              >
                <CheckIcon />
                Resolve
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onEdit}
              aria-label={`Edit ${entry.title}`}
            >
              <PencilIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              onClick={onFlagClick}
              aria-label={entry.flagged ? `Clear flag on ${entry.title}` : `Flag ${entry.title}`}
              title={entry.flagged ? 'Clear flag' : 'Flag for attention'}
            >
              <FlagIcon className={entry.flagged ? 'fill-red-600 text-red-600' : undefined} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              onClick={onDelete}
              aria-label={`Delete ${entry.title}`}
            >
              <Trash2Icon className="text-destructive" />
            </Button>
          </div>
        )}
      </div>

      {entry.description && (
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">
          {entry.description}
        </p>
      )}

      {entry.status === 'open' && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          <span className="font-semibold tracking-wide uppercase">Open</span>
          <span>{entry.follow_up || 'Permanent repair recommended'}</span>
          {entry.follow_up_due && (
            <span
              className={`rounded px-1.5 py-0.5 font-semibold ${dueTone(entry.follow_up_due)}`}
            >
              due {fmtDate(entry.follow_up_due)}
            </span>
          )}
          {canEdit && !entry.quote_id && (
            <QuoteThisButton entryId={entry.id} />
          )}
          {entry.quote_id && (
            <Link
              href={`/quotes/${entry.quote_id}`}
              className="font-medium underline underline-offset-2"
            >
              Quoted{entry.quote_number ? `: ${entry.quote_number}` : ''}
            </Link>
          )}
        </div>
      )}

      {entry.flagged && (
        <div className="flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
          <FlagIcon className="size-3.5 fill-current" />
          {entry.flag_note || 'Flagged for attention'}
        </div>
      )}

      {entry.evidence.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {entry.evidence.map((att) => {
            const isImage =
              att.content_type?.startsWith('image/') || att.kind === 'photo'
            if (isImage && att.signedUrl) {
              return (
                <span key={att.id} className="relative block">
                  <a
                    href={att.signedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={att.signedUrl}
                      alt={att.filename}
                      loading="lazy"
                      className="size-16 rounded-lg border object-cover"
                    />
                  </a>
                  {canEdit && <EvidenceDeleteButton attachmentId={att.id} />}
                </span>
              )
            }
            return (
              <span key={att.id} className="inline-flex items-center gap-1">
                <a
                  href={att.signedUrl ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <FileIcon className="size-3.5" />
                  {att.filename}
                </a>
                {canEdit && <EvidenceDeleteButton attachmentId={att.id} inline />}
              </span>
            )
          })}
        </div>
      )}

      {(entry.job_id || entry.project_id) && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {entry.job_id && (
            <Link
              href={`/jobs/${entry.job_id}`}
              className="text-primary hover:underline"
            >
              Job {entry.job_number ?? ''}
            </Link>
          )}
          {entry.project_id && (
            <Link
              href={`/projects/${entry.project_id}`}
              className="text-primary hover:underline"
            >
              Project {entry.project_number ?? ''}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Section ─────────────────────────────────────────────────────────────────

export function MaintenanceSection({
  siteId,
  entries,
  jobs,
  projects,
  canEdit,
}: MaintenanceSectionProps) {
  const router = useRouter()
  const [dialog, setDialog] = useState<DialogMode | null>(null)
  const [flagTarget, setFlagTarget] = useState<MaintenanceEntryRow | null>(null)
  const [, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)

  function handleResolve(entry: MaintenanceEntryRow) {
    setBusyId(entry.id)
    startTransition(async () => {
      const result = await resolveMaintenanceEntry(entry.id)
      setBusyId(null)
      if (result.error) toast.error(result.error)
      else {
        toast.success('Marked as resolved')
        router.refresh()
      }
    })
  }

  function handleFlagClick(entry: MaintenanceEntryRow) {
    if (!entry.flagged) {
      setFlagTarget(entry)
      return
    }
    // Already flagged — clearing needs no note.
    setBusyId(entry.id)
    startTransition(async () => {
      const result = await setMaintenanceFlag(entry.id, false)
      setBusyId(null)
      if (result.error) toast.error(result.error)
      else {
        toast.success('Flag cleared')
        router.refresh()
      }
    })
  }

  function handleDelete(entry: MaintenanceEntryRow) {
    if (!confirm(`Delete "${entry.title}"? This cannot be undone.`)) return
    setBusyId(entry.id)
    startTransition(async () => {
      const result = await deleteMaintenanceEntry(entry.id)
      setBusyId(null)
      if (result.error) toast.error(result.error)
      else {
        toast.success('Entry deleted')
        router.refresh()
      }
    })
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Maintenance log</h2>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDialog({ mode: 'create' })}
          >
            <PlusIcon />
            Add entry
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No maintenance recorded for this property yet.
        </p>
      ) : (
        <div className="divide-y rounded-xl border">
          {entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              canEdit={canEdit}
              busy={busyId === entry.id}
              onEdit={() => setDialog({ mode: 'edit', entry })}
              onResolve={() => handleResolve(entry)}
              onFlagClick={() => handleFlagClick(entry)}
              onDelete={() => handleDelete(entry)}
            />
          ))}
        </div>
      )}

      {dialog && (
        <EntryDialog
          siteId={siteId}
          jobs={jobs}
          projects={projects}
          state={dialog}
          onClose={() => setDialog(null)}
        />
      )}

      {flagTarget && (
        <FlagDialog entry={flagTarget} onClose={() => setFlagTarget(null)} />
      )}
    </section>
  )
}
