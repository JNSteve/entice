'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { round2 } from '@/lib/money'
import { areaM2, explodeAssembly, lengthM, type Pt } from '@/lib/takeoff'
import {
  extractTakeoffFromReport,
  extractionEnabled,
  MAX_REPORT_BYTES,
} from '@/lib/extract-takeoff'
import {
  takeoffCalibrateSchema,
  takeoffItemSchema,
  takeoffSheetSchema,
} from '@/lib/zod'

type Result = { error?: string }

function revalidateTakeoff(quoteId: string) {
  revalidatePath(`/quotes/${quoteId}/takeoff`)
  revalidatePath(`/quotes/${quoteId}`)
}

/** Quotes freeze once accepted/lost — takeoff mutations follow the same rule. */
async function assertQuoteEditable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  quoteId: string
): Promise<{ error?: string }> {
  const { data: quote } = await supabase
    .from('quotes')
    .select('id, status')
    .eq('id', quoteId)
    .single()
  if (!quote) return { error: 'Quote not found' }
  if (!['draft', 'sent'].includes(quote.status as string)) {
    return { error: `Quote is ${quote.status} and can no longer be edited` }
  }
  return {}
}

// ─── Sheets ───────────────────────────────────────────────────────────────────

export async function createTakeoffSheet(data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office')

  const parsed = takeoffSheetSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const editable = await assertQuoteEditable(supabase, parsed.data.quote_id)
  if (editable.error) return editable

  // The plan must be an attachment of THIS quote.
  const { data: attachment } = await supabase
    .from('attachments')
    .select('id')
    .eq('id', parsed.data.attachment_id)
    .eq('parent_type', 'quote')
    .eq('parent_id', parsed.data.quote_id)
    .maybeSingle()
  if (!attachment) return { error: 'Pick a document attached to this quote' }

  const { error } = await supabase.from('takeoff_sheets').insert({
    quote_id: parsed.data.quote_id,
    attachment_id: parsed.data.attachment_id,
    name: parsed.data.name,
    page: parsed.data.page,
    created_by: profile.id,
  })
  if (error) return { error: error.message }

  revalidateTakeoff(parsed.data.quote_id)
  return {}
}

/**
 * Sets the sheet's scale AND re-derives every measured quantity on it from
 * the stored geometry — recalibrating fixes all measurements in one go.
 */
export async function calibrateSheet(
  sheetId: string,
  quoteId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = takeoffCalibrateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }
  const scale = parsed.data.scale_m_per_pt

  const supabase = await createClient()
  const { error } = await supabase
    .from('takeoff_sheets')
    .update({ scale_m_per_pt: scale })
    .eq('id', sheetId)
    .eq('quote_id', quoteId)
  if (error) return { error: error.message }

  const { data: items } = await supabase
    .from('takeoff_items')
    .select('id, shape, geometry')
    .eq('sheet_id', sheetId)
    .eq('source', 'measured')
  for (const item of items ?? []) {
    const geometry = (item.geometry as Pt[] | null) ?? []
    if (geometry.length === 0) continue
    let qty: number | null = null
    if (item.shape === 'area') qty = areaM2(geometry, scale)
    else if (item.shape === 'line') qty = lengthM(geometry, scale)
    if (qty !== null) {
      await supabase.from('takeoff_items').update({ qty }).eq('id', item.id)
    }
  }

  revalidateTakeoff(quoteId)
  return {}
}

export async function deleteTakeoffSheet(
  sheetId: string,
  quoteId: string
): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const editable = await assertQuoteEditable(supabase, quoteId)
  if (editable.error) return editable

  // Items keep their qty but lose the sheet link (on delete set null).
  const { error } = await supabase
    .from('takeoff_sheets')
    .delete()
    .eq('id', sheetId)
    .eq('quote_id', quoteId)
  if (error) return { error: error.message }

  revalidateTakeoff(quoteId)
  return {}
}

/**
 * Records a freshly uploaded plan snapshot (canvas + shapes composited to PNG
 * by the browser, uploaded client-side like PhotoUpload) against the sheet,
 * and best-effort removes the previous snapshot object.
 */
export async function saveSheetSnapshot(
  sheetId: string,
  quoteId: string,
  path: string
): Promise<Result> {
  await requireRole('admin', 'office')

  if (!path.startsWith('takeoff-snapshots/')) {
    return { error: 'Invalid snapshot path' }
  }

  const supabase = await createClient()
  const editable = await assertQuoteEditable(supabase, quoteId)
  if (editable.error) return editable

  const { data: sheet } = await supabase
    .from('takeoff_sheets')
    .select('id, snapshot_path')
    .eq('id', sheetId)
    .eq('quote_id', quoteId)
    .maybeSingle()
  if (!sheet) return { error: 'Sheet not found' }

  const { error } = await supabase
    .from('takeoff_sheets')
    .update({ snapshot_path: path })
    .eq('id', sheetId)
  if (error) return { error: error.message }

  // Old snapshot object is now orphaned — best-effort cleanup.
  const oldPath = sheet.snapshot_path as string | null
  if (oldPath && oldPath !== path) {
    await supabase.storage.from('attachments').remove([oldPath])
  }

  revalidateTakeoff(quoteId)
  return {}
}

// ─── Items ────────────────────────────────────────────────────────────────────

/** Resolve cost/markup from the rate library when the item doesn't carry them. */
async function resolveRate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rateItemId: string | null,
  unitCost: number | null,
  markupPct: number | null
): Promise<{ unit_cost: number | null; markup_pct: number | null }> {
  if (!rateItemId || (unitCost !== null && markupPct !== null)) {
    return { unit_cost: unitCost, markup_pct: markupPct }
  }
  const { data: rate } = await supabase
    .from('rate_items')
    .select('cost, default_markup_pct')
    .eq('id', rateItemId)
    .maybeSingle()
  return {
    unit_cost: unitCost ?? (rate ? Number(rate.cost) : null),
    markup_pct: markupPct ?? (rate ? Number(rate.default_markup_pct) : null),
  }
}

export async function addTakeoffItem(data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office')

  const parsed = takeoffItemSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const editable = await assertQuoteEditable(supabase, parsed.data.quote_id)
  if (editable.error) return editable

  const { data: last } = await supabase
    .from('takeoff_items')
    .select('position')
    .eq('quote_id', parsed.data.quote_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const rate = await resolveRate(
    supabase,
    parsed.data.rate_item_id,
    parsed.data.unit_cost,
    parsed.data.markup_pct
  )

  const { error } = await supabase.from('takeoff_items').insert({
    ...parsed.data,
    ...rate,
    position: (last?.position ?? -1) + 1,
    created_by: profile.id,
  })
  if (error) return { error: error.message }

  revalidateTakeoff(parsed.data.quote_id)
  return {}
}

export async function updateTakeoffItem(
  itemId: string,
  quoteId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = takeoffItemSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }
  if (parsed.data.quote_id !== quoteId) return { error: 'Quote mismatch' }

  const supabase = await createClient()
  const editable = await assertQuoteEditable(supabase, quoteId)
  if (editable.error) return editable

  const rate = await resolveRate(
    supabase,
    parsed.data.rate_item_id,
    parsed.data.unit_cost,
    parsed.data.markup_pct
  )

  const { error } = await supabase
    .from('takeoff_items')
    .update({ ...parsed.data, ...rate })
    .eq('id', itemId)
    .eq('quote_id', quoteId)
  if (error) return { error: error.message }

  revalidateTakeoff(quoteId)
  return {}
}

export async function deleteTakeoffItem(
  itemId: string,
  quoteId: string
): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const editable = await assertQuoteEditable(supabase, quoteId)
  if (editable.error) return editable

  const { error } = await supabase
    .from('takeoff_items')
    .delete()
    .eq('id', itemId)
    .eq('quote_id', quoteId)
  if (error) return { error: error.message }

  revalidateTakeoff(quoteId)
  return {}
}

// ─── Assemblies ───────────────────────────────────────────────────────────────

export async function applyAssembly(
  quoteId: string,
  assemblyId: string,
  qty: number,
  sectionTitle: string | null
): Promise<Result> {
  const profile = await requireRole('admin', 'office')
  if (!Number.isFinite(qty) || qty <= 0) return { error: 'Enter a quantity' }

  const supabase = await createClient()
  const editable = await assertQuoteEditable(supabase, quoteId)
  if (editable.error) return editable

  const [{ data: assembly }, { data: components }] = await Promise.all([
    supabase
      .from('takeoff_assemblies')
      .select('id, name, unit')
      .eq('id', assemblyId)
      .eq('active', true)
      .single(),
    supabase
      .from('takeoff_assembly_components')
      .select('description, unit, factor, fixed_qty, rate_item_id')
      .eq('assembly_id', assemblyId)
      .order('position'),
  ])
  if (!assembly) return { error: 'Assembly not found' }
  if (!components || components.length === 0) {
    return { error: 'This assembly has no components — add them in Settings → Estimating' }
  }

  const lines = explodeAssembly(
    qty,
    components.map((c) => ({
      description: c.description as string,
      unit: c.unit as string,
      factor: Number(c.factor),
      fixed_qty: c.fixed_qty === null ? null : Number(c.fixed_qty),
    }))
  )

  const { data: last } = await supabase
    .from('takeoff_items')
    .select('position')
    .eq('quote_id', quoteId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  let position = (last?.position ?? -1) + 1

  const groupId = crypto.randomUUID()
  for (const [i, line] of lines.entries()) {
    const component = components[i]
    const rate = await resolveRate(
      supabase,
      (component.rate_item_id as string | null) ?? null,
      null,
      null
    )
    const { error } = await supabase.from('takeoff_items').insert({
      quote_id: quoteId,
      source: 'assembly',
      description: `${line.description} (${assembly.name} × ${qty}${assembly.unit})`,
      qty: line.qty,
      unit: line.unit,
      rate_item_id: component.rate_item_id ?? null,
      unit_cost: rate.unit_cost,
      markup_pct: rate.markup_pct,
      section_title: sectionTitle,
      group_id: groupId,
      position: position++,
      created_by: profile.id,
    })
    if (error) return { error: error.message }
  }

  revalidateTakeoff(quoteId)
  return {}
}

// ─── Report extraction ────────────────────────────────────────────────────────

/**
 * Sends a quote-attached PDF (asbestos register / survey report) to OpenAI and
 * inserts the extracted rows as takeoff items with source 'report'. Never
 * auto-pushes to the quote — the estimator reviews, rates and pushes manually.
 * Dormant until OPENAI_API_KEY is set.
 */
export async function ingestReportTakeoff(
  quoteId: string,
  attachmentId: string
): Promise<{ error?: string; added?: number }> {
  const profile = await requireRole('admin', 'office')

  if (!extractionEnabled()) {
    return { error: 'Add OPENAI_API_KEY to the environment to enable report extraction' }
  }

  const supabase = await createClient()
  const editable = await assertQuoteEditable(supabase, quoteId)
  if (editable.error) return editable

  // The report must be a PDF attached to THIS quote.
  const { data: attachment } = await supabase
    .from('attachments')
    .select('id, path, filename, content_type, size')
    .eq('id', attachmentId)
    .eq('parent_type', 'quote')
    .eq('parent_id', quoteId)
    .maybeSingle()
  if (!attachment) return { error: 'Pick a document attached to this quote' }
  const isPdf =
    attachment.content_type === 'application/pdf' ||
    (attachment.filename as string).toLowerCase().endsWith('.pdf')
  if (!isPdf) return { error: 'Report extraction only works on PDF documents' }
  if (attachment.size !== null && Number(attachment.size) > MAX_REPORT_BYTES) {
    return { error: 'This PDF is over 20MB — split it and retry' }
  }

  const { data: blob, error: downloadError } = await supabase.storage
    .from('attachments')
    .download(attachment.path as string)
  if (downloadError || !blob) {
    return { error: downloadError?.message ?? 'Could not download the document' }
  }
  const bytes = Buffer.from(await blob.arrayBuffer())
  if (bytes.byteLength > MAX_REPORT_BYTES) {
    return { error: 'This PDF is over 20MB — split it and retry' }
  }

  const result = await extractTakeoffFromReport(bytes.toString('base64'))
  if (result.error) return { error: result.error }
  const extracted = result.items ?? []
  if (extracted.length === 0) {
    return { error: 'No register rows or material findings were found in this document' }
  }

  const { data: last } = await supabase
    .from('takeoff_items')
    .select('position')
    .eq('quote_id', quoteId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  let position = (last?.position ?? -1) + 1

  const groupId = crypto.randomUUID()
  for (const item of extracted) {
    const notes = [
      item.friable === null ? null : item.friable ? 'Friable' : 'Non-friable',
      item.condition ? `Condition: ${item.condition}` : null,
      item.recommendation ? `Recommendation: ${item.recommendation}` : null,
      item.description && item.description !== item.material
        ? item.description
        : null,
    ]
      .filter(Boolean)
      .join('. ')

    const { error } = await supabase.from('takeoff_items').insert({
      quote_id: quoteId,
      source: 'report',
      description: `${item.material} — ${item.location}`,
      qty: item.qty ?? 1,
      unit: item.unit || 'item',
      notes: notes || null,
      group_id: groupId,
      position: position++,
      created_by: profile.id,
    })
    if (error) return { error: error.message }
  }

  revalidateTakeoff(quoteId)
  return { added: extracted.length }
}

// ─── Push to quote ────────────────────────────────────────────────────────────

const DEFAULT_MARKUP_PCT = 20

/**
 * Groups takeoff items by section title, find-or-creates the quote sections
 * and appends priced lines. Items already pushed (a quote line points at
 * them) are skipped, so re-pushing only adds what's new.
 */
export async function pushTakeoffToQuote(
  quoteId: string
): Promise<{ error?: string; pushed?: number; skipped?: number }> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const editable = await assertQuoteEditable(supabase, quoteId)
  if (editable.error) return editable

  const [{ data: items }, { data: pushedLines }, { data: sections }] =
    await Promise.all([
      supabase
        .from('takeoff_items')
        .select('id, description, qty, unit, unit_cost, markup_pct, section_title, deduction, rate_item_id')
        .eq('quote_id', quoteId)
        .order('position'),
      supabase
        .from('quote_lines')
        .select('takeoff_item_id')
        .eq('quote_id', quoteId)
        .not('takeoff_item_id', 'is', null),
      supabase
        .from('quote_sections')
        .select('id, title, position')
        .eq('quote_id', quoteId)
        .order('position'),
    ])

  const alreadyPushed = new Set(
    (pushedLines ?? []).map((l) => l.takeoff_item_id as string)
  )
  const pending = (items ?? []).filter((i) => !alreadyPushed.has(i.id as string))
  if (pending.length === 0) {
    return { pushed: 0, skipped: (items ?? []).length }
  }

  // Cost category flows from the linked rate item onto the quote line.
  const rateIds = [
    ...new Set(
      pending
        .map((i) => i.rate_item_id as string | null)
        .filter((id): id is string => Boolean(id))
    ),
  ]
  const kindByRate = new Map<string, string>()
  if (rateIds.length > 0) {
    const { data: rates } = await supabase
      .from('rate_items')
      .select('id, kind')
      .in('id', rateIds)
    for (const r of rates ?? []) kindByRate.set(r.id as string, r.kind as string)
  }

  // Section find-or-create by title.
  const sectionByTitle = new Map(
    (sections ?? []).map((s) => [s.title as string, s.id as string])
  )
  let nextSectionPos =
    (sections ?? []).reduce((max, s) => Math.max(max, s.position as number), -1) + 1

  async function sectionIdFor(title: string): Promise<string | { error: string }> {
    const existing = sectionByTitle.get(title)
    if (existing) return existing
    const { data: created, error } = await supabase
      .from('quote_sections')
      .insert({ quote_id: quoteId, title, position: nextSectionPos++ })
      .select('id')
      .single()
    if (error || !created) return { error: error?.message ?? 'Section create failed' }
    sectionByTitle.set(title, created.id as string)
    return created.id as string
  }

  // Line positions per section.
  const { data: lineRows } = await supabase
    .from('quote_lines')
    .select('section_id, position')
    .eq('quote_id', quoteId)
  const linePos = new Map<string, number>()
  for (const l of lineRows ?? []) {
    const key = l.section_id as string
    linePos.set(key, Math.max(linePos.get(key) ?? -1, l.position as number))
  }

  let pushed = 0
  for (const item of pending) {
    const title = (item.section_title as string | null)?.trim() || 'Takeoff'
    const sectionId = await sectionIdFor(title)
    if (typeof sectionId !== 'string') return sectionId

    const cost = item.unit_cost === null ? 0 : Number(item.unit_cost)
    const markup = item.markup_pct === null ? DEFAULT_MARKUP_PCT : Number(item.markup_pct)
    const sell = round2(cost * (1 + markup / 100))
    // Deductions carry negative qty into the quote so totals net off.
    const qty = Number(item.qty) * (item.deduction ? -1 : 1)

    const position = (linePos.get(sectionId) ?? -1) + 1
    linePos.set(sectionId, position)

    const { error } = await supabase.from('quote_lines').insert({
      quote_id: quoteId,
      section_id: sectionId,
      description: item.description,
      qty,
      unit: item.unit,
      unit_cost: cost,
      markup_pct: markup,
      unit_sell: sell,
      position,
      takeoff_item_id: item.id,
      kind: item.rate_item_id
        ? kindByRate.get(item.rate_item_id as string) ?? null
        : null,
    })
    if (error) return { error: error.message }
    pushed++
  }

  revalidateTakeoff(quoteId)
  return { pushed, skipped: alreadyPushed.size }
}
