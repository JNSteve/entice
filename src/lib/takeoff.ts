/**
 * Pure takeoff quantity math — geometry is stored in PDF POINT coordinates
 * (pt), calibration converts to real-world metres. No Supabase imports;
 * everything here is vitest-covered (tests/takeoff.test.ts).
 */

export type Pt = [number, number]

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** Shoelace area in pt² (absolute — winding order doesn't matter). */
export function polygonAreaPt2(points: Pt[]): number {
  if (points.length < 3) return 0
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

/** Sum of segment lengths in pt. */
export function polylineLengthPt(points: Pt[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0]
    const dy = points[i][1] - points[i - 1][1]
    total += Math.hypot(dx, dy)
  }
  return total
}

/** Real-world m² for a polygon given metres-per-pt (scale applies squared). */
export function areaM2(points: Pt[], mPerPt: number): number {
  return round3(polygonAreaPt2(points) * mPerPt * mPerPt)
}

/** Real-world metres for a polyline given metres-per-pt. */
export function lengthM(points: Pt[], mPerPt: number): number {
  return round3(polylineLengthPt(points) * mPerPt)
}

/**
 * Calibration: the user clicks two points spanning a known real-world
 * distance → metres per PDF point.
 */
export function scaleFromCalibration(p1: Pt, p2: Pt, metres: number): number {
  const pt = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
  if (pt === 0 || metres <= 0) return 0
  return metres / pt
}

/** Waste: quantity × kg-per-unit → tonnes (3dp). */
export function wasteTonnes(qty: number, kgPerUnit: number): number {
  return round3((qty * kgPerUnit) / 1000)
}

/** Common ECR waste densities — editable in the calculator, not gospel. */
export const WASTE_PRESETS: {
  label: string
  unit: 'm2' | 'm3'
  kgPerUnit: number
}[] = [
  { label: 'AC sheeting (fibro)', unit: 'm2', kgPerUnit: 15 },
  { label: 'Vinyl tiles + adhesive', unit: 'm2', kgPerUnit: 8 },
  { label: 'Contaminated soil', unit: 'm3', kgPerUnit: 1800 },
  { label: 'Concrete', unit: 'm3', kgPerUnit: 2400 },
]

export interface AssemblyComponentInput {
  description: string
  unit: string
  /** Component qty per 1 assembly unit. */
  factor: number
  /** Flat qty regardless of assembly qty (mobilisation, clearance, …). */
  fixed_qty: number | null
}

/** One assembly qty → concrete component line quantities. */
export function explodeAssembly(
  qty: number,
  components: AssemblyComponentInput[]
): { description: string; unit: string; qty: number }[] {
  return components.map((c) => ({
    description: c.description,
    unit: c.unit,
    qty: c.fixed_qty != null ? round3(c.fixed_qty) : round3(qty * c.factor),
  }))
}
