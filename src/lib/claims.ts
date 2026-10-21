import { round2, round6 } from './money'

/**
 * Previously-claimed floor for a line as a percentage (6dp), capped at 100.
 * A draft line cannot drop below this without an explicit reduction (credit).
 * 6dp so a dollar figure entered on a large line round-trips exactly.
 */
export function floorPct(lineValue: number, previousClaimed: number): number {
  if (lineValue <= 0) return 0
  return Math.min(round6((previousClaimed / lineValue) * 100), 100)
}

/**
 * Percentage to store when one figure is pushed to every line at once (a 20%
 * deposit, 100% at completion): the requested pct clamped to [floor, 100].
 */
export function bulkPct(lineValue: number, previousClaimed: number, pct: number): number {
  if (lineValue <= 0) return 0
  return Math.min(Math.max(round6(pct), floorPct(lineValue, previousClaimed)), 100)
}

export type ClaimLineInput = {
  sourceType: 'budget_line' | 'variation'
  sourceId: string
  description: string
  lineValue: number
  pctComplete: number
  previousClaimed: number
}

export type RetentionRules = {
  pctPerClaim: number
  capPct: number
  contractSum: number
  previouslyWithheld: number
}

export type ClaimLineResult = ClaimLineInput & {
  claimedToDate: number
  thisClaim: number
}

export type ClaimResult = {
  lines: ClaimLineResult[]
  grossThisClaim: number
  retentionThisClaim: number
  subtotal: number
  gst: number
  totalIncGst: number
  totalClaimedToDate: number
}

export function computeClaim(
  lines: ClaimLineInput[],
  retention: RetentionRules,
  gstRate: number,
): ClaimResult {
  const outLines = lines.map(l => {
    const claimedToDate = round2(l.lineValue * l.pctComplete / 100)
    return { ...l, claimedToDate, thisClaim: round2(claimedToDate - l.previousClaimed) }
  })

  const grossThisClaim = round2(outLines.reduce((s, l) => s + l.thisClaim, 0))

  const cap = round2(retention.capPct / 100 * retention.contractSum)
  const headroom = Math.max(0, round2(cap - retention.previouslyWithheld))
  const retentionThisClaim = grossThisClaim <= 0
    ? 0
    : Math.min(round2(grossThisClaim * retention.pctPerClaim / 100), headroom)

  const subtotal = round2(grossThisClaim - retentionThisClaim)
  const gst = round2(subtotal * gstRate / 100)

  return {
    lines: outLines,
    grossThisClaim,
    retentionThisClaim,
    subtotal,
    gst,
    totalIncGst: round2(subtotal + gst),
    totalClaimedToDate: round2(outLines.reduce((s, l) => s + l.claimedToDate, 0)),
  }
}
