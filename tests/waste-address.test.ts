import { describe, expect, test } from 'vitest'
import { looksLikePoBox, splitStreetAddress } from '../src/lib/waste/address'

describe('splitStreetAddress', () => {
  test('plain number and street', () => {
    expect(splitStreetAddress('266 George Street')).toEqual({
      streetNumber: '266',
      streetName: 'George Street',
    })
  })

  test('alpha suffix stays with the number', () => {
    expect(splitStreetAddress('12A Wickham Terrace')).toEqual({
      streetNumber: '12A',
      streetName: 'Wickham Terrace',
    })
  })

  test('unit slash number', () => {
    expect(splitStreetAddress('1/266 George Street')).toEqual({
      streetNumber: '1/266',
      streetName: 'George Street',
    })
  })

  test('range', () => {
    expect(splitStreetAddress('266-270 George Street')).toEqual({
      streetNumber: '266-270',
      streetName: 'George Street',
    })
  })

  test('spacing around separators is normalised', () => {
    expect(splitStreetAddress('266 - 270 George Street').streetNumber).toBe('266-270')
    expect(splitStreetAddress('1 / 266 George Street').streetNumber).toBe('1/266')
  })

  test('unit prefix folds into the number', () => {
    expect(splitStreetAddress('Unit 5, 266 George Street')).toEqual({
      streetNumber: 'Unit 5 266',
      streetName: 'George Street',
    })
    expect(splitStreetAddress('Level 2 100 Creek Street')).toEqual({
      streetNumber: 'Level 2 100',
      streetName: 'Creek Street',
    })
  })

  test('no leading number leaves the number blank rather than guessing', () => {
    expect(splitStreetAddress('The Esplanade')).toEqual({
      streetNumber: '',
      streetName: 'The Esplanade',
    })
  })

  test('blank input gives two blanks', () => {
    expect(splitStreetAddress(null)).toEqual({ streetNumber: '', streetName: '' })
    expect(splitStreetAddress('   ')).toEqual({ streetNumber: '', streetName: '' })
  })

  test('collapses runs of whitespace', () => {
    expect(splitStreetAddress('  266   George   Street ')).toEqual({
      streetNumber: '266',
      streetName: 'George Street',
    })
  })
})

describe('looksLikePoBox — the spec forbids PO Boxes on every address field', () => {
  test('catches the common forms', () => {
    for (const v of [
      'PO Box 123',
      'P.O. Box 123',
      'po box 99, Brisbane',
      'GPO Box 1434',
      'Locked Bag 5',
      'Private Bag 12',
    ]) {
      expect(looksLikePoBox(v)).toBe(true)
    }
  })

  test('leaves real street addresses alone', () => {
    for (const v of ['266 George Street', '14 Depot Road', 'Boxwood Avenue', '']) {
      expect(looksLikePoBox(v)).toBe(false)
    }
  })
})
