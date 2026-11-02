import { describe, expect, test } from 'vitest'
import {
  detectPricesIncludeGst,
  guessColumns,
  importLinesFromExtraction,
  kindToCategory,
  matchLine,
  parseKind,
  quoteKind,
  rowsFromTable,
  supplierKey,
  toExGst,
  withTier,
  type ExistingItem,
} from '../src/lib/price-list'

test('kinds map to P&L categories and quote kinds', () => {
  expect(kindToCategory('consumable')).toBe('consumables')
  expect(kindToCategory('material')).toBe('materials')
  expect(kindToCategory('subbie')).toBe('subcontract')
  expect(quoteKind('consumable')).toBe('material')
  expect(quoteKind('plant')).toBe('plant')
})

test('parseKind understands supplier wording', () => {
  expect(parseKind('Consumables', 'material')).toBe('consumable')
  expect(parseKind('Equipment hire', 'material')).toBe('plant')
  expect(parseKind('Sub-contractor', 'material')).toBe('subbie')
  expect(parseKind('', 'consumable')).toBe('consumable')
})

test('supplierKey and GST conversion', () => {
  expect(supplierKey('  Allens   Industrial ')).toBe('allens industrial')
  expect(toExGst(110, true, 10)).toBe(100)
  expect(toExGst(5.6525, false, 10)).toBe(5.6525)
  expect(toExGst(9.8, true, 10)).toBe(8.9091)
})

describe('spreadsheet import', () => {
  const table = [
    ['Item code', 'Description', 'UOM', 'Nett price', 'Category'],
    ['D85220', 'Black Plastic 200um', 'roll', '$99.313', 'Consumables'],
    ['107420416DOP', 'Nilfisk VHS42 Vacuum', 'ea', '1,810.00', 'Equipment'],
    ['', '', '', '', ''],
    ['JET', 'Delivery', 'ea', '0', ''],
  ]

  test('guessColumns picks sensible columns from the header', () => {
    expect(guessColumns(table[0])).toEqual({ code: 0, name: 1, unit: 2, cost: 3, kind: 4 })
  })

  test('rowsFromTable maps, cleans prices and skips blanks and $0 lines', () => {
    const { lines, skipped } = rowsFromTable(
      table,
      { name: 1, cost: 3, unit: 2, code: 0, kind: 4, qty: null, headerRow: true, defaultKind: 'material' },
      { pricesIncludeGst: false, gstRate: 10 }
    )
    expect(skipped).toBe(2)
    expect(lines).toEqual([
      { code: 'D85220', name: 'Black Plastic 200um', unit: 'roll', unitPrice: 99.313, qty: null, kind: 'consumable', note: null, tier: null },
      { code: '107420416DOP', name: 'Nilfisk VHS42 Vacuum', unit: 'ea', unitPrice: 1810, qty: null, kind: 'plant', note: null, tier: null },
    ])
  })

  test('inc-GST spreadsheets are stored ex GST', () => {
    const { lines } = rowsFromTable(
      [['Silicone', 11]],
      { name: 0, cost: 1, headerRow: false, defaultKind: 'consumable' },
      { pricesIncludeGst: true, gstRate: 10 }
    )
    expect(lines[0]).toMatchObject({ name: 'Silicone', unitPrice: 10, unit: 'ea', kind: 'consumable' })
  })
})

describe('matching against the existing price list', () => {
  const existing: ExistingItem[] = [
    { id: 'a', supplier: 'Allens Industrial', product_code: 'D85220', name: 'Black plastic', cost: 95, unit: 'roll', active: true },
    { id: 'b', supplier: 'Allens Industrial', product_code: null, name: 'White T-Shirt Rags 10kg', cost: 43.94, unit: 'ea', active: true },
    { id: 'c', supplier: 'Bunnings', product_code: 'D85220', name: 'Other', cost: 1, unit: 'ea', active: true },
  ]
  const line = (over: object) => ({ code: null, name: 'X', unit: 'ea', unitPrice: 1, qty: null, kind: 'consumable' as const, note: null, tier: null, ...over })

  test('matches supplier + code first and reports a price change', () => {
    expect(matchLine(line({ code: 'd85220', unitPrice: 99.313, unit: 'roll' }), 'ALLENS  industrial', existing))
      .toEqual({ status: 'changed', id: 'a', oldCost: 95 })
  })
  test('falls back to supplier + name', () => {
    expect(matchLine(line({ name: 'white t-shirt rags 10kg', unitPrice: 43.94 }), 'Allens Industrial', existing))
      .toEqual({ status: 'unchanged', id: 'b' })
  })
  test('unknown lines are new; other suppliers never match', () => {
    expect(matchLine(line({ code: 'ZPZ2' }), 'Allens Industrial', existing)).toEqual({ status: 'new' })
    expect(matchLine(line({ code: 'D85220' }), 'Reece', existing)).toEqual({ status: 'new' })
  })
})

test('detectPricesIncludeGst compares line totals with the document subtotal', () => {
  const lines = [
    { qty: 1, unitPrice: 99.313 },
    { qty: 12, unitPrice: 35.64 },
  ]
  expect(detectPricesIncludeGst(lines, 526.99, 52.7)).toBe(false)
  expect(detectPricesIncludeGst(lines, 479.08, 47.91)).toBe(true)
  expect(detectPricesIncludeGst(lines, 1000, 100)).toBeNull()
  expect(detectPricesIncludeGst(lines, null, null)).toBeNull()
})

test('parseCsvTable handles quotes, embedded commas and CRLF', async () => {
  const { parseCsvTable } = await import('../src/lib/price-list')
  expect(parseCsvTable('﻿Code,Description,Price\r\nA1,"Tape, duct 48mm",12.5\r\nB2,"Say ""hi""",3\r\n\r\n')).toEqual([
    ['Code', 'Description', 'Price'],
    ['A1', 'Tape, duct 48mm', '12.5'],
    ['B2', 'Say "hi"', '3'],
  ])
})

test('a changed type counts as a change; other suppliers never deactivate', () => {
  const existing: ExistingItem[] = [
    { id: 'a', supplier: 'ABC Supplies', product_code: 'X1', name: 'Tape', cost: 5, unit: 'ea', kind: 'material', active: true },
  ]
  const line = { code: 'X1', name: 'Tape', unit: 'ea', unitPrice: 5, qty: null, kind: 'consumable' as const, note: null, tier: null }
  expect(matchLine(line, 'ABC Supplies', existing)).toEqual({ status: 'changed', id: 'a', oldCost: 5 })
  expect(matchLine({ ...line, kind: 'material' }, 'ABC Supplies', existing)).toEqual({ status: 'unchanged', id: 'a' })
  expect(matchLine(line, 'ABC Safety Supplies', existing)).toEqual({ status: 'new' })
})

describe('hire-duration tiers', () => {
  test('withTier folds the price column heading into the name', () => {
    expect(withTier('SMH NPU5000 Negative Pressure Unit', '5 – 8  Weeks')).toBe('SMH NPU5000 Negative Pressure Unit (5-8 Weeks)')
    expect(withTier('Omniguard Monitor', '1 - 4 weeks')).toBe('Omniguard Monitor (1-4 weeks)')
    expect(withTier('Omniguard Monitor', null)).toBe('Omniguard Monitor')
    expect(withTier('Omniguard Monitor', '  ')).toBe('Omniguard Monitor')
    // A name that already carries the tier is left alone.
    expect(withTier('Omniguard Monitor (1-4 weeks)', '1 – 4 weeks')).toBe('Omniguard Monitor (1-4 weeks)')
    expect(withTier('Omniguard Monitor 1-4 weeks', '1-4 Weeks')).toBe('Omniguard Monitor 1-4 weeks')
  })

  test('importLinesFromExtraction keeps one line per tier and drops unpriced lines', () => {
    const lines = importLinesFromExtraction([
      { code: 'NPU5', name: 'SMH NPU5000', unit: 'week', qty: null, unit_price: 450, kind: 'plant', note: null, tier: '1 Week' },
      { code: 'NPU5', name: 'SMH NPU5000', unit: 'week', qty: null, unit_price: 391, kind: 'plant', note: null, tier: '5 – 8 Weeks' },
      { code: null, name: ' Rags ', unit: null, qty: 2, unit_price: 43.9449, kind: 'consumable', note: ' 10kg bag ', tier: null },
      { code: null, name: 'Delivery', unit: null, qty: null, unit_price: 0, kind: 'other', note: null, tier: null },
      { code: null, name: 'Odd kind', unit: null, qty: null, unit_price: 1, kind: 'widget' as never, note: null, tier: '  ' },
    ])
    expect(lines).toEqual([
      { code: 'NPU5', name: 'SMH NPU5000 (1 Week)', unit: 'week', unitPrice: 450, qty: null, kind: 'plant', note: null, tier: '1 Week' },
      { code: 'NPU5', name: 'SMH NPU5000 (5-8 Weeks)', unit: 'week', unitPrice: 391, qty: null, kind: 'plant', note: null, tier: '5-8 Weeks' },
      { code: null, name: 'Rags', unit: 'ea', unitPrice: 43.9449, qty: 2, kind: 'consumable', note: '10kg bag', tier: null },
      { code: null, name: 'Odd kind', unit: 'ea', unitPrice: 1, qty: null, kind: 'material', note: null, tier: null },
    ])
  })

  test('tiered lines match by name, so tiers sharing a product code are not merged', () => {
    const existing: ExistingItem[] = [
      { id: 'w1', supplier: 'Assured', product_code: 'NPU5', name: 'SMH NPU5000 (1 Week)', cost: 450, unit: 'week', kind: 'plant', active: true },
    ]
    const tier = (over: object) => ({ code: 'NPU5', name: 'SMH NPU5000 (1 Week)', unit: 'week', unitPrice: 450, qty: null, kind: 'plant' as const, note: null, tier: '1 Week', ...over })
    expect(matchLine(tier({}), 'Assured', existing)).toEqual({ status: 'unchanged', id: 'w1' })
    expect(matchLine(tier({ name: 'SMH NPU5000 (5-8 Weeks)', tier: '5-8 Weeks', unitPrice: 391 }), 'Assured', existing)).toEqual({ status: 'new' })
    // An untiered line still matches on the code alone, so a renamed product keeps its item.
    expect(matchLine(tier({ name: 'NPU 5000 unit', tier: null }), 'Assured', existing)).toEqual({ status: 'unchanged', id: 'w1' })
  })
})
