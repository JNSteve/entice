'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { round2 } from '@/lib/money'
import { extractPriceList, priceExtractionEnabled } from '@/lib/extract-price-list'
import {
  detectPricesIncludeGst,
  kindToCategory,
  matchLine,
  PRICE_KINDS,
  round4,
  supplierKey,
  toExGst,
  type ColumnMapping,
  type ExistingItem,
  type ImportLine,
  type LineStatus,
  type PriceKind,
} from '@/lib/price-list'
import { removeUploadedObject } from '@/lib/storage-keys'
import { fetchAll } from '@/lib/pnl-queries'

type Supabase = Awaited<ReturnType<typeof createClient>>

const MAX_PDF_BYTES = 20 * 1024 * 1024

export interface PriceItemHit {
  id: string
  name: string
  supplier: string | null
  product_code: string | null
  unit: string
  cost: number
  kind: PriceKind
}

async function gstRate(supabase: Supabase): Promise<number> {
  const { data } = await supabase.from('settings').select('gst_rate').eq('id', 1).maybeSingle()
  return Number(data?.gst_rate ?? 10)
}

// ─── Search (cost dialog) ─────────────────────────────────────────────────────

const searchSchema = z.object({
  query: z.string().max(100),
  kinds: z.array(z.enum(PRICE_KINDS)).min(1),
})

/** Active price-list items of the given kinds matching name / code / supplier. */
export async function searchPriceItems(query: string, kinds: PriceKind[]): Promise<{ items: PriceItemHit[]; error?: string }> {
  await requireRole('admin', 'office')
  const parsed = searchSchema.safeParse({ query, kinds })
  if (!parsed.success) return { items: [], error: 'Invalid search' }

  const supabase = await createClient()
  let q = supabase
    .from('rate_items')
    .select('id, name, supplier, product_code, unit, cost, kind')
    .eq('active', true)
    .in('kind', parsed.data.kinds)
    .order('name')
    .limit(30)
  // PostgREST `or` syntax — strip the characters that would break the filter.
  const term = parsed.data.query.replace(/[,()%*\\"']/g, ' ').trim()
  if (term) {
    const like = `%${term.replace(/\s+/g, '%')}%`
    q = q.or(`name.ilike.${like},product_code.ilike.${like},supplier.ilike.${like}`)
  }
  const { data, error } = await q
  if (error) return { items: [], error: error.message }
  return {
    items: (data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      supplier: r.supplier,
      product_code: r.product_code,
      unit: r.unit,
      cost: Number(r.cost),
      kind: r.kind as PriceKind,
    })),
  }
}

// ─── PDF extraction ───────────────────────────────────────────────────────────

const extractSchema = z.object({
  path: z.string().regex(/^price-lists\/[\w.-]+$/, 'Invalid upload path'),
})

export interface ExtractedForReview {
  supplier: string | null
  documentDate: string | null
  /** true / false when the document's totals make it clear, else null. */
  pricesIncludeGst: boolean | null
  /** Prices exactly as printed. */
  lines: ImportLine[]
}

/** Reads an uploaded supplier PDF (attachments/price-lists/…) and removes the upload afterwards. */
export async function extractPriceListPdf(input: unknown): Promise<{ error?: string; result?: ExtractedForReview }> {
  await requireRole('admin', 'office')
  const parsed = extractSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }

  const supabase = await createClient()
  try {
    if (!priceExtractionEnabled()) {
      return { error: 'PDF reading needs OPENAI_API_KEY — it works on the live site, not in local dev' }
    }
    const { data: blob, error } = await supabase.storage.from('attachments').download(parsed.data.path)
    if (error || !blob) return { error: error?.message ?? 'Could not read the uploaded PDF' }
    const bytes = Buffer.from(await blob.arrayBuffer())
    if (bytes.byteLength > MAX_PDF_BYTES) return { error: 'This PDF is over 20 MB' }
    if (bytes.subarray(0, 4).toString() !== '%PDF') return { error: 'That file is not a PDF' }

    const out = await extractPriceList(bytes.toString('base64'))
    if (out.error || !out.result) return { error: out.error ?? 'Reading failed' }

    const lines: ImportLine[] = out.result.lines
      .filter((l) => l.name?.trim() && Number.isFinite(l.unit_price) && l.unit_price > 0)
      .map((l) => ({
        code: l.code?.trim() || null,
        name: l.name.trim(),
        unit: l.unit?.trim() || 'ea',
        unitPrice: round4(l.unit_price),
        qty: l.qty != null && l.qty > 0 ? l.qty : null,
        kind: (PRICE_KINDS as readonly string[]).includes(l.kind) ? l.kind : 'material',
        note: l.note?.trim() || null,
      }))
    if (lines.length === 0) return { error: 'No priced items were found in this document' }

    return {
      result: {
        supplier: out.result.supplier?.trim() || null,
        documentDate: /^\d{4}-\d{2}-\d{2}$/.test(out.result.document_date ?? '') ? out.result.document_date : null,
        pricesIncludeGst: detectPricesIncludeGst(lines, out.result.subtotal, out.result.gst),
        lines,
      },
    }
  } finally {
    await removeUploadedObject(supabase, parsed.data.path)
  }
}

// ─── Review helpers ───────────────────────────────────────────────────────────

/**
 * Every saved item for exactly this supplier. The ilike only narrows the
 * fetch ("ABC%Supplies" also matches "ABC Safety Supplies"); supplierKey()
 * then keeps the exact supplier, so nothing downstream (matching, deactivate
 * missing) can touch another supplier's items. Paged past PostgREST's 1000-row
 * cap; throws on a query error rather than treating everything as new.
 */
async function existingForSupplier(supabase: Supabase, supplier: string): Promise<ExistingItem[]> {
  const pattern = supplier.trim().replace(/[%_\\]/g, (c) => `\\${c}`).replace(/\s+/g, '%')
  const rows = await fetchAll((from, to) =>
    supabase
      .from('rate_items')
      .select('id, supplier, product_code, name, cost, unit, kind, active')
      .ilike('supplier', pattern)
      .order('id')
      .range(from, to)
  )
  const key = supplierKey(supplier)
  return rows
    .filter((r) => r.supplier != null && supplierKey(r.supplier) === key)
    .map((r) => ({
      id: r.id,
      supplier: r.supplier,
      product_code: r.product_code,
      name: r.name,
      cost: Number(r.cost),
      unit: r.unit,
      kind: r.kind,
      active: r.active,
    }))
}

const lineSchema = z.object({
  code: z.string().trim().max(80).nullable(),
  name: z.string().trim().min(1, 'Every line needs a name').max(300),
  unit: z.string().trim().min(1).max(30),
  unitPrice: z.number().positive('Prices must be above zero').max(10_000_000),
  qty: z.number().positive().max(1_000_000).nullable(),
  kind: z.enum(PRICE_KINDS),
  note: z.string().trim().max(500).nullable(),
})

const matchSchema = z.object({
  supplier: z.string().trim().min(1, 'Enter the supplier').max(120),
  pricesIncludeGst: z.boolean(),
  lines: z.array(lineSchema).max(5000),
})

/** New / price change / unchanged for each line, against this supplier's saved items (prices compared ex GST). */
export async function matchPriceLines(input: unknown): Promise<{ error?: string; statuses?: LineStatus[] }> {
  await requireRole('admin', 'office')
  const parsed = matchSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  const supabase = await createClient()
  let existing: ExistingItem[]
  let rate: number
  try {
    ;[existing, rate] = await Promise.all([existingForSupplier(supabase, parsed.data.supplier), gstRate(supabase)])
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not load the price list' }
  }
  return {
    statuses: parsed.data.lines.map((l) =>
      matchLine({ ...l, unitPrice: toExGst(l.unitPrice, parsed.data.pricesIncludeGst, rate) }, parsed.data.supplier, existing)
    ),
  }
}

const mappingSchema = z.object({
  name: z.number().int().min(0),
  cost: z.number().int().min(0),
  unit: z.number().int().min(0).nullable().optional(),
  code: z.number().int().min(0).nullable().optional(),
  kind: z.number().int().min(0).nullable().optional(),
  qty: z.number().int().min(0).nullable().optional(),
  headerRow: z.boolean(),
  defaultKind: z.enum(PRICE_KINDS),
})

export async function loadSupplierMapping(supplier: string): Promise<ColumnMapping | null> {
  await requireRole('admin', 'office')
  if (!supplier.trim()) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('supplier_import_mappings')
    .select('mapping')
    .eq('supplier_key', supplierKey(supplier))
    .maybeSingle()
  const parsed = mappingSchema.safeParse(data?.mapping)
  return parsed.success ? parsed.data : null
}

/** Supplier names already in the price list (for the supplier field's suggestions). */
export async function listSuppliers(): Promise<string[]> {
  await requireRole('admin', 'office')
  const supabase = await createClient()
  const rows = await fetchAll((from, to) =>
    supabase.from('rate_items').select('id, supplier').not('supplier', 'is', null).order('id').range(from, to)
  ).catch(() => [] as { id: string; supplier: string | null }[])
  const byKey = new Map<string, string>()
  for (const r of rows) if (r.supplier) byKey.set(supplierKey(r.supplier), r.supplier)
  return [...byKey.values()].sort((a, b) => a.localeCompare(b))
}

// ─── Commit ───────────────────────────────────────────────────────────────────

const commitSchema = matchSchema.extend({
  lines: z
    .array(lineSchema.extend({ saveToList: z.boolean(), addToJob: z.boolean() }))
    .max(5000),
  deactivateMissing: z.boolean(),
  mapping: mappingSchema.nullable(),
  job: z
    .object({
      parent_type: z.enum(['job', 'project']),
      parent_id: z.uuid(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .nullable(),
})

export interface CommitResult {
  error?: string
  added?: number
  updated?: number
  unchanged?: number
  deactivated?: number
  costsAdded?: number
}

export async function commitPriceListImport(input: unknown): Promise<CommitResult> {
  const profile = await requireRole('admin', 'office')
  const parsed = commitSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  const d = parsed.data
  if (!d.lines.some((l) => l.saveToList || l.addToJob)) return { error: 'Tick at least one line' }
  if (d.lines.some((l) => l.addToJob) && !d.job) return { error: 'Pick the job to add costs to' }

  const supabase = await createClient()
  let existing: ExistingItem[]
  let rate: number
  try {
    ;[existing, rate] = await Promise.all([existingForSupplier(supabase, d.supplier), gstRate(supabase)])
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not load the price list' }
  }

  if (d.job) {
    const { data: parent } = await supabase
      .from(d.job.parent_type === 'job' ? 'jobs' : 'projects')
      .select('id')
      .eq('id', d.job.parent_id)
      .maybeSingle()
    if (!parent) return { error: 'That job or project no longer exists' }
  }

  const now = new Date().toISOString()
  const touched = new Set<string>()
  const itemIdByLine = new Map<number, string>()
  let added = 0
  let updated = 0
  let unchanged = 0

  for (const [i, line] of d.lines.entries()) {
    if (!line.saveToList) continue
    const exPrice = toExGst(line.unitPrice, d.pricesIncludeGst, rate)
    const status = matchLine({ ...line, unitPrice: exPrice }, d.supplier, existing)
    if (status.status === 'new') {
      const { data: row, error } = await supabase
        .from('rate_items')
        .insert({
          kind: line.kind,
          name: line.name,
          unit: line.unit,
          cost: exPrice,
          supplier: d.supplier,
          product_code: line.code,
          notes: line.note,
          active: true,
          updated_at: now,
        })
        .select('id')
        .single()
      if (error || !row) return { error: error?.message ?? 'Could not save an item', added, updated }
      itemIdByLine.set(i, row.id)
      touched.add(row.id)
      // Later duplicate lines in the same file match this one instead of inserting again.
      existing.push({ id: row.id, supplier: d.supplier, product_code: line.code, name: line.name, cost: exPrice, unit: line.unit, kind: line.kind, active: true })
      added++
    } else {
      itemIdByLine.set(i, status.id)
      touched.add(status.id)
      if (status.status === 'unchanged') {
        unchanged++
        continue
      }
      const { error } = await supabase
        .from('rate_items')
        .update({
          cost: exPrice,
          unit: line.unit,
          kind: line.kind,
          // Keep a stored code/note when this document doesn't carry one.
          ...(line.code ? { product_code: line.code } : {}),
          ...(line.note ? { notes: line.note } : {}),
          active: true,
          updated_at: now,
        })
        .eq('id', status.id)
      if (error) return { error: error.message, added, updated }
      const e = existing.find((x) => x.id === status.id)
      if (e) Object.assign(e, { cost: exPrice, unit: line.unit, kind: line.kind, active: true })
      updated++
    }
  }

  let deactivated = 0
  if (d.deactivateMissing) {
    const stale = existing.filter((e) => e.active && !touched.has(e.id)).map((e) => e.id)
    if (stale.length > 0) {
      const { error } = await supabase
        .from('rate_items')
        .update({ active: false, updated_at: now })
        .in('id', stale)
      if (error) return { error: error.message, added, updated }
      deactivated = stale.length
    }
  }

  if (d.mapping) {
    await supabase.from('supplier_import_mappings').upsert({
      supplier_key: supplierKey(d.supplier),
      supplier: d.supplier,
      mapping: d.mapping,
      updated_at: now,
    })
  }

  let costsAdded = 0
  if (d.job) {
    const rows = d.lines.flatMap((line, i) => {
      if (!line.addToJob) return []
      const qty = line.qty ?? 1
      const unitCost = toExGst(line.unitPrice, d.pricesIncludeGst, rate)
      return [
        {
          parent_type: d.job!.parent_type,
          parent_id: d.job!.parent_id,
          date: d.job!.date,
          description: line.code ? `${line.name} (${d.supplier} ${line.code})` : `${line.name} (${d.supplier})`,
          amount: round2(qty * unitCost),
          qty,
          unit_cost: unitCost,
          category: kindToCategory(line.kind),
          rate_item_id: itemIdByLine.get(i) ?? null,
          source: 'manual',
          created_by: profile.id,
        },
      ]
    })
    if (rows.length > 0) {
      const { error } = await supabase.from('costs').insert(rows)
      if (error) return { error: `Price list saved, but adding job costs failed: ${error.message}`, added, updated, unchanged, deactivated }
      costsAdded = rows.length
    }
    revalidatePath(d.job.parent_type === 'job' ? `/jobs/${d.job.parent_id}` : `/projects/${d.job.parent_id}/pnl`)
  }

  revalidatePath('/settings')
  return { added, updated, unchanged, deactivated, costsAdded }
}
