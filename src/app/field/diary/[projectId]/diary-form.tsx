'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  PlusIcon,
  Trash2Icon,
  PencilIcon,
  XIcon,
  CheckIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PhotoUpload } from '@/components/PhotoUpload'
import { AttachmentList, type AttachmentItem } from '@/components/AttachmentList'
import { WEATHER_OPTIONS, type PlantStatus } from '@/lib/zod'
import {
  saveDiary,
  addLabourRow,
  updateLabourRow,
  deleteLabourRow,
  addPlantRow,
  deletePlantRow,
} from './actions'

// ─── Types ───────────────────────────────────────────────────────────────────

export type DiaryData = {
  id: string
  weather: string | null
  work_performed: string
  delays: string
  instructions: string
  visitors: string
}

export type LabourRow = {
  id: string
  user_id: string | null
  name: string
  trade: string | null
  headcount: number
  hours: number
}

export type PlantRow = {
  id: string
  plant_id: string | null
  name: string
  status: PlantStatus
  hours: number
}

export type PlantOption = {
  id: string
  name: string
  type: string | null
}

export type LabourSuggestion = {
  user_id: string
  name: string
}

interface Props {
  projectId: string
  date: string
  diary: DiaryData | null
  labour: LabourRow[]
  plant: PlantRow[]
  photos: AttachmentItem[]
  plantOptions: PlantOption[]
  suggestions: LabourSuggestion[]
}

// ─── Weather helpers ─────────────────────────────────────────────────────────

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

// ─── Shared field styles (mobile-first, chunky) ──────────────────────────────

const inputCls =
  'rounded-xl border bg-background px-3 py-2.5 text-base w-full md:text-sm'
const labelCls = 'text-xs font-medium'

// ─── Diary details form ──────────────────────────────────────────────────────

function DetailsSection({
  projectId,
  date,
  diary,
}: {
  projectId: string
  date: string
  diary: DiaryData | null
}) {
  const initial = parseWeather(diary?.weather ?? null)
  const [pending, startTransition] = useTransition()
  const [weatherOption, setWeatherOption] = useState(initial.option)
  const [weatherNote, setWeatherNote] = useState(initial.note)
  const [workPerformed, setWorkPerformed] = useState(diary?.work_performed ?? '')
  const [delays, setDelays] = useState(diary?.delays ?? '')
  const [instructions, setInstructions] = useState(diary?.instructions ?? '')
  const [visitors, setVisitors] = useState(diary?.visitors ?? '')

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await saveDiary({
        project_id: projectId,
        date,
        weather: mergeWeather(weatherOption, weatherNote),
        work_performed: workPerformed,
        delays,
        instructions,
        visitors,
      })
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Diary saved')
      }
    })
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Weather</label>
          <select
            className={inputCls}
            value={weatherOption}
            onChange={(e) => setWeatherOption(e.target.value)}
          >
            <option value="">—</option>
            {WEATHER_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Weather note</label>
          <input
            type="text"
            className={inputCls}
            placeholder="e.g. windy pm"
            value={weatherNote}
            onChange={(e) => setWeatherNote(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>
          Work performed <span className="text-destructive">*</span>
        </label>
        <textarea
          className={inputCls}
          rows={4}
          required
          placeholder="What happened on site today?"
          value={workPerformed}
          onChange={(e) => setWorkPerformed(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Delays</label>
        <textarea
          className={inputCls}
          rows={2}
          value={delays}
          onChange={(e) => setDelays(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Instructions received</label>
        <textarea
          className={inputCls}
          rows={2}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Visitors</label>
        <textarea
          className={inputCls}
          rows={2}
          value={visitors}
          onChange={(e) => setVisitors(e.target.value)}
        />
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Saving…' : diary ? 'Save diary' : 'Save diary to continue'}
      </Button>
    </form>
  )
}

// ─── Labour section ──────────────────────────────────────────────────────────

function LabourRowItem({ row }: { row: LabourRow }) {
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(row.name)
  const [trade, setTrade] = useState(row.trade ?? '')
  const [headcount, setHeadcount] = useState(String(row.headcount))
  const [hours, setHours] = useState(String(row.hours))

  function handleUpdate() {
    startTransition(async () => {
      const result = await updateLabourRow(row.id, {
        name,
        trade,
        headcount,
        hours,
      })
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Labour row updated')
        setEditing(false)
      }
    })
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteLabourRow(row.id)
      if (result.error) toast.error(result.error)
      else toast.success('Labour row removed')
    })
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border p-3">
        <div className="grid grid-cols-2 gap-2">
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
          />
          <input
            className={inputCls}
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
            placeholder="Trade"
          />
          <input
            className={inputCls}
            type="number"
            min={1}
            value={headcount}
            onChange={(e) => setHeadcount(e.target.value)}
            placeholder="Headcount"
          />
          <input
            className={inputCls}
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
    <div className="flex items-center gap-2 rounded-xl border px-3 py-2.5">
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

function LabourSection({
  diaryId,
  labour,
  suggestions,
}: {
  diaryId: string
  labour: LabourRow[]
  suggestions: LabourSuggestion[]
}) {
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [trade, setTrade] = useState('')
  const [headcount, setHeadcount] = useState('1')
  const [hours, setHours] = useState('8')

  // Hide chips for people already on the sheet.
  const onSheet = new Set(labour.map((l) => l.user_id).filter(Boolean))
  const chips = suggestions.filter((s) => !onSheet.has(s.user_id))

  function addChip(s: LabourSuggestion) {
    startTransition(async () => {
      const result = await addLabourRow({
        diary_id: diaryId,
        user_id: s.user_id,
        name: s.name,
        headcount: 1,
        hours: 8,
      })
      if (result.error) toast.error(result.error)
      else toast.success(`${s.name} added`)
    })
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await addLabourRow({
        diary_id: diaryId,
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
      }
    })
  }

  const totalHeadcount = labour.reduce((s, l) => s + l.headcount, 0)

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Labour</h2>
        {labour.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {totalHeadcount} on site
          </span>
        )}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((s) => (
            <button
              key={s.user_id}
              type="button"
              onClick={() => addChip(s)}
              disabled={pending}
              className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted active:bg-muted disabled:opacity-50"
            >
              <PlusIcon className="size-3" />
              {s.name}
            </button>
          ))}
        </div>
      )}

      {labour.length > 0 && (
        <div className="flex flex-col gap-2">
          {labour.map((row) => (
            <LabourRowItem key={row.id} row={row} />
          ))}
        </div>
      )}

      <form onSubmit={handleAdd} className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name / crew"
            required
          />
          <input
            className={inputCls}
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
            placeholder="Trade"
          />
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Headcount</label>
            <input
              className={inputCls}
              type="number"
              min={1}
              value={headcount}
              onChange={(e) => setHeadcount(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Hours</label>
            <input
              className={inputCls}
              type="number"
              min={0}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              required
            />
          </div>
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          <PlusIcon className="size-3.5" />
          Add labour
        </Button>
      </form>
    </div>
  )
}

// ─── Plant section ───────────────────────────────────────────────────────────

const FREE_TEXT = '__free__'

function PlantSection({
  diaryId,
  plant,
  plantOptions,
}: {
  diaryId: string
  plant: PlantRow[]
  plantOptions: PlantOption[]
}) {
  const [pending, startTransition] = useTransition()
  const [selected, setSelected] = useState(plantOptions[0]?.id ?? FREE_TEXT)
  const [freeName, setFreeName] = useState('')
  const [status, setStatus] = useState<PlantStatus>('working')
  const [hours, setHours] = useState('8')

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const fromRegister = plantOptions.find((p) => p.id === selected)
    const isFree = selected === FREE_TEXT

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
      }
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deletePlantRow(id)
      if (result.error) toast.error(result.error)
      else toast.success('Plant row removed')
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-sm font-semibold">Plant &amp; equipment</h2>

      {plant.length > 0 && (
        <div className="flex flex-col gap-2">
          {plant.map((row) => (
            <div key={row.id} className="flex items-center gap-2 rounded-xl border px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.name}</p>
                <p className="text-xs text-muted-foreground capitalize">
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
        <select
          className={inputCls}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {plantOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.type ? ` (${p.type})` : ''}
            </option>
          ))}
          <option value={FREE_TEXT}>Other (type a name)…</option>
        </select>

        {selected === FREE_TEXT && (
          <input
            className={inputCls}
            value={freeName}
            onChange={(e) => setFreeName(e.target.value)}
            placeholder="Plant name, e.g. hired 5t excavator"
          />
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Status</label>
            <select
              className={inputCls}
              value={status}
              onChange={(e) => setStatus(e.target.value as PlantStatus)}
            >
              <option value="working">Working</option>
              <option value="idle">Idle</option>
              <option value="down">Down</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Hours</label>
            <input
              className={inputCls}
              type="number"
              min={0}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              required
            />
          </div>
        </div>

        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          <PlusIcon className="size-3.5" />
          Add plant
        </Button>
      </form>
    </div>
  )
}

// ─── Main form ───────────────────────────────────────────────────────────────

export function DiaryForm({
  projectId,
  date,
  diary,
  labour,
  plant,
  photos,
  plantOptions,
  suggestions,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      <DetailsSection projectId={projectId} date={date} diary={diary} />

      {diary ? (
        <>
          <LabourSection diaryId={diary.id} labour={labour} suggestions={suggestions} />
          <PlantSection diaryId={diary.id} plant={plant} plantOptions={plantOptions} />

          <div className="flex flex-col gap-3 rounded-xl border p-4">
            <h2 className="text-sm font-semibold">Photos</h2>
            <PhotoUpload
              parentType="diary"
              parentId={diary.id}
              kind="photo"
              capture
              multiple
            />
            {photos.length > 0 && <AttachmentList items={photos} canDelete />}
          </div>
        </>
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-3 text-center text-sm text-muted-foreground">
          Save the diary first to add labour, plant and photos.
        </p>
      )}
    </div>
  )
}
