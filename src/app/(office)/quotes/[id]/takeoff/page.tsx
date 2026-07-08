import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeftIcon } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAttachmentsWithUrls } from '@/lib/attachment-queries'
import { StatusBadge } from '@/components/StatusBadge'
import {
  TakeoffWorkspace,
  type AssemblyOption,
  type SheetData,
  type TakeoffItemRow,
  type TakeoffRateItem,
  type PlanAttachment,
} from './takeoff-workspace'

export default async function QuoteTakeoffPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('admin', 'office')

  const { id } = await params
  const supabase = await createClient()

  const [
    { data: quote },
    { data: sheets },
    { data: items },
    { data: rateItems },
    { data: assemblies },
    { data: sections },
  ] = await Promise.all([
    supabase
      .from('quotes')
      .select('id, number, title, status')
      .eq('id', id)
      .single(),
    supabase
      .from('takeoff_sheets')
      .select('id, name, page, scale_m_per_pt, attachment_id')
      .eq('quote_id', id)
      .order('created_at'),
    supabase
      .from('takeoff_items')
      .select(
        'id, sheet_id, source, shape, geometry, deduction, color, description, qty, unit, rate_item_id, unit_cost, markup_pct, section_title, notes, group_id, position'
      )
      .eq('quote_id', id)
      .order('position'),
    supabase
      .from('rate_items')
      .select('id, kind, name, unit, cost, default_markup_pct')
      .eq('active', true)
      .order('kind')
      .order('name'),
    supabase
      .from('takeoff_assemblies')
      .select('id, name, unit, description')
      .eq('active', true)
      .order('name'),
    supabase
      .from('quote_sections')
      .select('title')
      .eq('quote_id', id)
      .order('position'),
  ])

  if (!quote) notFound()

  // Quote attachments — PDFs become candidate sheets; signed URLs feed pdf.js.
  const attachments = await fetchAttachmentsWithUrls(supabase, 'quote', id)
  const pdfAttachments: PlanAttachment[] = attachments
    .filter(
      (a) =>
        a.content_type === 'application/pdf' ||
        a.filename.toLowerCase().endsWith('.pdf')
    )
    .map((a) => ({ id: a.id, filename: a.filename, signedUrl: a.signedUrl }))

  const urlByAttachment = new Map(
    attachments.map((a) => [a.id, a.signedUrl] as const)
  )

  const sheetData: SheetData[] = (sheets ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    page: Number(s.page),
    scale_m_per_pt:
      s.scale_m_per_pt === null ? null : Number(s.scale_m_per_pt),
    signedUrl: urlByAttachment.get(s.attachment_id as string) ?? null,
  }))

  const itemRows: TakeoffItemRow[] = (items ?? []).map((i) => ({
    id: i.id as string,
    sheet_id: (i.sheet_id as string | null) ?? null,
    source: i.source as TakeoffItemRow['source'],
    shape: (i.shape as TakeoffItemRow['shape']) ?? null,
    geometry: (i.geometry as [number, number][] | null) ?? null,
    deduction: Boolean(i.deduction),
    color: (i.color as string | null) ?? null,
    description: i.description as string,
    qty: Number(i.qty),
    unit: i.unit as string,
    rate_item_id: (i.rate_item_id as string | null) ?? null,
    unit_cost: i.unit_cost === null ? null : Number(i.unit_cost),
    markup_pct: i.markup_pct === null ? null : Number(i.markup_pct),
    section_title: (i.section_title as string | null) ?? null,
    notes: (i.notes as string | null) ?? null,
  }))

  const rates: TakeoffRateItem[] = (rateItems ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as string,
    name: r.name as string,
    unit: r.unit as string,
    cost: Number(r.cost),
    default_markup_pct: Number(r.default_markup_pct),
  }))

  const assemblyOptions: AssemblyOption[] = (assemblies ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    unit: a.unit as string,
    description: (a.description as string | null) ?? null,
  }))

  const sectionTitles = [
    ...new Set([
      ...((sections ?? []).map((s) => s.title as string) ?? []),
      ...itemRows.map((i) => i.section_title).filter((t): t is string => Boolean(t)),
    ]),
  ]

  const editable = ['draft', 'sent'].includes(quote.status as string)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link
          href={`/quotes/${id}`}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          {quote.number} — {quote.title}
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Takeoff</h1>
          <StatusBadge status={quote.status as string} />
        </div>
        <p className="text-sm text-muted-foreground">
          Measure on the plans, map quantities to rates, then push the lot into
          the quote as priced lines.
        </p>
      </div>

      <TakeoffWorkspace
        quoteId={id}
        editable={editable}
        sheets={sheetData}
        items={itemRows}
        rateItems={rates}
        assemblies={assemblyOptions}
        planAttachments={pdfAttachments}
        sectionTitles={sectionTitles}
      />
    </div>
  )
}
