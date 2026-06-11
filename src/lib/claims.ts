import { round2 } from './money'

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
