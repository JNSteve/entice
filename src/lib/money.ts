export function round2(n: number): number {
  const sign = n < 0 ? -1 : 1
  return sign * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100
}
export function lineSell(unitCost: number, markupPct: number): number {
  return round2(unitCost * (1 + markupPct / 100))
}
export function lineTotal(qty: number, unitSell: number): number {
  return round2(qty * unitSell)
}
export function docTotals(lines: { qty: number; unitSell: number }[], gstRate: number) {
  const subtotal = round2(lines.reduce((s, l) => s + lineTotal(l.qty, l.unitSell), 0))
  const gst = round2(subtotal * gstRate / 100)
  return { subtotal, gst, total: round2(subtotal + gst) }
}
