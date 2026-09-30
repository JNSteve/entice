'use client'

import React, { useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { FileUpIcon, Loader2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { aud } from '@/lib/format'
import { round2 } from '@/lib/money'
import {
  guessColumns,
  parseCsvTable,
  PRICE_KIND_LABELS,
  PRICE_KINDS,
  rowsFromTable,
  toExGst,
  type ColumnMapping,
  type ImportLine,
  type LineStatus,
  type PriceKind,
} from '@/lib/price-list'
import {
  commitPriceListImport,
  extractPriceListPdf,
  listSuppliers,
  loadSupplierMapping,
  matchPriceLines,
} from '@/lib/price-list-actions'
import { createClient } from '@/lib/supabase/client'
import { buildStorageKey } from '@/lib/storage-keys'
import { cn } from '@/lib/utils'

type Cell = string | number | boolean | Date | null
type ReviewLine = ImportLine & { key: number; saveToList: boolean; addToJob: boolean }

export interface ImportJobTarget {
  parent_type: 'job' | 'project'
  parent_id: string
  label: string
}

interface PriceListImportProps {
  open: boolean
  onClose: () => void
  gstRate: number
  /** When set, lines can also be added to this job's costs. */
  job?: ImportJobTarget
}

function toImportLine(l: ReviewLine): ImportLine {
  return { code: l.code, name: l.name, unit: l.unit, unitPrice: l.unitPrice, qty: l.qty, kind: l.kind, note: l.note }
}

const SELECT = 'h-8 rounded-lg border bg-transparent px-2 text-base md:text-sm'
const today = () => new Date().toISOString().slice(0, 10)

function StatusBadge({ status, exPrice }: { status: LineStatus | undefined; exPrice: number }) {
  if (!status) return <span className="text-xs text-muted-foreground">…</span>
  if (status.status === 'new') return <Badge variant="outline" className="border-emerald-300 text-emerald-700">New</Badge>
  if (status.status === 'unchanged') return <span className="text-xs text-muted-foreground">Unchanged</span>
  const up = exPrice > status.oldCost
  return (
    <span className={cn('text-xs whitespace-nowrap', up ? 'text-red-600' : 'text-emerald-700')}>
      {aud(status.oldCost)} → {aud(exPrice)}
    </span>
  )
}

export function PriceListImport({ open, onClose, gstRate, job }: PriceListImportProps) {
  const [step, setStep] = useState<'source' | 'map' | 'review'>('source')
  const [pending, startTransition] = useTransition()
  const [reading, setReading] = useState(false)
  const [suppliers, setSuppliers] = useState<string[]>([])
  const [supplier, setSupplier] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [table, setTable] = useState<Cell[][] | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [incGst, setIncGst] = useState(false)
  const [gstDetected, setGstDetected] = useState<boolean | null>(null)
  const [lines, setLines] = useState<ReviewLine[]>([])
  const [skipped, setSkipped] = useState(0)
  const [statuses, setStatuses] = useState<LineStatus[] | null>(null)
  const [docDate, setDocDate] = useState(today())
  const [deactivateMissing, setDeactivateMissing] = useState(false)
  const [version, setVersion] = useState(0)
  const nextKey = useRef(0)

  useEffect(() => {
    if (!open) return
    listSuppliers().then(setSuppliers).catch(() => setSuppliers([]))
  }, [open])

  // Re-match against the saved price list whenever the supplier, GST basis or lines change.
  useEffect(() => {
    if (step !== 'review' || !supplier.trim() || lines.length === 0) return
    const t = setTimeout(async () => {
      const res = await matchPriceLines({
        supplier: supplier.trim(),
        pricesIncludeGst: incGst,
        lines: lines.map(toImportLine),
      })
      if (!res.error) setStatuses(res.statuses ?? null)
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, supplier, incGst, version])

  function reset() {
    setStep('source')
    setFile(null)
    setTable(null)
    setMapping(null)
    setIncGst(false)
    setGstDetected(null)
    setLines([])
    setSkipped(0)
    setStatuses(null)
    setDocDate(today())
    setDeactivateMissing(false)
  }

  function close() {
    reset()
    setSupplier('')
    onClose()
  }

  function toReview(importLines: ImportLine[]) {
    setLines(
      importLines.map((l) => ({
        ...l,
        key: nextKey.current++,
        saveToList: true,
        // Reusable equipment usually isn't a job cost — leave plant unticked.
        addToJob: Boolean(job) && l.kind !== 'plant',
      }))
    )
    setVersion((v) => v + 1)
    setStep('review')
  }

  async function readFile() {
    if (!file) return
    const name = file.name.toLowerCase()
    setReading(true)
    try {
      if (name.endsWith('.pdf')) {
        const supabase = createClient()
        const path = buildStorageKey('price-lists', file.name)
        const { error: upErr } = await supabase.storage
          .from('attachments')
          .upload(path, file, { contentType: 'application/pdf', upsert: false })
        if (upErr) {
          toast.error(upErr.message)
          return
        }
        const res = await extractPriceListPdf({ path })
        if (res.error || !res.result) {
          toast.error(res.error ?? 'Could not read that PDF')
          return
        }
        if (!supplier.trim() && res.result.supplier) setSupplier(res.result.supplier)
        setGstDetected(res.result.pricesIncludeGst)
        setIncGst(res.result.pricesIncludeGst ?? false)
        if (res.result.documentDate) setDocDate(res.result.documentDate)
        setMapping(null)
        setSkipped(0)
        toReview(res.result.lines)
        return
      }

      let rows: Cell[][]
      if (name.endsWith('.xlsx')) {
        const { default: readXlsxFile } = await import('read-excel-file')
        rows = (await readXlsxFile(file)) as Cell[][]
      } else if (name.endsWith('.csv') || name.endsWith('.txt')) {
        rows = parseCsvTable(await file.text())
      } else {
        toast.error('Use a .xlsx, .csv or .pdf file (save older .xls files as .xlsx first)')
        return
      }
      rows = rows.filter((r) => r.some((c) => c != null && String(c).trim() !== ''))
      if (rows.length === 0) {
        toast.error('That file has no rows')
        return
      }
      const width = Math.max(...rows.map((r) => r.length))
      const saved = supplier.trim() ? await loadSupplierMapping(supplier.trim()) : null
      const fits = (m: ColumnMapping) =>
        [m.name, m.cost, m.unit, m.code, m.kind, m.qty].every((i) => i == null || i < width)
      const guess = guessColumns(rows[0])
      const hasHeader = guess.name !== undefined || guess.cost !== undefined
      setMapping(
        saved && fits(saved)
          ? saved
          : {
              name: guess.name ?? 0,
              cost: guess.cost ?? Math.min(1, width - 1),
              unit: guess.unit ?? null,
              code: guess.code ?? null,
              kind: guess.kind ?? null,
              qty: guess.qty ?? null,
              headerRow: hasHeader,
              defaultKind: 'material',
            }
      )
      setTable(rows)
      setStep('map')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read that file')
    } finally {
      setReading(false)
    }
  }

  function applyMapping() {
    if (!table || !mapping) return
    // Keep prices as printed here; the GST switch converts on save.
    const { lines: out, skipped: s } = rowsFromTable(table, mapping, { pricesIncludeGst: false, gstRate })
    if (out.length === 0) {
      toast.error('No rows with a name and a price above $0 — check the column choices')
      return
    }
    setSkipped(s)
    toReview(out)
  }

  function updateLine(key: number, patch: Partial<ReviewLine>, rematch = false) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
    if (rematch) setVersion((v) => v + 1)
  }

  function setAll(field: 'saveToList' | 'addToJob', value: boolean) {
    setLines((ls) => ls.map((l) => ({ ...l, [field]: value })))
  }

  function save() {
    if (!supplier.trim()) {
      toast.error('Enter the supplier name')
      return
    }
    startTransition(async () => {
      const res = await commitPriceListImport({
        supplier: supplier.trim(),
        pricesIncludeGst: incGst,
        lines: lines.map((l) => ({ ...toImportLine(l), saveToList: l.saveToList, addToJob: Boolean(job) && l.addToJob })),
        deactivateMissing,
        mapping,
        job: job && lines.some((l) => l.addToJob) ? { parent_type: job.parent_type, parent_id: job.parent_id, date: docDate } : null,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      const parts = [
        res.added ? `${res.added} new` : null,
        res.updated ? `${res.updated} updated` : null,
        res.unchanged ? `${res.unchanged} unchanged` : null,
        res.deactivated ? `${res.deactivated} deactivated` : null,
        res.costsAdded ? `${res.costsAdded} cost${res.costsAdded === 1 ? '' : 's'} added to ${job?.label ?? 'the job'}` : null,
      ].filter(Boolean)
      toast.success(`Saved — ${parts.join(', ') || 'nothing changed'}`)
      close()
    })
  }

  const shownStatuses = supplier.trim() && statuses?.length === lines.length ? statuses : null
  const toList = lines.filter((l) => l.saveToList).length
  const toJob = job ? lines.filter((l) => l.addToJob) : []
  const jobTotal = round2(
    toJob.reduce((s, l) => s + (l.qty ?? 1) * toExGst(l.unitPrice, incGst, gstRate), 0)
  )
  const width = table ? Math.max(...table.map((r) => r.length)) : 0
  const columnOptions = Array.from({ length: width }, (_, i) => {
    const head = mapping?.headerRow && table ? String(table[0][i] ?? '').trim() : ''
    return { value: i, label: head ? `${String.fromCharCode(65 + (i % 26))} · ${head}` : `Column ${String.fromCharCode(65 + (i % 26))}` }
  })

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {step === 'source' && 'Import a supplier price list or document'}
            {step === 'map' && 'Match the columns'}
            {step === 'review' && 'Check before saving'}
          </DialogTitle>
        </DialogHeader>

        {step === 'source' && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              A spreadsheet price list (.xlsx or .csv), or a PDF price list, quote, proforma or invoice.
              Nothing is saved until you&apos;ve checked it.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pl-supplier">Supplier</Label>
              <Input
                id="pl-supplier"
                list="pl-suppliers"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder="e.g. Allens Industrial (read from PDFs automatically)"
              />
              <datalist id="pl-suppliers">
                {suppliers.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pl-file">File</Label>
              <Input
                id="pl-file"
                type="file"
                accept=".xlsx,.csv,.txt,.pdf,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                PDFs are read by AI (about 30–60 seconds) and only work on the live site.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={readFile} disabled={!file || reading}>
                {reading ? <Loader2Icon className="animate-spin" /> : <FileUpIcon />}
                {reading ? 'Reading…' : 'Read file'}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'map' && table && mapping && (
          <div className="flex flex-col gap-4">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <tbody>
                  {table.slice(0, 6).map((r, ri) => (
                    <tr key={ri} className={cn('border-b last:border-0', ri === 0 && mapping.headerRow && 'bg-muted/60 font-medium')}>
                      {Array.from({ length: width }, (_, ci) => (
                        <td key={ci} className="max-w-48 truncate px-2 py-1">
                          {r[ci] == null ? '' : String(r[ci])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={mapping.headerRow}
                onChange={(e) => setMapping({ ...mapping, headerRow: e.target.checked })}
              />
              First row is headings
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  ['name', 'Item name *', false],
                  ['cost', 'Unit price *', false],
                  ['unit', 'Unit', true],
                  ['code', 'Product code', true],
                  ['qty', 'Quantity (invoices)', true],
                ] as const
              ).map(([field, label, optional]) => (
                <div key={field} className="flex flex-col gap-1.5">
                  <Label>{label}</Label>
                  <select
                    className={SELECT}
                    value={mapping[field] ?? ''}
                    onChange={(e) =>
                      setMapping({ ...mapping, [field]: e.target.value === '' ? null : Number(e.target.value) })
                    }
                  >
                    {optional && <option value="">— none —</option>}
                    {columnOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div className="flex flex-col gap-1.5">
                <Label>Type</Label>
                <select
                  className={SELECT}
                  value={mapping.kind == null ? `all:${mapping.defaultKind}` : String(mapping.kind)}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v.startsWith('all:')) setMapping({ ...mapping, kind: null, defaultKind: v.slice(4) as PriceKind })
                    else setMapping({ ...mapping, kind: Number(v) })
                  }}
                >
                  {PRICE_KINDS.map((k) => (
                    <option key={k} value={`all:${k}`}>
                      Whole file: {PRICE_KIND_LABELS[k]}
                    </option>
                  ))}
                  {columnOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      From {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Back
              </Button>
              <Button onClick={applyMapping}>Continue</Button>
            </DialogFooter>
          </div>
        )}

        {step === 'review' && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pl-supplier-r">Supplier</Label>
                <Input
                  id="pl-supplier-r"
                  list="pl-suppliers"
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Prices on the document are</Label>
                <div className="inline-flex w-fit rounded-lg border p-0.5" role="radiogroup" aria-label="GST basis">
                  {([false, true] as const).map((v) => (
                    <button
                      key={String(v)}
                      type="button"
                      role="radio"
                      aria-checked={incGst === v}
                      onClick={() => setIncGst(v)}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-sm',
                        incGst === v ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {v ? 'Inc GST' : 'Ex GST'}
                    </button>
                  ))}
                </div>
                {gstDetected != null && (
                  <p className="text-xs text-muted-foreground">
                    Worked out from the document&apos;s totals: {gstDetected ? 'inc GST' : 'ex GST'}.
                  </p>
                )}
              </div>
              {job && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pl-date">Cost date</Label>
                  <Input id="pl-date" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className="w-40" />
                </div>
              )}
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium">
                      <label className="flex items-center gap-1 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={lines.length > 0 && lines.every((l) => l.saveToList)}
                          onChange={(e) => setAll('saveToList', e.target.checked)}
                        />
                        Price list
                      </label>
                    </th>
                    {job && (
                      <th className="px-2 py-2 text-left font-medium">
                        <label className="flex items-center gap-1 whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={lines.length > 0 && lines.every((l) => l.addToJob)}
                            onChange={(e) => setAll('addToJob', e.target.checked)}
                          />
                          Job cost
                        </label>
                      </th>
                    )}
                    <th className="px-2 py-2 text-left font-medium">Code</th>
                    <th className="px-2 py-2 text-left font-medium">Item</th>
                    <th className="px-2 py-2 text-left font-medium">Type</th>
                    <th className="px-2 py-2 text-left font-medium">Unit</th>
                    <th className="px-2 py-2 text-right font-medium">Price {incGst ? '(inc)' : ''}</th>
                    {incGst && <th className="px-2 py-2 text-right font-medium">Ex GST</th>}
                    {job && <th className="px-2 py-2 text-right font-medium">Qty</th>}
                    <th className="px-2 py-2 text-left font-medium">Price list</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const ex = toExGst(l.unitPrice, incGst, gstRate)
                    return (
                      <tr key={l.key} className={cn('border-t align-top', !l.saveToList && !l.addToJob && 'opacity-50')}>
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            aria-label={`Save ${l.name} to the price list`}
                            checked={l.saveToList}
                            onChange={(e) => updateLine(l.key, { saveToList: e.target.checked })}
                          />
                        </td>
                        {job && (
                          <td className="px-2 py-1.5">
                            <input
                              type="checkbox"
                              aria-label={`Add ${l.name} to the job costs`}
                              checked={l.addToJob}
                              onChange={(e) => updateLine(l.key, { addToJob: e.target.checked })}
                            />
                          </td>
                        )}
                        <td className="px-2 py-1.5">
                          <input
                            className="w-28 rounded border bg-transparent px-1.5 py-0.5 text-base md:text-sm"
                            value={l.code ?? ''}
                            onChange={(e) => updateLine(l.key, { code: e.target.value.trim() || null })}
                            onBlur={() => setVersion((v) => v + 1)}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            className="w-full min-w-56 rounded border bg-transparent px-1.5 py-0.5 text-base md:text-sm"
                            value={l.name}
                            onChange={(e) => updateLine(l.key, { name: e.target.value })}
                            onBlur={() => setVersion((v) => v + 1)}
                          />
                          {l.note && <div className="mt-0.5 text-xs text-muted-foreground">{l.note}</div>}
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            className={SELECT}
                            value={l.kind}
                            onChange={(e) => updateLine(l.key, { kind: e.target.value as PriceKind })}
                          >
                            {PRICE_KINDS.map((k) => (
                              <option key={k} value={k}>
                                {PRICE_KIND_LABELS[k]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            className="w-16 rounded border bg-transparent px-1.5 py-0.5 text-base md:text-sm"
                            value={l.unit}
                            onChange={(e) => updateLine(l.key, { unit: e.target.value })}
                            onBlur={() => setVersion((v) => v + 1)}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <input
                            type="number"
                            inputMode="decimal"
                            step="any"
                            min="0"
                            className="w-24 rounded border bg-transparent px-1.5 py-0.5 text-right tabular-nums text-base md:text-sm"
                            value={l.unitPrice}
                            onChange={(e) => updateLine(l.key, { unitPrice: Number(e.target.value) || 0 })}
                            onBlur={() => setVersion((v) => v + 1)}
                          />
                        </td>
                        {incGst && <td className="px-2 py-1.5 text-right tabular-nums">{aud(ex)}</td>}
                        {job && (
                          <td className="px-2 py-1.5 text-right">
                            <input
                              type="number"
                              inputMode="decimal"
                              step="any"
                              min="0"
                              className="w-16 rounded border bg-transparent px-1.5 py-0.5 text-right tabular-nums text-base md:text-sm"
                              value={l.qty ?? ''}
                              placeholder="1"
                              onChange={(e) => updateLine(l.key, { qty: Number(e.target.value) > 0 ? Number(e.target.value) : null })}
                            />
                          </td>
                        )}
                        <td className="px-2 py-1.5">
                          {l.saveToList ? <StatusBadge status={shownStatuses?.[i]} exPrice={ex} /> : <span className="text-xs text-muted-foreground">Not saved</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              {skipped > 0 && <p>{skipped} row{skipped === 1 ? '' : 's'} without a name or price were skipped.</p>}
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={deactivateMissing} onChange={(e) => setDeactivateMissing(e.target.checked)} />
                This is {supplier.trim() || 'the supplier'}&apos;s full price list — deactivate their items that aren&apos;t in it
              </label>
            </div>

            <DialogFooter className="items-center gap-3">
              <span className="mr-auto text-sm text-muted-foreground">
                {toList} to the price list
                {job ? ` · ${toJob.length} to ${job.label} (${aud(jobTotal)} ex GST)` : ''}
              </span>
              <Button variant="outline" onClick={() => (table ? setStep('map') : reset())} disabled={pending}>
                Back
              </Button>
              <Button onClick={save} disabled={pending || (toList === 0 && toJob.length === 0) || !supplier.trim()}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
