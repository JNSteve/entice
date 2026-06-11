import { describe, expect, test } from 'vitest'
import { csvField, toCsv } from '../src/lib/csv'

describe('csvField', () => {
  test('plain value passes through', () => {
    expect(csvField('Labour')).toBe('Labour')
  })

  test('null and undefined become empty string', () => {
    expect(csvField(null)).toBe('')
    expect(csvField(undefined)).toBe('')
  })

  test('comma triggers quoting', () => {
    expect(csvField('Supply, install')).toBe('"Supply, install"')
  })

  test('double-quote is doubled and quoted', () => {
    expect(csvField('6" pipe')).toBe('"6"" pipe"')
  })

  test('newline triggers quoting', () => {
    expect(csvField('line1\nline2')).toBe('"line1\nline2"')
  })

  test('numbers and booleans are stringified', () => {
    expect(csvField(33.33)).toBe('33.33')
    expect(csvField(true)).toBe('true')
  })
})

describe('toCsv', () => {
  test('empty array produces empty string', () => {
    expect(toCsv([])).toBe('')
  })

  test('header row comes from object keys', () => {
    const csv = toCsv([{ Project: 'P-0001', Budget: 1000 }])
    const lines = csv.split('\n')
    expect(lines[0]).toBe('Project,Budget')
    expect(lines[1]).toBe('P-0001,1000')
  })

  test('multiple rows share one header', () => {
    const csv = toCsv([
      { Name: 'Acme', Total: 100 },
      { Name: 'Builder Co', Total: 250.5 },
    ])
    expect(csv).toBe('Name,Total\nAcme,100\nBuilder Co,250.5')
  })

  test('values with commas and quotes are escaped', () => {
    const csv = toCsv([{ Description: 'Supply "premium", grade', Qty: 5 }])
    expect(csv.split('\n')[1]).toBe('"Supply ""premium"", grade",5')
  })

  test('header containing a comma is escaped', () => {
    const csv = toCsv([{ 'Margin, %': 12 }])
    expect(csv.split('\n')[0]).toBe('"Margin, %"')
  })

  test('null and undefined values produce empty cells', () => {
    const csv = toCsv([{ a: 1, b: null, c: undefined, d: 'x' }])
    expect(csv.split('\n')[1]).toBe('1,,,x')
  })

  test('header is union of keys across rows in first-appearance order', () => {
    const csv = toCsv([
      { a: 1, b: 2 },
      { a: 3, c: 4 },
    ])
    const lines = csv.split('\n')
    expect(lines[0]).toBe('a,b,c')
    expect(lines[1]).toBe('1,2,')
    expect(lines[2]).toBe('3,,4')
  })
})
