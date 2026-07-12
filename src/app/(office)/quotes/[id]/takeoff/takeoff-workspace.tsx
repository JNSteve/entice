'use client'

import React, { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { PhotoUpload } from '@/components/PhotoUpload'
import { createClient } from '@/lib/supabase/client'
import { aud } from '@/lib/format'
import { round2 } from '@/lib/money'
import { areaM2, lengthM, wasteTonnes, WASTE_PRESETS, type Pt } from '@/lib/takeoff'
import { cn } from '@/lib/utils'
import {
  BlocksIcon,
  CalculatorIcon,
  FileTextIcon,
  FileUpIcon,
  PlusIcon,
  SendIcon,
  SparklesIcon,
  Trash2Icon,
} from 'lucide-react'
import { TakeoffCanvas, SHAPE_COLORS, type CanvasItem } from './takeoff-canvas'
import {
  addTakeoffItem,
  applyAssembly,
  calibrateSheet,
  createTakeoffSheet,
  deleteTakeoffItem,
  deleteTakeoffSheet,
  ingestReportTakeoff,
  pushTakeoffToQuote,
  saveSheetSnapshot,
  updateTakeoffItem,
} from './actions'

// ─── Types (shaped by the server page) ───────────────────────────────────────

export interface SheetData {
  id: string
  name: string
  page: number
  scale_m_per_pt: number | null
  signedUrl: string | null
}

export interface TakeoffItemRow {
  id: string
  sheet_id: string | null
  source: 'measured' | 'manual' | 'report' | 'assembly'
  shape: 'area' | 'line' | 'count' | null
  geometry: Pt[] | null
  deduction: boolean
  color: string | null
  description: string
  qty: number
  unit: string
  rate_item_id: string | null
  unit_cost: number | null
  markup_pct: number | null
  section_title: string | null
  notes: string | null
}

export interface TakeoffRateItem {
  id: string
  kind: string
  name: string
  unit: string
  cost: number
  default_markup_pct: number
}

export interface AssemblyOption {
  id: string
  name: string
  unit: string
  description: string | null
}

export interface PlanAttachment {
  id: string
  filename: string
  signedUrl: string | null
}

const SOURCE_LABEL: Record<TakeoffItemRow['source'], string> = {
  measured: 'Measured',
  manual: 'Manual',
  report: 'Report',
  assembly: 'Assembly',
}

const NONE = '__none__'

// Draft being confirmed in the item dialog.
interface ItemDraft {
  id?: string
  sheet_id: string | null
  source: TakeoffItemRow['source']
  shape: TakeoffItemRow['shape']
  geometry: Pt[] | null
  deduction: boolean
  color: string | null
  description: string
  qty: string
  unit: string
  rate_item_id: string | null
  unit_cost: string
  markup_pct: string
  section_title: string
  notes: string
  /** Transient multipliers for NEW measured shapes — never stored as-is. */
  depth: string
  pitch: string
  height: string
}

function emptyDraft(): ItemDraft {
  return {
    sheet_id: null,
    source: 'manual',
    shape: null,
    geometry: null,
    deduction: false,
    color: null,
    description: '',
    qty: '',
    unit: 'ea',
    rate_item_id: null,
    unit_cost: '',
    markup_pct: '',
    section_title: '',
    notes: '',
    depth: '',
    pitch: '',
    height: '',
  }
}

/**
 * Applies the transient depth/pitch/height multipliers to a NEW measured
 * shape: area × pitch stays m², area × depth becomes m³, line × height
 * becomes m². Returns the adjusted qty/unit and a derivation note.
 */
function applyMultipliers(draft: ItemDraft): {
  qty: string
  unit: string
  note: string | null
} {
  const base = parseFloat(draft.qty)
  if (draft.id || !Number.isFinite(base)) {
    return { qty: draft.qty, unit: draft.unit, note: null }
  }
  const depth = parseFloat(draft.depth)
  const pitch = parseFloat(draft.pitch)
  const height = parseFloat(draft.height)
  let qty = base
  let unit = draft.unit
  const parts: string[] = []
  if (draft.shape === 'area') {
    if (Number.isFinite(pitch) && pitch > 0 && pitch !== 1) {
      qty *= pitch
      parts.push(`× ${pitch} pitch`)
    }
    if (Number.isFinite(depth) && depth > 0) {
      qty *= depth
      unit = 'm3'
      parts.push(`× ${depth}m depth`)
    }
  } else if (draft.shape === 'line') {
    if (Number.isFinite(height) && height > 0) {
      qty *= height
      unit = 'm2'
      parts.push(`× ${height}m height`)
    }
  }
  if (parts.length === 0) {
    return { qty: draft.qty, unit: draft.unit, note: null }
  }
  return {
    qty: String(Math.round(qty * 1000) / 1000),
    unit,
    note: `Measured ${base} ${draft.unit} ${parts.join(' ')}`,
  }
}

export function TakeoffWorkspace({
  quoteId,
  editable,
  sheets,
  items,
  rateItems,
  assemblies,
  planAttachments,
  sectionTitles,
}: {
  quoteId: string
  editable: boolean
  sheets: SheetData[]
  items: TakeoffItemRow[]
  rateItems: TakeoffRateItem[]
  assemblies: AssemblyOption[]
  planAttachments: PlanAttachment[]
  sectionTitles: string[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [activeSheetId, setActiveSheetId] = useState<string | null>(
    sheets[0]?.id ?? null
  )
  const [deduction, setDeduction] = useState(false)
  const [itemDraft, setItemDraft] = useState<ItemDraft | null>(null)
  const [newSheetOpen, setNewSheetOpen] = useState(false)
  const [sheetName, setSheetName] = useState('')
  const [sheetAttachment, setSheetAttachment] = useState<string | null>(null)
  const [sheetPage, setSheetPage] = useState('1')
  const [wasteOpen, setWasteOpen] = useState(false)
  const [wastePreset, setWastePreset] = useState(WASTE_PRESETS[0].label)
  const [wasteQty, setWasteQty] = useState('')
  const [wasteKg, setWasteKg] = useState(String(WASTE_PRESETS[0].kgPerUnit))
  const [assemblyOpen, setAssemblyOpen] = useState(false)
  const [assemblyId, setAssemblyId] = useState<string | null>(assemblies[0]?.id ?? null)
  const [assemblyQty, setAssemblyQty] = useState('')
  const [assemblySection, setAssemblySection] = useState('')
  const [extractOpen, setExtractOpen] = useState(false)
  const [extractAttachment, setExtractAttachment] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)

  const [hiddenColors, setHiddenColors] = useState<Set<string>>(new Set())

  const activeSheet = sheets.find((s) => s.id === activeSheetId) ?? null
  const allSheetItems = useMemo(
    () =>
      items.filter(
        (i): i is TakeoffItemRow & { shape: NonNullable<TakeoffItemRow['shape']>; geometry: Pt[] } =>
          i.sheet_id === activeSheetId && i.shape !== null && !!i.geometry
      ),
    [items, activeSheetId]
  )

  // Colour legend: one chip per distinct colour on the active sheet.
  const legend = useMemo(() => {
    const byColor = new Map<string, { label: string; count: number }>()
    for (const i of allSheetItems) {
      const color = i.color ?? SHAPE_COLORS[0]
      const entry = byColor.get(color)
      if (entry) entry.count++
      else byColor.set(color, { label: i.description, count: 1 })
    }
    return [...byColor.entries()].map(([color, v]) => ({ color, ...v }))
  }, [allSheetItems])

  const sheetItems: CanvasItem[] = useMemo(
    () =>
      allSheetItems
        .filter((i) => !hiddenColors.has(i.color ?? SHAPE_COLORS[0]))
        .map((i) => ({
          id: i.id,
          shape: i.shape,
          geometry: i.geometry,
          color: i.color,
          deduction: i.deduction,
          description: i.description,
          qty: i.qty,
          unit: i.unit,
        })),
    [allSheetItems, hiddenColors]
  )

  const totals = useMemo(() => {
    let cost = 0
    let sell = 0
    for (const i of items) {
      const sign = i.deduction ? -1 : 1
      const c = (i.unit_cost ?? 0) * i.qty * sign
      cost += c
      sell += c * (1 + (i.markup_pct ?? 20) / 100)
    }
    return { cost: round2(cost), sell: round2(sell) }
  }, [items])

  // ── Canvas callbacks ─────────────────────────────────────────────────────────

  function handleShapeComplete(
    shape: 'area' | 'line' | 'count',
    geometry: Pt[],
    qty: number,
    unit: string
  ) {
    setItemDraft({
      ...emptyDraft(),
      sheet_id: activeSheetId,
      source: 'measured',
      shape,
      geometry,
      deduction: shape !== 'count' && deduction,
      color: SHAPE_COLORS[items.length % SHAPE_COLORS.length],
      qty: String(qty),
      unit,
    })
  }

  /**
   * Vertex drag committed on the canvas — persist and re-derive the qty.
   * Items whose unit was converted away from the shape's natural unit (e.g.
   * area × depth → m³) keep their qty: the multiplier isn't stored, so a
   * recompute would silently produce the wrong unit.
   */
  function handleGeometryEdited(itemId: string, geometry: Pt[]) {
    const item = items.find((i) => i.id === itemId)
    if (!item || !item.shape) return
    const naturalUnit =
      item.shape === 'area' ? 'm2' : item.shape === 'line' ? 'm' : 'ea'
    let qty = item.qty
    let qtyKept = false
    if (item.shape === 'count') {
      qty = geometry.length
    } else if (item.source === 'measured' && activeSheet?.scale_m_per_pt) {
      if (item.unit === naturalUnit) {
        qty =
          item.shape === 'area'
            ? areaM2(geometry, activeSheet.scale_m_per_pt)
            : lengthM(geometry, activeSheet.scale_m_per_pt)
      } else {
        qtyKept = true
      }
    }
    startTransition(async () => {
      const result = await updateTakeoffItem(item.id, quoteId, {
        quote_id: quoteId,
        sheet_id: item.sheet_id,
        source: item.source,
        shape: item.shape,
        geometry,
        deduction: item.deduction,
        color: item.color,
        description: item.description,
        qty: String(qty),
        unit: item.unit,
        rate_item_id: item.rate_item_id,
        unit_cost: item.unit_cost === null ? null : String(item.unit_cost),
        markup_pct: item.markup_pct === null ? null : String(item.markup_pct),
        section_title: item.section_title || undefined,
        notes: item.notes || undefined,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(
        qtyKept
          ? 'Shape updated — converted quantity kept, adjust it if the new size changes it'
          : 'Shape updated'
      )
      router.refresh()
    })
  }

  /** Composited PNG from the canvas → storage upload → record on the sheet. */
  async function handleSnapshot(blob: Blob) {
    if (!activeSheetId) return
    const supabase = createClient()
    const path = `takeoff-snapshots/${activeSheetId}-${Date.now()}.png`
    const { error: uploadError } = await supabase.storage
      .from('attachments')
      .upload(path, blob, { contentType: 'image/png', upsert: false })
    if (uploadError) {
      toast.error(uploadError.message)
      return
    }
    const result = await saveSheetSnapshot(activeSheetId, quoteId, path)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success('Snapshot saved — it prints in the Schedule PDF')
  }

  function handleCalibrated(mPerPt: number) {
    if (!activeSheetId) return
    startTransition(async () => {
      const result = await calibrateSheet(activeSheetId, quoteId, {
        scale_m_per_pt: mPerPt,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Sheet calibrated — measurements now in metres')
      router.refresh()
    })
  }

  // ── Item dialog save ─────────────────────────────────────────────────────────

  function saveItemDraft() {
    if (!itemDraft) return
    const derived = applyMultipliers(itemDraft)
    const payload = {
      quote_id: quoteId,
      sheet_id: itemDraft.sheet_id,
      source: itemDraft.source,
      shape: itemDraft.shape,
      geometry: itemDraft.geometry,
      deduction: itemDraft.deduction,
      color: itemDraft.color,
      description: itemDraft.description,
      qty: derived.qty,
      unit: derived.unit,
      rate_item_id: itemDraft.rate_item_id,
      unit_cost: itemDraft.unit_cost === '' ? null : itemDraft.unit_cost,
      markup_pct: itemDraft.markup_pct === '' ? null : itemDraft.markup_pct,
      section_title: itemDraft.section_title || undefined,
      notes:
        [derived.note, itemDraft.notes].filter(Boolean).join('. ') || undefined,
    }
    startTransition(async () => {
      const result = itemDraft.id
        ? await updateTakeoffItem(itemDraft.id, quoteId, payload)
        : await addTakeoffItem(payload)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(itemDraft.id ? 'Item updated' : 'Item added')
      setItemDraft(null)
      router.refresh()
    })
  }

  function handleDelete(item: TakeoffItemRow) {
    startTransition(async () => {
      const result = await deleteTakeoffItem(item.id, quoteId)
      if (result.error) toast.error(result.error)
      else router.refresh()
    })
  }

  // ── Sheet / waste / assembly / push ─────────────────────────────────────────

  function handleCreateSheet(e: React.FormEvent) {
    e.preventDefault()
    if (!sheetAttachment) {
      toast.error('Pick a PDF attachment')
      return
    }
    startTransition(async () => {
      const result = await createTakeoffSheet({
        quote_id: quoteId,
        attachment_id: sheetAttachment,
        name: sheetName || 'Sheet',
        page: sheetPage,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Sheet added')
      setNewSheetOpen(false)
      setSheetName('')
      setSheetAttachment(null)
      setSheetPage('1')
      router.refresh()
    })
  }

  function handleWasteCreate(e: React.FormEvent) {
    e.preventDefault()
    const qty = parseFloat(wasteQty)
    const kg = parseFloat(wasteKg)
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(kg) || kg <= 0) {
      toast.error('Enter the quantity and density')
      return
    }
    const preset = WASTE_PRESETS.find((p) => p.label === wastePreset)
    const tonnes = wasteTonnes(qty, kg)
    setWasteOpen(false)
    setItemDraft({
      ...emptyDraft(),
      description: `Waste disposal — ${wastePreset} (${qty}${preset?.unit ?? ''} @ ${kg}kg)`,
      qty: String(tonnes),
      unit: 't',
    })
  }

  function handleApplyAssembly(e: React.FormEvent) {
    e.preventDefault()
    if (!assemblyId) return
    const qty = parseFloat(assemblyQty)
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Enter the assembly quantity')
      return
    }
    startTransition(async () => {
      const result = await applyAssembly(
        quoteId,
        assemblyId,
        qty,
        assemblySection || null
      )
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Assembly applied')
      setAssemblyOpen(false)
      setAssemblyQty('')
      router.refresh()
    })
  }

  function handleExtract(e: React.FormEvent) {
    e.preventDefault()
    if (!extractAttachment) {
      toast.error('Pick the report PDF')
      return
    }
    const attachmentId = extractAttachment
    setExtracting(true)
    startTransition(async () => {
      const result = await ingestReportTakeoff(quoteId, attachmentId)
      setExtracting(false)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(
        `${result.added} item${result.added === 1 ? '' : 's'} extracted — review and rate them below`
      )
      setExtractOpen(false)
      setExtractAttachment(null)
      router.refresh()
    })
  }

  function handlePush() {
    startTransition(async () => {
      const result = await pushTakeoffToQuote(quoteId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(
        `${result.pushed} line${result.pushed === 1 ? '' : 's'} pushed to the quote${
          result.skipped ? ` (${result.skipped} already pushed)` : ''
        }`
      )
      router.refresh()
    })
  }

  const wastePresetObj = WASTE_PRESETS.find((p) => p.label === wastePreset)

  return (
    <div className="flex flex-col gap-6">
      {!editable && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          This quote is no longer editable — the takeoff is read-only.
        </p>
      )}

      {/* ── Sheets ── */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {sheets.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveSheetId(s.id)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                s.id === activeSheetId
                  ? 'border-foreground bg-foreground text-background'
                  : 'hover:bg-muted'
              )}
            >
              {s.name}
              {s.scale_m_per_pt === null && (
                <span className="ml-1.5 text-xs text-amber-500">⚠ scale</span>
              )}
            </button>
          ))}
          {editable && (
            <Button size="sm" variant="outline" onClick={() => setNewSheetOpen(true)}>
              <FileUpIcon className="size-4" />
              Add sheet
            </Button>
          )}
          {editable && activeSheet && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const result = await deleteTakeoffSheet(activeSheet.id, quoteId)
                  if (result.error) toast.error(result.error)
                  else {
                    setActiveSheetId(sheets.find((s) => s.id !== activeSheet.id)?.id ?? null)
                    router.refresh()
                  }
                })
              }}
            >
              Remove sheet
            </Button>
          )}
          {editable && (
            <label className="ml-auto flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={deduction}
                onChange={(e) => setDeduction(e.target.checked)}
                className="size-4 accent-red-600"
              />
              <span className={cn(deduction && 'font-medium text-red-600')}>
                Draw deductions
              </span>
            </label>
          )}
        </div>

        {legend.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {legend.map((entry) => {
              const hidden = hiddenColors.has(entry.color)
              return (
                <button
                  key={entry.color}
                  type="button"
                  onClick={() =>
                    setHiddenColors((prev) => {
                      const next = new Set(prev)
                      if (next.has(entry.color)) next.delete(entry.color)
                      else next.add(entry.color)
                      return next
                    })
                  }
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-opacity',
                    hidden && 'opacity-40 line-through'
                  )}
                  title={hidden ? 'Show on plan' : 'Hide on plan'}
                >
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                  {entry.label.length > 30
                    ? `${entry.label.slice(0, 30)}…`
                    : entry.label}
                  {entry.count > 1 && (
                    <span className="text-muted-foreground">×{entry.count}</span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {activeSheet?.signedUrl ? (
          <TakeoffCanvas
            key={activeSheet.id}
            pdfUrl={activeSheet.signedUrl}
            page={activeSheet.page}
            scaleMPerPt={activeSheet.scale_m_per_pt}
            items={sheetItems}
            deduction={deduction}
            onCalibrated={handleCalibrated}
            onShapeComplete={editable ? handleShapeComplete : () => undefined}
            onGeometryEdited={editable ? handleGeometryEdited : undefined}
            onSnapshot={editable ? handleSnapshot : undefined}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {sheets.length === 0
                ? 'No sheets yet — upload a plan PDF to the quote, then add it as a sheet.'
                : 'This sheet has no readable file.'}
            </p>
            {editable && (
              <div className="w-full max-w-sm">
                <PhotoUpload
                  parentType="quote"
                  parentId={quoteId}
                  kind="document"
                  onUploaded={() => router.refresh()}
                />
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Items ── */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            Takeoff items{' '}
            <span className="text-sm font-normal text-muted-foreground">
              {items.length}
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {editable && (
              <>
                <Button size="sm" variant="outline" onClick={() => setItemDraft(emptyDraft())}>
                  <PlusIcon className="size-4" />
                  Add item
                </Button>
                <Button size="sm" variant="outline" onClick={() => setWasteOpen(true)}>
                  <CalculatorIcon className="size-4" />
                  Waste calculator
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAssemblyOpen(true)}
                  disabled={assemblies.length === 0}
                >
                  <BlocksIcon className="size-4" />
                  Apply assembly
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setExtractOpen(true)}
                  disabled={planAttachments.length === 0}
                >
                  <SparklesIcon className="size-4" />
                  Extract from report
                </Button>
                <Button size="sm" onClick={handlePush} disabled={pending || items.length === 0}>
                  <SendIcon className="size-4" />
                  Push to quote
                </Button>
              </>
            )}
            <a
              href={`/api/pdf/takeoff/${quoteId}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <FileTextIcon className="size-4" />
              Schedule PDF
            </a>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing measured yet — draw on the plan, add items manually, or
            extract them from a survey report.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  {editable && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const sign = item.deduction ? -1 : 1
                  const lineCost =
                    item.unit_cost === null
                      ? null
                      : round2(item.unit_cost * item.qty * sign)
                  return (
                    <TableRow
                      key={item.id}
                      className={cn(editable && 'cursor-pointer')}
                      onClick={() =>
                        editable &&
                        setItemDraft({
                          id: item.id,
                          sheet_id: item.sheet_id,
                          source: item.source,
                          shape: item.shape,
                          geometry: item.geometry,
                          deduction: item.deduction,
                          color: item.color,
                          description: item.description,
                          qty: String(item.qty),
                          unit: item.unit,
                          rate_item_id: item.rate_item_id,
                          unit_cost: item.unit_cost === null ? '' : String(item.unit_cost),
                          markup_pct: item.markup_pct === null ? '' : String(item.markup_pct),
                          section_title: item.section_title ?? '',
                          notes: item.notes ?? '',
                          depth: '',
                          pitch: '',
                          height: '',
                        })
                      }
                    >
                      <TableCell className={cn(item.deduction && 'text-red-600')}>
                        {item.deduction ? '− ' : ''}
                        {item.description}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{item.qty}</TableCell>
                      <TableCell className="text-muted-foreground">{item.unit}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {SOURCE_LABEL[item.source]}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {item.section_title ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {item.unit_cost === null ? '—' : aud(item.unit_cost)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {lineCost === null ? '—' : aud(lineCost)}
                      </TableCell>
                      {editable && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(item)}
                          >
                            <Trash2Icon className="size-4" />
                            <span className="sr-only">Delete</span>
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
                <TableRow className="bg-muted font-medium">
                  <TableCell colSpan={6}>Totals</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {aud(totals.cost)}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      sell {aud(totals.sell)}
                    </span>
                  </TableCell>
                  {editable && <TableCell />}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* ── Item dialog ── */}
      <Dialog open={itemDraft !== null} onOpenChange={(open) => !open && setItemDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {itemDraft?.id
                ? 'Edit takeoff item'
                : itemDraft?.source === 'measured'
                  ? 'Save measurement'
                  : 'Add takeoff item'}
            </DialogTitle>
          </DialogHeader>
          {itemDraft && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                saveItemDraft()
              }}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ti-desc">Description</Label>
                <Input
                  id="ti-desc"
                  value={itemDraft.description}
                  onChange={(e) => setItemDraft({ ...itemDraft, description: e.target.value })}
                  placeholder="AC roof sheeting removal — main building"
                  required
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ti-qty">Qty</Label>
                  <Input
                    id="ti-qty"
                    value={itemDraft.qty}
                    onChange={(e) => setItemDraft({ ...itemDraft, qty: e.target.value })}
                    inputMode="decimal"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ti-unit">Unit</Label>
                  <Input
                    id="ti-unit"
                    value={itemDraft.unit}
                    onChange={(e) => setItemDraft({ ...itemDraft, unit: e.target.value })}
                    placeholder="m2, m, ea, t…"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ti-section">Quote section</Label>
                  <Input
                    id="ti-section"
                    value={itemDraft.section_title}
                    onChange={(e) =>
                      setItemDraft({ ...itemDraft, section_title: e.target.value })
                    }
                    placeholder="Takeoff"
                    list="takeoff-sections"
                  />
                  <datalist id="takeoff-sections">
                    {sectionTitles.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </div>
              </div>

              {!itemDraft.id &&
                itemDraft.source === 'measured' &&
                (itemDraft.shape === 'area' || itemDraft.shape === 'line') && (
                  <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      Convert the measurement (optional)
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {itemDraft.shape === 'area' ? (
                        <>
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor="ti-depth">Depth (m) → m³</Label>
                            <Input
                              id="ti-depth"
                              value={itemDraft.depth}
                              onChange={(e) =>
                                setItemDraft({ ...itemDraft, depth: e.target.value })
                              }
                              inputMode="decimal"
                              placeholder="0.3"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor="ti-pitch">Roof pitch factor</Label>
                            <Input
                              id="ti-pitch"
                              value={itemDraft.pitch}
                              onChange={(e) =>
                                setItemDraft({ ...itemDraft, pitch: e.target.value })
                              }
                              inputMode="decimal"
                              placeholder="1.08 (22.5°)"
                            />
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="ti-height">Height (m) → m²</Label>
                          <Input
                            id="ti-height"
                            value={itemDraft.height}
                            onChange={(e) =>
                              setItemDraft({ ...itemDraft, height: e.target.value })
                            }
                            inputMode="decimal"
                            placeholder="2.4"
                          />
                        </div>
                      )}
                    </div>
                    {(() => {
                      const preview = applyMultipliers(itemDraft)
                      return preview.note ? (
                        <p className="text-xs font-medium">
                          = {preview.qty} {preview.unit === 'm2' ? 'm²' : preview.unit === 'm3' ? 'm³' : preview.unit}
                          <span className="ml-1.5 font-normal text-muted-foreground">
                            ({preview.note})
                          </span>
                        </p>
                      ) : null
                    })()}
                  </div>
                )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ti-rate">Rate item</Label>
                <Select
                  value={itemDraft.rate_item_id ?? NONE}
                  onValueChange={(v) => {
                    const next = !v || v === NONE ? null : v
                    const rate = rateItems.find((r) => r.id === next)
                    setItemDraft({
                      ...itemDraft,
                      rate_item_id: next,
                      unit_cost: rate ? String(rate.cost) : itemDraft.unit_cost,
                      markup_pct: rate
                        ? String(rate.default_markup_pct)
                        : itemDraft.markup_pct,
                    })
                  }}
                >
                  <SelectTrigger id="ti-rate" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No rate — enter cost below</SelectItem>
                    {rateItems.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name} — {aud(r.cost)}/{r.unit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ti-cost">Unit cost ($)</Label>
                  <Input
                    id="ti-cost"
                    value={itemDraft.unit_cost}
                    onChange={(e) => setItemDraft({ ...itemDraft, unit_cost: e.target.value })}
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ti-markup">Markup %</Label>
                  <Input
                    id="ti-markup"
                    value={itemDraft.markup_pct}
                    onChange={(e) => setItemDraft({ ...itemDraft, markup_pct: e.target.value })}
                    inputMode="decimal"
                    placeholder="20"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ti-notes">Notes</Label>
                <Textarea
                  id="ti-notes"
                  value={itemDraft.notes}
                  onChange={(e) => setItemDraft({ ...itemDraft, notes: e.target.value })}
                  rows={2}
                />
              </div>

              {itemDraft.deduction && (
                <p className="text-sm font-medium text-red-600">
                  Deduction — this quantity subtracts when pushed to the quote.
                </p>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setItemDraft(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || !itemDraft.description.trim()}>
                  {pending ? 'Saving…' : 'Save item'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ── New sheet dialog ── */}
      <Dialog open={newSheetOpen} onOpenChange={setNewSheetOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a sheet</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSheet} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Plan PDF (quote attachments)</Label>
              <Select
                value={sheetAttachment ?? NONE}
                onValueChange={(v) => setSheetAttachment(!v || v === NONE ? null : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Pick a PDF…</SelectItem>
                  {planAttachments.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.filename}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Upload new plans below, then pick them here.
              </p>
              <PhotoUpload
                parentType="quote"
                parentId={quoteId}
                kind="document"
                onUploaded={() => router.refresh()}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ts-name">Sheet name</Label>
                <Input
                  id="ts-name"
                  value={sheetName}
                  onChange={(e) => setSheetName(e.target.value)}
                  placeholder="Site plan"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ts-page">PDF page</Label>
                <Input
                  id="ts-page"
                  value={sheetPage}
                  onChange={(e) => setSheetPage(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewSheetOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !sheetAttachment || !sheetName.trim()}>
                {pending ? 'Adding…' : 'Add sheet'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Waste calculator ── */}
      <Dialog open={wasteOpen} onOpenChange={setWasteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Waste disposal calculator</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleWasteCreate} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Material</Label>
              <Select
                value={wastePreset}
                onValueChange={(v) => {
                  if (!v) return
                  setWastePreset(v)
                  const preset = WASTE_PRESETS.find((p) => p.label === v)
                  if (preset) setWasteKg(String(preset.kgPerUnit))
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WASTE_PRESETS.map((p) => (
                    <SelectItem key={p.label} value={p.label}>
                      {p.label} ({p.kgPerUnit}kg/{p.unit === 'm2' ? 'm²' : 'm³'})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wc-qty">
                  Quantity ({wastePresetObj?.unit === 'm3' ? 'm³' : 'm²'})
                </Label>
                <Input
                  id="wc-qty"
                  value={wasteQty}
                  onChange={(e) => setWasteQty(e.target.value)}
                  inputMode="decimal"
                  autoFocus
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wc-kg">Density (kg/unit)</Label>
                <Input
                  id="wc-kg"
                  value={wasteKg}
                  onChange={(e) => setWasteKg(e.target.value)}
                  inputMode="decimal"
                  required
                />
              </div>
            </div>
            {Number.isFinite(parseFloat(wasteQty)) && parseFloat(wasteQty) > 0 && (
              <p className="text-sm font-medium">
                = {wasteTonnes(parseFloat(wasteQty), parseFloat(wasteKg) || 0)} tonnes
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setWasteOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Create item</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Extract from report ── */}
      <Dialog
        open={extractOpen}
        onOpenChange={(open) => {
          if (!extracting) setExtractOpen(open)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Extract items from a report</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleExtract} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Report PDF (quote attachments)</Label>
              <Select
                value={extractAttachment ?? NONE}
                onValueChange={(v) => setExtractAttachment(!v || v === NONE ? null : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Pick a PDF…</SelectItem>
                  {planAttachments.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.filename}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="rounded-lg border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Sends this document to Anthropic (Claude) to read the asbestos
              register / findings and turn them into takeoff items. Items land
              as “Report” rows for you to review and rate — nothing is pushed
              to the quote automatically.
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={extracting}
                onClick={() => setExtractOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={extracting || !extractAttachment}>
                {extracting ? 'Extracting… this can take a minute' : 'Extract items'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Apply assembly ── */}
      <Dialog open={assemblyOpen} onOpenChange={setAssemblyOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apply an assembly</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleApplyAssembly} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Assembly</Label>
              <Select
                value={assemblyId ?? NONE}
                onValueChange={(v) => setAssemblyId(!v || v === NONE ? null : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {assemblies.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} (per {a.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {assemblyId && (
                <p className="text-xs text-muted-foreground">
                  {assemblies.find((a) => a.id === assemblyId)?.description}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="aa-qty">
                  Quantity ({assemblies.find((a) => a.id === assemblyId)?.unit ?? 'unit'})
                </Label>
                <Input
                  id="aa-qty"
                  value={assemblyQty}
                  onChange={(e) => setAssemblyQty(e.target.value)}
                  inputMode="decimal"
                  autoFocus
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="aa-section">Quote section</Label>
                <Input
                  id="aa-section"
                  value={assemblySection}
                  onChange={(e) => setAssemblySection(e.target.value)}
                  placeholder="Takeoff"
                  list="takeoff-sections"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAssemblyOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !assemblyId}>
                {pending ? 'Applying…' : 'Apply'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
