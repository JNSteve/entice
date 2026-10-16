'use client'

import { useEffect, useMemo, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckIcon, PencilIcon, Trash2Icon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  addUsage,
  deleteUsage,
  saveDayNote,
  searchCatalogue,
  updateUsage,
  type CatalogueHit,
} from './actions'

// ─── Types ───────────────────────────────────────────────────────────────────

export type ScopeLine = {
  id: string
  description: string
  unit: string | null
  section: string | null
}

export type PlantOption = {
  id: string
  name: string
  rego: string | null
}

export type UsageKind = 'material' | 'plant' | 'subbie'

export type UsageRow = {
  id: string
  user_id: string
  kind: UsageKind
  description: string
  qty: number | null
  unit: string | null
  company: string | null
  headcount: number | null
  hours: number | null
  notes: string | null
  quote_line_id: string | null
  rate_item_id: string | null
  plant_id: string | null
  created_at: string
  logged_by: string | null
}

interface Props {
  jobId: string | null
  projectId: string | null
  date: string
  dateLabel: string
  scope: ScopeLine[]
  plant: PlantOption[]
  rows: UsageRow[]
  summary: string
  currentUserId: string
}

type Picked = {
  description: string
  unit: string | null
  quote_line_id: string | null
  rate_item_id: string | null
  plant_id: string | null
}

const KIND_LABEL: Record<UsageKind, string> = {
  material: 'Material',
  plant: 'Plant',
  subbie: 'Subbie',
}

/** Parse a numeric text field; '' → null, garbage → NaN. */
function num(v: string): number | null {
  const t = v.trim()
  if (t === '') return null
  return Number(t)
}

function fmtNum(n: number | null): string {
  if (n == null) return ''
  return String(Number(n.toFixed(3)))
}

function describeRow(r: UsageRow): string {
  if (r.kind === 'subbie') {
    return `${r.company ?? r.description} — ${r.headcount ?? 1} × ${fmtNum(r.hours)} h`
  }
  const unit = r.unit ? ` ${r.unit}` : ''
  return `${r.description} — ${fmtNum(r.qty)}${unit}`
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function UsageClient({
  jobId,
  projectId,
  date,
  dateLabel,
  scope,
  plant,
  rows,
  summary,
  currentUserId,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      <AddCard jobId={jobId} projectId={projectId} date={date} scope={scope} plant={plant} />
      <LoggedList rows={rows} dateLabel={dateLabel} currentUserId={currentUserId} />
      <DayNoteCard jobId={jobId} projectId={projectId} date={date} initial={summary} />
    </div>
  )
}

// ─── Add card ────────────────────────────────────────────────────────────────

function AddCard({
  jobId,
  projectId,
  date,
  scope,
  plant,
}: {
  jobId: string | null
  projectId: string | null
  date: string
  scope: ScopeLine[]
  plant: PlantOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [kind, setKind] = useState<UsageKind>('material')

  // material / plant
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Picked | null>(null)
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('ea')
  const [notes, setNotes] = useState('')

  // subbie
  const [company, setCompany] = useState('')
  const [headcount, setHeadcount] = useState('1')
  const [hours, setHours] = useState('')

  function resetAll() {
    setQuery('')
    setPicked(null)
    setQty('')
    setUnit(kind === 'plant' ? 'hrs' : 'ea')
    setNotes('')
    setCompany('')
    setHeadcount('1')
    setHours('')
  }

  function switchKind(k: UsageKind) {
    setKind(k)
    setQuery('')
    setPicked(null)
    setQty('')
    setUnit(k === 'plant' ? 'hrs' : 'ea')
  }

  function pick(p: Picked) {
    setPicked(p)
    if (kind === 'material') setUnit(p.unit?.trim() || 'ea')
  }

  function handleAdd() {
    const base = { job_id: jobId, project_id: projectId, date, kind, notes: notes || null }
    const payload =
      kind === 'subbie'
        ? {
            ...base,
            description: company,
            company,
            headcount: num(headcount),
            hours: num(hours),
          }
        : {
            ...base,
            description: picked?.description ?? '',
            qty: num(qty),
            unit: kind === 'plant' ? 'hrs' : unit || 'ea',
            quote_line_id: picked?.quote_line_id ?? null,
            rate_item_id: picked?.rate_item_id ?? null,
            plant_id: picked?.plant_id ?? null,
          }

    if (kind !== 'subbie' && !picked) {
      toast.error(kind === 'plant' ? 'Pick a machine first' : 'Pick what was used first')
      return
    }

    startTransition(async () => {
      const res = await addUsage(payload)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Added')
      resetAll()
      router.refresh()
    })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-0">
        <p className="text-sm font-semibold">Add</p>

        <div className="grid grid-cols-3 gap-1 rounded-lg border p-1" role="tablist">
          {(['material', 'plant', 'subbie'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => switchKind(k)}
              className={`rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
                kind === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
              }`}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        {kind === 'subbie' ? (
          <>
            <Field label="Company">
              <Input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="e.g. ABC Scaffolding"
                maxLength={200}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="People">
                <Input
                  inputMode="numeric"
                  value={headcount}
                  onChange={(e) => setHeadcount(e.target.value)}
                />
              </Field>
              <Field label="Hours each">
                <Input
                  inputMode="decimal"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  placeholder="8"
                />
              </Field>
            </div>
          </>
        ) : picked ? (
          <>
            <div className="flex items-start justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{picked.description}</p>
                {picked.quote_line_id && (
                  <p className="text-xs text-muted-foreground">From the agreed scope</p>
                )}
                {picked.rate_item_id && (
                  <p className="text-xs text-muted-foreground">From the price list</p>
                )}
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Change"
                onClick={() => setPicked(null)}
              >
                <XIcon />
              </Button>
            </div>
            {kind === 'material' ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Qty">
                  <Input
                    inputMode="decimal"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    autoFocus
                  />
                </Field>
                <Field label="Unit">
                  <Input value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={20} />
                </Field>
              </div>
            ) : (
              <Field label="Hours">
                <Input
                  inputMode="decimal"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder="8"
                  autoFocus
                />
              </Field>
            )}
          </>
        ) : kind === 'material' ? (
          <MaterialPicker scope={scope} query={query} setQuery={setQuery} onPick={pick} />
        ) : (
          <PlantPicker plant={plant} query={query} setQuery={setQuery} onPick={pick} />
        )}

        {(kind === 'subbie' || picked) && (
          <>
            <Field label="Notes (optional)">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
            </Field>
            <Button onClick={handleAdd} disabled={pending} className="w-full">
              {pending ? 'Adding…' : 'Add'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
    </label>
  )
}

function PickRow({ label, sub, onClick }: { label: string; sub?: string | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted active:bg-muted"
    >
      <span className="min-w-0 truncate">{label}</span>
      {sub && <span className="shrink-0 text-xs text-muted-foreground">{sub}</span>}
    </button>
  )
}

function GroupHeading({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  )
}

// ─── Material picker ─────────────────────────────────────────────────────────

function MaterialPicker({
  scope,
  query,
  setQuery,
  onPick,
}: {
  scope: ScopeLine[]
  query: string
  setQuery: (q: string) => void
  onPick: (p: Picked) => void
}) {
  const [hits, setHits] = useState<CatalogueHit[]>([])
  const [searching, setSearching] = useState(false)
  const q = query.trim()
  const active = q.length >= 2

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const t = setTimeout(async () => {
      setSearching(true)
      const res = await searchCatalogue(q)
      if (!cancelled) {
        setHits(res)
        setSearching(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q, active])

  const filteredScope = useMemo(() => {
    if (!active) return scope
    const needle = q.toLowerCase()
    return scope.filter((s) => s.description.toLowerCase().includes(needle))
  }, [scope, q, active])

  // Group by section, preserving order.
  const groups = useMemo(() => {
    const out: { section: string | null; lines: ScopeLine[] }[] = []
    for (const line of filteredScope) {
      const last = out[out.length - 1]
      if (last && last.section === line.section) last.lines.push(line)
      else out.push({ section: line.section, lines: [line] })
    }
    return out
  }, [filteredScope])

  const visibleHits = active ? hits : []

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search materials…"
        type="search"
      />
      <div className="max-h-80 overflow-y-auto rounded-lg border">
        {q && (
          <PickRow
            label={`Use “${q}”`}
            onClick={() =>
              onPick({
                description: q,
                unit: null,
                quote_line_id: null,
                rate_item_id: null,
                plant_id: null,
              })
            }
          />
        )}

        {filteredScope.length > 0 && (
          <>
            <p className="px-2 pt-2 text-xs font-semibold text-foreground">From the agreed scope</p>
            {groups.map((g, i) => (
              <div key={`${g.section ?? ''}-${i}`}>
                {g.section && <GroupHeading>{g.section}</GroupHeading>}
                {g.lines.map((l) => (
                  <PickRow
                    key={l.id}
                    label={l.description}
                    sub={l.unit}
                    onClick={() =>
                      onPick({
                        description: l.description,
                        unit: l.unit,
                        quote_line_id: l.id,
                        rate_item_id: null,
                        plant_id: null,
                      })
                    }
                  />
                ))}
              </div>
            ))}
          </>
        )}

        {active && (
          <>
            <p className="px-2 pt-2 text-xs font-semibold text-foreground">From the price list</p>
            {searching && visibleHits.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">Searching…</p>
            ) : visibleHits.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">No matches</p>
            ) : (
              visibleHits.map((h) => (
                <PickRow
                  key={h.id}
                  label={h.name}
                  sub={[h.unit, h.supplier].filter(Boolean).join(' · ') || null}
                  onClick={() =>
                    onPick({
                      description: h.name,
                      unit: h.unit,
                      quote_line_id: null,
                      rate_item_id: h.id,
                      plant_id: null,
                    })
                  }
                />
              ))
            )}
          </>
        )}

        {!q && scope.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Type to search the price list, or enter anything.
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Plant picker ────────────────────────────────────────────────────────────

function PlantPicker({
  plant,
  query,
  setQuery,
  onPick,
}: {
  plant: PlantOption[]
  query: string
  setQuery: (q: string) => void
  onPick: (p: Picked) => void
}) {
  const q = query.trim()
  const filtered = useMemo(() => {
    if (!q) return plant
    const needle = q.toLowerCase()
    return plant.filter(
      (p) => p.name.toLowerCase().includes(needle) || (p.rego ?? '').toLowerCase().includes(needle)
    )
  }, [plant, q])

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search plant or type a machine…"
        type="search"
      />
      <div className="max-h-80 overflow-y-auto rounded-lg border">
        {q && (
          <PickRow
            label={`Use “${q}”`}
            onClick={() =>
              onPick({
                description: q,
                unit: 'hrs',
                quote_line_id: null,
                rate_item_id: null,
                plant_id: null,
              })
            }
          />
        )}
        {filtered.length > 0 && <GroupHeading>Plant register</GroupHeading>}
        {filtered.map((p) => (
          <PickRow
            key={p.id}
            label={p.name}
            sub={p.rego}
            onClick={() =>
              onPick({
                description: p.rego ? `${p.name} (${p.rego})` : p.name,
                unit: 'hrs',
                quote_line_id: null,
                rate_item_id: null,
                plant_id: p.id,
              })
            }
          />
        ))}
        {!q && plant.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            No plant in the register — type the machine name.
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Logged list ─────────────────────────────────────────────────────────────

function LoggedList({
  rows,
  dateLabel,
  currentUserId,
}: {
  rows: UsageRow[]
  dateLabel: string
  currentUserId: string
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-0">
        <p className="text-sm font-semibold">{`Logged for ${dateLabel}`}</p>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing logged yet.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {rows.map((r) => (
              <UsageRowItem key={r.id} row={r} mine={r.user_id === currentUserId} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function UsageRowItem({ row, mine }: { row: UsageRow; mine: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [qty, setQty] = useState(fmtNum(row.qty))
  const [unit, setUnit] = useState(row.unit ?? '')
  const [headcount, setHeadcount] = useState(String(row.headcount ?? 1))
  const [hours, setHours] = useState(fmtNum(row.hours))
  const [notes, setNotes] = useState(row.notes ?? '')

  function startEdit() {
    setQty(fmtNum(row.qty))
    setUnit(row.unit ?? '')
    setHeadcount(String(row.headcount ?? 1))
    setHours(fmtNum(row.hours))
    setNotes(row.notes ?? '')
    setEditing(true)
  }

  function handleSave() {
    const payload =
      row.kind === 'subbie'
        ? {
            kind: row.kind,
            description: row.company ?? row.description,
            company: row.company ?? row.description,
            headcount: num(headcount),
            hours: num(hours),
            notes: notes || null,
          }
        : {
            kind: row.kind,
            description: row.description,
            qty: num(qty),
            unit: unit || (row.kind === 'plant' ? 'hrs' : 'ea'),
            quote_line_id: row.quote_line_id,
            rate_item_id: row.rate_item_id,
            plant_id: row.plant_id,
            notes: notes || null,
          }
    startTransition(async () => {
      const res = await updateUsage(row.id, payload)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Updated')
      setEditing(false)
      router.refresh()
    })
  }

  function handleDelete() {
    if (!window.confirm('Delete this entry?')) return
    startTransition(async () => {
      const res = await deleteUsage(row.id)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Deleted')
      router.refresh()
    })
  }

  return (
    <li className="flex flex-col gap-2 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {KIND_LABEL[row.kind]}
            </Badge>
            <p className="text-sm">{describeRow(row)}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {[row.logged_by ?? 'Unknown', row.notes].filter(Boolean).join(' · ')}
          </p>
        </div>
        {mine && !editing && (
          <div className="flex shrink-0 gap-1">
            <Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={startEdit} disabled={pending}>
              <PencilIcon />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Delete"
              onClick={handleDelete}
              disabled={pending}
            >
              <Trash2Icon />
            </Button>
          </div>
        )}
      </div>

      {editing && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-2">
          {row.kind === 'subbie' ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="People">
                <Input inputMode="numeric" value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
              </Field>
              <Field label="Hours each">
                <Input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Field label={row.kind === 'plant' ? 'Hours' : 'Qty'}>
                <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
              </Field>
              <Field label="Unit">
                <Input value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={20} />
              </Field>
            </div>
          )}
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </Field>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={handleSave} disabled={pending}>
              <CheckIcon className="mr-1 size-3.5" />
              {pending ? 'Saving…' : 'Save'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

// ─── Day note ────────────────────────────────────────────────────────────────

function DayNoteCard({
  jobId,
  projectId,
  date,
  initial,
}: {
  jobId: string | null
  projectId: string | null
  date: string
  initial: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [summary, setSummary] = useState(initial)
  const dirty = summary !== initial

  function handleSave() {
    startTransition(async () => {
      const res = await saveDayNote({ job_id: jobId, project_id: projectId, date, summary })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Saved')
      router.refresh()
    })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-0">
        <p className="text-sm font-semibold">Today&apos;s work</p>
        <p className="text-xs text-muted-foreground">
          A short description of the work done — goes on the client&apos;s daily sign-off.
        </p>
        <Textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={4}
          maxLength={4000}
          placeholder="e.g. Removed eaves lining to rear of house, bagged and wrapped."
        />
        <Button onClick={handleSave} disabled={pending || !dirty} className="w-full">
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </CardContent>
    </Card>
  )
}
