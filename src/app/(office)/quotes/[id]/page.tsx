import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RulerIcon } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { buttonVariants } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'
import { pricingDisplaySchema, quoteDocSchema } from '@/lib/quote-doc'
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

  const [
    { data: quote },
    { data: sections },
    { data: lines },
    { data: rateItems },
    { data: pmOptions },
    { data: templates },
  ] = await Promise.all([
      supabase
        .from('quotes')
        .select(
          '*, clients(name), sites(name), contacts(name), profiles!quotes_pm_id_fkey(id, full_name), quote_templates(name)'
        )
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
        .select('id, section_id, position, description, qty, unit, unit_cost, markup_pct, unit_sell, kind')
        .eq('quote_id', id)
        .order('position')
        .order('id'),
      supabase
        .from('rate_items')
        .select('id, kind, name, unit, cost, default_markup_pct')
        .eq('active', true)
        .order('name'),
      supabase
        .from('profiles')
        .select('id, full_name')
        .in('role', ['admin', 'office'])
        .eq('active', true)
        .order('full_name'),
      supabase
        .from('quote_templates')
        .select('id, name, is_default')
        .eq('active', true)
        .order('name'),
    ])

  if (!quote) notFound()

  // Resolve the converted entity number (jobs or projects) if applicable.
  let convertedNumber: string | null = null
  if (quote.converted_to && quote.converted_id) {
    const table = quote.converted_to === 'job' ? 'jobs' : 'projects'
    const { data: converted } = await supabase
      .from(table)
      .select('number')
      .eq('id', quote.converted_id)
      .single()
    convertedNumber = (converted as { number: string } | null)?.number ?? null
  }

  // Sign-on-the-glass evidence (an accept wins over an earlier decline).
  const { data: acceptances } = await supabase
    .from('portal_acceptances')
    .select('action, signer_name, signature_data, reason, ip, signed_at')
    .eq('kind', 'quote')
    .eq('target_id', id)
    .order('signed_at', { ascending: false })
  const acceptanceRow =
    (acceptances ?? []).find((a) => a.action === 'accepted') ??
    (acceptances ?? [])[0] ??
    null

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
    pm_id: (quote.profiles as { id: string } | null)?.id ?? null,
    pm_name: (quote.profiles as { full_name: string } | null)?.full_name ?? null,
    converted_to: quote.converted_to ?? null,
    converted_id: quote.converted_id ?? null,
    converted_number: convertedNumber,
    archived: Boolean(quote.archived),
    portal_published: Boolean(quote.portal_published),
    portal_acceptance: acceptanceRow
      ? {
          action: acceptanceRow.action as 'accepted' | 'declined',
          signer_name: acceptanceRow.signer_name as string,
          signed_display: new Date(
            acceptanceRow.signed_at as string
          ).toLocaleString('en-AU', {
            timeZone: 'Australia/Brisbane',
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
          signature_data: (acceptanceRow.signature_data as string | null) ?? null,
          reason: (acceptanceRow.reason as string | null) ?? null,
          ip: (acceptanceRow.ip as string | null) ?? null,
        }
      : null,
    template_id: (quote.template_id as string | null) ?? null,
    template_name: (quote.quote_templates as { name: string } | null)?.name ?? null,
    doc: (() => {
      const p = quoteDocSchema.safeParse(quote.doc)
      return p.success ? p.data : null
    })(),
    pdf_options: (() => {
      const p = pricingDisplaySchema.safeParse(quote.pdf_options)
      return p.success ? p.data : null
    })(),
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
    kind: (l.kind as string | null) ?? null,
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
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Link
          href={`/quotes/${quoteData.id}/takeoff`}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <RulerIcon className="size-4" />
          Takeoff
        </Link>
      </div>
      <QuoteBuilder
        quote={quoteData}
        sections={sectionData}
        lines={lineData}
        rateItems={rateItemData}
        pmOptions={pmOptions ?? []}
        templates={(templates ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          is_default: Boolean(t.is_default),
        }))}
      />
    </div>
  )
}
