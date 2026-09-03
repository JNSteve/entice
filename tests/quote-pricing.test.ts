import { describe, expect, test } from 'vitest'
import { DEFAULT_PRICING } from '../src/lib/quote-doc'
import { buildPricingModel, fmtQty, type PricingSection } from '../src/lib/quote-pricing'

const SECTIONS: PricingSection[] = [
  { title: 'Preparation', lines: [
    { description: 'Site setup', qty: 3, unit: 'ea', unit_sell: 100 },
    { description: 'Traffic mgmt', qty: 2.5, unit: 'hr', unit_sell: 50 },
  ] },
  { title: 'Materials', lines: [{ description: 'Membrane', qty: 1, unit: 'm2', unit_sell: 250.5 }] },
]
const TOTALS = { subtotal: 675.5, gst: 67.55, gstRate: 10, total: 743.05 }

test('fmtQty trims trailing zeros', () => {
  expect(fmtQty(2)).toBe('2')
  expect(fmtQty(1.25)).toBe('1.25')
  expect(fmtQty(0.5)).toBe('0.5')
})

describe('itemised', () => {
  test('rows carry rate and total per line, section subtotals and GST rows', () => {
    const m = buildPricingModel(SECTIONS, TOTALS, DEFAULT_PRICING)
    expect(m.mode).toBe('itemised')
    if (m.mode !== 'itemised') return
    expect(m.showQtyUnit).toBe(true)
    expect(m.sections[0].lines[1]).toEqual({ description: 'Traffic mgmt', qty: '2.5', unit: 'hr', rate: 50, total: 125 })
    expect(m.sections[0].subtotal).toBe(425)
    expect(m.sections[1].subtotal).toBe(250.5)
    expect(m.totals.rows).toEqual([{ label: 'Subtotal (ex GST)', value: 675.5 }, { label: 'GST 10%', value: 67.55 }])
    expect(m.totals.grand).toEqual({ label: 'Total inc GST', value: 743.05 })
  })

  test('show_gst false collapses the totals to the grand line', () => {
    const m = buildPricingModel(SECTIONS, TOTALS, { ...DEFAULT_PRICING, show_gst: false })
    expect(m.totals.rows).toEqual([])
    expect(m.totals.grand.value).toBe(743.05)
  })
})

describe('section_totals', () => {
  test('lines have no rate or total; subtotals remain', () => {
    const m = buildPricingModel(SECTIONS, TOTALS, { ...DEFAULT_PRICING, mode: 'section_totals', show_qty_unit: false })
    expect(m.mode).toBe('section_totals')
    if (m.mode !== 'section_totals') return
    expect(m.showQtyUnit).toBe(false)
    expect(m.sections[0].lines[0]).toEqual({ description: 'Site setup', qty: '3', unit: 'ea' })
    expect(m.sections[0].subtotal).toBe(425)
    expect(JSON.stringify(m)).not.toMatch(/"rate"|"total":/)
  })
})

describe('lump_sum', () => {
  test('fee label, totals and optional item lists without numbers', () => {
    const m = buildPricingModel(SECTIONS, TOTALS, { ...DEFAULT_PRICING, mode: 'lump_sum', fee_label: 'Fixed fee' })
    expect(m.mode).toBe('lump_sum')
    if (m.mode !== 'lump_sum') return
    expect(m.totals.rows[0]).toEqual({ label: 'Fixed fee (ex GST)', value: 675.5 })
    expect(m.itemLists).toEqual([
      { title: 'Preparation', items: ['Site setup', 'Traffic mgmt'] },
      { title: 'Materials', items: ['Membrane'] },
    ])
  })

  test('list_items false yields no item lists', () => {
    const m = buildPricingModel(SECTIONS, TOTALS, { ...DEFAULT_PRICING, mode: 'lump_sum', list_items: false })
    if (m.mode !== 'lump_sum') return
    expect(m.itemLists).toEqual([])
  })
})

test('the model never carries cost or markup even if the input has extra keys', () => {
  const leaky = SECTIONS.map((s) => ({
    ...s,
    lines: s.lines.map((l) => ({ ...l, unit_cost: 1, markup_pct: 99 })),
  }))
  for (const mode of ['lump_sum', 'section_totals', 'itemised'] as const) {
    const json = JSON.stringify(buildPricingModel(leaky, TOTALS, { ...DEFAULT_PRICING, mode }))
    expect(json).not.toMatch(/unit_cost|markup/)
  }
})
