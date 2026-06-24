'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  BookOpenIcon,
  CameraIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FileTextIcon,
  HardHatIcon,
  PencilIcon,
  PlusIcon,
  TruckIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { AttachmentList, type AttachmentItem } from '@/components/AttachmentList'
import { PhotoUpload } from '@/components/PhotoUpload'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DiaryDialog, LabourManager, PlantManager } from './diary-manage'

// ─── Types ───────────────────────────────────────────────────────────────────

export type DiaryEntry = {
  id: string
  date: string
  weather: string | null
  work_performed: string | null
  delays: string | null
  instructions: string | null
  visitors: string | null
  author: string | null
  labour: Array<{
    id: string
    name: string
    trade: string | null
    headcount: number
    hours: number
  }>
  plant: Array<{
    id: string
    name: string
    status: string
    hours: number
  }>
}

interface DiaryListProps {
  projectId: string
  entries: DiaryEntry[]
  attachmentsByDiary: Record<string, AttachmentItem[]>
  canManage: boolean
  plant: { id: string; name: string }[]
}

// ─── Range export form ───────────────────────────────────────────────────────

function RangeExport({ projectId, entries }: { projectId: string; entries: DiaryEntry[] }) {
  // Dates are date-desc; default the range to the span of existing entries.
  const newest = entries[0]?.date ?? ''
  const oldest = entries[entries.length - 1]?.date ?? ''
  const [from, setFrom] = useState(oldest)
  const [to, setTo] = useState(newest)

  function handleExport(e: React.FormEvent) {
    e.preventDefault()
    if (!from || !to) return
    window.open(`/api/pdf/diary-range/${projectId}?from=${from}&to=${to}`, '_blank')
  }

  return (
    <form
      onSubmit={handleExport}
      className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/40 px-4 py-3"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="diary-from" className="text-xs font-medium">
          From
        </label>
        <input
          id="diary-from"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-md border bg-background px-3 py-1.5 text-sm"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="diary-to" className="text-xs font-medium">
          To
        </label>
        <input
          id="diary-to"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-md border bg-background px-3 py-1.5 text-sm"
          required
        />
      </div>
      <Button type="submit" variant="outline" size="sm">
        <FileTextIcon className="size-4" />
        Export range PDF
      </Button>
    </form>
  )
}

// ─── Entry card ──────────────────────────────────────────────────────────────

function DetailBlock({ label, text }: { label: string; text: string | null }) {
  if (!text) return null
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="whitespace-pre-wrap text-sm">{text}</p>
    </div>
  )
}

function EntryCard({
  entry,
  attachments,
  projectId,
  canManage,
  plantOptions,
}: {
  entry: DiaryEntry
  attachments: AttachmentItem[]
  projectId: string
  canManage: boolean
  plantOptions: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const headcount = entry.labour.reduce((s, l) => s + l.headcount, 0)
  const totalLabourHours = entry.labour.reduce((s, l) => s + l.headcount * l.hours, 0)
  const photos = attachments.filter((a) => a.kind === 'photo')

  const excerpt =
    entry.work_performed && entry.work_performed.length > 140
      ? `${entry.work_performed.slice(0, 140)}…`
      : entry.work_performed

  const dateLabel = new Date(`${entry.date}T00:00:00`).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  return (
    <div className="rounded-xl border">
      {/* Summary row */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm font-semibold">{dateLabel}</span>
            {entry.weather && (
              <span className="text-xs text-muted-foreground">{entry.weather}</span>
            )}
          </div>
          {excerpt && <p className="text-sm text-muted-foreground">{excerpt}</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <HardHatIcon className="size-3.5" />
              {headcount} labour
            </span>
            <span className="flex items-center gap-1">
              <TruckIcon className="size-3.5" />
              {entry.plant.length} plant
            </span>
            <span className="flex items-center gap-1">
              <CameraIcon className="size-3.5" />
              {photos.length} photos
            </span>
            {entry.author && <span>{entry.author}</span>}
          </div>
        </div>
        {open ? (
          <ChevronUpIcon className="mt-1 size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="mt-1 size-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="flex flex-col gap-4 border-t px-4 py-4">
          <div className="flex justify-end gap-2">
            {canManage && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditOpen(true)}
              >
                <PencilIcon className="size-4" />
                Edit details
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => window.open(`/api/pdf/diary/${entry.id}`, '_blank')}
            >
              <FileTextIcon className="size-4" />
              Export PDF
            </Button>
          </div>
          {canManage && (
            <DiaryDialog
              projectId={projectId}
              entry={entry}
              open={editOpen}
              onOpenChange={setEditOpen}
            />
          )}

          <DetailBlock label="Work performed" text={entry.work_performed} />
          <DetailBlock label="Delays" text={entry.delays} />
          <DetailBlock label="Instructions received" text={entry.instructions} />
          <DetailBlock label="Visitors" text={entry.visitors} />

          {canManage ? (
            <LabourManager diaryId={entry.id} labour={entry.labour} />
          ) : (
            entry.labour.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Labour
              </p>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Trade</TableHead>
                      <TableHead className="text-right">Headcount</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entry.labour.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell>{l.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {l.trade ?? '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {l.headcount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{l.hours}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="font-medium">Total</TableCell>
                      <TableCell />
                      <TableCell className="text-right font-medium tabular-nums">
                        {headcount}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {totalLabourHours}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
            )
          )}

          {canManage ? (
            <PlantManager
              diaryId={entry.id}
              plant={entry.plant}
              plantOptions={plantOptions}
            />
          ) : (
            entry.plant.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Plant
              </p>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entry.plant.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{p.name}</TableCell>
                        <TableCell className="capitalize text-muted-foreground">
                          {p.status}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{p.hours}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            )
          )}

          {canManage ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Photos
              </p>
              <PhotoUpload
                parentType="diary"
                parentId={entry.id}
                kind="photo"
                capture
                multiple
                onUploaded={() => router.refresh()}
              />
              {photos.length > 0 && (
                <AttachmentList items={photos} canDelete />
              )}
            </div>
          ) : (
            photos.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Photos
                </p>
                <AttachmentList items={photos} canDelete={false} />
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main list ───────────────────────────────────────────────────────────────

export function DiaryList({
  projectId,
  entries,
  attachmentsByDiary,
  canManage,
  plant,
}: DiaryListProps) {
  const [createOpen, setCreateOpen] = useState(false)

  if (entries.length === 0) {
    if (!canManage) {
      return (
        <EmptyState
          icon={<BookOpenIcon className="size-8" />}
          title="No diary entries yet"
          description="Site diaries recorded in the field app will show up here."
        />
      )
    }
    return (
      <div className="flex flex-col gap-4">
        <div className="flex justify-end">
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-4" />
            New diary entry
          </Button>
        </div>
        <EmptyState
          icon={<BookOpenIcon className="size-8" />}
          title="No diary entries yet"
          description="Record a site diary for any past date, or capture entries from the field app."
        />
        <DiaryDialog projectId={projectId} open={createOpen} onOpenChange={setCreateOpen} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-4" />
            New diary entry
          </Button>
          <DiaryDialog projectId={projectId} open={createOpen} onOpenChange={setCreateOpen} />
        </div>
      )}
      <RangeExport projectId={projectId} entries={entries} />
      <div className="flex flex-col gap-3">
        {entries.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            attachments={attachmentsByDiary[entry.id] ?? []}
            projectId={projectId}
            canManage={canManage}
            plantOptions={plant}
          />
        ))}
      </div>
    </div>
  )
}
