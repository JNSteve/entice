import { describe, expect, test } from 'vitest'
import { round2, lineSell, lineMarkup, lineTotal, docTotals } from '../src/lib/money'

test('round2 rounds half away from zero', () => {
  expect(round2(1.005)).toBe(1.01)
  expect(round2(2.675)).toBe(2.68)
  expect(round2(-1.005)).toBe(-1.01)
  expect(round2(10)).toBe(10)
})
test('lineSell = cost * (1 + markup%)', () => {
  expect(lineSell(100, 20)).toBe(120)
  expect(lineSell(33.33, 15)).toBe(38.33)
})
test('lineTotal = qty * unitSell rounded', () => {
  expect(lineTotal(3, 38.33)).toBe(114.99)
})
test('docTotals sums lines then GST on subtotal', () => {
  const lines = [{ qty: 3, unitSell: 38.33 }, { qty: 1, unitSell: 0.01 }]
  expect(docTotals(lines, 10)).toEqual({ subtotal: 115.0, gst: 11.5, total: 126.5 })
})
test('lineMarkup is the markup % that takes cost to sell, 2dp', () => {
  expect(lineMarkup(100, 180)).toBe(80)
  expect(lineMarkup(6.8, 8.16)).toBe(20)
  expect(lineMarkup(7, 9)).toBe(28.57)
  expect(lineMarkup(100, 100)).toBe(0)
  expect(lineMarkup(100, 50)).toBe(-50)
})
test('lineMarkup is null when there is no cost to mark up', () => {
  expect(lineMarkup(0, 50)).toBeNull()
  expect(lineMarkup(0, 0)).toBeNull()
})
