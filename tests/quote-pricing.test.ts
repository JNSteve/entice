import { describe, expect, test } from 'vitest'
import { DEFAULT_PRICING, pricingDisplaySchema } from '../src/lib/quote-doc'
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
  for (const mode of ['lump_sum', 'unit_rate', 'section_totals', 'itemised'] as const) {
    const json = JSON.stringify(buildPricingModel(leaky, TOTALS, { ...DEFAULT_PRICING, mode, rate_qty: 1 }))
    expect(json).not.toMatch(/unit_cost|markup/)
  }
})

describe('unit_rate', () => {
  const RATED: PricingSection[] = [
    { id: 'sec-1', title: 'Removal', lines: [
      { description: 'Strip AC sheeting', qty: 1, unit: 'ea', unit_sell: 49620.66 },
    ] },
    { id: 'sec-2', title: 'Hazmat Survey', lines: [
      { description: 'Survey', qty: 1, unit: 'ea', unit_sell: 1200 },
    ] },
  ]
  const RATED_TOTALS = { subtotal: 50820.66, gst: 5082.07, gstRate: 10, total: 55902.73 }
  const display = { ...DEFAULT_PRICING, mode: 'unit_rate' as const, rate_section_id: 'sec-1', rate_qty: 1250, rate_unit: 'm2' }

  test('rows: rate to the cent, quantity text, other line items, then GST; totals unchanged', () => {
    const m = buildPricingModel(RATED, RATED_TOTALS, display)
    expect(m.mode).toBe('unit_rate')
    if (m.mode !== 'unit_rate') return
    expect(m.totals.rows).toEqual([
      { label: 'Rate per m2', value: 39.7 },
      { label: 'Initial quantity (m2)', text: '1250 m2' },
      { label: 'Other line items', value: 1200 },
      { label: 'Subtotal (ex GST)', value: 50820.66 },
      { label: 'GST 10%', value: 5082.07 },
    ])
    expect(m.totals.grand).toEqual({ label: 'Total inc GST', value: 55902.73 })
    expect(m.itemLists).toEqual([
      { title: 'Removal', items: ['Strip AC sheeting'] },
      { title: 'Hazmat Survey', items: ['Survey'] },
    ])
  })

  test('no other section with lines: no Other line items row', () => {
    const m = buildPricingModel([RATED[0]], { subtotal: 49620.66, gst: 4962.07, gstRate: 10, total: 54582.73 }, display)
    if (m.mode !== 'unit_rate') return
    expect(m.totals.rows.map((r) => r.label)).toEqual(['Rate per m2', 'Initial quantity (m2)', 'Subtotal (ex GST)', 'GST 10%'])
  })

  test('show_gst false keeps the rate rows and drops subtotal and GST', () => {
    const m = buildPricingModel(RATED, RATED_TOTALS, { ...display, show_gst: false })
    if (m.mode !== 'unit_rate') return
    expect(m.totals.rows.map((r) => r.label)).toEqual(['Rate per m2', 'Initial quantity (m2)', 'Other line items'])
    expect(m.totals.grand.value).toBe(55902.73)
  })

  test('null or unknown rate_section_id falls back to the first section', () => {
    for (const id of [null, 'nope']) {
      const m = buildPricingModel(RATED, RATED_TOTALS, { ...display, rate_section_id: id })
      if (m.mode !== 'unit_rate') return
      expect(m.totals.rows[0]).toEqual({ label: 'Rate per m2', value: 39.7 })
    }
  })

  test('quantity with decimals prints trimmed and the unit prints as typed', () => {
    const m = buildPricingModel(RATED, RATED_TOTALS, { ...display, rate_qty: 12.5, rate_unit: 'lm' })
    if (m.mode !== 'unit_rate') return
    expect(m.totals.rows[0]).toEqual({ label: 'Rate per lm', value: 3969.65 })
    expect(m.totals.rows[1]).toEqual({ label: 'Initial quantity (lm)', text: '12.5 lm' })
  })

  test('list_items false yields no item lists', () => {
    const m = buildPricingModel(RATED, RATED_TOTALS, { ...display, list_items: false })
    if (m.mode !== 'unit_rate') return
    expect(m.itemLists).toEqual([])
  })
})

describe('pricingDisplaySchema and unit_rate', () => {
  test('options saved before unit rate still parse, with the rate defaults filled in', () => {
    const p = pricingDisplaySchema.parse({ mode: 'lump_sum', show_qty_unit: true, list_items: true, show_gst: true, fee_label: 'Fixed fee' })
    expect(p).toMatchObject({ rate_section_id: null, rate_qty: 0, rate_unit: 'm2' })
  })

  test('unit_rate needs a quantity above zero', () => {
    const bad = pricingDisplaySchema.safeParse({ ...DEFAULT_PRICING, mode: 'unit_rate' })
    expect(bad.success).toBe(false)
    if (!bad.success) expect(bad.error.issues[0]?.message).toBe('Quantity is required')
    expect(pricingDisplaySchema.safeParse({ ...DEFAULT_PRICING, mode: 'unit_rate', rate_qty: 95 }).success).toBe(true)
  })
})
