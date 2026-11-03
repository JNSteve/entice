# Rate Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin add, rename and delete rate categories (kinds) in Settings, and have every kind picker and grouping in the app list them.

**Architecture:** A `rate_kinds` table replaces the three `check (kind in (…))` constraints with foreign keys. A pure `src/lib/rate-kinds.ts` owns the built-in list, the fixed order (built-ins, then custom by key, then null) and label lookup; pages load the catalog once (`loadRateKinds`) and thread it as an optional `rateKinds` prop that defaults to the built-ins. Zod validates kind keys by shape; the FK and a catalog check in the settings actions validate existence.

**Tech Stack:** Next.js App Router (server actions, `revalidatePath`), Supabase (Postgres, RLS), zod 4, React 19, Base UI select/dialog, lucide-react, vitest + @testing-library/react (jsdom, no jest-dom).

Spec: `docs/superpowers/specs/2026-11-03-rate-categories-design.md`

## Global Constraints

- Migration file: `supabase/migrations/0077_rate_kinds.sql`; history row version `20261103090000`, name `0077_rate_kinds`.
- Key shape, verbatim regex: `^[a-z0-9][a-z0-9_-]{0,39}$`. Label: 1–40 chars after trim.
- Order everywhere: built-ins `labour, plant, material, consumable, subbie, other`, then custom kinds by key (plain string compare), then `null`/unknown.
- Quote and invoice line selects never offer `consumable` (`quoteLineKinds`).
- Copy, verbatim: `Use letters or numbers in the name`; `A category with that name already exists`; `That category is still used by rates or lines. Move them first.`; `Unknown category`; `Built-in categories cannot be deleted`.
- Every new component prop is optional and defaults to `BUILTIN_RATE_KINDS`, so existing tests and callers compile unchanged.
- Run from `C:\Users\nickj\Documents\Devman\nexvia`. `npx vitest run <file>` and `npx tsc --noEmit` need no extra env.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Migration and the pure catalog library

**Files:**
- Create: `supabase/migrations/0077_rate_kinds.sql`
- Create: `src/lib/rate-kinds.ts`
- Test: `tests/rate-kinds.test.ts`

**Interfaces (produces):**
```ts
export interface RateKindRow { key: string; label: string; builtin: boolean }
export const BUILTIN_RATE_KINDS: readonly RateKindRow[]      // six rows, display order
export function slugKey(label: string): string                // '' when nothing survives
export function sortRateKinds(rows: readonly RateKindRow[]): RateKindRow[]
export function compareKinds(a: string | null, b: string | null): number
export function kindLabel(kind: string | null, rows?: readonly RateKindRow[]): string
export function quoteLineKinds(rows?: readonly RateKindRow[]): RateKindRow[]  // minus consumable
export function isRateKindKey(s: string): boolean
```

- [ ] **Step 1: Write the failing tests** (`tests/rate-kinds.test.ts`)

```ts
import { describe, expect, test } from 'vitest'
import {
  BUILTIN_RATE_KINDS, compareKinds, isRateKindKey, kindLabel, quoteLineKinds, slugKey, sortRateKinds,
} from '../src/lib/rate-kinds'

const custom = (key: string, label = key) => ({ key, label, builtin: false })

describe('slugKey', () => {
  test('lower-cases and joins words with dashes', () => {
    expect(slugKey('Waste disposal')).toBe('waste-disposal')
    expect(slugKey('  Permits & Fees  ')).toBe('permits-fees')
    expect(slugKey('Air-monitoring (NATA)')).toBe('air-monitoring-nata')
  })
  test('empty when nothing survives, and capped at 40', () => {
    expect(slugKey('&&&')).toBe('')
    expect(slugKey('a'.repeat(60))).toHaveLength(40)
    expect(isRateKindKey(slugKey('x'.repeat(60)))).toBe(true)
  })
})

describe('sortRateKinds', () => {
  test('built-ins in fixed order, then custom by key', () => {
    const rows = [custom('waste'), BUILTIN_RATE_KINDS[5], custom('air'), BUILTIN_RATE_KINDS[0]]
    expect(sortRateKinds(rows).map((r) => r.key)).toEqual(['labour', 'other', 'air', 'waste'])
  })
})

describe('compareKinds', () => {
  test('built-in < custom < null', () => {
    expect(compareKinds('other', 'air')).toBeLessThan(0)
    expect(compareKinds('air', 'waste')).toBeLessThan(0)
    expect(compareKinds('waste', null)).toBeLessThan(0)
    expect(compareKinds(null, null)).toBe(0)
    expect(compareKinds('labour', 'plant')).toBeLessThan(0)
  })
})

describe('labels', () => {
  test('catalog label, then raw key, then Uncategorised', () => {
    expect(kindLabel('plant')).toBe('Plant & equipment')
    expect(kindLabel('waste', [...BUILTIN_RATE_KINDS, custom('waste', 'Waste disposal')])).toBe('Waste disposal')
    expect(kindLabel('waste')).toBe('waste')
    expect(kindLabel(null)).toBe('Uncategorised')
  })
  test('quoteLineKinds drops consumable only', () => {
    expect(quoteLineKinds().map((r) => r.key)).toEqual(['labour', 'plant', 'material', 'subbie', 'other'])
  })
})
```

- [ ] **Step 2: Run to see it fail** — `npx vitest run tests/rate-kinds.test.ts` → cannot resolve `../src/lib/rate-kinds`.

- [ ] **Step 3: Implement `src/lib/rate-kinds.ts`**

```ts
export interface RateKindRow { key: string; label: string; builtin: boolean }

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

export function isRateKindKey(s: string): boolean { return RATE_KIND_KEY_RE.test(s) }

export function slugKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '')
}

export function compareKinds(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a == null) return 1
  if (b == null) return -1
  const ra = BUILTIN_RANK.get(a), rb = BUILTIN_RANK.get(b)
  if (ra != null && rb != null) return ra - rb
  if (ra != null) return -1
  if (rb != null) return 1
  return a < b ? -1 : 1
}

export function sortRateKinds(rows: readonly RateKindRow[]): RateKindRow[] {
  return [...rows].sort((x, y) => compareKinds(x.key, y.key))
}

export function kindLabel(kind: string | null, rows: readonly RateKindRow[] = BUILTIN_RATE_KINDS): string {
  if (kind == null) return 'Uncategorised'
  return rows.find((r) => r.key === kind)?.label ?? kind
}

export function quoteLineKinds(rows: readonly RateKindRow[] = BUILTIN_RATE_KINDS): RateKindRow[] {
  return rows.filter((r) => r.key !== 'consumable')
}
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Write the migration** (see spec "Schema"; RLS: `rate_kinds_select_authenticated` using `auth.uid() is not null`; `rate_kinds_write_admin` for insert/update/delete with `current_app_role() = 'admin'`; seed six built-ins; drop `rate_items_kind_check`, `quote_lines_kind_check`, `invoice_lines_kind_check`; add `*_kind_fkey … references rate_kinds(key) on update cascade`; history row).

- [ ] **Step 6: Commit** — `feat(rates): rate_kinds table and catalog helpers`.

---

### Task 2: quote-lines helpers on the catalog order

**Files:**
- Modify: `src/lib/quote-lines.ts`
- Test: `tests/quote-lines.test.ts`

**Interfaces (produces):**
```ts
export function lineKindLabel(kind: string | null, kinds?: readonly RateKindRow[]): string
export function sortLinesGrouped<T>(lines: readonly T[]): T[]          // unchanged signature, compareKinds inside
export function groupLinesByKind<T>(lines: readonly T[], kinds?: readonly RateKindRow[]): LineGroup<T>[]
// LineGroup.kind becomes string | null
```
`lineKindRank` is removed (its only test moves to compareKinds). `LINE_KIND_ORDER` / `LINE_KIND_LABELS` stay.

- [ ] **Step 1: Replace the rank test** with one for custom order and labels:

```ts
test('a custom kind sorts after the built-ins and before uncategorised', () => {
  const out = sortLinesGrouped([line('a', null, 0), line('b', 'waste', 0), line('c', 'other', 0), line('d', 'air', 0)])
  expect(out.map((l) => l.id)).toEqual(['c', 'd', 'b', 'a'])
})
test('groupLinesByKind labels a custom group from the catalog', () => {
  const kinds = [...BUILTIN_RATE_KINDS, { key: 'waste', label: 'Waste disposal', builtin: false }]
  const groups = groupLinesByKind([line('a', 'waste', 0), line('b', 'labour', 0)], kinds)
  expect(groups.map((g) => [g.kind, g.label])).toEqual([['labour', 'Labour'], ['waste', 'Waste disposal']])
})
```
and change the "unknown last" expectations: `lineKindLabel('consumable')` is now `'Consumables'` (a built-in), `lineKindLabel('zzz')` is `'zzz'`.

- [ ] **Step 2: Run** — fails (rank/labels). **Step 3: Implement** — comparator `compareKinds(a.kind, b.kind) || a.position - b.position || id`; `groupLinesByKind` keys on the raw kind (`line.kind ?? null`) and labels with `kindLabel`. **Step 4: Run** — PASS. **Step 5: Commit** — `refactor(quotes): line grouping follows the rate-kind catalog order`.

---

### Task 3: zod shapes, price-list helpers, server loader

**Files:**
- Modify: `src/lib/zod.ts` (rate items ~166-200, quote line create/update ~317-340, invoice line ~481, xero ~504)
- Modify: `src/lib/price-list.ts` (`kindToCategory`, `quoteKind`, `kindsForCategory` unchanged)
- Create: `src/lib/rate-kinds-queries.ts`

**Interfaces (produces):**
```ts
// zod.ts
export const rateKindKey = z.string().regex(RATE_KIND_KEY_RE, 'Unknown category')
export const rateKindLabel = z.string().trim().min(1, 'Name is required').max(40, 'Keep the name under 40 characters')
export const rateKindCreateSchema = z.object({ label: rateKindLabel })
export const rateKindRenameSchema = z.object({ key: rateKindKey, label: rateKindLabel })
// rateItemSchema.kind, rateImportSchema[].kind, quoteLineCreateSchema.kind (optional), quoteLineUpdateSchema.kind (nullable),
// invoiceLineUpdateSchema.kind (nullable optional), xeroMappingSchema.xero_account_by_kind: z.record(rateKindKey, z.string().min(1))
// price-list.ts
export function kindToCategory(kind: string): CostCategory     // unknown → 'other'
// rate-kinds-queries.ts
export async function loadRateKinds(supabase: SupabaseClient): Promise<RateKindRow[]>  // sorted; BUILTIN_RATE_KINDS on error
```

- [ ] Steps: edit, `npx tsc --noEmit` (expect errors only where `RateKind` was narrowed — fix by widening to `string` in `LinePayload`, `line-row.tsx`, `lines-grid.tsx`, `invoice-editor.tsx`), `npx vitest run`, commit `feat(rates): kind keys validated by shape; catalog loader`.

---

### Task 4: Settings — actions, Categories dialog, rates section, imports, Xero

**Files:**
- Modify: `src/app/(office)/settings/actions.ts` (after `importRateItems`)
- Create: `src/app/(office)/settings/rate-kinds-dialog.tsx`
- Modify: `src/app/(office)/settings/rates-section.tsx`, `settings-tabs.tsx`, `page.tsx`, `xero-section.tsx`
- Modify: `src/components/price-list/PriceListImport.tsx` (`rateKinds?: readonly RateKindRow[]`, the two selects at ~398 and ~554)

**Interfaces (produces):**
```ts
export async function createRateKind(data: unknown): Promise<{ error?: string; key?: string }>
export async function renameRateKind(data: unknown): Promise<{ error?: string }>
export async function deleteRateKind(key: string): Promise<{ error?: string }>
// RatesSection({ rateItems, gstRate, rateKinds }) ; XeroSectionProps.rateKinds ; SettingsTabs prop rateKinds
```

- [ ] Actions: `requireRole('admin')`; create → `slugKey`, empty → `Use letters or numbers in the name`; insert `{ key, label, builtin: false }`; Postgres `23505` → `A category with that name already exists`. Delete → select `builtin`; true → `Built-in categories cannot be deleted`; delete; `23503` → `That category is still used by rates or lines. Move them first.`. `upsertRateItem` / `importRateItems`: `loadRateKinds` then refuse unknown kinds with `Unknown category`. All `revalidatePath('/settings')`.
- [ ] Dialog: list `sortRateKinds(rateKinds)`; each row = label (or an inline `Input` while editing, Enter/blur → `renameRateKind`), `Badge` "Built-in" or a ghost `Trash2Icon` button (`aria-label="Delete {label}"`) → `deleteRateKind`; footer `Input` placeholder "New category" + "Add" button → `createRateKind`; `toast` on error; `router.refresh()` on success.
- [ ] Rates section: `KIND_LABELS` → `kindLabel(k, rateKinds)`; filter/select options from `rateKinds`; CSV `parseCsv(text, rateKinds)` accepts a key or label case-insensitively and stores the key; "Categories" button beside Import CSV renders `<RateKindsDialog rateKinds={rateKinds} />`.
- [ ] Settings page: add `supabase.from('rate_kinds').select('key, label, builtin')` to the `Promise.all` and pass `rateKinds={sortRateKinds(rateKinds ?? BUILTIN_RATE_KINDS)}` (fallback when the table is missing). Xero: `MappingForm` lists `quoteLineKinds(rateKinds)`.
- [ ] `npx tsc --noEmit`, `npx vitest run`, commit `feat(settings): manage rate categories`.

---

### Task 5: Quote builder threading

**Files:**
- Modify: `src/app/(office)/quotes/[id]/page.tsx` (load + pass), `quote-builder.tsx` (`QuoteBuilder`, `SectionCard`, `TotalsCard`), `lines-grid.tsx`, `line-row.tsx`, `rate-picker-dialog.tsx`
- Test: `tests/line-row.test.tsx`, `tests/rate-picker-dialog.test.tsx`

- [ ] Failing tests:
```ts
// line-row.test.tsx
test('the category select lists a custom kind from the catalog', () => {
  const kinds = [...BUILTIN_RATE_KINDS, { key: 'waste', label: 'Waste disposal', builtin: false }]
  render(<LineRow line={line({ kind: 'waste' })} editable isFirst isLast rateKinds={kinds} />)
  const select = screen.getByLabelText('Category') as HTMLSelectElement
  expect(select.value).toBe('waste')
  expect(Array.from(select.options).map((o) => o.textContent)).toContain('Waste disposal')
  expect(Array.from(select.options).map((o) => o.value)).not.toContain('consumable')
})
// rate-picker-dialog.test.tsx
test('a custom kind groups under its catalog label', async () => {
  const kinds = [...BUILTIN_RATE_KINDS, { key: 'waste', label: 'Waste disposal', builtin: false }]
  render(<RatePickerDialog quoteId="q-1" sectionId="s-1" rateItems={[...rates, { id: 'r-w', kind: 'waste', name: 'Tip fees', unit: 't', cost: 300, default_markup_pct: 0 }]} rateKinds={kinds} />)
  fireEvent.click(screen.getByRole('button', { name: /add from rates/i }))
  await screen.findByText('Add from rate library')
  expect(screen.getByRole('heading', { name: 'Waste disposal' })).toBeTruthy()
})
```
- [ ] Implement: `rateKinds?: readonly RateKindRow[]` (default `BUILTIN_RATE_KINDS`) on each component; `LineRow` options = `quoteLineKinds(rateKinds)`; `LinesGrid` → `groupLinesByKind(lines, rateKinds)`; `RatePickerDialog` filter + `groupByKind(rates, rateKinds)` (sorted by `compareKinds`, labels via `kindLabel`); `TotalsCard` breakdown keys sorted with `compareKinds` (null = uncategorised last) and labelled with `kindLabel`.
- [ ] `npx vitest run tests/line-row.test.tsx tests/rate-picker-dialog.test.tsx tests/quote-lines-grid.test.tsx tests/quote-line-row.test.tsx`, tsc, commit `feat(quotes): builder lists custom rate categories`.

---

### Task 6: Invoice editor

**Files:** `src/app/(office)/invoices/[id]/page.tsx`, `invoice-editor.tsx` (~559-690).

- [ ] Load `rateKinds` on the page, pass through `InvoiceEditor` → `InvoiceLineRow`; options = `quoteLineKinds(rateKinds)` with `kindLabel`. tsc, commit `feat(invoices): line kind select lists custom categories`.

---

### Task 7: Full verification and hand-off

- [ ] `npx tsc --noEmit` and `npx vitest run` clean; `npx eslint src/lib/rate-kinds.ts src/app/\(office\)/settings`.
- [ ] Owner applies `0077_rate_kinds.sql`; then dev-server check per spec "Rollout" step 3.
- [ ] Fast-forward `main`, push, verify the Vercel deployment.
