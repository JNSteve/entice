'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { lineSell } from '@/lib/money'
import { nextNumber } from '@/lib/numbering'
import {
  quoteCreateSchema,
  quoteHeaderSchema,
  quoteStatusSchema,
  quoteSectionSchema,
  quoteLineCreateSchema,
  quoteLineUpdateSchema,
} from '@/lib/zod'
import type { SupabaseClient } from '@supabase/supabase-js'

type Result = { error?: string }

const EDITABLE_STATUSES = ['draft', 'sent']

function revalidateQuote(quoteId: string) {
  revalidatePath('/quotes')
  revalidatePath(`/quotes/${quoteId}`)
}

/**
 * Every mutation must verify the quote is still editable (draft or sent).
 * Once accepted/lost a quote is frozen — no edits anywhere.
 */
async function assertEditable(
  supabase: SupabaseClient,
  quoteId: string
): Promise<{ error?: string }> {
  const { data: quote, error } = await supabase
    .from('quotes')
    .select('id, status')
    .eq('id', quoteId)
    .single()

  if (error || !quote) return { error: 'Quote not found' }
  if (!EDITABLE_STATUSES.includes(quote.status)) {
    return { error: `Quote is ${quote.status} and can no longer be edited` }
  }
  return {}
}

// ─── Quote ───────────────────────────────────────────────────────────────────

export async function createQuote(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin', 'office')

  const parsed = quoteCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  // GST rate snapshot from company settings (falls back to the column default).
  const { data: settings } = await supabase
    .from('settings')
    .select('gst_rate')
    .eq('id', 1)
    .single()

  let number: string
  try {
    number = await nextNumber(supabase, 'quote')
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to allocate quote number' }
  }

  const { data: row, error } = await supabase
    .from('quotes')
    .insert({
      number,
      client_id: parsed.data.client_id,
      site_id: parsed.data.site_id,
      contact_id: parsed.data.contact_id,
      title: parsed.data.title,
      gst_rate: settings?.gst_rate ?? 10,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidatePath('/quotes')
  return { id: row.id }
}

export async function updateQuoteHeader(
  id: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = quoteHeaderSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const editable = await assertEditable(supabase, id)
  if (editable.error) return editable

  const { error } = await supabase.from('quotes').update(parsed.data).eq('id', id)
  if (error) return { error: error.message }

  revalidateQuote(id)
  return {}
}

export async function setQuoteStatus(
  id: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = quoteStatusSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { data: quote, error: fetchError } = await supabase
    .from('quotes')
    .select('id, status')
    .eq('id', id)
    .single()
  if (fetchError || !quote) return { error: 'Quote not found' }

  const target = parsed.data.status
  const now = new Date().toISOString()

  // Legal transitions: draft→sent, sent→accepted, sent→lost.
  let update: Record<string, unknown>
  if (target === 'sent' && quote.status === 'draft') {
    update = { status: 'sent', sent_at: now }
  } else if (target === 'accepted' && quote.status === 'sent') {
    update = { status: 'accepted', decided_at: now }
  } else if (target === 'lost' && quote.status === 'sent') {
    update = { status: 'lost', decided_at: now, lost_reason: parsed.data.lost_reason ?? null }
  } else {
    return { error: `Can't move a ${quote.status} quote to ${target}` }
  }

  const { error } = await supabase.from('quotes').update(update).eq('id', id)
  if (error) return { error: error.message }

  revalidateQuote(id)
  return {}
}

// ─── Sections ────────────────────────────────────────────────────────────────

export async function addSection(data: unknown): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = quoteSectionSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const editable = await assertEditable(supabase, parsed.data.quote_id)
  if (editable.error) return editable

  const { data: last } = await supabase
    .from('quote_sections')
    .select('position')
    .eq('quote_id', parsed.data.quote_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await supabase.from('quote_sections').insert({
    quote_id: parsed.data.quote_id,
    title: parsed.data.title,
    position: (last?.position ?? -1) + 1,
  })
  if (error) return { error: error.message }

  revalidateQuote(parsed.data.quote_id)
  return {}
}

export async function updateSection(
  id: string,
  title: string
): Promise<Result> {
  await requireRole('admin', 'office')

  if (!title.trim()) return { error: 'Section title is required' }

  const supabase = await createClient()
  const { data: section } = await supabase
    .from('quote_sections')
    .select('id, quote_id')
    .eq('id', id)
    .single()
  if (!section) return { error: 'Section not found' }

  const editable = await assertEditable(supabase, section.quote_id)
  if (editable.error) return editable

  const { error } = await supabase
    .from('quote_sections')
    .update({ title: title.trim() })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidateQuote(section.quote_id)
  return {}
}

export async function deleteSection(id: string): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const { data: section } = await supabase
    .from('quote_sections')
    .select('id, quote_id')
    .eq('id', id)
    .single()
  if (!section) return { error: 'Section not found' }

  const editable = await assertEditable(supabase, section.quote_id)
  if (editable.error) return editable

  // Delete the section's lines first (FK is on delete set null, which would
  // otherwise leave orphan lines floating outside every section).
  const { error: linesError } = await supabase
    .from('quote_lines')
    .delete()
    .eq('section_id', id)
  if (linesError) return { error: linesError.message }

  const { error } = await supabase.from('quote_sections').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidateQuote(section.quote_id)
  return {}
}

export async function moveSection(
  id: string,
  dir: 'up' | 'down'
): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const { data: section } = await supabase
    .from('quote_sections')
    .select('id, quote_id')
    .eq('id', id)
    .single()
  if (!section) return { error: 'Section not found' }

  const editable = await assertEditable(supabase, section.quote_id)
  if (editable.error) return editable

  const { data: siblings, error: sibError } = await supabase
    .from('quote_sections')
    .select('id, position')
    .eq('quote_id', section.quote_id)
    .order('position')
    .order('id')
  if (sibError || !siblings) return { error: sibError?.message ?? 'Failed to load sections' }

  const swapError = await swapAndReindex(
    siblings,
    id,
    dir,
    async (rowId, position) => {
      const { error } = await supabase
        .from('quote_sections')
        .update({ position })
        .eq('id', rowId)
      return error?.message
    }
  )
  if (swapError) return { error: swapError }

  revalidateQuote(section.quote_id)
  return {}
}

// ─── Lines ───────────────────────────────────────────────────────────────────

export async function addLine(data: unknown): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = quoteLineCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const editable = await assertEditable(supabase, parsed.data.quote_id)
  if (editable.error) return editable

  // The section must belong to the quote.
  const { data: section } = await supabase
    .from('quote_sections')
    .select('id')
    .eq('id', parsed.data.section_id)
    .eq('quote_id', parsed.data.quote_id)
    .single()
  if (!section) return { error: 'Section not found on this quote' }

  // Defaults for a blank manual line.
  let line = {
    description: '',
    unit: 'ea',
    unit_cost: 0,
    markup_pct: 0,
    unit_sell: 0,
    rate_item_id: null as string | null,
  }

  if (parsed.data.rate_item_id) {
    const { data: rateItem } = await supabase
      .from('rate_items')
      .select('id, name, unit, cost, default_markup_pct')
      .eq('id', parsed.data.rate_item_id)
      .single()
    if (!rateItem) return { error: 'Rate item not found' }

    line = {
      description: rateItem.name,
      unit: rateItem.unit,
      unit_cost: Number(rateItem.cost),
      markup_pct: Number(rateItem.default_markup_pct),
      unit_sell: lineSell(Number(rateItem.cost), Number(rateItem.default_markup_pct)),
      rate_item_id: rateItem.id,
    }
  }

  const { data: last } = await supabase
    .from('quote_lines')
    .select('position')
    .eq('section_id', parsed.data.section_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await supabase.from('quote_lines').insert({
    quote_id: parsed.data.quote_id,
    section_id: parsed.data.section_id,
    position: (last?.position ?? -1) + 1,
    qty: 1,
    ...line,
  })
  if (error) return { error: error.message }

  revalidateQuote(parsed.data.quote_id)
  return {}
}

export async function updateLine(id: string, data: unknown): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = quoteLineUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { data: line } = await supabase
    .from('quote_lines')
    .select('id, quote_id')
    .eq('id', id)
    .single()
  if (!line) return { error: 'Line not found' }

  const editable = await assertEditable(supabase, line.quote_id)
  if (editable.error) return editable

  const { sell_overridden, ...fields } = parsed.data
  // Server is the source of truth for the auto-computed sell price.
  const unit_sell = sell_overridden
    ? fields.unit_sell
    : lineSell(fields.unit_cost, fields.markup_pct)

  const { error } = await supabase
    .from('quote_lines')
    .update({ ...fields, unit_sell })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidateQuote(line.quote_id)
  return {}
}

export async function deleteLine(id: string): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const { data: line } = await supabase
    .from('quote_lines')
    .select('id, quote_id')
    .eq('id', id)
    .single()
  if (!line) return { error: 'Line not found' }

  const editable = await assertEditable(supabase, line.quote_id)
  if (editable.error) return editable

  const { error } = await supabase.from('quote_lines').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidateQuote(line.quote_id)
  return {}
}

export async function moveLine(id: string, dir: 'up' | 'down'): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const { data: line } = await supabase
    .from('quote_lines')
    .select('id, quote_id, section_id')
    .eq('id', id)
    .single()
  if (!line) return { error: 'Line not found' }

  const editable = await assertEditable(supabase, line.quote_id)
  if (editable.error) return editable

  let query = supabase
    .from('quote_lines')
    .select('id, position')
    .eq('quote_id', line.quote_id)
  query = line.section_id
    ? query.eq('section_id', line.section_id)
    : query.is('section_id', null)
  const { data: siblings, error: sibError } = await query
    .order('position')
    .order('id')
  if (sibError || !siblings) return { error: sibError?.message ?? 'Failed to load lines' }

  const swapError = await swapAndReindex(
    siblings,
    id,
    dir,
    async (rowId, position) => {
      const { error } = await supabase
        .from('quote_lines')
        .update({ position })
        .eq('id', rowId)
      return error?.message
    }
  )
  if (swapError) return { error: swapError }

  revalidateQuote(line.quote_id)
  return {}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Swaps the target row with its neighbour, then writes back normalised
 * sequential positions (repairs any duplicate/gappy positions on the way).
 */
async function swapAndReindex(
  ordered: { id: string; position: number }[],
  targetId: string,
  dir: 'up' | 'down',
  write: (id: string, position: number) => Promise<string | undefined>
): Promise<string | undefined> {
  const index = ordered.findIndex((r) => r.id === targetId)
  if (index === -1) return 'Row not found'

  const swapWith = dir === 'up' ? index - 1 : index + 1
  if (swapWith < 0 || swapWith >= ordered.length) return undefined // edge — no-op

  const next = [...ordered]
  ;[next[index], next[swapWith]] = [next[swapWith], next[index]]

  for (let i = 0; i < next.length; i++) {
    if (next[i].position !== i) {
      const error = await write(next[i].id, i)
      if (error) return error
    }
  }
  return undefined
}
