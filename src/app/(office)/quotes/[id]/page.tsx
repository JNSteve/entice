import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  QuoteBuilder,
  type QuoteData,
  type SectionData,
  type LineData,
  type RateItemData,
} from './quote-builder'

export default async function QuoteBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('admin', 'office')

  const { id } = await params
  const supabase = await createClient()

  const [{ data: quote }, { data: sections }, { data: lines }, { data: rateItems }] =
    await Promise.all([
      supabase
        .from('quotes')
        .select('*, clients(name), sites(name), contacts(name)')
        .eq('id', id)
        .single(),
      supabase
        .from('quote_sections')
        .select('id, title, position')
        .eq('quote_id', id)
        .order('position')
        .order('id'),
      supabase
        .from('quote_lines')
        .select('id, section_id, position, description, qty, unit, unit_cost, markup_pct, unit_sell')
        .eq('quote_id', id)
        .order('position')
        .order('id'),
      supabase
        .from('rate_items')
        .select('id, kind, name, unit, cost, default_markup_pct')
        .eq('active', true)
        .order('name'),
    ])

  if (!quote) notFound()

  const quoteData: QuoteData = {
    id: quote.id,
    number: quote.number,
    title: quote.title,
    description: quote.description,
    status: quote.status,
    gst_rate: Number(quote.gst_rate),
    valid_days: quote.valid_days,
    sent_at: quote.sent_at,
    decided_at: quote.decided_at,
    lost_reason: quote.lost_reason,
    client_name: (quote.clients as { name: string } | null)?.name ?? '—',
    site_name: (quote.sites as { name: string } | null)?.name ?? null,
    contact_name: (quote.contacts as { name: string } | null)?.name ?? null,
  }

  const sectionData: SectionData[] = (sections ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    position: s.position,
  }))

  const lineData: LineData[] = (lines ?? []).map((l) => ({
    id: l.id,
    section_id: l.section_id,
    position: l.position,
    description: l.description,
    qty: Number(l.qty),
    unit: l.unit,
    unit_cost: Number(l.unit_cost),
    markup_pct: Number(l.markup_pct),
    unit_sell: Number(l.unit_sell),
  }))

  const rateItemData: RateItemData[] = (rateItems ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    unit: r.unit,
    cost: Number(r.cost),
    default_markup_pct: Number(r.default_markup_pct),
  }))

  return (
    <QuoteBuilder
      quote={quoteData}
      sections={sectionData}
      lines={lineData}
      rateItems={rateItemData}
    />
  )
}
