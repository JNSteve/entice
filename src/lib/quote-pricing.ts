import { pct } from '@/lib/format'
import { lineTotal, round2 } from '@/lib/money'
import type { PricingDisplay } from '@/lib/quote-doc'

/**
 * Sell-side pricing view-model for quote PDFs. Input lines carry unit_sell
 * only; the output is a plain object the PDF layer prints without doing
 * arithmetic. Nothing here knows about cost or markup.
 */

export type PricingLine = { description: string; qty: number; unit: string; unit_sell: number }
export type PricingSection = { title: string; lines: PricingLine[] }
export type PricingTotals = { subtotal: number; gst: number; gstRate: number; total: number }

export type TotalsRows = {
  rows: { label: string; value: number }[]
  grand: { label: string; value: number }
}

export type PricingModel =
  | {
      mode: 'lump_sum'
      totals: TotalsRows
      itemLists: { title: string; items: string[] }[]
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
        itemLists: display.list_items
          ? sections.map((s) => ({ title: s.title, items: s.lines.map((l) => l.description) }))
          : [],
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
