'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { MoneyInput } from '@/components/MoneyInput'
import { aud, pct } from '@/lib/format'
import { RATE_KINDS, type RateKind } from '@/lib/zod'
import { importRateItems, setRateItemActive, upsertRateItem } from './actions'
import { ActiveBadge, ToggleActiveButton } from './users-section'
import { ListIcon, PencilIcon, PlusIcon, UploadIcon } from 'lucide-react'

export interface RateItemRow {
  id: string
  kind: RateKind
  name: string
  unit: string
  cost: number
  default_markup_pct: number
  active: boolean
}

const KIND_LABELS: Record<RateKind, string> = {
  labour: 'Labour',
  plant: 'Plant',
  material: 'Material',
  subbie: 'Subbie',
  other: 'Other',
}

export function RatesSection({ rateItems }: { rateItems: RateItemRow[] }) {
  const [kindFilter, setKindFilter] = useState<'all' | RateKind>('all')

  const filtered =
    kindFilter === 'all'
      ? rateItems
      : rateItems.filter((r) => r.kind === kindFilter)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <Select
          value={kindFilter}
          onValueChange={(v) => setKindFilter(v as 'all' | RateKind)}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            {RATE_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <ImportCsvDialog />
          <RateItemDialog />
        </div>
      </div>
      <DataTable
        columns={[
          {
            key: 'kind',
            header: 'Kind',
            render: (r: RateItemRow) => (
              <Badge variant="secondary">{KIND_LABELS[r.kind] ?? r.kind}</Badge>
            ),
          },
          {
            key: 'name',
            header: 'Name',
            render: (r: RateItemRow) => (
              <span className="font-medium">{r.name}</span>
            ),
          },
          {
            key: 'unit',
            header: 'Unit',
            render: (r: RateItemRow) => (
              <span className="text-muted-foreground">{r.unit}</span>
            ),
          },
          {
            key: 'cost',
            header: 'Cost',
            className: 'text-right',
            render: (r: RateItemRow) => (
              <span className="block text-right tabular-nums">{aud(r.cost)}</span>
            ),
          },
          {
            key: 'markup',
            header: 'Markup',
            className: 'text-right',
            render: (r: RateItemRow) => (
              <span className="block text-right tabular-nums">
                {pct(r.default_markup_pct)}
              </span>
            ),
          },
          {
            key: 'active',
            header: 'Status',
            render: (r: RateItemRow) => <ActiveBadge active={r.active} />,
          },
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            className: 'w-0',
            render: (r: RateItemRow) => (
              <div className="flex items-center justify-end gap-1">
                <RateItemDialog item={r} />
                <ToggleActiveButton
                  active={r.active}
                  label={r.name}
                  onToggle={(active) => setRateItemActive(r.id, active)}
                />
              </div>
            ),
          },
        ]}
        rows={filtered}
        getRowKey={(r) => r.id}
        empty={
          <EmptyState
            icon={<ListIcon className="size-8" />}
            title={
              kindFilter === 'all'
                ? 'No rate items yet'
                : `No ${KIND_LABELS[kindFilter as RateKind].toLowerCase()} rates yet`
            }
            description="Add rate items to speed up quoting."
          />
        }
      />
    </div>
  )
}

function RateItemDialog({ item }: { item?: RateItemRow }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [kind, setKind] = useState<RateKind>(item?.kind ?? 'labour')
  const [name, setName] = useState(item?.name ?? '')
  const [unit, setUnit] = useState(item?.unit ?? 'ea')
  const [cost, setCost] = useState<number | null>(item?.cost ?? null)
  const [markup, setMarkup] = useState(String(item?.default_markup_pct ?? 20))

  function reset() {
    if (!item) {
      setKind('labour')
      setName('')
      setUnit('ea')
      setCost(null)
      setMarkup('20')
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await upsertRateItem({
        id: item?.id,
        kind,
        name,
        unit,
        cost: cost ?? 0,
        default_markup_pct: markup,
        active: item?.active ?? true,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(item ? 'Rate item updated' : 'Rate item added')
      setOpen(false)
      reset()
    })
  }

  return (
    <>
      {item ? (
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)}>
          <PencilIcon />
          <span className="sr-only">Edit rate item</span>
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <PlusIcon />
          New rate item
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{item ? 'Edit rate item' : 'New rate item'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ri-kind">Kind</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as RateKind)}>
                <SelectTrigger id="ri-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RATE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ri-name">Name</Label>
              <Input
                id="ri-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Labourer — standard"
                required
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ri-unit">Unit</Label>
                <Input
                  id="ri-unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="hr"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ri-cost">Cost (AUD)</Label>
                <MoneyInput value={cost} onChange={setCost} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ri-markup">Markup %</Label>
                <Input
                  id="ri-markup"
                  type="number"
                  min={0}
                  max={1000}
                  step="0.01"
                  value={markup}
                  onChange={(e) => setMarkup(e.target.value)}
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : item ? 'Save changes' : 'Add rate item'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── CSV import ───────────────────────────────────────────────────────────────

const IMPORT_COLUMNS = ['kind', 'name', 'unit', 'cost', 'default_markup_pct']

interface ParsedRow {
  kind: string
  name: string
  unit: string
  cost: string
  default_markup_pct: string
  error: string | null
}

// Minimal CSV cell splitter: splits on commas and strips a single pair of
// surrounding double-quotes. This does NOT handle commas embedded inside quoted
// fields — good enough for the simple kind,name,unit,cost,markup rate format.
function splitCsvLine(line: string): string[] {
  return line.split(',').map((cell) => {
    const t = cell.trim()
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
      return t.slice(1, -1).trim()
    }
    return t
  })
}

function parseCsv(text: string): ParsedRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) return []

  const firstCells = splitCsvLine(lines[0])
  const firstCellLower = firstCells[0]?.toLowerCase() ?? ''
  const headerless = (RATE_KINDS as readonly string[]).includes(firstCellLower)

  // Map each import column to its position in the row.
  let colIndex: Record<string, number>
  let dataLines: string[]
  if (headerless) {
    colIndex = { kind: 0, name: 1, unit: 2, cost: 3, default_markup_pct: 4 }
    dataLines = lines
  } else {
    const headers = firstCells.map((h) => h.toLowerCase())
    colIndex = {}
    for (const col of IMPORT_COLUMNS) {
      colIndex[col] = headers.indexOf(col)
    }
    dataLines = lines.slice(1)
  }

  return dataLines.map((line) => {
    const cells = splitCsvLine(line)
    const get = (col: string) => {
      const i = colIndex[col]
      return i >= 0 ? (cells[i] ?? '') : ''
    }
    const kind = get('kind').toLowerCase()
    const name = get('name')
    const unit = get('unit')
    const cost = get('cost')
    const markup = get('default_markup_pct')

    let error: string | null = null
    if (!(RATE_KINDS as readonly string[]).includes(kind)) {
      error = `Bad kind "${get('kind')}"`
    } else if (!name) {
      error = 'Missing name'
    } else if (!unit) {
      error = 'Missing unit'
    } else if (cost === '' || !Number.isFinite(Number(cost)) || Number(cost) < 0) {
      error = 'Bad cost'
    } else if (
      markup === '' ||
      !Number.isFinite(Number(markup)) ||
      Number(markup) < 0 ||
      Number(markup) > 1000
    ) {
      error = 'Bad markup'
    }

    return { kind, name, unit, cost, default_markup_pct: markup, error }
  })
}

function ImportCsvDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [text, setText] = useState('')

  const rows = parseCsv(text)
  const validRows = rows.filter((r) => r.error === null)
  const invalidCount = rows.length - validRows.length
  const canImport = validRows.length > 0 && invalidCount === 0

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result ?? ''))
    reader.readAsText(file)
    // Allow re-selecting the same file later.
    e.target.value = ''
  }

  function handleImport() {
    if (!canImport) return
    startTransition(async () => {
      const result = await importRateItems(
        validRows.map((r) => ({
          kind: r.kind,
          name: r.name,
          unit: r.unit,
          cost: r.cost,
          default_markup_pct: r.default_markup_pct,
        }))
      )
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(
        `${result.added ?? 0} added, ${result.updated ?? 0} updated`
      )
      setText('')
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <UploadIcon />
        Import CSV
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import rate items from CSV</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Columns: kind, name, unit, cost, default_markup_pct (any order; a
              header row is optional). Matching active rows (same kind + name) are
              updated; the rest are added. Nothing is ever deleted.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="csv-file">Upload a .csv file</Label>
              <Input
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                onChange={handleFile}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="csv-text">Or paste CSV</Label>
              <Textarea
                id="csv-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="kind,name,unit,cost,default_markup_pct&#10;labour,Labourer — standard,hr,55,20"
                rows={5}
                className="font-mono text-xs"
              />
            </div>

            {rows.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {rows.length} row{rows.length === 1 ? '' : 's'} parsed
                  </span>
                  <span
                    className={
                      invalidCount > 0
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                    }
                  >
                    {validRows.length} valid
                    {invalidCount > 0 ? `, ${invalidCount} with errors` : ''}
                  </span>
                </div>
                <div className="max-h-64 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kind</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead className="text-right">Markup %</TableHead>
                        <TableHead>Note</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>{r.kind || '—'}</TableCell>
                          <TableCell className="font-medium">
                            {r.name || '—'}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {r.unit || '—'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.cost || '—'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.default_markup_pct || '—'}
                          </TableCell>
                          <TableCell>
                            {r.error ? (
                              <span className="text-xs text-destructive">
                                {r.error}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                OK
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              onClick={handleImport}
              disabled={!canImport || pending}
            >
              {pending
                ? 'Importing…'
                : `Import ${validRows.length} row${
                    validRows.length === 1 ? '' : 's'
                  }`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
