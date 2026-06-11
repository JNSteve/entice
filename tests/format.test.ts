import { expect, test } from 'vitest'
import { aud, fmtDate, pct } from '../src/lib/format'

test('aud formats AUD currency', () => {
  expect(aud(1234.5)).toBe('$1,234.50')
  expect(aud(0)).toBe('$0.00')
})
test('fmtDate formats dd/MM/yyyy and tolerates nullish', () => {
  expect(fmtDate('2026-06-11')).toBe('11/06/2026')
  expect(fmtDate(null)).toBe('')
  expect(fmtDate(undefined)).toBe('')
})
test('pct trims trailing zeros', () => {
  expect(pct(12.5)).toBe('12.5%')
  expect(pct(10)).toBe('10%')
})
