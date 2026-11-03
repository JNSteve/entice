import type { CostCategory } from './pnl'
import type { ExtractedPriceLine } from './extract-price-list'

/** Price-list item types. `consumable` exists only here — quote/invoice lines use RATE_KINDS. */
export const PRICE_KINDS = ['material', 'consumable', 'plant', 'subbie', 'labour', 'other'] as const
export type PriceKind = (typeof PRICE_KINDS)[number]

export const PRICE_KIND_LABELS: Record<PriceKind, string> = {
  material: 'Material',
  consumable: 'Consumable',
  plant: 'Plant & equipment',
  subbie: 'Subcontract',
  labour: 'Labour',
  other: 'Other',
}

export function kindToCategory(kind: string): CostCategory {
  switch (kind) {
    case 'material':
      return 'materials'
    case 'consumable':
      return 'consumables'
    case 'plant':
      return 'plant'
    case 'subbie':
      return 'subcontract'
    case 'labour':
      return 'labour'
    default:
      return 'other'
  }
}

/** Kinds offered when searching the price list for a cost category. */
export function kindsForCategory(category: CostCategory): PriceKind[] {
  switch (category) {
    case 'materials':
      return ['material']
    case 'consumables':
      return ['consumable']
    case 'plant':
      return ['plant']
    case 'subcontract':
      return ['subbie']
    case 'labour':
      return ['labour']
    default:
      return ['other']
  }
}

/** Kind to store on a quote/invoice line (they don't know `consumable`). */
export function quoteKind(kind: string | null): string | null {
  if (kind == null) return null
  return kind === 'consumable' ? 'material' : kind
}

/** Loose reading of a supplier's category wording. */
export function parseKind(text: string | null | undefined, fallback: string): string {
  const t = (text ?? '').toLowerCase()
  if (!t.trim()) return fallback
  if (/consum/.test(t)) return 'consumable'
  if (/sub.?contract|subbie/.test(t)) return 'subbie'
  if (/labou?r/.test(t)) return 'labour'
  if (/plant|equip|hire|tool|machine/.test(t)) return 'plant'
  if (/material/.test(t)) return 'material'
  return fallback
}

export function supplierKey(supplier: string): string {
  return supplier.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function round4(n: number): number {
  const sign = n < 0 ? -1 : 1
  return (sign * Math.round((Math.abs(n) + Number.EPSILON) * 10_000)) / 10_000
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * A tier heading with its dashes and spacing tidied, so "5 – 8  Weeks" and
 * "5-8 Weeks" read as the same tier on a re-import; null when blank.
 */
export function tidyTier(tier: string | null | undefined): string | null {
  const t = (tier ?? '')
    .replace(/\s*[-–—]+\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return t ? t.slice(0, 120) : null
}

/**
 * The name a tiered line is saved under: "Name (tier)". A rate item has one
 * cost, so each hire-duration or quantity-break tier becomes its own item,
 * told apart by the tier in its name. A name that already carries the tier
 * wording is left alone.
 */
export function withTier(name: string, tier: string | null | undefined): string {
  const base = name.trim()
  const t = tidyTier(tier)
  if (!t) return base
  return norm(base).includes(norm(t)) ? base : `${base} (${t})`
}

export function toExGst(price: number, includesGst: boolean, gstRate: number): number {
  return round4(includesGst ? price / (1 + gstRate / 100) : price)
}

export interface ImportLine {
  code: string | null
  name: string
  unit: string
  /** Ex GST, 4 dp. */
  unitPrice: number
  qty: number | null
  kind: string
  note: string | null
  /**
   * The heading of the price column this price came from, when the document
   * prices the line at several hire durations or quantity breaks ("1 Week",
   * "5-8 Weeks", "Per Day"); null for a single-price line. A tiered line is
   * saved as its own rate item named with the tier (withTier), and matched
   * by that name rather than by product code, which its sibling tiers share.
   */
  tier: string | null
}

export interface ColumnMapping {
  name: number
  cost: number
  unit?: number | null
  code?: number | null
  kind?: number | null
  qty?: number | null
  headerRow: boolean
  /** Type for rows without (or without a readable) type column. */
  defaultKind: string
}

type Cell = string | number | boolean | Date | null | undefined

function text(cell: Cell): string {
  if (cell == null) return ''
  if (cell instanceof Date) return cell.toISOString().slice(0, 10)
  return String(cell).trim()
}

export function parseMoney(cell: Cell): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null
  const cleaned = text(cell).replace(/[$,\s]|AUD/gi, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** Best-guess column indexes from a header row. */
export function guessColumns(header: Cell[]): Partial<Pick<ColumnMapping, 'name' | 'cost' | 'unit' | 'code' | 'kind' | 'qty'>> {
  const h = header.map((c) => text(c).toLowerCase())
  const find = (re: RegExp, not?: RegExp) => {
    const i = h.findIndex((x) => re.test(x) && !(not && not.test(x)))
    return i >= 0 ? i : undefined
  }
  const out: Partial<Pick<ColumnMapping, 'name' | 'cost' | 'unit' | 'code' | 'kind' | 'qty'>> = {}
  const code = find(/code|sku|stock|part\s*(no|#|number)|item\s*(no|#|number)/)
  const name = find(/desc|name|product|item/, /code|no\b|#|number|price|qty/)
  const cost = find(/nett|net\b|ex\s*gst|price|cost|rate|amount/, /total|qty|inc/) ?? find(/price|cost/)
  const unit = find(/\buom\b|\bunit\b|unit of/, /price|cost/)
  const kind = find(/categor|type|group|class/)
  const qty = find(/qty|quantity/)
  if (code !== undefined) out.code = code
  if (name !== undefined) out.name = name
  if (unit !== undefined) out.unit = unit
  if (cost !== undefined) out.cost = cost
  if (kind !== undefined) out.kind = kind
  if (qty !== undefined) out.qty = qty
  return out
}

/** Spreadsheet rows → import lines (ex GST). Blank-name and $0/unreadable-price rows are skipped. */
export function rowsFromTable(
  table: Cell[][],
  mapping: ColumnMapping,
  opts: { pricesIncludeGst: boolean; gstRate: number }
): { lines: ImportLine[]; skipped: number } {
  const lines: ImportLine[] = []
  let skipped = 0
  const body = mapping.headerRow ? table.slice(1) : table
  const at = (row: Cell[], i: number | null | undefined) => (i == null ? '' : text(row[i]))

  for (const row of body) {
    const name = at(row, mapping.name)
    const price = parseMoney(row[mapping.cost])
    if (!name || price == null || price <= 0) {
      skipped++
      continue
    }
    const qty = mapping.qty == null ? null : parseMoney(row[mapping.qty])
    lines.push({
      code: at(row, mapping.code) || null,
      name,
      unit: at(row, mapping.unit) || 'ea',
      unitPrice: toExGst(price, opts.pricesIncludeGst, opts.gstRate),
      qty: qty != null && qty > 0 ? qty : null,
      kind: mapping.kind == null ? mapping.defaultKind : parseKind(at(row, mapping.kind), mapping.defaultKind),
      note: null,
      tier: null,
    })
  }
  return { lines, skipped }
}

/**
 * The PDF reader's lines as import lines: trimmed, unit defaulting to ea,
 * prices at 4 dp, each tier folded into its line's name. Lines with no name
 * or no price above zero are dropped; an unknown kind becomes material.
 */
export function importLinesFromExtraction(lines: ExtractedPriceLine[]): ImportLine[] {
  return lines
    .filter((l) => l.name?.trim() && Number.isFinite(l.unit_price) && l.unit_price > 0)
    .map((l) => {
      const tier = tidyTier(l.tier)
      return {
        code: l.code?.trim() || null,
        name: withTier(l.name, tier),
        unit: l.unit?.trim() || 'ea',
        unitPrice: round4(l.unit_price),
        qty: l.qty != null && l.qty > 0 ? l.qty : null,
        kind: (PRICE_KINDS as readonly string[]).includes(l.kind) ? l.kind : 'material',
        note: l.note?.trim() || null,
        tier,
      }
    })
}

export interface ExistingItem {
  id: string
  supplier: string | null
  product_code: string | null
  name: string
  cost: number
  unit: string
  /** When known, a changed type counts as a change. */
  kind?: string
  active: boolean
}

export type LineStatus =
  | { status: 'new' }
  | { status: 'changed'; id: string; oldCost: number }
  | { status: 'unchanged'; id: string }

/**
 * Supplier + product code first, else supplier + name (case-insensitive);
 * active items preferred. A tiered line shares its product code with its
 * sibling tiers, so it is matched by name alone.
 */
export function matchLine(line: ImportLine, supplier: string, existing: ExistingItem[]): LineStatus {
  const key = supplierKey(supplier)
  const mine = existing
    .filter((e) => e.supplier != null && supplierKey(e.supplier) === key)
    .sort((a, b) => Number(b.active) - Number(a.active))
  const byCode =
    line.code && !line.tier
      ? mine.find((e) => e.product_code != null && norm(e.product_code) === norm(line.code!))
      : undefined
  const hit = byCode ?? mine.find((e) => norm(e.name) === norm(line.name))
  if (!hit) return { status: 'new' }
  const same =
    Math.abs(hit.cost - line.unitPrice) < 0.00005 &&
    norm(hit.unit) === norm(line.unit) &&
    (hit.kind == null || hit.kind === line.kind) &&
    hit.active
  return same ? { status: 'unchanged', id: hit.id } : { status: 'changed', id: hit.id, oldCost: hit.cost }
}

/**
 * Whether a document's unit prices include GST, by comparing Σ qty × price with
 * its subtotal (ex) or subtotal + GST (inc). null when it can't tell.
 */
export function detectPricesIncludeGst(
  lines: { qty: number | null; unitPrice: number }[],
  subtotal: number | null,
  gst: number | null
): boolean | null {
  if (subtotal == null || subtotal <= 0) return null
  const sum = lines.reduce((s, l) => s + (l.qty ?? 1) * l.unitPrice, 0)
  const tol = Math.max(0.05 * lines.length, subtotal * 0.001)
  if (Math.abs(sum - subtotal) <= tol) return false
  if (gst != null && Math.abs(sum - (subtotal + gst)) <= tol) return true
  return null
}

/** RFC 4180-ish CSV → rows (quoted fields, "" escapes, commas/newlines inside quotes, CRLF). */
export function parseCsvTable(textIn: string): string[][] {
  const src = textIn.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}
