'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { lineSell } from '@/lib/money'
import { nextNumber } from '@/lib/numbering'
import { syncRequestsForQuote } from '@/lib/notify'
import { canPublishQuote } from '@/lib/portal-interactions'
import { jobPayloadFromQuote, projectPayloadFromQuote } from '@/lib/convert'
import { copyQuoteAttachments, seedConvertChecklist } from '@/lib/convert-side-effects'
import {
  quoteCreateSchema,
  quoteHeaderSchema,
  quoteStatusSchema,
  quoteSectionSchema,
  quoteLineCreateSchema,
  quoteLineUpdateSchema,
} from '@/lib/zod'
import {
  normaliseBlocks,
  pricingDisplaySchema,
  quoteDocSchema,
  quoteTemplateSchema,
  snapshotFromTemplate,
  type DocBlock,
} from '@/lib/quote-doc'
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

  // Verify client exists and is not archived.
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('id', parsed.data.client_id)
    .eq('archived', false)
    .single()
  if (!client) return { error: 'Client not found or archived' }

  // GST rate snapshot from company settings (falls back to the column default).
  const { data: settings } = await supabase
    .from('settings')
    .select('gst_rate')
    .eq('id', 1)
    .single()

  let templatePatch: Record<string, unknown> = {}
  if (parsed.data.template_id) {
    const loaded = await loadTemplate(supabase, parsed.data.template_id)
    if ('error' in loaded) return { error: loaded.error }
    templatePatch = {
      template_id: parsed.data.template_id,
      doc: snapshotFromTemplate(loaded.template),
      pdf_options: loaded.template.pricing_defaults,
    }
  }

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
      // PM defaults to whoever raised the quote — always assigned from day one.
      pm_id: parsed.data.pm_id ?? profile.id,
      gst_rate: settings?.gst_rate ?? 10,
      created_by: profile.id,
      ...templatePatch,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidatePath('/quotes')
  return { id: row.id }
}

/**
 * Clone a quote into a fresh draft — any status is fair game (the main use is
 * re-quoting from an accepted job). Copies the header, sections and lines but
 * drops all lifecycle state (sent/decided/lost/portal/converted/archived) and
 * the takeoff provenance link; the new quote is owned by whoever duplicated it.
 */
export async function duplicateQuote(
  quoteId: string
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin', 'office')

  const supabase = await createClient()

  const { data: source, error: srcErr } = await supabase
    .from('quotes')
    .select(
      'id, client_id, site_id, contact_id, title, description, notes, valid_days, gst_rate, template_id, doc, pdf_options'
    )
    .eq('id', quoteId)
    .single()
  if (srcErr || !source) return { error: 'Quote not found' }

  let number: string
  try {
    number = await nextNumber(supabase, 'quote')
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to allocate quote number' }
  }

  const { data: newQuote, error: insErr } = await supabase
    .from('quotes')
    .insert({
      number,
      client_id: source.client_id,
      site_id: source.site_id,
      contact_id: source.contact_id,
      title: `${source.title} (copy)`,
      description: source.description,
      notes: source.notes,
      valid_days: source.valid_days,
      gst_rate: source.gst_rate,
      template_id: source.template_id,
      doc: source.doc,
      pdf_options: source.pdf_options,
      status: 'draft',
      pm_id: profile.id,
      created_by: profile.id,
    })
    .select('id')
    .single()
  if (insErr || !newQuote) return { error: insErr?.message ?? 'Failed to create quote' }

  // Copy sections, building an old→new id map for line remapping.
  const { data: sections } = await supabase
    .from('quote_sections')
    .select('id, title, position')
    .eq('quote_id', quoteId)
    .order('position')
    .order('id')

  const sectionMap = new Map<string, string>()
  for (const section of sections ?? []) {
    const { data: newSection, error: secErr } = await supabase
      .from('quote_sections')
      .insert({
        quote_id: newQuote.id,
        title: section.title,
        position: section.position,
      })
      .select('id')
      .single()
    if (secErr || !newSection) return { error: secErr?.message ?? 'Failed to copy section' }
    sectionMap.set(section.id, newSection.id)
  }

  // Copy lines, remapping section ids (null / orphaned → null; takeoff link dropped).
  const { data: lines } = await supabase
    .from('quote_lines')
    .select(
      'section_id, description, qty, unit, unit_cost, markup_pct, unit_sell, position'
    )
    .eq('quote_id', quoteId)
    .order('position')
    .order('id')

  if (lines?.length) {
    const { error: linesErr } = await supabase.from('quote_lines').insert(
      lines.map((l) => ({
        quote_id: newQuote.id,
        section_id: l.section_id ? sectionMap.get(l.section_id) ?? null : null,
        description: l.description,
        qty: l.qty,
        unit: l.unit,
        unit_cost: l.unit_cost,
        markup_pct: l.markup_pct,
        unit_sell: l.unit_sell,
        position: l.position,
      }))
    )
    if (linesErr) return { error: linesErr.message }
  }

  revalidatePath('/quotes')
  return { id: newQuote.id }
}

/**
 * Reversible archive — hides the quote from lists/pickers/reports without
 * touching any data. Works on any status (frozen/converted included); restore
 * lives in Settings → Archive. Independent of the converted job/project.
 */
export async function setQuoteArchived(
  id: string,
  archived: boolean
): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const { error } = await supabase
    .from('quotes')
    .update({ archived, archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidateQuote(id)
  revalidatePath('/settings')
  return {}
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

/**
 * Portal publishing (CP2b sign-on-the-glass): only a SENT quote can be
 * published — the portal offers accept/decline while it stays sent, and the
 * definer fn re-checks both flags. Unpublishing is allowed anytime.
 */
export async function setQuotePortalPublished(
  id: string,
  published: boolean
): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const { data: quote, error: fetchError } = await supabase
    .from('quotes')
    .select('id, status')
    .eq('id', id)
    .single()
  if (fetchError || !quote) return { error: 'Quote not found' }

  if (published && !canPublishQuote(quote.status)) {
    return { error: 'Only a sent quote can be published to the portal' }
  }

  const { error } = await supabase
    .from('quotes')
    .update({ portal_published: published })
    .eq('id', id)
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

  // Renormalise sibling section positions to close the gap.
  const { data: siblings } = await supabase
    .from('quote_sections')
    .select('id, position')
    .eq('quote_id', section.quote_id)
    .order('position')
    .order('id')
  if (siblings?.length) {
    const renumError = await renumberSiblings(
      siblings,
      async (rowId, position) => {
        const { error: e } = await supabase
          .from('quote_sections')
          .update({ position })
          .eq('id', rowId)
        return e?.message
      }
    )
    if (renumError) return { error: renumError }
  }

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
    kind: null as string | null,
  }

  if (parsed.data.rate_item_id) {
    const { data: rateItem } = await supabase
      .from('rate_items')
      .select('id, kind, name, unit, cost, default_markup_pct')
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
      kind: (rateItem.kind as string | null) ?? null,
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
    .select('id, quote_id, section_id')
    .eq('id', id)
    .single()
  if (!line) return { error: 'Line not found' }

  const editable = await assertEditable(supabase, line.quote_id)
  if (editable.error) return editable

  const { error } = await supabase.from('quote_lines').delete().eq('id', id)
  if (error) return { error: error.message }

  // Renormalise sibling positions to close the gap.
  let siblingsQuery = supabase
    .from('quote_lines')
    .select('id, position')
    .eq('quote_id', line.quote_id)
  siblingsQuery = line.section_id
    ? siblingsQuery.eq('section_id', line.section_id)
    : siblingsQuery.is('section_id', null)
  const { data: siblings } = await siblingsQuery.order('position').order('id')
  if (siblings?.length) {
    const renumError = await renumberSiblings(
      siblings,
      async (rowId, position) => {
        const { error: e } = await supabase
          .from('quote_lines')
          .update({ position })
          .eq('id', rowId)
        return e?.message
      }
    )
    if (renumError) return { error: renumError }
  }

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

// ─── Conversion ──────────────────────────────────────────────────────────────

export async function convertQuoteToJob(quoteId: string): Promise<Result> {
  const profile = await requireRole('admin', 'office')

  const supabase = await createClient()

  // Re-fetch the quote — server-side guard against double conversion.
  const { data: quote, error: qErr } = await supabase
    .from('quotes')
    .select('id, status, converted_id, client_id, site_id, title, description, pm_id')
    .eq('id', quoteId)
    .single()

  if (qErr || !quote) return { error: 'Quote not found' }
  if (quote.status !== 'accepted') return { error: 'Only accepted quotes can be converted' }
  if (quote.converted_id) return { error: 'Quote has already been converted' }

  // Sections + lines feed the price-free scope summary in the description.
  const [{ data: sections }, { data: lines }] = await Promise.all([
    supabase
      .from('quote_sections')
      .select('id, title, position')
      .eq('quote_id', quoteId)
      .order('position')
      .order('id'),
    supabase
      .from('quote_lines')
      .select('section_id, description, qty, unit_cost, unit_sell')
      .eq('quote_id', quoteId)
      .order('position')
      .order('id'),
  ])

  let number: string
  try {
    number = await nextNumber(supabase, 'job')
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to allocate job number' }
  }

  const payload = jobPayloadFromQuote(
    {
      id: quote.id,
      client_id: quote.client_id,
      site_id: quote.site_id,
      title: quote.title,
      description: quote.description,
      gst_rate: 0, // not needed for job payload
      pm_id: quote.pm_id ?? null,
    },
    number,
    sections ?? [],
    (lines ?? []).map((l) => ({
      section_id: l.section_id,
      description: l.description,
      qty: Number(l.qty),
      unit_cost: Number(l.unit_cost),
      unit_sell: Number(l.unit_sell),
    }))
  )

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .insert(payload)
    .select('id')
    .single()

  if (jobErr || !job) return { error: jobErr?.message ?? 'Failed to create job' }

  // Carry the working context across — start-up checklist + scope documents.
  await seedConvertChecklist(supabase, { table: 'job_checklist_items', fk: 'job_id' }, job.id)
  await copyQuoteAttachments(supabase, quoteId, 'job', job.id, profile.id)

  const { error: updateErr } = await supabase
    .from('quotes')
    .update({ converted_to: 'job', converted_id: job.id })
    .eq('id', quoteId)

  if (updateErr) return { error: updateErr.message }

  // Linked portal request → 'scheduled' — fire-and-forget after the response
  // (must be registered BEFORE redirect() throws).
  after(() => syncRequestsForQuote(quoteId, 'work_scheduled'))

  revalidatePath('/quotes')
  revalidatePath(`/quotes/${quoteId}`)
  redirect(`/jobs/${job.id}`)
}

export async function convertQuoteToProject(quoteId: string): Promise<Result> {
  const profile = await requireRole('admin', 'office')

  const supabase = await createClient()

  // Re-fetch the quote — server-side guard against double conversion.
  const { data: quote, error: qErr } = await supabase
    .from('quotes')
    .select('id, status, converted_id, client_id, site_id, title, description, gst_rate, pm_id')
    .eq('id', quoteId)
    .single()

  if (qErr || !quote) return { error: 'Quote not found' }
  if (quote.status !== 'accepted') return { error: 'Only accepted quotes can be converted' }
  if (quote.converted_id) return { error: 'Quote has already been converted' }

  // Fetch sections and lines for budget computation.
  const [{ data: sections }, { data: lines }] = await Promise.all([
    supabase
      .from('quote_sections')
      .select('id, title, position')
      .eq('quote_id', quoteId)
      .order('position')
      .order('id'),
    supabase
      .from('quote_lines')
      .select('section_id, description, qty, unit_cost, unit_sell')
      .eq('quote_id', quoteId)
      .order('position')
      .order('id'),
  ])

  // Fetch the "Other" cost code (code = '99').
  const { data: otherCode } = await supabase
    .from('cost_codes')
    .select('id')
    .eq('code', '99')
    .single()

  if (!otherCode) return { error: 'Cost code "99 – Other" not found; cannot create budget lines' }

  let number: string
  try {
    number = await nextNumber(supabase, 'project')
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to allocate project number' }
  }

  const { project: projectPayload, budgetLines } = projectPayloadFromQuote(
    {
      id: quote.id,
      client_id: quote.client_id,
      site_id: quote.site_id,
      title: quote.title,
      description: quote.description,
      gst_rate: Number(quote.gst_rate),
      pm_id: quote.pm_id ?? null,
    },
    sections ?? [],
    (lines ?? []).map((l) => ({
      section_id: l.section_id,
      description: l.description,
      qty: Number(l.qty),
      unit_cost: Number(l.unit_cost),
      unit_sell: Number(l.unit_sell),
    })),
    otherCode.id
  )

  // Insert the project with the allocated number.
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .insert({ ...projectPayload, number })
    .select('id')
    .single()

  if (projErr || !project) return { error: projErr?.message ?? 'Failed to create project' }

  // Insert budget lines (if any).
  if (budgetLines.length > 0) {
    const { error: blErr } = await supabase
      .from('budget_lines')
      .insert(budgetLines.map((bl) => ({ ...bl, project_id: project.id })))

    if (blErr) return { error: blErr.message }
  }

  // Carry the working context across — mobilisation checklist + scope documents.
  await seedConvertChecklist(
    supabase,
    { table: 'project_checklist_items', fk: 'project_id' },
    project.id
  )
  await copyQuoteAttachments(supabase, quoteId, 'project', project.id, profile.id)

  const { error: updateErr } = await supabase
    .from('quotes')
    .update({ converted_to: 'project', converted_id: project.id })
    .eq('id', quoteId)

  if (updateErr) return { error: updateErr.message }

  // Linked portal request → 'scheduled' — fire-and-forget after the response
  // (must be registered BEFORE redirect() throws).
  after(() => syncRequestsForQuote(quoteId, 'work_scheduled'))

  revalidatePath('/quotes')
  revalidatePath(`/quotes/${quoteId}`)
  redirect(`/projects/${project.id}`)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Rewrites sequential 0-based positions for every sibling row whose current
 * position doesn't already match its ordinal index.  Call this after a delete
 * to close the gap left behind.
 */
async function renumberSiblings(
  ordered: { id: string; position: number }[],
  write: (id: string, position: number) => Promise<string | undefined>
): Promise<string | undefined> {
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].position !== i) {
      const error = await write(ordered[i].id, i)
      if (error) return error
    }
  }
  return undefined
}

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

  return renumberSiblings(next, write)
}

// ─── Document template ───────────────────────────────────────────────────────

/** Active template row, validated, or an error message. */
async function loadTemplate(supabase: SupabaseClient, templateId: string) {
  const { data } = await supabase
    .from('quote_templates')
    .select('doc_title, heading, validity_text, number_headings, blocks, pricing_defaults, name')
    .eq('id', templateId)
    .eq('active', true)
    .maybeSingle()
  if (!data) return { error: 'Template not found or inactive' as const }
  const parsed = quoteTemplateSchema.safeParse(data)
  if (!parsed.success) return { error: 'Template is invalid — fix it in Settings' as const }
  return { template: parsed.data }
}

/**
 * Snapshots a template onto the quote (doc + pricing defaults) or, with null,
 * returns the quote to the standard layout. Frozen quotes are refused.
 */
export async function applyQuoteTemplate(
  quoteId: string,
  templateId: string | null
): Promise<Result> {
  await requireRole('admin', 'office')
  const supabase = await createClient()
  const editable = await assertEditable(supabase, quoteId)
  if (editable.error) return editable

  let patch: Record<string, unknown>
  if (templateId) {
    const loaded = await loadTemplate(supabase, templateId)
    if ('error' in loaded) return { error: loaded.error }
    patch = {
      template_id: templateId,
      doc: snapshotFromTemplate(loaded.template),
      pdf_options: loaded.template.pricing_defaults,
    }
  } else {
    patch = { template_id: null, doc: null }
  }

  const { error } = await supabase.from('quotes').update(patch).eq('id', quoteId)
  if (error) return { error: error.message }
  revalidateQuote(quoteId)
  return {}
}

/** Saves per-quote edits to the document snapshot (heading, validity, blocks). */
export async function updateQuoteDoc(quoteId: string, doc: unknown): Promise<Result> {
  await requireRole('admin', 'office')
  const raw = (doc && typeof doc === 'object' ? doc : {}) as Record<string, unknown>
  const cleaned = {
    ...raw,
    heading: typeof raw.heading === 'string' ? raw.heading.trim() || null : raw.heading,
    validity_text:
      typeof raw.validity_text === 'string' ? raw.validity_text.trim() : raw.validity_text,
    blocks: Array.isArray(raw.blocks) ? normaliseBlocks(raw.blocks as DocBlock[]) : raw.blocks,
  }
  const parsed = quoteDocSchema.safeParse(cleaned)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid document' }
  }

  const supabase = await createClient()
  const editable = await assertEditable(supabase, quoteId)
  if (editable.error) return editable

  const { error } = await supabase.from('quotes').update({ doc: parsed.data }).eq('id', quoteId)
  if (error) return { error: error.message }
  revalidateQuote(quoteId)
  return {}
}

export async function updateQuotePdfOptions(quoteId: string, options: unknown): Promise<Result> {
  await requireRole('admin', 'office')
  const parsed = pricingDisplaySchema.safeParse(options)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid options' }
  }

  const supabase = await createClient()
  const editable = await assertEditable(supabase, quoteId)
  if (editable.error) return editable

  const { error } = await supabase
    .from('quotes')
    .update({ pdf_options: parsed.data })
    .eq('id', quoteId)
  if (error) return { error: error.message }
  revalidateQuote(quoteId)
  return {}
}
