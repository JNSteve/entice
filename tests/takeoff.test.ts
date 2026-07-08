import { describe, expect, test } from 'vitest'
import {
  areaM2,
  explodeAssembly,
  lengthM,
  polygonAreaPt2,
  polylineLengthPt,
  scaleFromCalibration,
  wasteTonnes,
  WASTE_PRESETS,
  type Pt,
} from '../src/lib/takeoff'

// A 100pt × 50pt rectangle.
const RECT: Pt[] = [
  [0, 0],
  [100, 0],
  [100, 50],
  [0, 50],
]

describe('polygonAreaPt2', () => {
  test('rectangle area via shoelace', () => {
    expect(polygonAreaPt2(RECT)).toBe(5000)
  })

  test('triangle area', () => {
    expect(polygonAreaPt2([[0, 0], [10, 0], [0, 10]])).toBe(50)
  })

  test('winding order does not matter (absolute)', () => {
    expect(polygonAreaPt2([...RECT].reverse())).toBe(5000)
  })

  test('fewer than 3 points → 0', () => {
    expect(polygonAreaPt2([[0, 0], [10, 10]])).toBe(0)
  })
})

describe('polylineLengthPt', () => {
  test('two segments', () => {
    expect(polylineLengthPt([[0, 0], [30, 40], [30, 140]])).toBe(150) // 50 + 100
  })

  test('single point → 0', () => {
    expect(polylineLengthPt([[5, 5]])).toBe(0)
  })
})

describe('calibration + real-world quantities', () => {
  // 100pt measured = 5 metres real → 0.05 m/pt
  const M_PER_PT = scaleFromCalibration([0, 0], [100, 0], 5)

  test('scaleFromCalibration', () => {
    expect(M_PER_PT).toBe(0.05)
  })

  test('areaM2 applies scale squared', () => {
    // 5000 pt² × 0.05² = 12.5 m²
    expect(areaM2(RECT, M_PER_PT)).toBe(12.5)
  })

  test('lengthM applies scale linearly', () => {
    expect(lengthM([[0, 0], [100, 0]], M_PER_PT)).toBe(5)
  })

  test('rounding to 3dp', () => {
    const scale = scaleFromCalibration([0, 0], [3, 0], 1) // 1/3 m per pt
    expect(lengthM([[0, 0], [1, 0]], scale)).toBe(0.333)
  })
})

describe('wasteTonnes', () => {
  test('AC sheeting preset: 100 m² × 15 kg/m² = 1.5 t', () => {
    const ac = WASTE_PRESETS.find((p) => p.label.includes('AC sheeting'))!
    expect(wasteTonnes(100, ac.kgPerUnit)).toBe(1.5)
  })

  test('soil: 10 m³ × 1800 kg/m³ = 18 t', () => {
    expect(wasteTonnes(10, 1800)).toBe(18)
  })
})

describe('explodeAssembly', () => {
  const COMPONENTS = [
    { description: 'Removal labour', unit: 'hr', factor: 0.5, fixed_qty: null },
    { description: 'Air monitoring shift', unit: 'ea', factor: 1, fixed_qty: 2 },
  ]

  test('factor components scale with qty; fixed stay flat', () => {
    const lines = explodeAssembly(40, COMPONENTS)
    expect(lines).toEqual([
      { description: 'Removal labour', unit: 'hr', qty: 20 },
      { description: 'Air monitoring shift', unit: 'ea', qty: 2 },
    ])
  })

  test('rounds factored qty to 3dp', () => {
    const lines = explodeAssembly(10, [
      { description: 'x', unit: 'ea', factor: 0.3333, fixed_qty: null },
    ])
    expect(lines[0].qty).toBe(3.333)
  })
})
