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
