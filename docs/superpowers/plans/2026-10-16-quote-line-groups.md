# Quote Line Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each quote section's lines grouped under Labour / Plant & equipment / Materials / Subcontract / Other / Uncategorised headings, with an editable category on every line, and keep that order on the PDF and on conversion.

**Architecture:** A pure ordering module (`src/lib/quote-lines.ts`) defines the category order, labels, a grouped sort and a grouper. The builder renders groups from it; the PDF builder and the two conversion actions sort with it; `moveLine` scopes siblings to the same category; `updateLine` accepts `kind` and re-positions a line to the end of its section when its category changes. No migration: `quote_lines.kind` already exists with a check constraint.

**Tech Stack:** Next.js 16 app router (server actions), React 19, Supabase JS (untyped client, rows cast at use), zod 4 (`z.uuid()`, `z.enum`), Tailwind 4 + shadcn/ui, vitest 3 + @testing-library/react (jsdom via `// @vitest-environment jsdom`), @react-pdf/renderer.

Spec: `docs/superpowers/specs/2026-10-16-quote-line-groups-design.md`.

## Global Constraints

- Category order and labels, verbatim: `labour` "Labour", `plant` "Plant & equipment", `material` "Materials", `subbie` "Subcontract", `other` "Other", `null` "Uncategorised".
- `kind` values are `RATE_KINDS` from `src/lib/zod.ts`: `'labour' | 'plant' | 'material' | 'subbie' | 'other'`; `null` = uncategorised. Never write any other string (DB check constraint).
- Sections and their titles are untouched; category headings never print on the client PDF.
- No database migration.
- Working directory is the worktree `C:\Users\nickj\Documents\Devman\nexvia\.claude\worktrees\quote-line-groups` on branch `feat/quote-line-groups`. Never `cd` to the main checkout.
- The Bash tool in this worktree refuses heredocs and any command containing a parenthesised path such as `src/app/(office)/…`. Use the Write/Edit tools for files, and run tests with `npx vitest run tests/<file>` (test paths have no parentheses). Lint with `npm run lint` (whole project), not eslint-on-paths.
- Commits are made by the lead session after review (project policy: subagents never commit). Commit steps below are for the lead. Every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` passed as a second `-m`.
- Known pre-existing flake: `tests/quote-pdf-dialog.test.tsx` can time out waiting for a button to enable. It is unrelated; a fix lives on `fix/quote-pdf-dialog-flake`.

---

## File map

| File | Responsibility |
|---|---|
| Create `src/lib/quote-lines.ts` | Category order, labels, `lineKindRank`, `sortLinesGrouped`, `groupLinesByKind` (pure) |
| Create `tests/quote-lines.test.ts` | Unit tests for the above |
| Modify `src/lib/zod.ts:317-337` | `kind` on `quoteLineCreateSchema` (optional) and `quoteLineUpdateSchema` (nullable, required) |
| Modify `src/app/(office)/quotes/actions.ts` | `addLine` stores `kind` on a blank line; `updateLine` writes `kind` and re-positions on change; `moveLine` siblings = same section + same category; `duplicateQuote` copies `kind`; both conversions use `sortLinesGrouped` |
| Modify `src/pdf/build-quote-pdf.tsx:56-99` | Select `id, position, kind`; sort with `sortLinesGrouped` |
| Modify `src/app/(office)/quotes/[id]/line-row.tsx` | Category column: `<select aria-label="Category">` when editable, label text when not; `kind` in the save payload; wider grid templates |
| Create `tests/quote-line-row.test.tsx` | jsdom tests for the category control |
| Create `src/app/(office)/quotes/[id]/lines-grid.tsx` | `LinesGrid`: header row + one block per populated category (heading, sell subtotal, per-group Add line) |
| Create `tests/quote-lines-grid.test.tsx` | jsdom tests for grouping and the per-group add |
| Modify `src/app/(office)/quotes/[id]/quote-builder.tsx` | Use the new `LinesGrid` (drop the inline one); `TotalsCard` reuses the shared labels/order |

---

### Task 1: Ordering module `src/lib/quote-lines.ts`

**Files:**
- Create: `src/lib/quote-lines.ts`
- Test: `tests/quote-lines.test.ts`

**Interfaces:**
- Consumes: `lineTotal`, `round2` from `src/lib/money.ts` (`lineTotal(qty, unitSell)` = `round2(qty * unitSell)`); `RateKind` from `src/lib/zod.ts`.
- Produces (used by Tasks 2–5):
  - `LINE_KIND_ORDER: readonly RateKind[]` = `['labour','plant','material','subbie','other']`
  - `LINE_KIND_LABELS: Record<RateKind | 'uncategorised', string>`
  - `lineKindLabel(kind: string | null): string`
  - `lineKindRank(kind: string | null): number` (null/unknown → `LINE_KIND_ORDER.length`)
  - `interface GroupableLine { id: string; position: number; kind: string | null }`
  - `sortLinesGrouped<T extends GroupableLine>(lines: readonly T[]): T[]` (new array; rank, then position, then id)
  - `interface LineGroup<T> { kind: RateKind | null; label: string; lines: T[]; sellSubtotal: number }`
  - `groupLinesByKind<T extends GroupableLine & { qty: number; unit_sell: number }>(lines: readonly T[]): LineGroup<T>[]` (populated groups only, in rank order)

- [ ] **Step 1: Write the failing tests**

Create `tests/quote-lines.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  LINE_KIND_LABELS,
  LINE_KIND_ORDER,
  groupLinesByKind,
  lineKindLabel,
  lineKindRank,
  sortLinesGrouped,
} from '../src/lib/quote-lines'

function line(id: string, kind: string | null, position: number, qty = 1, unit_sell = 10) {
  return { id, kind, position, qty, unit_sell }
}

describe('category order and labels', () => {
  test('ranks labour, plant, material, subbie, other; null and unknown last', () => {
    expect([...LINE_KIND_ORDER]).toEqual(['labour', 'plant', 'material', 'subbie', 'other'])
    expect(LINE_KIND_ORDER.map(lineKindRank)).toEqual([0, 1, 2, 3, 4])
    expect(lineKindRank(null)).toBe(5)
    expect(lineKindRank('consumable')).toBe(5)
  })

  test('labels are the owner-facing names', () => {
    expect(LINE_KIND_LABELS).toEqual({
      labour: 'Labour',
      plant: 'Plant & equipment',
      material: 'Materials',
      subbie: 'Subcontract',
      other: 'Other',
      uncategorised: 'Uncategorised',
    })
    expect(lineKindLabel('plant')).toBe('Plant & equipment')
    expect(lineKindLabel(null)).toBe('Uncategorised')
    expect(lineKindLabel('consumable')).toBe('Uncategorised')
  })
})

describe('sortLinesGrouped', () => {
  test('orders by category, then position, then id, without mutating the input', () => {
    const input = [
      line('d', null, 0),
      line('c', 'material', 0),
      line('b', 'labour', 5),
      line('a', 'labour', 2),
      line('e', 'plant', 1),
    ]
    const copy = [...input]
    expect(sortLinesGrouped(input).map((l) => l.id)).toEqual(['a', 'b', 'e', 'c', 'd'])
    expect(input).toEqual(copy)
  })

  test('ties on category and position break on id', () => {
    const sorted = sortLinesGrouped([line('b', 'other', 0), line('a', 'other', 0)])
    expect(sorted.map((l) => l.id)).toEqual(['a', 'b'])
  })
})

describe('groupLinesByKind', () => {
  test('returns only populated groups, in order, with rounded sell subtotals', () => {
    const groups = groupLinesByKind([
      line('m1', 'material', 0, 4, 2.5),
      line('u1', null, 0, 1, 7),
      line('l1', 'labour', 1, 2, 100),
      line('l2', 'labour', 0, 1, 50.555),
    ])
    expect(
      groups.map((g) => [g.kind, g.label, g.lines.map((l) => l.id), g.sellSubtotal])
    ).toEqual([
      ['labour', 'Labour', ['l2', 'l1'], 250.56],
      ['material', 'Materials', ['m1'], 10],
      [null, 'Uncategorised', ['u1'], 7],
    ])
  })

  test('unknown kinds share the uncategorised group', () => {
    const groups = groupLinesByKind([line('x', 'consumable', 0), line('y', null, 1)])
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBeNull()
    expect(groups[0].lines.map((l) => l.id)).toEqual(['x', 'y'])
  })

  test('empty input gives no groups', () => {
    expect(groupLinesByKind([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/quote-lines.test.ts`
Expected: FAIL — "Failed to resolve import '../src/lib/quote-lines'".

- [ ] **Step 3: Write the module**

Create `src/lib/quote-lines.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/quote-lines.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit (lead)**

```bash
git add src/lib/quote-lines.ts tests/quote-lines.test.ts
git commit -m "feat(quotes): category order, labels and grouped sort for quote lines" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Schemas and server actions

**Files:**
- Modify: `src/lib/zod.ts:317-337`
- Modify: `src/app/(office)/quotes/actions.ts` — `duplicateQuote` line copy (~lines 213-240), `addLine` (~598-668), `updateLine` (~670-703), `moveLine` (~749-790), `convertQuoteToJob` lines fetch (~811-853), `convertQuoteToProject` lines fetch (~899-955)

**Interfaces:**
- Consumes: `sortLinesGrouped` from Task 1; `RATE_KINDS` from `src/lib/zod.ts`.
- Produces:
  - `quoteLineCreateSchema` accepts optional `kind: RateKind` (Task 5's per-group Add line sends it).
  - `quoteLineUpdateSchema` requires `kind: RateKind | null` (Task 4's row sends it on every save).
  - `addLine({ quote_id, section_id, kind? , rate_item_id? })`, `updateLine(id, { …, kind })` — same `Result` return as today.

No unit harness exists for server actions (they call Supabase); this task is verified by `npx tsc --noEmit`, `npm run lint`, and the browser check in Task 6.

- [ ] **Step 1: Extend the zod schemas**

In `src/lib/zod.ts`, replace:

```ts
export const quoteLineCreateSchema = z.object({
  quote_id: z.uuid(),
  section_id: z.uuid(),
  /** When set, the line is prefilled from this rate item. */
  rate_item_id: z.uuid().optional(),
})
```

with:

```ts
export const quoteLineCreateSchema = z.object({
  quote_id: z.uuid(),
  section_id: z.uuid(),
  /** When set, the line is prefilled from this rate item. */
  rate_item_id: z.uuid().optional(),
  /** Cost category for a blank manual line; ignored when rate_item_id is set. */
  kind: z.enum(RATE_KINDS).optional(),
})
```

and replace:

```ts
  /** When false, unit_sell is recomputed server-side from cost + markup. */
  sell_overridden: z.boolean(),
})

export type QuoteLineUpdateInput = z.infer<typeof quoteLineUpdateSchema>
```

with:

```ts
  /** When false, unit_sell is recomputed server-side from cost + markup. */
  sell_overridden: z.boolean(),
  /** Cost category; null = uncategorised. */
  kind: z.enum(RATE_KINDS).nullable(),
})

export type QuoteLineUpdateInput = z.infer<typeof quoteLineUpdateSchema>
```

- [ ] **Step 2: Typecheck to see the one expected break**

Run: `npx tsc --noEmit`
Expected: no errors yet (the row's payload type is local to `line-row.tsx` and `updateLine` takes `unknown`). If it errors, fix only what the schema change caused.

- [ ] **Step 3: `addLine` — store `kind` on a blank manual line**

In `src/app/(office)/quotes/actions.ts`, inside `addLine`, replace:

```ts
  // Defaults for a blank manual line.
  let line = {
    description: '',
    unit: 'ea',
    unit_cost: 0,
    markup_pct: 0,
    unit_sell: 0,
    rate_item_id: null as string | null,
    kind: null as string | null,
  }
```

with:

```ts
  // Defaults for a blank manual line. The per-group "Add line" button passes
  // the group's category; a rate item below overrides it with its own.
  let line = {
    description: '',
    unit: 'ea',
    unit_cost: 0,
    markup_pct: 0,
    unit_sell: 0,
    rate_item_id: null as string | null,
    kind: (parsed.data.kind ?? null) as string | null,
  }
```

- [ ] **Step 4: `updateLine` — write `kind`, re-position when it changes**

Replace the body of `updateLine` from the line fetch down to the update, i.e. replace:

```ts
  const supabase = await createClient()
  const { data: line } = await supabase
    .from('quote_lines')
    .select('id, quote_id')
    .eq('id', id)
    .single()
  if (!line) return { error: 'Line not found' }

  const editable = await assertEditable(supabase, line.quote_id)
  if (editable.error) return editable

  const { sell_overridden, ...fields } = parsed.data
  // Server is the source of truth for the auto-computed sell price.
  const unit_sell = sell_overridden
    ? fields.unit_sell
    : lineSell(fields.unit_cost, fields.markup_pct)

  const { error } = await supabase
    .from('quote_lines')
    .update({ ...fields, unit_sell })
    .eq('id', id)
  if (error) return { error: error.message }
```

with:

```ts
  const supabase = await createClient()
  const { data: line } = await supabase
    .from('quote_lines')
    .select('id, quote_id, section_id, kind')
    .eq('id', id)
    .single()
  if (!line) return { error: 'Line not found' }

  const editable = await assertEditable(supabase, line.quote_id)
  if (editable.error) return editable

  const { sell_overridden, ...fields } = parsed.data
  // Server is the source of truth for the auto-computed sell price.
  const unit_sell = sell_overridden
    ? fields.unit_sell
    : lineSell(fields.unit_cost, fields.markup_pct)

  // A category change drops the line at the end of its new group. Lines are
  // listed by category first and position second (sortLinesGrouped), so the
  // highest position in the section is also the last slot in any group.
  let position: number | undefined
  if (fields.kind !== ((line.kind as string | null) ?? null)) {
    let lastQuery = supabase
      .from('quote_lines')
      .select('position')
      .eq('quote_id', line.quote_id)
    lastQuery = line.section_id
      ? lastQuery.eq('section_id', line.section_id)
      : lastQuery.is('section_id', null)
    const { data: last } = await lastQuery
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()
    position = ((last?.position as number | undefined) ?? -1) + 1
  }

  const { error } = await supabase
    .from('quote_lines')
    .update({ ...fields, unit_sell, ...(position === undefined ? {} : { position }) })
    .eq('id', id)
  if (error) return { error: error.message }
```

- [ ] **Step 5: `moveLine` — arrows move within the category group**

In `moveLine`, replace:

```ts
  const { data: line } = await supabase
    .from('quote_lines')
    .select('id, quote_id, section_id')
    .eq('id', id)
    .single()
  if (!line) return { error: 'Line not found' }

  const editable = await assertEditable(supabase, line.quote_id)
  if (editable.error) return editable

  let query = supabase
    .from('quote_lines')
    .select('id, position')
    .eq('quote_id', line.quote_id)
  query = line.section_id
    ? query.eq('section_id', line.section_id)
    : query.is('section_id', null)
```

with:

```ts
  const { data: line } = await supabase
    .from('quote_lines')
    .select('id, quote_id, section_id, kind')
    .eq('id', id)
    .single()
  if (!line) return { error: 'Line not found' }

  const editable = await assertEditable(supabase, line.quote_id)
  if (editable.error) return editable

  // Siblings are the lines shown in the same category group of the same
  // section — that is what the up/down arrows reorder on screen.
  let query = supabase
    .from('quote_lines')
    .select('id, position')
    .eq('quote_id', line.quote_id)
  query = line.section_id
    ? query.eq('section_id', line.section_id)
    : query.is('section_id', null)
  query = line.kind ? query.eq('kind', line.kind) : query.is('kind', null)
```

(`deleteLine` is untouched: it renumbers the whole section by `position, id`, which keeps each group's relative order.)

- [ ] **Step 6: `duplicateQuote` — copy `kind`**

Replace:

```ts
  // Copy lines, remapping section ids (null / orphaned → null; takeoff link dropped).
  const { data: lines } = await supabase
    .from('quote_lines')
    .select(
      'section_id, description, qty, unit, unit_cost, markup_pct, unit_sell, position'
    )
```

with:

```ts
  // Copy lines, remapping section ids (null / orphaned → null; takeoff link dropped).
  const { data: lines } = await supabase
    .from('quote_lines')
    .select(
      'section_id, description, qty, unit, unit_cost, markup_pct, unit_sell, position, kind'
    )
```

and in the insert map below it, replace:

```ts
        unit_sell: l.unit_sell,
        position: l.position,
      }))
```

with:

```ts
        unit_sell: l.unit_sell,
        position: l.position,
        kind: l.kind,
      }))
```

- [ ] **Step 7: Conversions use the grouped order**

Add to the imports at the top of `actions.ts` (next to the other `@/lib/...` imports):

```ts
import { sortLinesGrouped } from '@/lib/quote-lines'
```

Add this helper just above `export async function convertQuoteToJob` (after the `// ─── Conversion ───` banner):

```ts
/**
 * Quote lines for conversion, in the order the builder and PDF list them
 * (category group, then position). Budget lines and the scope summary follow
 * the same order the owner sees on screen.
 */
function convertLinesFromRows(rows: Record<string, unknown>[] | null) {
  return sortLinesGrouped(
    (rows ?? []).map((l) => ({
      id: l.id as string,
      position: Number(l.position),
      kind: (l.kind as string | null) ?? null,
      section_id: l.section_id as string | null,
      description: l.description as string,
      qty: Number(l.qty),
      unit_cost: Number(l.unit_cost),
      unit_sell: Number(l.unit_sell),
    }))
  )
}
```

Both conversions fetch lines with the identical snippet. Replace **both** occurrences (replace_all) of:

```ts
      .from('quote_lines')
      .select('section_id, description, qty, unit_cost, unit_sell')
      .eq('quote_id', quoteId)
```

with:

```ts
      .from('quote_lines')
      .select('id, position, kind, section_id, description, qty, unit_cost, unit_sell')
      .eq('quote_id', quoteId)
```

and replace **both** occurrences of:

```ts
    (lines ?? []).map((l) => ({
      section_id: l.section_id,
      description: l.description,
      qty: Number(l.qty),
      unit_cost: Number(l.unit_cost),
      unit_sell: Number(l.unit_sell),
    }))
```

with:

```ts
    convertLinesFromRows(lines)
```

(`jobPayloadFromQuote` and `projectPayloadFromQuote` take `ConvertLine[]`; the extra `id/position/kind` fields are structurally fine.)

- [ ] **Step 8: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no output (exit 0).

Run: `npm run lint`
Expected: no errors. If `Record<string, unknown>[] | null` rejects the Supabase row type at a call site, change the helper's parameter to `{ [key: string]: unknown }[] | null` — do not use `any`.

- [ ] **Step 9: Commit (lead)**

```bash
git add src/lib/zod.ts "src/app/(office)/quotes/actions.ts"
git commit -m "feat(quotes): editable line category — schema, update/add/move actions, duplicate copies kind, conversions in grouped order" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Quote PDF lists lines in grouped order

**Files:**
- Modify: `src/pdf/build-quote-pdf.tsx:56-99`

**Interfaces:**
- Consumes: `sortLinesGrouped` from Task 1.
- Produces: nothing new; `QuotePdfSection.lines` order changes to category → position.

- [ ] **Step 1: Select the ordering columns and sort**

Add the import after `import { fmtDate } from '@/lib/format'`:

```ts
import { sortLinesGrouped } from '@/lib/quote-lines'
```

Replace:

```ts
    supabase
      .from('quote_lines')
      .select('section_id, position, description, qty, unit, unit_sell')
      .eq('quote_id', id)
      .order('position')
      .order('id'),
```

with:

```ts
    supabase
      .from('quote_lines')
      .select('id, section_id, position, kind, description, qty, unit, unit_sell')
      .eq('quote_id', id)
      .order('position')
      .order('id'),
```

and replace:

```ts
  const allLines = (lines ?? []).map((l) => ({
    section_id: l.section_id as string | null,
    description: l.description as string,
    qty: Number(l.qty),
    unit: l.unit as string,
    unit_sell: Number(l.unit_sell),
  }))
```

with:

```ts
  // Same order as the builder: category group, then position. Headings are
  // not printed — the client just sees labour, then plant, then materials…
  const allLines = sortLinesGrouped(
    (lines ?? []).map((l) => ({
      id: l.id as string,
      position: Number(l.position),
      kind: (l.kind as string | null) ?? null,
      section_id: l.section_id as string | null,
      description: l.description as string,
      qty: Number(l.qty),
      unit: l.unit as string,
      unit_sell: Number(l.unit_sell),
    }))
  )
```

The per-section `filter` and the orphan `filter` below keep that order.

- [ ] **Step 2: Typecheck and run the PDF tests**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx vitest run tests/quote-pdf.test.tsx tests/quote-doc-pdf.test.tsx`
Expected: PASS (these render `QuotePdf`/`QuoteDocPdf` directly and are unaffected; they prove nothing broke in the renderers).

- [ ] **Step 3: Commit (lead)**

```bash
git add src/pdf/build-quote-pdf.tsx
git commit -m "feat(quotes): PDF prints lines in category order" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Category control on the line row

**Files:**
- Modify: `src/app/(office)/quotes/[id]/line-row.tsx`
- Test: `tests/quote-line-row.test.tsx`

**Interfaces:**
- Consumes: `LINE_KIND_LABELS`, `LINE_KIND_ORDER`, `lineKindLabel` from Task 1; `RateKind` from `src/lib/zod.ts`; `updateLine(id, payload)` now expecting `kind` (Task 2).
- Produces: `LINE_GRID_COLS_EDITABLE` / `LINE_GRID_COLS_READONLY` gain a second column (`8rem`) for Category — Task 5's header row must match. `LineRow` props are unchanged.

- [ ] **Step 1: Write the failing tests**

Create `tests/quote-line-row.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const updateLine = vi.fn()
const refresh = vi.fn()

vi.mock('../src/app/(office)/quotes/actions', () => ({
  updateLine: (...args: unknown[]) => updateLine(...args),
  moveLine: vi.fn(),
  deleteLine: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { LineRow, type LineData } from '../src/app/(office)/quotes/[id]/line-row'

function line(overrides: Partial<LineData> = {}): LineData {
  return {
    id: 'l-1',
    section_id: 's-1',
    position: 0,
    description: 'Site vehicle',
    qty: 25,
    unit: 'ea',
    unit_cost: 130,
    markup_pct: 0,
    unit_sell: 130,
    kind: null,
    ...overrides,
  }
}

beforeEach(() => {
  updateLine.mockReset()
  updateLine.mockResolvedValue({})
  refresh.mockReset()
})
afterEach(cleanup)

describe('LineRow category', () => {
  test('editable row offers the six categories and saves a change with kind', async () => {
    render(<LineRow line={line()} editable isFirst isLast />)
    const select = screen.getByLabelText('Category') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.text)).toEqual([
      'Uncategorised',
      'Labour',
      'Plant & equipment',
      'Materials',
      'Subcontract',
      'Other',
    ])
    expect(select.value).toBe('')

    fireEvent.change(select, { target: { value: 'plant' } })

    await waitFor(() => expect(updateLine).toHaveBeenCalledTimes(1))
    expect(updateLine).toHaveBeenCalledWith(
      'l-1',
      expect.objectContaining({ kind: 'plant', description: 'Site vehicle', unit_sell: 130 })
    )
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  test('clearing the category saves kind null', async () => {
    render(<LineRow line={line({ kind: 'labour' })} editable isFirst isLast />)
    const select = screen.getByLabelText('Category') as HTMLSelectElement
    expect(select.value).toBe('labour')
    fireEvent.change(select, { target: { value: '' } })
    await waitFor(() =>
      expect(updateLine).toHaveBeenCalledWith('l-1', expect.objectContaining({ kind: null }))
    )
  })

  test('other field saves carry the current kind', async () => {
    render(<LineRow line={line({ kind: 'labour' })} editable isFirst isLast />)
    const qty = screen.getByLabelText('Quantity')
    fireEvent.change(qty, { target: { value: '3' } })
    fireEvent.blur(qty)
    await waitFor(() =>
      expect(updateLine).toHaveBeenCalledWith('l-1', expect.objectContaining({ kind: 'labour', qty: 3 }))
    )
  })

  test('read-only row shows the label, or a dash when uncategorised', () => {
    const { unmount } = render(<LineRow line={line({ kind: 'subbie' })} editable={false} isFirst isLast />)
    expect(screen.getByText('Subcontract')).toBeTruthy()
    unmount()
    render(<LineRow line={line()} editable={false} isFirst isLast />)
    expect(screen.getByText('—')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/quote-line-row.test.tsx`
Expected: FAIL — "Unable to find a label with the text of: Category" (first three tests) and "Unable to find an element with the text: Subcontract" (last).

- [ ] **Step 3: Add the category control**

In `src/app/(office)/quotes/[id]/line-row.tsx`:

Replace the imports block:

```ts
import { aud } from '@/lib/format'
import { lineSell, lineTotal } from '@/lib/money'
import { cn } from '@/lib/utils'
import { deleteLine, moveLine, updateLine } from '../actions'
```

with:

```ts
import { aud } from '@/lib/format'
import { lineSell, lineTotal } from '@/lib/money'
import { LINE_KIND_LABELS, LINE_KIND_ORDER, lineKindLabel } from '@/lib/quote-lines'
import { cn } from '@/lib/utils'
import type { RateKind } from '@/lib/zod'
import { deleteLine, moveLine, updateLine } from '../actions'
```

Replace the grid templates:

```ts
export const LINE_GRID_COLS_EDITABLE =
  'grid-cols-[minmax(10rem,1fr)_4.5rem_4rem_7rem_5rem_7rem_6.5rem_5.5rem]'
export const LINE_GRID_COLS_READONLY =
  'grid-cols-[minmax(10rem,1fr)_4.5rem_4rem_7rem_5rem_7rem_6.5rem]'
```

with (second column = Category):

```ts
export const LINE_GRID_COLS_EDITABLE =
  'grid-cols-[minmax(10rem,1fr)_8rem_4.5rem_4rem_7rem_5rem_7rem_6.5rem_5.5rem]'
export const LINE_GRID_COLS_READONLY =
  'grid-cols-[minmax(10rem,1fr)_8rem_4.5rem_4rem_7rem_5rem_7rem_6.5rem]'
```

Replace the payload interface:

```ts
interface LinePayload {
  description: string
  qty: number
  unit: string
  unit_cost: number
  markup_pct: number
  unit_sell: number
  sell_overridden: boolean
}
```

with:

```ts
interface LinePayload {
  description: string
  qty: number
  unit: string
  unit_cost: number
  markup_pct: number
  unit_sell: number
  sell_overridden: boolean
  /** Cost category; null = uncategorised. */
  kind: RateKind | null
}
```

After the `sell` state line:

```ts
  const [sell, setSell] = useState<number>(line.unit_sell)
```

add:

```ts
  const [kind, setKind] = useState<RateKind | null>((line.kind as RateKind | null) ?? null)
```

In `revert()`, after `setSell(line.unit_sell)` add:

```ts
    setKind((line.kind as RateKind | null) ?? null)
```

In `save()`, replace:

```ts
      unit_sell: sell,
      sell_overridden: overridden,
      ...overrides,
```

with:

```ts
      unit_sell: sell,
      sell_overridden: overridden,
      kind,
      ...overrides,
```

After `handleSellChange`, add:

```ts
  function handleKindChange(value: string) {
    const next = (value || null) as RateKind | null
    if (next === kind) return
    setKind(next)
    save({ kind: next })
  }
```

In the read-only branch, after `<span className="truncate">{description || '—'}</span>` add:

```tsx
        <span className="truncate text-muted-foreground">
          {line.kind ? lineKindLabel(line.kind) : '—'}
        </span>
```

In the editable branch, after the Description `<Input … placeholder="Line description…" />` and before the Quantity input, add:

```tsx
      <select
        aria-label="Category"
        className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-base shadow-xs md:text-sm"
        value={kind ?? ''}
        onChange={(e) => handleKindChange(e.target.value)}
      >
        <option value="">{LINE_KIND_LABELS.uncategorised}</option>
        {LINE_KIND_ORDER.map((k) => (
          <option key={k} value={k}>
            {LINE_KIND_LABELS[k]}
          </option>
        ))}
      </select>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/quote-line-row.test.tsx`
Expected: PASS, 4 tests.

Run: `npx tsc --noEmit`
Expected: exit 0. (`quote-builder.tsx` still renders the header row with one column fewer than the grid — that is fixed in Task 5 and is not a type error.)

- [ ] **Step 5: Commit (lead)**

```bash
git add "src/app/(office)/quotes/[id]/line-row.tsx" tests/quote-line-row.test.tsx
git commit -m "feat(quotes): category select on each quote line" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Grouped `LinesGrid` and builder wiring

**Files:**
- Create: `src/app/(office)/quotes/[id]/lines-grid.tsx`
- Modify: `src/app/(office)/quotes/[id]/quote-builder.tsx` — imports (lines 39-44), orphan card (~lines 209-220), `SectionCard` (~line 768), delete the inline `LinesGrid` (~lines 788-817), `TotalsCard` constants and breakdown (~lines 847-900)
- Test: `tests/quote-lines-grid.test.tsx`

**Interfaces:**
- Consumes: `groupLinesByKind`, `LINE_KIND_LABELS`, `LINE_KIND_ORDER` (Task 1); `LineRow`, `LINE_GRID_COLS_*`, `LineData` (Task 4); `addLine` accepting `kind` (Task 2); `aud` from `@/lib/format`.
- Produces: `LinesGrid({ quoteId: string; sectionId: string | null; lines: LineData[]; editable: boolean })`.

- [ ] **Step 1: Write the failing tests**

Create `tests/quote-lines-grid.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const addLine = vi.fn()
const refresh = vi.fn()

vi.mock('../src/app/(office)/quotes/actions', () => ({
  addLine: (...args: unknown[]) => addLine(...args),
  updateLine: vi.fn(),
  moveLine: vi.fn(),
  deleteLine: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { LinesGrid } from '../src/app/(office)/quotes/[id]/lines-grid'
import type { LineData } from '../src/app/(office)/quotes/[id]/line-row'

const QUOTE_ID = '11111111-1111-4111-8111-111111111111'
const SECTION_ID = '22222222-2222-4222-8222-222222222222'

function line(
  id: string,
  kind: string | null,
  position: number,
  overrides: Partial<LineData> = {}
): LineData {
  return {
    id,
    section_id: SECTION_ID,
    position,
    description: id,
    qty: 1,
    unit: 'ea',
    unit_cost: 10,
    markup_pct: 0,
    unit_sell: 10,
    kind,
    ...overrides,
  }
}

// Deliberately out of category order, as stored positions would be on a
// quote built before grouping existed.
const LINES: LineData[] = [
  line('plastic', 'material', 0, { qty: 26, unit_sell: 119.18 }),
  line('vehicle', 'plant', 0, { qty: 25, unit_sell: 130 }),
  line('scaffold', 'plant', 1, { qty: 25, unit_sell: 100 }),
  line('tip fees', null, 0, { qty: 1, unit_sell: 400 }),
]

beforeEach(() => {
  addLine.mockReset()
  addLine.mockResolvedValue({})
  refresh.mockReset()
})
afterEach(cleanup)

describe('LinesGrid', () => {
  test('groups lines by category in fixed order with sell subtotals, skipping empty groups', () => {
    render(<LinesGrid quoteId={QUOTE_ID} sectionId={SECTION_ID} lines={LINES} editable />)

    const groups = screen.getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual([
      'Plant & equipment',
      'Materials',
      'Uncategorised',
    ])
    expect(
      within(groups[0])
        .getAllByLabelText('Description')
        .map((i) => (i as HTMLInputElement).value)
    ).toEqual(['vehicle', 'scaffold'])
    // Two-line group: the subtotal is the only element showing this amount.
    expect(within(groups[0]).getByText('$5,750.00')).toBeTruthy()
    // Single-line groups: the amount appears twice — the line's own total and
    // the group subtotal.
    expect(within(groups[1]).getAllByText('$3,098.68')).toHaveLength(2)
    expect(within(groups[2]).getAllByText('$400.00')).toHaveLength(2)
  })

  test('column headings include Category', () => {
    render(<LinesGrid quoteId={QUOTE_ID} sectionId={SECTION_ID} lines={LINES} editable />)
    expect(screen.getByText('Category')).toBeTruthy()
  })

  test('per-group Add line creates a line in that category', async () => {
    render(<LinesGrid quoteId={QUOTE_ID} sectionId={SECTION_ID} lines={LINES} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Add line to Plant & equipment' }))
    await waitFor(() =>
      expect(addLine).toHaveBeenCalledWith({ quote_id: QUOTE_ID, section_id: SECTION_ID, kind: 'plant' })
    )
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  test('uncategorised Add line sends no kind', async () => {
    render(<LinesGrid quoteId={QUOTE_ID} sectionId={SECTION_ID} lines={LINES} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Add line to Uncategorised' }))
    await waitFor(() =>
      expect(addLine).toHaveBeenCalledWith({ quote_id: QUOTE_ID, section_id: SECTION_ID })
    )
  })

  test('read-only grid keeps the groups but has no buttons', () => {
    render(<LinesGrid quoteId={QUOTE_ID} sectionId={SECTION_ID} lines={LINES} editable={false} />)
    expect(screen.getAllByRole('group')).toHaveLength(3)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  test('orphaned lines (no section) get no per-group Add line', () => {
    render(
      <LinesGrid
        quoteId={QUOTE_ID}
        sectionId={null}
        lines={LINES.map((l) => ({ ...l, section_id: null }))}
        editable
      />
    )
    expect(screen.getAllByRole('group')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /^Add line/ })).toBeNull()
  })

  test('empty list shows the placeholder', () => {
    render(<LinesGrid quoteId={QUOTE_ID} sectionId={SECTION_ID} lines={[]} editable />)
    expect(screen.getByText('No lines yet.')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/quote-lines-grid.test.tsx`
Expected: FAIL — "Failed to resolve import '../src/app/(office)/quotes/[id]/lines-grid'".

- [ ] **Step 3: Create `lines-grid.tsx`**

Create `src/app/(office)/quotes/[id]/lines-grid.tsx`:

```tsx
'use client'

import React, { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { aud } from '@/lib/format'
import { groupLinesByKind } from '@/lib/quote-lines'
import { cn } from '@/lib/utils'
import type { RateKind } from '@/lib/zod'
import { addLine } from '../actions'
import {
  LineRow,
  LINE_GRID_COLS_EDITABLE,
  LINE_GRID_COLS_READONLY,
  type LineData,
} from './line-row'
import { PlusIcon } from 'lucide-react'

/**
 * A section's lines grouped by cost category — Labour, Plant & equipment,
 * Materials, Subcontract, Other, then Uncategorised. Only populated groups
 * render. Each group heading carries the group's sell subtotal and, on an
 * editable quote with a real section, an "Add line" that creates a line
 * already in that category. Orphaned lines (sectionId null — their section
 * was deleted) get no add buttons because addLine needs a section.
 */
export function LinesGrid({
  quoteId,
  sectionId,
  lines,
  editable,
}: {
  quoteId: string
  sectionId: string | null
  lines: LineData[]
  editable: boolean
}) {
  if (lines.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">No lines yet.</p>
  }

  const groups = groupLinesByKind(lines)

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          'hidden gap-2 px-1 text-xs font-medium text-muted-foreground md:grid',
          editable ? LINE_GRID_COLS_EDITABLE : LINE_GRID_COLS_READONLY
        )}
      >
        <span>Description</span>
        <span>Category</span>
        <span className="text-right">Qty</span>
        <span>Unit</span>
        <span className="text-right">Unit cost</span>
        <span className="text-right">Markup %</span>
        <span className="text-right">Unit sell</span>
        <span className="text-right">Total</span>
        {editable && <span className="sr-only">Actions</span>}
      </div>

      {groups.map((group) => (
        <div
          key={group.kind ?? 'uncategorised'}
          role="group"
          aria-label={group.label}
          className="flex flex-col gap-1.5"
        >
          <div className="mt-1 flex items-center justify-between gap-2 border-b px-1 pb-1">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h4>
              {editable && sectionId && (
                <AddGroupLineButton
                  quoteId={quoteId}
                  sectionId={sectionId}
                  kind={group.kind}
                  label={group.label}
                />
              )}
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {aud(group.sellSubtotal)}
            </span>
          </div>
          {group.lines.map((line, i) => (
            <LineRow
              key={line.id}
              line={line}
              editable={editable}
              isFirst={i === 0}
              isLast={i === group.lines.length - 1}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function AddGroupLineButton({
  quoteId,
  sectionId,
  kind,
  label,
}: {
  quoteId: string
  sectionId: string
  kind: RateKind | null
  label: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleAdd() {
    startTransition(async () => {
      const result = await addLine({
        quote_id: quoteId,
        section_id: sectionId,
        ...(kind ? { kind } : {}),
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-1.5 text-xs"
      onClick={handleAdd}
      disabled={pending}
    >
      <PlusIcon />
      Add line
      <span className="sr-only"> to {label}</span>
    </Button>
  )
}
```

- [ ] **Step 4: Run the grid tests**

Run: `npx vitest run tests/quote-lines-grid.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Wire the builder to the new grid**

In `src/app/(office)/quotes/[id]/quote-builder.tsx`:

Replace the import block:

```ts
import {
  LineRow,
  LINE_GRID_COLS_EDITABLE,
  LINE_GRID_COLS_READONLY,
  type LineData,
} from './line-row'
```

with:

```ts
import { LINE_KIND_LABELS, LINE_KIND_ORDER } from '@/lib/quote-lines'
import type { LineData } from './line-row'
import { LinesGrid } from './lines-grid'
```

(`export type { LineData }` on the next lines stays.) Also delete the line `import { cn } from '@/lib/utils'` near the top of the file: the inline grid was its only user in this file.

In the orphan card, replace:

```tsx
            <LinesGrid
              lines={orphanLines}
              editable={editable}
            />
```

with:

```tsx
            <LinesGrid
              quoteId={quote.id}
              sectionId={null}
              lines={orphanLines}
              editable={editable}
            />
```

In `SectionCard`, replace:

```tsx
        <LinesGrid lines={lines} editable={editable} />
```

with:

```tsx
        <LinesGrid
          quoteId={quoteId}
          sectionId={section.id}
          lines={lines}
          editable={editable}
        />
```

Delete the whole inline `function LinesGrid({ lines, editable }: { lines: LineData[]; editable: boolean }) { … }` (from its signature through its closing brace, just above `function AddSectionButton`).

In the Totals area, replace:

```ts
const KIND_LABELS: Record<string, string> = {
  labour: 'Labour',
  plant: 'Plant',
  material: 'Materials',
  subbie: 'Subcontract',
  other: 'Other',
}
const KIND_ORDER = ['labour', 'plant', 'material', 'subbie', 'other', 'untagged']
```

with:

```ts
/** Breakdown rows: the category order, then the untagged remainder. */
const BREAKDOWN_ORDER = [...LINE_KIND_ORDER, 'uncategorised'] as const
```

and inside `TotalsCard` replace:

```ts
  const byKind = new Map<string, { cost: number; sell: number }>()
  for (const l of lines) {
    const key = l.kind ?? 'untagged'
    const entry = byKind.get(key) ?? { cost: 0, sell: 0 }
    entry.cost += lineTotal(l.qty, l.unit_cost)
    entry.sell += lineTotal(l.qty, l.unit_sell)
    byKind.set(key, entry)
  }
  const breakdown = KIND_ORDER.filter(
    (k) => byKind.has(k) && k !== 'untagged'
  ).length
    ? KIND_ORDER.filter((k) => byKind.has(k)).map((k) => {
        const entry = byKind.get(k)!
        const cost = round2(entry.cost)
        const sell = round2(entry.sell)
        return {
          kind: k,
          label: KIND_LABELS[k] ?? 'Untagged',
          cost,
          sell,
          marginPct: sell > 0 ? round2(((sell - cost) / sell) * 100) : null,
        }
      })
    : []
```

with:

```ts
  const byKind = new Map<string, { cost: number; sell: number }>()
  for (const l of lines) {
    const key = l.kind ?? 'uncategorised'
    const entry = byKind.get(key) ?? { cost: 0, sell: 0 }
    entry.cost += lineTotal(l.qty, l.unit_cost)
    entry.sell += lineTotal(l.qty, l.unit_sell)
    byKind.set(key, entry)
  }
  const breakdown = BREAKDOWN_ORDER.filter(
    (k) => byKind.has(k) && k !== 'uncategorised'
  ).length
    ? BREAKDOWN_ORDER.filter((k) => byKind.has(k)).map((k) => {
        const entry = byKind.get(k)!
        const cost = round2(entry.cost)
        const sell = round2(entry.sell)
        return {
          kind: k,
          label: LINE_KIND_LABELS[k],
          cost,
          sell,
          marginPct: sell > 0 ? round2(((sell - cost) / sell) * 100) : null,
        }
      })
    : []
```

After these edits `cn`, `LineRow`, `LINE_GRID_COLS_EDITABLE` and `LINE_GRID_COLS_READONLY` must no longer be imported in this file; lint in the next step catches any leftover.

- [ ] **Step 6: Typecheck, lint, and run the quote test files**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npm run lint`
Expected: no errors (an unused-import error here means a leftover from Step 5 — remove it).

Run: `npx vitest run tests/quote-lines.test.ts tests/quote-line-row.test.tsx tests/quote-lines-grid.test.tsx tests/quote-pdf.test.tsx tests/convert.test.ts`
Expected: all PASS.

- [ ] **Step 7: Commit (lead)**

```bash
git add "src/app/(office)/quotes/[id]/lines-grid.tsx" "src/app/(office)/quotes/[id]/quote-builder.tsx" tests/quote-lines-grid.test.tsx
git commit -m "feat(quotes): group section lines by category with subtotals and per-group add" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Full verification (lead)

**Files:** none new.

- [ ] **Step 1: Whole suite, types, lint**

Run: `npm test`
Expected: all pass except possibly the known `tests/quote-pdf-dialog.test.tsx` flake; if it fails, re-run that file alone (`npx vitest run tests/quote-pdf-dialog.test.tsx`) and confirm it passes on its own.

Run: `npx tsc --noEmit` → exit 0. Run: `npm run lint` → clean.

- [ ] **Step 2: Browser check on the worktree dev server**

Start `preview_start {name: "quote-line-groups-dev"}` (launch config on port 3500, uncommitted in `.claude/launch.json`). Sign-in is the owner's if needed.

Open quote RQ26021 "244 Ingham Forrest Beach Rd" (55 lines, 48 tagged) and confirm:
1. Section 1 shows category headings in order with subtotals; only populated groups appear; untagged lines sit under Uncategorised.
2. Changing a line's Category moves it to the end of that group after refresh.
3. Up/down arrows move a line within its group only.
4. "Add line" on a group heading creates a blank line in that group; the section's "Add line" creates an Uncategorised one. Delete the test lines afterwards.
5. The cost breakdown card labels read Labour / Plant & equipment / Materials / Subcontract / Other / Uncategorised.
6. Open the PDF (quote PDF dialog, itemised) — lines appear in the same grouped order, no headings.
7. `read_console_messages` shows no errors. Take a screenshot of the grouped section as proof.

- [ ] **Step 3: Finish**

Use `superpowers:finishing-a-development-branch`. The owner pushes (`git push origin feat/quote-line-groups:main` after their own check) — pushes from this session are blocked by the classifier.
