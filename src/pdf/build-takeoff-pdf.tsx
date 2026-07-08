import { renderToBuffer } from '@react-pdf/renderer'
import type { SupabaseClient } from '@supabase/supabase-js'
import { aud, fmtDate } from '@/lib/format'
import { round2 } from '@/lib/money'
import { todayAU } from '@/lib/tz'
import {
  TakeoffPdf,
  type TakeoffGroup,
  type TakeoffItemRow,
  type TakeoffPdfData,
} from './TakeoffPdf'
import { toDocCompany, type SettingsRow } from './build-quote-pdf'

const DEFAULT_MARKUP_PCT = 20

const SOURCE_LABELS: Record<string, string> = {
  report: 'Report',
  assembly: 'Assembly',
  manual: 'Manual',
}

/** Trims trailing zeros from a fixed-3dp quantity (e.g. 12.500 → "12.5"). */
function fmtQty(n: number): string {
  return String(Number(n.toFixed(3)))
}

/**
 * Shared takeoff-schedule builder used by the office route
 * (/api/pdf/takeoff/[quoteId], authed client). The estimating audit trail:
 * measured/extracted quantities behind a quote, grouped by section with
 * per-item rate, section cost subtotals and a grand cost/sell block. Money
 * document — office/admin only, like the quote itself.
 */
export async function buildTakeoffPdfResponse(
  supabase: SupabaseClient,
  quoteId: string
): Promise<Response> {
  const [{ data: quote }, { data: items }, { data: sheets }, { data: settings }] =
    await Promise.all([
      supabase
        .from('quotes')
        .select('id, number, title, status')
        .eq('id', quoteId)
        .single(),
      supabase
        .from('takeoff_items')
        .select(
          'description, qty, unit, source, shape, deduction, unit_cost, markup_pct, section_title, sheet_id'
        )
        .eq('quote_id', quoteId)
        .order('position'),
      supabase.from('takeoff_sheets').select('id, name').eq('quote_id', quoteId),
      supabase
        .from('settings')
        .select('company_name, abn, address, phone, email, logo_path')
        .eq('id', 1)
        .single(),
    ])

  if (!quote) return new Response('Not found', { status: 404 })

  const sheetName = new Map(
    (sheets ?? []).map((s) => [s.id as string, s.name as string])
  )

  let totalCost = 0
  let totalSell = 0

  // Group by section_title (null → 'Takeoff'), preserving first-seen order.
  const groupOrder: string[] = []
  const groupItems = new Map<string, TakeoffItemRow[]>()
  const groupCost = new Map<string, number>()

  for (const it of items ?? []) {
    const title = (it.section_title as string | null) ?? 'Takeoff'
    if (!groupItems.has(title)) {
      groupOrder.push(title)
      groupItems.set(title, [])
      groupCost.set(title, 0)
    }

    const deduction = Boolean(it.deduction)
    const sign = deduction ? -1 : 1
    const qty = Number(it.qty)
    const unitCost = it.unit_cost == null ? null : Number(it.unit_cost)
    const markup =
      it.markup_pct == null ? DEFAULT_MARKUP_PCT : Number(it.markup_pct)

    const amount = round2(sign * qty * (unitCost ?? 0))
    const sell = round2(sign * qty * (unitCost ?? 0) * (1 + markup / 100))

    totalCost = round2(totalCost + amount)
    totalSell = round2(totalSell + sell)
    groupCost.set(title, round2((groupCost.get(title) ?? 0) + amount))

    const source =
      it.source === 'measured'
        ? `Measured — ${sheetName.get(it.sheet_id as string) ?? ''}`.replace(
            / — $/,
            ''
          )
        : (SOURCE_LABELS[it.source as string] ?? (it.source as string))

    const row: TakeoffItemRow = {
      description: it.description as string,
      qtyDisplay: `${deduction ? '−' : ''}${fmtQty(qty)}`,
      unit: it.unit as string,
      source,
      rateDisplay: unitCost == null ? '—' : aud(unitCost),
      amountDisplay: aud(amount),
      negative: deduction,
    }
    groupItems.get(title)!.push(row)
  }

  const groups: TakeoffGroup[] = groupOrder.map((title) => ({
    title,
    items: groupItems.get(title)!,
    subtotalDisplay: aud(groupCost.get(title) ?? 0),
  }))

  const data: TakeoffPdfData = {
    quoteNumber: quote.number as string,
    title: (quote.title as string | null) ?? null,
    generatedDisplay: fmtDate(todayAU()),
    groups,
    totalCostDisplay: aud(totalCost),
    totalSellDisplay: aud(totalSell),
  }

  const buffer = await renderToBuffer(
    <TakeoffPdf
      data={data}
      company={toDocCompany((settings ?? null) as SettingsRow | null)}
    />
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="takeoff-${quote.number}.pdf"`,
    },
  })
}
