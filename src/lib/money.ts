export function round2(n: number): number {
  const sign = n < 0 ? -1 : 1
  return sign * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100
}
/**
 * Rounds to 6 decimal places. Used for claim `pct_complete`, which is the
 * source of truth for a line's claimed-to-date dollars. 2dp is too coarse on
 * large lines (a dollar figure entered on a $2M line round-trips to a different
 * dollar figure); 6dp lets the stored percentage reproduce the entered dollars.
 */
export function round6(n: number): number {
  const sign = n < 0 ? -1 : 1
  return sign * Math.round((Math.abs(n) + Number.EPSILON) * 1e6) / 1e6
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
