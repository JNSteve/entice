// Address splitting for the BUDF record.
//
// The spec carries street number and street name as SEPARATE fields (5/6 for
// the generator, 26/27 transporter, 42/43 receiver), each null-not-allowed,
// each "a physical address and not a PO Box". This repo stores sites.address as
// one line, so it has to be split.
//
// A best-effort split is the right shape here: it prefills the two fields and
// the operator can correct them before saving. It is NEVER used to overwrite
// what someone typed, and the result is snapshotted onto the movement.

export interface SplitAddress {
  streetNumber: string
  streetName: string
}

/**
 * Splits "1/266 George Street" into { streetNumber: '1/266', streetName:
 * 'George Street' }. Handles unit/level prefixes, ranges and alpha suffixes.
 * When no leading number is found the whole value becomes the street name and
 * the number is left empty for the operator to fill — better an obvious blank
 * than a confidently wrong guess on a statutory record.
 */
export function splitStreetAddress(address: string | null | undefined): SplitAddress {
  const raw = (address ?? '').trim().replace(/\s+/g, ' ')
  if (!raw) return { streetNumber: '', streetName: '' }

  // "Unit 5, 266 George St" / "Level 2 266 George St" — fold the prefix into
  // the number so the street name stays clean.
  const prefixed =
    /^((?:unit|shop|suite|level|lot|apt|apartment)\s*[\w-]+)[,\s]+(.*)$/i.exec(raw)
  if (prefixed) {
    const rest = splitStreetAddress(prefixed[2])
    const number = [prefixed[1], rest.streetNumber].filter(Boolean).join(' ')
    return { streetNumber: number.trim(), streetName: rest.streetName }
  }

  // Leading number: 266 | 266A | 266-270 | 1/266 | 1-3/266A
  const m = /^(\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?(?:\s*\/\s*\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?)?)\s+(.+)$/i.exec(
    raw
  )
  if (!m) return { streetNumber: '', streetName: raw }

  return {
    streetNumber: m[1].replace(/\s*([-–/])\s*/g, '$1').trim(),
    streetName: m[2].trim(),
  }
}

/**
 * True when an address looks like a PO Box, which the spec forbids for every
 * address field. Used to warn at capture rather than at export.
 */
export function looksLikePoBox(address: string | null | undefined): boolean {
  const raw = (address ?? '').trim()
  if (!raw) return false
  return /\b(p\.?\s?o\.?\s?box|post(al)?\s+box|g\.?p\.?o\.?|locked\s+bag|private\s+bag)\b/i.test(
    raw
  )
}
