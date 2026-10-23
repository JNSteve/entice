import { lineTotal, round2 } from './money'
import type { RateKind } from './zod'

/**
 * Cost-category order used wherever a section's lines are listed: the quote
 * builder (grouped under headings), the client PDF (same order, no headings)
 * and quote → job/project conversion. Uncategorised (null) lines come last.
 */
export const LINE_KIND_ORDER: readonly RateKind[] = [
  'labour',
  'plant',
  'material',
  'subbie',
  'other',
]

export const LINE_KIND_LABELS: Record<RateKind | 'uncategorised', string> = {
  labour: 'Labour',
  plant: 'Plant & equipment',
  material: 'Materials',
  subbie: 'Subcontract',
  other: 'Other',
  uncategorised: 'Uncategorised',
}

function isRateKind(kind: string | null): kind is RateKind {
  return kind !== null && (LINE_KIND_ORDER as readonly string[]).includes(kind)
}

export function lineKindLabel(kind: string | null): string {
  return isRateKind(kind) ? LINE_KIND_LABELS[kind] : LINE_KIND_LABELS.uncategorised
}

/** Position of a kind in LINE_KIND_ORDER; null or unknown sorts after all of them. */
export function lineKindRank(kind: string | null): number {
  return isRateKind(kind) ? LINE_KIND_ORDER.indexOf(kind) : LINE_KIND_ORDER.length
}

export interface GroupableLine {
  id: string
  position: number
  kind: string | null
}

/** New array: by category rank, then stored position, then id (stable, deterministic). */
export function sortLinesGrouped<T extends GroupableLine>(lines: readonly T[]): T[] {
  return [...lines].sort(
    (a, b) =>
      lineKindRank(a.kind) - lineKindRank(b.kind) ||
      a.position - b.position ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

export interface LineGroup<T> {
  /** null = uncategorised */
  kind: RateKind | null
  label: string
  lines: T[]
  /** Σ qty × unit_sell, in cents-rounded dollars. */
  sellSubtotal: number
}

/** Populated groups only, in LINE_KIND_ORDER then Uncategorised. */
export function groupLinesByKind<T extends GroupableLine & { qty: number; unit_sell: number }>(
  lines: readonly T[]
): LineGroup<T>[] {
  const groups: LineGroup<T>[] = []
  for (const line of sortLinesGrouped(lines)) {
    const kind = isRateKind(line.kind) ? line.kind : null
    let group = groups[groups.length - 1]
    if (!group || group.kind !== kind) {
      group = { kind, label: lineKindLabel(kind), lines: [], sellSubtotal: 0 }
      groups.push(group)
    }
    group.lines.push(line)
    group.sellSubtotal = round2(group.sellSubtotal + lineTotal(line.qty, line.unit_sell))
  }
  return groups
}

/** Rate-library item id → how many of `lines` carry it. Lines with no rate are skipped. */
export function countByRate(
  lines: readonly { rate_item_id: string | null }[]
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const l of lines) {
    if (!l.rate_item_id) continue
    counts.set(l.rate_item_id, (counts.get(l.rate_item_id) ?? 0) + 1)
  }
  return counts
}

/** Description as compared for duplicates: case and runs of spaces don't count. */
function descriptionKey(description: string): string {
  return description.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Ids of the lines that appear more than once among `lines`: the same rate
 * item on two lines, or the same wording on two lines. Blank descriptions
 * never match each other.
 */
export function duplicateLineIds(
  lines: readonly { id: string; rate_item_id: string | null; description: string }[]
): ReadonlySet<string> {
  const byRate = countByRate(lines)
  const byDescription = new Map<string, number>()
  for (const l of lines) {
    const key = descriptionKey(l.description)
    if (key) byDescription.set(key, (byDescription.get(key) ?? 0) + 1)
  }
  const duplicates = new Set<string>()
  for (const l of lines) {
    const key = descriptionKey(l.description)
    const sameRate = l.rate_item_id !== null && (byRate.get(l.rate_item_id) ?? 0) > 1
    const sameWording = key !== '' && (byDescription.get(key) ?? 0) > 1
    if (sameRate || sameWording) duplicates.add(l.id)
  }
  return duplicates
}
