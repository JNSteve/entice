/**
 * Rate categories ("kinds"): the six built-ins the code knows about plus any
 * the owner adds in Settings → Rates → Categories. Rows come from the
 * `rate_kinds` table; this module is pure so client components can use it.
 *
 * Order everywhere a kind is listed or grouped: built-ins in the order below,
 * then custom kinds by key, then uncategorised (null). The order needs no
 * catalog, so server code sorts lines without loading the table.
 */
export interface RateKindRow {
  key: string
  label: string
  builtin: boolean
}

/** Shape of a kind key: the slug of its label. */
export const RATE_KIND_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/

export const BUILTIN_RATE_KINDS: readonly RateKindRow[] = [
  { key: 'labour', label: 'Labour', builtin: true },
  { key: 'plant', label: 'Plant & equipment', builtin: true },
  { key: 'material', label: 'Materials', builtin: true },
  { key: 'consumable', label: 'Consumables', builtin: true },
  { key: 'subbie', label: 'Subcontract', builtin: true },
  { key: 'other', label: 'Other', builtin: true },
]

const BUILTIN_RANK = new Map(BUILTIN_RATE_KINDS.map((r, i) => [r.key, i]))

export function isRateKindKey(s: string): boolean {
  return RATE_KIND_KEY_RE.test(s)
}

/**
 * The key a new category is stored under: its label lower-cased with runs of
 * anything but letters and digits collapsed to a dash, capped at 40. Empty
 * when nothing survives ("&&&").
 */
export function slugKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}

/** Built-ins in their fixed order, then custom kinds by key, then null. */
export function compareKinds(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a == null) return 1
  if (b == null) return -1
  const ra = BUILTIN_RANK.get(a)
  const rb = BUILTIN_RANK.get(b)
  if (ra != null && rb != null) return ra - rb
  if (ra != null) return -1
  if (rb != null) return 1
  return a < b ? -1 : 1
}

/** New array in catalog order (compareKinds on the keys). */
export function sortRateKinds(rows: readonly RateKindRow[]): RateKindRow[] {
  return [...rows].sort((x, y) => compareKinds(x.key, y.key))
}

/** The catalog's label for a kind; a kind the catalog lacks shows its key. */
export function kindLabel(
  kind: string | null,
  rows: readonly RateKindRow[] = BUILTIN_RATE_KINDS
): string {
  if (kind == null) return 'Uncategorised'
  return rows.find((r) => r.key === kind)?.label ?? kind
}

/**
 * Kinds a quote or invoice line can carry: everything but `consumable`, which
 * only price-list items use (a consumable rate lands on a quote as material —
 * see quoteKind in lib/price-list).
 */
export function quoteLineKinds(rows: readonly RateKindRow[] = BUILTIN_RATE_KINDS): RateKindRow[] {
  return rows.filter((r) => r.key !== 'consumable')
}
