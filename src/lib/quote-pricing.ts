import { pct } from '@/lib/format'
import { lineTotal, round2 } from '@/lib/money'
import type { PricingDisplay } from '@/lib/quote-doc'

/**
 * Sell-side pricing view-model for quote PDFs. Input lines carry unit_sell
 * only; the output is a plain object the PDF layer prints without doing
 * arithmetic. Nothing here knows about cost or markup.
 */

export type PricingLine = { description: string; qty: number; unit: string; unit_sell: number }
/** `id` is the quote_sections id; absent for the orphan "Items" group and template samples. */
export type PricingSection = { id?: string; title: string; lines: PricingLine[] }
export type PricingTotals = { subtotal: number; gst: number; gstRate: number; total: number }

/** A money row prints `value` as AUD; a text row prints `text` as given. */
export type TotalsRow = { label: string; value: number } | { label: string; text: string }
export type TotalsRows = {
  rows: TotalsRow[]
  grand: { label: string; value: number }
}

type ItemList = { title: string; items: string[] }

export type PricingModel =
  | {
      mode: 'lump_sum'
      totals: TotalsRows
      itemLists: ItemList[]
    }
  | {
      /** One section priced as rate × quantity; the rest as "Other line items". */
      mode: 'unit_rate'
      totals: TotalsRows
      itemLists: ItemList[]
    }
  | {
      mode: 'section_totals'
      showQtyUnit: boolean
      sections: { title: string; lines: { description: string; qty: string; unit: string }[]; subtotal: number }[]
      totals: TotalsRows
    }
  | {
      mode: 'itemised'
      showQtyUnit: boolean
      sections: {
        title: string
        lines: { description: string; qty: string; unit: string; rate: number; total: number }[]
        subtotal: number
      }[]
      totals: TotalsRows
    }

/** Trim trailing zeros from a qty (numeric 12,3): 2.000 → "2", 1.250 → "1.25". */
export function fmtQty(n: number): string {
  return String(parseFloat(n.toFixed(3)))
}

function sectionSubtotal(section: PricingSection): number {
  return round2(section.lines.reduce((sum, l) => sum + lineTotal(l.qty, l.unit_sell), 0))
}

function totalsRows(t: PricingTotals, showGst: boolean, subtotalLabel: string): TotalsRows {
  const grand = { label: 'Total inc GST', value: t.total }
  if (!showGst) return { rows: [], grand }
  return {
    rows: [
      { label: subtotalLabel, value: t.subtotal },
      { label: `GST ${pct(t.gstRate)}`, value: t.gst },
    ],
    grand,
  }
}

function itemLists(sections: PricingSection[], display: PricingDisplay): ItemList[] {
  return display.list_items
    ? sections.map((s) => ({ title: s.title, items: s.lines.map((l) => l.description) }))
    : []
}

/**
 * Rate rows for unit_rate: the rated section's total over the typed quantity,
 * rounded to the cent. The quote totals are printed as they are; the few
 * cents between rate × quantity and the section total are not reconciled.
 */
function unitRateRows(sections: PricingSection[], totals: PricingTotals, display: PricingDisplay): TotalsRows {
  const rated = sections.find((s) => s.id === display.rate_section_id) ?? sections[0]
  const ratedTotal = rated ? sectionSubtotal(rated) : 0
  const unit = display.rate_unit
  const rows: TotalsRow[] = [
    { label: `Rate per ${unit}`, value: display.rate_qty > 0 ? round2(ratedTotal / display.rate_qty) : 0 },
    { label: `Initial quantity (${unit})`, text: `${fmtQty(display.rate_qty)} ${unit}` },
  ]
  if (sections.some((s) => s !== rated && s.lines.length > 0)) {
    rows.push({ label: 'Other line items', value: round2(totals.subtotal - ratedTotal) })
  }
  const gst = totalsRows(totals, display.show_gst, 'Subtotal (ex GST)')
  return { rows: [...rows, ...gst.rows], grand: gst.grand }
}

export function buildPricingModel(
  sections: PricingSection[],
  totals: PricingTotals,
  display: PricingDisplay
): PricingModel {
  switch (display.mode) {
    case 'lump_sum':
      return {
        mode: 'lump_sum',
        totals: totalsRows(totals, display.show_gst, `${display.fee_label} (ex GST)`),
        itemLists: itemLists(sections, display),
      }
    case 'unit_rate':
      return {
        mode: 'unit_rate',
        totals: unitRateRows(sections, totals, display),
        itemLists: itemLists(sections, display),
      }
    case 'section_totals':
      return {
        mode: 'section_totals',
        showQtyUnit: display.show_qty_unit,
        sections: sections.map((s) => ({
          title: s.title,
          lines: s.lines.map((l) => ({ description: l.description, qty: fmtQty(l.qty), unit: l.unit })),
          subtotal: sectionSubtotal(s),
        })),
        totals: totalsRows(totals, display.show_gst, 'Subtotal (ex GST)'),
      }
    case 'itemised':
      return {
        mode: 'itemised',
        showQtyUnit: display.show_qty_unit,
        sections: sections.map((s) => ({
          title: s.title,
          lines: s.lines.map((l) => ({
            description: l.description,
            qty: fmtQty(l.qty),
            unit: l.unit,
            rate: l.unit_sell,
            total: lineTotal(l.qty, l.unit_sell),
          })),
          subtotal: sectionSubtotal(s),
        })),
        totals: totalsRows(totals, display.show_gst, 'Subtotal (ex GST)'),
      }
  }
}
