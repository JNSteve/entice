'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import {
  addDays,
  differenceInCalendarDays,
  format,
  getDate,
  isMonday,
  isWeekend,
  parseISO,
} from 'date-fns'
import { toast } from 'sonner'
import { PlusIcon } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import { fmtDate } from '@/lib/format'
import {
  createProgrammeTask,
  deleteProgrammeTask,
  updateProgrammeTask,
} from './actions'

export type ProgrammeTask = {
  id: string
  name: string
  phase: string | null
  start_date: string // YYYY-MM-DD
  end_date: string // YYYY-MM-DD
  progress_pct: number
  position: number
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const COL_W: Record<Zoom, number> = { week: 24, month: 6 }
const HEADER_H = 'h-8' // timeline header + left-pane header
const PHASE_H = 'h-8' // phase group rows
const TASK_H = 'h-12' // task rows

type Zoom = 'week' | 'month'

// ─── Phase colours (hash phase name → 6-colour palette) ──────────────────────

type Colour = { bar: string; fill: string; dot: string }

const PALETTE: Colour[] = [
  { bar: 'bg-sky-200 dark:bg-sky-900', fill: 'bg-sky-500', dot: 'bg-sky-500' },
  { bar: 'bg-emerald-200 dark:bg-emerald-900', fill: 'bg-emerald-500', dot: 'bg-emerald-500' },
  { bar: 'bg-amber-200 dark:bg-amber-900', fill: 'bg-amber-500', dot: 'bg-amber-500' },
  { bar: 'bg-violet-200 dark:bg-violet-900', fill: 'bg-violet-500', dot: 'bg-violet-500' },
  { bar: 'bg-rose-200 dark:bg-rose-900', fill: 'bg-rose-500', dot: 'bg-rose-500' },
  { bar: 'bg-teal-200 dark:bg-teal-900', fill: 'bg-teal-500', dot: 'bg-teal-500' },
]

const NEUTRAL: Colour = {
  bar: 'bg-zinc-200 dark:bg-zinc-800',
  fill: 'bg-zinc-500',
  dot: 'bg-zinc-500',
}

function phaseColour(phase: string | null): Colour {
  if (!phase) return NEUTRAL
  let h = 0
  for (let i = 0; i < phase.length; i++) h = (h * 31 + phase.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

function iso(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

// ─── Gantt ────────────────────────────────────────────────────────────────────

export function Gantt({
  projectId,
  tasks: serverTasks,
  projectStartDate,
  canDelete,
}: {
  projectId: string
  tasks: ProgrammeTask[]
  projectStartDate: string | null
  canDelete: boolean
}) {
  const [tasks, setTasks] = useState(serverTasks)
  const [zoom, setZoom] = useState<Zoom>('week')
  const [dialog, setDialog] = useState<{
    task: ProgrammeTask | null
    defaultPhase?: string
  } | null>(null)
  const [, startTransition] = useTransition()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Re-sync optimistic state whenever the server sends fresh rows
  // (state-adjust-during-render pattern — avoids an effect re-render cascade).
  const [prevServerTasks, setPrevServerTasks] = useState(serverTasks)
  if (prevServerTasks !== serverTasks) {
    setPrevServerTasks(serverTasks)
    setTasks(serverTasks)
  }

  const colW = COL_W[zoom]

  // ── Range: min(start)−7d → max(end)+14d (empty: project start or today → +90d)
  const { rangeStart, totalDays } = useMemo(() => {
    if (tasks.length === 0) {
      const base = projectStartDate ? parseISO(projectStartDate) : new Date()
      return { rangeStart: base, totalDays: 91 }
    }
    let min = tasks[0].start_date
    let max = tasks[0].end_date
    for (const t of tasks) {
      if (t.start_date < min) min = t.start_date
      if (t.end_date > max) max = t.end_date
    }
    const start = addDays(parseISO(min), -7)
    const end = addDays(parseISO(max), 14)
    return {
      rangeStart: start,
      totalDays: differenceInCalendarDays(end, start) + 1,
    }
  }, [tasks, projectStartDate])

  const days = useMemo(
    () => Array.from({ length: totalDays }, (_, i) => addDays(rangeStart, i)),
    [rangeStart, totalDays]
  )
  const rangeEnd = days[days.length - 1]
  const todayIdx = differenceInCalendarDays(new Date(), rangeStart)
  const todayInRange = todayIdx >= 0 && todayIdx < totalDays

  // ── Group tasks by phase (first-appearance order, tasks ordered by position)
  const groups = useMemo(() => {
    const out: { phase: string | null; tasks: ProgrammeTask[] }[] = []
    const idx = new Map<string, number>()
    for (const t of tasks) {
      const key = t.phase ?? ''
      const at = idx.get(key)
      if (at === undefined) {
        idx.set(key, out.length)
        out.push({ phase: t.phase, tasks: [t] })
      } else {
        out[at].tasks.push(t)
      }
    }
    return out
  }, [tasks])

  const phases = useMemo(
    () =>
      Array.from(
        new Set(tasks.map((t) => t.phase).filter((p): p is string => !!p))
      ),
    [tasks]
  )

  // Scroll so today sits about a quarter in from the left edge.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !todayInRange) return
    el.scrollLeft = Math.max(0, todayIdx * colW - el.clientWidth / 4)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  // ── Optimistic drag commit ────────────────────────────────────────────────
  function commitDates(id: string, start_date: string, end_date: string) {
    const prev = tasks
    setTasks((ts) =>
      ts.map((t) => (t.id === id ? { ...t, start_date, end_date } : t))
    )
    startTransition(async () => {
      const res = await updateProgrammeTask(id, projectId, {
        start_date,
        end_date,
      })
      if (res.error) {
        toast.error(res.error)
        setTasks(prev)
      }
    })
  }

  // ── Timeline header labels ────────────────────────────────────────────────
  const headerLabels = useMemo(() => {
    const labels: { idx: number; text: string }[] = []
    days.forEach((d, i) => {
      if (zoom === 'week') {
        if (isMonday(d)) labels.push({ idx: i, text: format(d, 'EEE d MMM') })
      } else if (getDate(d) === 1 || i === 0) {
        labels.push({ idx: i, text: format(d, 'MMM yyyy') })
      }
    })
    return labels
  }, [days, zoom])

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">Programme</h2>
          <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
            {fmtDate(rangeStart)} – {fmtDate(rangeEnd)} · {totalDays} days
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border p-0.5">
            {(['week', 'month'] as const).map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZoom(z)}
                className={cn(
                  'rounded px-2.5 py-1 text-xs capitalize transition-colors',
                  zoom === z
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {z}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => setDialog({ task: null })}>
            <PlusIcon className="size-4" />
            Add task
          </Button>
        </div>
      </div>

      {/* Two-pane gantt */}
      <div className="flex overflow-hidden rounded-md border">
        {/* Left: fixed task list */}
        <div className="w-56 shrink-0 border-r sm:w-64">
          <div
            className={cn(
              HEADER_H,
              'flex items-center border-b bg-muted/40 px-3 text-xs font-medium text-muted-foreground'
            )}
          >
            Task
          </div>
          {groups.length === 0 && (
            <div className="px-3 py-6 text-xs text-muted-foreground">
              No tasks yet — add your first task to start the programme.
            </div>
          )}
          {groups.map((g) => (
            <div key={g.phase ?? '∅'}>
              <div
                className={cn(
                  PHASE_H,
                  'flex items-center gap-2 border-b bg-muted/40 px-3'
                )}
              >
                <span
                  className={cn('size-2 shrink-0 rounded-full', phaseColour(g.phase).dot)}
                />
                <span className="truncate text-xs font-medium">
                  {g.phase ?? 'No phase'}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {g.tasks.length}
                </span>
                <button
                  type="button"
                  className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground"
                  title={`Add task to ${g.phase ?? 'no phase'}`}
                  onClick={() =>
                    setDialog({ task: null, defaultPhase: g.phase ?? undefined })
                  }
                >
                  <PlusIcon className="size-3.5" />
                </button>
              </div>
              {g.tasks.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setDialog({ task: t })}
                  className={cn(
                    TASK_H,
                    'flex w-full flex-col justify-center gap-0.5 border-b border-border/60 px-3 text-left hover:bg-muted/40'
                  )}
                >
                  <span className="w-full truncate text-sm">{t.name}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {format(parseISO(t.start_date), 'dd/MM')} –{' '}
                    {format(parseISO(t.end_date), 'dd/MM')} ·{' '}
                    {Math.round(t.progress_pct)}%
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Right: timeline (single horizontal scroll container) */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto">
          <div style={{ width: totalDays * colW }}>
            {/* Header */}
            <div className={cn(HEADER_H, 'relative border-b bg-muted/40')}>
              {headerLabels.map((l) => (
                <span
                  key={l.idx}
                  className="absolute top-0 flex h-full items-center whitespace-nowrap border-l border-border/60 pl-1.5 text-[10px] text-muted-foreground"
                  style={{ left: l.idx * colW }}
                >
                  {l.text}
                </span>
              ))}
            </div>

            {/* Body */}
            <div className="relative">
              {/* Weekend stripes */}
              {days.map(
                (d, i) =>
                  isWeekend(d) && (
                    <div
                      key={i}
                      className="absolute inset-y-0 bg-muted"
                      style={{ left: i * colW, width: colW }}
                    />
                  )
              )}
              {/* Today line */}
              {todayInRange && (
                <div
                  className="pointer-events-none absolute inset-y-0 z-20 w-[2px] bg-red-500/80"
                  style={{ left: todayIdx * colW + colW / 2 }}
                />
              )}

              {groups.length === 0 && <div className="h-14" />}
              {groups.map((g) => (
                <div key={g.phase ?? '∅'} className="relative">
                  <div className={cn(PHASE_H, 'border-b bg-muted/20')} />
                  {g.tasks.map((t) => (
                    <TaskBar
                      key={t.id}
                      task={t}
                      colour={phaseColour(t.phase)}
                      rangeStart={rangeStart}
                      colW={colW}
                      onCommit={commitDates}
                      onOpen={(task) => setDialog({ task })}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Drag a bar to move it, drag its edges to change the dates, or click a
        task to edit everything in a dialog.
      </p>

      {dialog && (
        <TaskDialog
          key={dialog.task?.id ?? 'new'}
          projectId={projectId}
          task={dialog.task}
          defaultPhase={dialog.defaultPhase}
          phases={phases}
          canDelete={canDelete}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

// ─── Task bar (drag to move, edge handles to resize, click to edit) ──────────

type DragMode = 'move' | 'resize-l' | 'resize-r'

function TaskBar({
  task,
  colour,
  rangeStart,
  colW,
  onCommit,
  onOpen,
}: {
  task: ProgrammeTask
  colour: Colour
  rangeStart: Date
  colW: number
  onCommit: (id: string, start: string, end: string) => void
  onOpen: (task: ProgrammeTask) => void
}) {
  const [preview, setPreview] = useState<{ start: Date; end: Date } | null>(null)
  const drag = useRef<{
    mode: DragMode
    originX: number
    origStart: Date
    origEnd: Date
    moved: boolean
  } | null>(null)

  const start = preview?.start ?? parseISO(task.start_date)
  const end = preview?.end ?? parseISO(task.end_date)
  const startIdx = differenceInCalendarDays(start, rangeStart)
  const dur = differenceInCalendarDays(end, start) + 1
  const left = startIdx * colW
  const width = dur * colW
  const labelInside = width >= 72
  const progress = Math.max(0, Math.min(100, task.progress_pct))

  function applyDelta(mode: DragMode, origStart: Date, origEnd: Date, delta: number) {
    const durDays = differenceInCalendarDays(origEnd, origStart)
    if (mode === 'move') {
      return { start: addDays(origStart, delta), end: addDays(origEnd, delta) }
    }
    if (mode === 'resize-l') {
      return { start: addDays(origStart, Math.min(delta, durDays)), end: origEnd }
    }
    return { start: origStart, end: addDays(origEnd, Math.max(delta, -durDays)) }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const handle = (e.target as HTMLElement)
      .closest('[data-handle]')
      ?.getAttribute('data-handle')
    drag.current = {
      mode: handle === 'l' ? 'resize-l' : handle === 'r' ? 'resize-r' : 'move',
      originX: e.clientX,
      origStart: parseISO(task.start_date),
      origEnd: parseISO(task.end_date),
      moved: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.originX
    if (Math.abs(dx) > 3) d.moved = true
    const delta = Math.round(dx / colW)
    setPreview(applyDelta(d.mode, d.origStart, d.origEnd, delta))
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    drag.current = null
    setPreview(null)
    if (!d) return
    if (!d.moved) {
      onOpen(task)
      return
    }
    const delta = Math.round((e.clientX - d.originX) / colW)
    const next = applyDelta(d.mode, d.origStart, d.origEnd, delta)
    const ns = iso(next.start)
    const ne = iso(next.end)
    if (ns !== task.start_date || ne !== task.end_date) {
      onCommit(task.id, ns, ne)
    }
  }

  function onPointerCancel() {
    drag.current = null
    setPreview(null)
  }

  return (
    <div className={cn(TASK_H, 'relative border-b border-border/60')}>
      <div
        role="button"
        aria-label={`${task.name} — drag to reschedule, click to edit`}
        title={`${task.name}\n${fmtDate(start)} → ${fmtDate(end)} · ${Math.round(progress)}%`}
        className={cn(
          'absolute top-2.5 z-10 h-7 cursor-grab touch-none select-none overflow-hidden rounded',
          colour.bar,
          preview && 'cursor-grabbing opacity-90 ring-2 ring-foreground/30'
        )}
        style={{ left, width }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {/* Progress fill */}
        <div
          className={cn('absolute inset-y-0 left-0', colour.fill)}
          style={{ width: `${progress}%` }}
        />
        {/* Resize handles */}
        <div
          data-handle="l"
          className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize"
        />
        <div
          data-handle="r"
          className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize"
        />
        {labelInside && (
          <span className="absolute inset-y-0 left-2 right-2 flex items-center truncate text-[11px] font-medium text-zinc-900 dark:text-zinc-50">
            {task.name}
          </span>
        )}
      </div>
      {!labelInside && (
        <span
          className="pointer-events-none absolute top-2.5 flex h-7 items-center whitespace-nowrap text-[11px] text-muted-foreground"
          style={{ left: left + width + 6 }}
        >
          {task.name}
        </span>
      )}
    </div>
  )
}

// ─── Add / edit dialog (keyboard-accessible fallback for all drag actions) ───

function TaskDialog({
  projectId,
  task,
  defaultPhase,
  phases,
  canDelete,
  onClose,
}: {
  projectId: string
  task: ProgrammeTask | null
  defaultPhase?: string
  phases: string[]
  canDelete: boolean
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()

  const today = iso(new Date())
  const [name, setName] = useState(task?.name ?? '')
  const [phase, setPhase] = useState(task?.phase ?? defaultPhase ?? '')
  const [startDate, setStartDate] = useState(task?.start_date ?? today)
  const [endDate, setEndDate] = useState(
    task?.end_date ?? iso(addDays(new Date(), 6))
  )
  const [progress, setProgress] = useState(
    task ? Math.round(task.progress_pct) : 0
  )

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const payload = {
        name,
        phase: phase || null,
        start_date: startDate,
        end_date: endDate,
        progress_pct: progress,
      }
      const result = task
        ? await updateProgrammeTask(task.id, projectId, payload)
        : await createProgrammeTask({ ...payload, project_id: projectId })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(task ? 'Task updated' : 'Task added')
      onClose()
    })
  }

  function handleDelete() {
    if (!task) return
    if (!confirm('Delete this programme task? This cannot be undone.')) return
    startTransition(async () => {
      const result = await deleteProgrammeTask(task.id, projectId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Task deleted')
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{task ? 'Edit task' : 'New task'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pt-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="pt-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bulk excavation"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pt-phase">Phase</Label>
            <Input
              id="pt-phase"
              value={phase}
              onChange={(e) => setPhase(e.target.value)}
              placeholder="e.g. Bulk works"
              list="pt-phase-options"
            />
            <datalist id="pt-phase-options">
              {phases.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pt-start">
                Start <span className="text-destructive">*</span>
              </Label>
              <Input
                id="pt-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pt-end">
                End <span className="text-destructive">*</span>
              </Label>
              <Input
                id="pt-end"
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pt-progress">Progress</Label>
            <div className="flex items-center gap-3">
              <input
                id="pt-progress"
                type="range"
                min={0}
                max={100}
                step={5}
                value={progress}
                onChange={(e) => setProgress(Number(e.target.value))}
                className="flex-1 accent-foreground"
              />
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={progress}
                  onChange={(e) =>
                    setProgress(
                      Math.max(0, Math.min(100, Number(e.target.value) || 0))
                    )
                  }
                  className="w-20 text-right tabular-nums"
                  aria-label="Progress percent"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            {task && canDelete && (
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={handleDelete}
                className="sm:mr-auto"
              >
                Delete
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? 'Saving…' : task ? 'Save changes' : 'Add task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
