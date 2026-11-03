import { describe, expect, test } from 'vitest'
import {
  LINE_KIND_LABELS,
  LINE_KIND_ORDER,
  groupLinesByKind,
  lineKindLabel,
  sortLinesGrouped,
} from '../src/lib/quote-lines'
import { BUILTIN_RATE_KINDS } from '../src/lib/rate-kinds'

function line(id: string, kind: string | null, position: number, qty = 1, unit_sell = 10) {
  return { id, kind, position, qty, unit_sell }
}

describe('category order and labels', () => {
  test('the quote-line kinds are labour, plant, material, subbie, other', () => {
    expect([...LINE_KIND_ORDER]).toEqual(['labour', 'plant', 'material', 'subbie', 'other'])
  })

  test('labels are the owner-facing names', () => {
    expect(LINE_KIND_LABELS).toEqual({
      labour: 'Labour',
      plant: 'Plant & equipment',
      material: 'Materials',
      subbie: 'Subcontract',
      other: 'Other',
      uncategorised: 'Uncategorised',
    })
    expect(lineKindLabel('plant')).toBe('Plant & equipment')
    expect(lineKindLabel(null)).toBe('Uncategorised')
    expect(lineKindLabel('consumable')).toBe('Consumables')
  })

  test('a custom kind is labelled from the catalog, else by its key', () => {
    const kinds = [...BUILTIN_RATE_KINDS, { key: 'waste', label: 'Waste disposal', builtin: false }]
    expect(lineKindLabel('waste', kinds)).toBe('Waste disposal')
    expect(lineKindLabel('waste')).toBe('waste')
  })
})

describe('sortLinesGrouped', () => {
  test('orders by category, then position, then id, without mutating the input', () => {
    const input = [
      line('d', null, 0),
      line('c', 'material', 0),
      line('b', 'labour', 5),
      line('a', 'labour', 2),
      line('e', 'plant', 1),
    ]
    const copy = [...input]
    expect(sortLinesGrouped(input).map((l) => l.id)).toEqual(['a', 'b', 'e', 'c', 'd'])
    expect(input).toEqual(copy)
  })

  test('ties on category and position break on id', () => {
    const sorted = sortLinesGrouped([line('b', 'other', 0), line('a', 'other', 0)])
    expect(sorted.map((l) => l.id)).toEqual(['a', 'b'])
  })

  test('custom kinds sort after the built-ins, by key, and before uncategorised', () => {
    const out = sortLinesGrouped([
      line('a', null, 0),
      line('b', 'waste', 0),
      line('c', 'other', 0),
      line('d', 'air', 0),
    ])
    expect(out.map((l) => l.id)).toEqual(['c', 'd', 'b', 'a'])
  })
})

describe('groupLinesByKind', () => {
  test('returns only populated groups, in order, with rounded sell subtotals', () => {
    const groups = groupLinesByKind([
      line('m1', 'material', 0, 4, 2.5),
      line('u1', null, 0, 1, 7),
      line('l1', 'labour', 1, 2, 100),
      line('l2', 'labour', 0, 1, 50.555),
    ])
    expect(
      groups.map((g) => [g.kind, g.label, g.lines.map((l) => l.id), g.sellSubtotal])
    ).toEqual([
      ['labour', 'Labour', ['l2', 'l1'], 250.56],
      ['material', 'Materials', ['m1'], 10],
      [null, 'Uncategorised', ['u1'], 7],
    ])
  })

  test('a custom kind gets its own group, labelled from the catalog', () => {
    const kinds = [...BUILTIN_RATE_KINDS, { key: 'waste', label: 'Waste disposal', builtin: false }]
    const groups = groupLinesByKind(
      [line('a', 'waste', 0), line('y', null, 1), line('b', 'labour', 0)],
      kinds
    )
    expect(groups.map((g) => [g.kind, g.label, g.lines.map((l) => l.id)])).toEqual([
      ['labour', 'Labour', ['b']],
      ['waste', 'Waste disposal', ['a']],
      [null, 'Uncategorised', ['y']],
    ])
  })

  test('empty input gives no groups', () => {
    expect(groupLinesByKind([])).toEqual([])
  })
})
