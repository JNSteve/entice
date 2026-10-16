'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { fmtDate } from '@/lib/format'
import {
  FLAG_LABELS,
  SIGNOFF_SECTION_LABELS,
  SIGNOFF_SECTIONS,
  fmtQty,
  type SignoffSection,
} from '@/lib/signoffs'
import {
  addSignoffLine,
  buildSignoff,
  deleteSignoffDraft,
  deleteSignoffLine,
  releaseSignoff,
  reviseSignoff,
  updateSignoffDraft,
  updateSignoffLine,
} from '@/lib/signoff-actions'
import { SignoffStatusBadge } from '@/components/signoffs/SignoffStatusBadge'

export type EditorLine = {
  id: string
  section: SignoffSection
  description: string
  qty: number
  unit: string
  detail: string | null
  scope_label: string | null
  flags: string[]
}

export type EditorPhoto = { id: string; url: string | null; caption: string }

export type EditorResponse = {
  signer_name: string
  signature_data: string
  signed_at: string
  ip: string | null
  disputes: { line_id: string; client_qty: number; reason: string }[]
}

export type EditorVersion = { id: string; version: number; status: string }

function instantAU(iso: string): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(new Date(iso))
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Australia/Brisbane',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
  return `${fmtDate(day)} ${time}`
}

export function SignoffEditor({
  signoffId,
  kind,
  workId,
  date,
  status,
  canEdit,
  summary: initialSummary,
  photoIds: initialPhotoIds,
  photos,
  lines,
  response,
  versions,
  isRevision,
  sourceChanged,
}: {
  signoffId: string
  kind: 'job' | 'project'
  workId: string
  date: string
  status: string
  canEdit: boolean
  summary: string
  photoIds: string[]
  photos: EditorPhoto[]
  lines: EditorLine[]
  response: EditorResponse | null
  versions: EditorVersion[]
  /** A revision of a disputed/withdrawn sheet — never rebuilt from entries. */
  isRevision: boolean
  /** Draft only: crew changed the day's entries after this draft was built. */
  sourceChanged: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const editable = canEdit && status === 'draft'
  const [summary, setSummary] = useState(initialSummary)
  const [photoIds, setPhotoIds] = useState<string[]>(initialPhotoIds)

  const flagged = lines.filter((l) => l.flags.length > 0)
  const blocking = lines.some((l) => l.flags.includes('still_checked_in'))
  const workHref = kind === 'job' ? `/jobs/${workId}` : `/projects/${workId}/signoffs`

  function run(fn: () => Promise<{ error?: string; id?: string }>, ok: string, after?: (id?: string) => void) {
    startTransition(async () => {
      const res = await fn()
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(ok)
      if (after) after(res.id)
      else router.refresh()
    })
  }

  function togglePhoto(id: string) {
    setPhotoIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  function onRebuild() {
    if (!confirm('Rebuild from entries? This replaces the lines, summary and any edits on this draft.')) return
    run(() => buildSignoff(kind, workId, date), 'Rebuilt from entries', (newId) => {
      if (newId && newId !== signoffId) router.push(`/signoffs/${newId}`)
      else router.refresh()
    })
  }

  const draftDirty =
    summary !== initialSummary ||
    photoIds.length !== initialPhotoIds.length ||
    photoIds.some((id) => !initialPhotoIds.includes(id))

  function onRelease() {
    if (!confirm('Release to the client portal? The client will be emailed and the sheet locks.')) return
    // Unsaved summary/photo changes go out with the release, never get lost.
    run(async () => {
      if (draftDirty) {
        const saved = await updateSignoffDraft(signoffId, { summary, photo_ids: photoIds })
        if (saved.error) return saved
      }
      return releaseSignoff(signoffId)
    }, 'Released to client')
  }

  function onDeleteDraft() {
    if (!confirm('Delete this draft?')) return
    run(() => deleteSignoffDraft(signoffId), 'Draft deleted', () => router.push(workHref))
  }

  function onRevise() {
    if (
      status === 'released' &&
      !confirm('Withdraw this sheet from the client and draft a corrected version?')
    ) {
      return
    }
    run(() => reviseSignoff(signoffId), 'Revision drafted', (newId) => {
      if (newId) router.push(`/signoffs/${newId}`)
      else router.refresh()
    })
  }

  const linesById = new Map(lines.map((l) => [l.id, l]))

  return (
    <div className="flex flex-col gap-6">
      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && status === 'draft' && (
          <>
            <Button onClick={onRelease} disabled={pending || blocking}>
              Release to client
            </Button>
            {!isRevision && (
              <Button variant="outline" onClick={onRebuild} disabled={pending}>
                Rebuild from entries
              </Button>
            )}
            <Button variant="destructive" onClick={onDeleteDraft} disabled={pending}>
              Delete draft
            </Button>
          </>
        )}
        {canEdit && status === 'disputed' && (
          <Button onClick={onRevise} disabled={pending}>
            Revise
          </Button>
        )}
        {canEdit && status === 'released' && (
          <Button variant="outline" onClick={onRevise} disabled={pending}>
            Withdraw &amp; revise
          </Button>
        )}
        <a
          href={`/api/pdf/signoff/${signoffId}`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: 'outline' })}
        >
          PDF
        </a>
      </div>

      {status === 'draft' && sourceChanged && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          {isRevision
            ? 'Crew entries for this day have changed since the original sheet was built. Check the lines before releasing.'
            : 'Crew entries for this day have changed since this draft was built. Use “Rebuild from entries” to pick them up (this replaces manual edits), or check the lines before releasing.'}
        </div>
      )}

      {/* Versions */}
      {versions.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Versions:</span>
          {versions.map((v) => (
            <Link
              key={v.id}
              href={`/signoffs/${v.id}`}
              className={cn(
                'flex items-center gap-1 rounded-md border px-2 py-1',
                v.id === signoffId ? 'bg-muted font-medium' : 'hover:bg-muted'
              )}
            >
              {`v${v.version}`}
              <SignoffStatusBadge status={v.status} />
            </Link>
          ))}
        </div>
      )}

      {/* Flags */}
      {flagged.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
          <p className="font-medium text-amber-800 dark:text-amber-200">Check before release</p>
          <ul className="mt-1 flex flex-col gap-1">
            {flagged.flatMap((l) =>
              l.flags.map((f) => (
                <li
                  key={`${l.id}-${f}`}
                  className={cn(
                    f === 'still_checked_in'
                      ? 'font-medium text-red-700 dark:text-red-300'
                      : 'text-amber-800 dark:text-amber-200'
                  )}
                >
                  {`${l.description}: ${FLAG_LABELS[f] ?? f}${f === 'still_checked_in' ? ' (blocks release)' : ''}`}
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      {/* Summary + photos */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Summary</h2>
        {editable ? (
          <Textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={4}
            maxLength={4000}
            className="text-base md:text-sm"
            placeholder="What was done on site this day"
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm">
            {initialSummary || <span className="text-muted-foreground">No summary.</span>}
          </p>
        )}

        {(editable ? photos.length > 0 : initialPhotoIds.length > 0) && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {photos
              .filter((p) => editable || initialPhotoIds.includes(p.id))
              .map((p) => {
                const checked = photoIds.includes(p.id)
                return (
                  <label
                    key={p.id}
                    className={cn(
                      'relative flex flex-col gap-1 rounded-lg border p-1 text-xs',
                      editable && 'cursor-pointer',
                      editable && checked && 'border-primary ring-2 ring-primary/40'
                    )}
                  >
                    {p.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.url} alt={p.caption} className="aspect-square w-full rounded object-cover" />
                    ) : (
                      <div className="flex aspect-square w-full items-center justify-center rounded bg-muted text-muted-foreground">
                        No preview
                      </div>
                    )}
                    <span className="truncate text-muted-foreground">{p.caption}</span>
                    {editable && (
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePhoto(p.id)}
                        className="absolute left-2 top-2 size-4"
                        aria-label={`Include ${p.caption}`}
                      />
                    )}
                  </label>
                )
              })}
          </div>
        )}
        {editable && photos.length === 0 && (
          <p className="text-sm text-muted-foreground">No photos taken on site this day.</p>
        )}
        {editable && (
          <div>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => updateSignoffDraft(signoffId, { summary, photo_ids: photoIds }), 'Saved')
              }
            >
              Save summary &amp; photos
            </Button>
          </div>
        )}
      </section>

      {/* Lines */}
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Quantities</h2>
        {SIGNOFF_SECTIONS.map((section) => {
          const sectionLines = lines.filter((l) => l.section === section)
          if (sectionLines.length === 0 && !editable) return null
          return (
            <div key={section} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{SIGNOFF_SECTION_LABELS[section]}</h3>
              <div className="flex flex-col divide-y rounded-lg border">
                {sectionLines.length === 0 && (
                  <p className="p-3 text-sm text-muted-foreground">Nothing recorded.</p>
                )}
                {sectionLines.map((l) => (
                  <LineRow key={l.id} line={l} editable={editable} />
                ))}
                {editable && <AddLineRow signoffId={signoffId} section={section} />}
              </div>
            </div>
          )
        })}
      </section>

      {/* Client response */}
      {response && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Client response</h2>
          <div className="flex flex-col gap-1 text-sm">
            <span>{`Signed by ${response.signer_name}`}</span>
            <span className="text-muted-foreground">
              {`${instantAU(response.signed_at)}${response.ip ? ` · IP ${response.ip}` : ''}`}
            </span>
          </div>
          <div className="w-fit rounded-lg border bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={response.signature_data} alt="Client signature" className="max-h-24" />
          </div>
          {response.disputes.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead className="text-right">Our qty</TableHead>
                    <TableHead className="text-right">Client&apos;s qty</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {response.disputes.map((d) => {
                    const line = linesById.get(d.line_id)
                    return (
                      <TableRow key={d.line_id}>
                        <TableCell>{line?.description ?? 'Unknown line'}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {line ? `${fmtQty(line.qty)} ${line.unit}`.trim() : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-red-700 dark:text-red-300">
                          {`${fmtQty(Number(d.client_qty))} ${line?.unit ?? ''}`.trim()}
                        </TableCell>
                        <TableCell className="whitespace-pre-wrap">{d.reason}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function LineRow({ line, editable }: { line: EditorLine; editable: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [description, setDescription] = useState(line.description)
  const [qty, setQty] = useState(String(line.qty))
  const [unit, setUnit] = useState(line.unit)
  const [detail, setDetail] = useState(line.detail ?? '')

  function startEdit() {
    setDescription(line.description)
    setQty(String(line.qty))
    setUnit(line.unit)
    setDetail(line.detail ?? '')
    setEditing(true)
  }

  function save() {
    startTransition(async () => {
      const res = await updateSignoffLine(line.id, {
        description,
        qty,
        unit,
        detail: detail.trim() || null,
        scope_label: line.scope_label,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Line saved')
      setEditing(false)
      router.refresh()
    })
  }

  function remove() {
    if (!confirm(`Delete "${line.description}"?`)) return
    startTransition(async () => {
      const res = await deleteSignoffLine(line.id)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Line deleted')
      router.refresh()
    })
  }

  if (editable && editing) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_6rem_6rem]">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" />
          <Input
            type="number"
            min={0}
            step="0.25"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            aria-label="Quantity"
          />
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unit" aria-label="Unit" />
        </div>
        <Input
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Detail (optional)"
          aria-label="Detail"
        />
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={pending}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{line.description}</span>
        {line.detail && <span className="text-muted-foreground">{line.detail}</span>}
        {line.scope_label && (
          <span className="text-muted-foreground">{`Scope: ${line.scope_label}`}</span>
        )}
        {line.flags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {line.flags.map((f) => (
              <Badge
                key={f}
                variant="outline"
                className={cn(
                  f === 'still_checked_in'
                    ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300'
                    : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300'
                )}
              >
                {FLAG_LABELS[f] ?? f}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap tabular-nums font-medium">
          {`${fmtQty(line.qty)} ${line.unit}`.trim()}
        </span>
        {editable && (
          <>
            <Button size="sm" variant="outline" onClick={startEdit} disabled={pending}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={remove} disabled={pending}>
              Delete
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function AddLineRow({ signoffId, section }: { signoffId: string; section: SignoffSection }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState(section === 'labour' || section === 'plant' ? 'hrs' : section === 'subbie' ? 'man-hrs' : 'ea')
  const [detail, setDetail] = useState('')

  function add() {
    startTransition(async () => {
      const res = await addSignoffLine(signoffId, {
        section,
        description,
        qty: qty === '' ? 0 : qty,
        unit,
        detail: detail.trim() || null,
        scope_label: null,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Line added')
      setDescription('')
      setQty('')
      setDetail('')
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <div className="p-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          + Add line
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 bg-muted/30 p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_6rem_6rem]">
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          aria-label="Description"
        />
        <Input
          type="number"
          min={0}
          step="0.25"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="Qty"
          aria-label="Quantity"
        />
        <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unit" aria-label="Unit" />
      </div>
      <Input
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        placeholder="Detail (optional)"
        aria-label="Detail"
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={add} disabled={pending}>
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
