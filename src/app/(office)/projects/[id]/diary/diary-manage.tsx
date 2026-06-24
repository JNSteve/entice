'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PlusIcon, Trash2Icon, PencilIcon, XIcon, CheckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import { WEATHER_OPTIONS, PLANT_STATUSES, type PlantStatus } from '@/lib/zod'
import type { DiaryEntry } from './diary-list'
import {
  saveProjectDiary,
  addLabourRow,
  updateLabourRow,
  deleteLabourRow,
  addPlantRow,
  deletePlantRow,
} from './actions'

// ─── Date + weather helpers ──────────────────────────────────────────────────

/** YYYY-MM-DD for today (local). */
function todayStr(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Splits a stored weather string back into select option + free-text note. */
function parseWeather(stored: string | null): { option: string; note: string } {
  if (!stored) return { option: '', note: '' }
  for (const opt of WEATHER_OPTIONS) {
    if (stored === opt) return { option: opt, note: '' }
    if (stored.startsWith(`${opt} — `)) {
      return { option: opt, note: stored.slice(opt.length + 3) }
    }
  }
  return { option: '', note: stored }
}

function mergeWeather(option: string, note: string): string {
  const trimmed = note.trim()
  if (option && trimmed) return `${option} — ${trimmed}`
  return option || trimmed
}

const WEATHER_NONE = 'none'
const PLANT_FREE_TEXT = '__free__'

// ─── Diary create / edit dialog ──────────────────────────────────────────────

interface DiaryDialogProps {
  projectId: string
  /** When set, dialog opens in edit mode (date locked). */
  entry?: DiaryEntry
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DiaryDialog({ projectId, entry, open, onOpenChange }: DiaryDialogProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const editing = Boolean(entry)

  const initialWeather = parseWeather(entry?.weather ?? null)
  const [date, setDate] = useState(entry?.date ?? todayStr())
  const [weatherOption, setWeatherOption] = useState(
    initialWeather.option || WEATHER_NONE
  )
  const [weatherNote, setWeatherNote] = useState(initialWeather.note)
  const [workPerformed, setWorkPerformed] = useState(entry?.work_performed ?? '')
  const [delays, setDelays] = useState(entry?.delays ?? '')
  const [instructions, setInstructions] = useState(entry?.instructions ?? '')
  const [visitors, setVisitors] = useState(entry?.visitors ?? '')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await saveProjectDiary({
        project_id: projectId,
        date,
        weather: mergeWeather(
          weatherOption === WEATHER_NONE ? '' : weatherOption,
          weatherNote
        ),
        work_performed: workPerformed,
        delays,
        instructions,
        visitors,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(editing ? 'Diary updated' : 'Diary entry created')
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit diary entry' : 'New diary entry'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dd-date">Date</Label>
              <Input
                id="dd-date"
                type="date"
                value={date}
                max={todayStr()}
                onChange={(e) => setDate(e.target.value)}
                disabled={editing}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dd-weather">Weather</Label>
              <Select
                value={weatherOption}
                onValueChange={(v) => setWeatherOption(v ?? WEATHER_NONE)}
              >
                <SelectTrigger id="dd-weather" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={WEATHER_NONE}>—</SelectItem>
                  {WEATHER_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dd-weather-note">Weather note (optional)</Label>
            <Input
              id="dd-weather-note"
              value={weatherNote}
              onChange={(e) => setWeatherNote(e.target.value)}
              placeholder="e.g. windy pm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dd-work">
              Work performed <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="dd-work"
              rows={4}
              required
              value={workPerformed}
              onChange={(e) => setWorkPerformed(e.target.value)}
              placeholder="What happened on site?"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dd-delays">Delays</Label>
            <Textarea
              id="dd-delays"
              rows={2}
              value={delays}
              onChange={(e) => setDelays(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dd-instructions">Instructions received</Label>
            <Textarea
              id="dd-instructions"
              rows={2}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dd-visitors">Visitors</Label>
            <Textarea
              id="dd-visitors"
              rows={2}
              value={visitors}
              onChange={(e) => setVisitors(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending
                ? 'Saving…'
                : editing
                  ? 'Save changes'
                  : 'Create entry'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Labour management ───────────────────────────────────────────────────────

type LabourRow = DiaryEntry['labour'][number]

function LabourRowItem({ row }: { row: LabourRow }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(row.name)
  const [trade, setTrade] = useState(row.trade ?? '')
  const [headcount, setHeadcount] = useState(String(row.headcount))
  const [hours, setHours] = useState(String(row.hours))

  function handleUpdate() {
    startTransition(async () => {
      const result = await updateLabourRow(row.id, { name, trade, headcount, hours })
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Labour row updated')
        setEditing(false)
        router.refresh()
      }
    })
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteLabourRow(row.id)
      if (result.error) toast.error(result.error)
      else {
        toast.success('Labour row removed')
        router.refresh()
      }
    })
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <div className="grid grid-cols-2 gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <Input value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="Trade" />
          <Input
            type="number"
            min={1}
            value={headcount}
            onChange={(e) => setHeadcount(e.target.value)}
            placeholder="Headcount"
          />
          <Input
            type="number"
            min={0}
            step={0.5}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="Hours"
          />
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={handleUpdate} disabled={pending} className="flex-1">
            <CheckIcon className="size-3.5" />
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing(false)}
            disabled={pending}
          >
            <XIcon className="size-3.5" />
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{row.name}</p>
        <p className="text-xs text-muted-foreground">
          {row.trade ? `${row.trade} · ` : ''}
          {row.headcount} × {row.hours}h
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => setEditing(true)}
        disabled={pending}
        aria-label={`Edit ${row.name}`}
      >
        <PencilIcon className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={handleDelete}
        disabled={pending}
        aria-label={`Remove ${row.name}`}
      >
        <Trash2Icon className="size-3.5 text-destructive" />
      </Button>
    </div>
  )
}

export function LabourManager({
  diaryId,
  labour,
}: {
  diaryId: string
  labour: LabourRow[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [trade, setTrade] = useState('')
  const [headcount, setHeadcount] = useState('1')
  const [hours, setHours] = useState('8')

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await addLabourRow({
        diary_id: diaryId,
        user_id: null,
        name,
        trade,
        headcount,
        hours,
      })
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Labour row added')
        setName('')
        setTrade('')
        setHeadcount('1')
        setHours('8')
        router.refresh()
      }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Labour
      </p>
      {labour.length > 0 && (
        <div className="flex flex-col gap-2">
          {labour.map((row) => (
            <LabourRowItem key={row.id} row={row} />
          ))}
        </div>
      )}
      <form onSubmit={handleAdd} className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name / crew"
            required
          />
          <Input
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
            placeholder="Trade"
          />
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Headcount</Label>
            <Input
              type="number"
              min={1}
              value={headcount}
              onChange={(e) => setHeadcount(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Hours</Label>
            <Input
              type="number"
              min={0}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              required
            />
          </div>
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={pending} className="self-start">
          <PlusIcon className="size-3.5" />
          Add labour
        </Button>
      </form>
    </div>
  )
}

// ─── Plant management ────────────────────────────────────────────────────────

type PlantRow = DiaryEntry['plant'][number]

export function PlantManager({
  diaryId,
  plant,
  plantOptions,
}: {
  diaryId: string
  plant: PlantRow[]
  plantOptions: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [selected, setSelected] = useState(plantOptions[0]?.id ?? PLANT_FREE_TEXT)
  const [freeName, setFreeName] = useState('')
  const [status, setStatus] = useState<PlantStatus>('working')
  const [hours, setHours] = useState('8')

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const fromRegister = plantOptions.find((p) => p.id === selected)
    const isFree = selected === PLANT_FREE_TEXT

    if (isFree && !freeName.trim()) {
      toast.error('Enter the plant name')
      return
    }

    startTransition(async () => {
      const result = await addPlantRow({
        diary_id: diaryId,
        plant_id: isFree ? null : selected,
        name: isFree ? freeName : (fromRegister?.name ?? ''),
        status,
        hours,
      })
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Plant row added')
        setFreeName('')
        setHours('8')
        router.refresh()
      }
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deletePlantRow(id)
      if (result.error) toast.error(result.error)
      else {
        toast.success('Plant row removed')
        router.refresh()
      }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Plant &amp; equipment
      </p>
      {plant.length > 0 && (
        <div className="flex flex-col gap-2">
          {plant.map((row) => (
            <div
              key={row.id}
              className="flex items-center gap-2 rounded-lg border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.name}</p>
                <p className="text-xs capitalize text-muted-foreground">
                  {row.status} · {row.hours}h
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => handleDelete(row.id)}
                disabled={pending}
                aria-label={`Remove ${row.name}`}
              >
                <Trash2Icon className="size-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAdd} className="flex flex-col gap-2">
        <Select value={selected} onValueChange={(v) => setSelected(v ?? PLANT_FREE_TEXT)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {plantOptions.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
            <SelectItem value={PLANT_FREE_TEXT}>Other (type a name)…</SelectItem>
          </SelectContent>
        </Select>

        {selected === PLANT_FREE_TEXT && (
          <Input
            value={freeName}
            onChange={(e) => setFreeName(e.target.value)}
            placeholder="Plant name, e.g. hired 5t excavator"
          />
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={(v) => v && setStatus(v as PlantStatus)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLANT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Hours</Label>
            <Input
              type="number"
              min={0}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              required
            />
          </div>
        </div>

        <Button type="submit" variant="outline" size="sm" disabled={pending} className="self-start">
          <PlusIcon className="size-3.5" />
          Add plant
        </Button>
      </form>
    </div>
  )
}
