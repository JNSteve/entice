# Quote Line Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A padlock at the far left of every editable quote line that, when locked, freezes the whole line (all fields and delete) on the client and the server, and unlocks again on a second press.

**Architecture:** One new boolean column `quote_lines.locked` carried through the page loader into `LineData`. A new server action `setLineLocked` flips it; `updateLine` and `deleteLine` refuse a locked line. `LineRow` renders a ghost icon button in a new leading grid column and disables its inputs while locked.

**Tech Stack:** Next.js (App Router, server actions), Supabase (Postgres), zod, React 19, Base UI buttons/inputs, lucide-react icons, vitest + @testing-library/react (jsdom, no jest-dom matchers).

Spec: `docs/superpowers/specs/2026-10-23-quote-line-lock-design.md`

## Global Constraints

- Migration file name: `supabase/migrations/0076_quote_line_locked.sql`. Column: `locked boolean not null default false`.
- Locked refusal message, verbatim: `Line is locked. Unlock it to edit.`
- Lock button accessible names, verbatim: `Lock line` (unlocked state) and `Unlock line` (locked state).
- Read-only quotes (status not draft/sent) show no padlock; `LINE_GRID_COLS_READONLY` is unchanged.
- Move up / move down keep working on a locked line.
- `tsconfig.json` includes `tests/**`, so every `LineData` fixture in tests must carry `locked`.
- Run commands from `C:\Users\nickj\Documents\Devman\nexvia`. npm needs `NODE_EXTRA_CA_CERTS=C:\Users\nickj\norton-ssl-root-ca.pem` on this machine for installs only; `npx vitest`/`npx tsc` run without it.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Migration and data plumbing

**Files:**
- Create: `supabase/migrations/0076_quote_line_locked.sql`
- Modify: `src/app/(office)/quotes/[id]/line-row.tsx` (the `LineData` interface, ~line 17)
- Modify: `src/app/(office)/quotes/[id]/page.tsx` (lines select ~line 52, `lineData` map ~line 173)
- Modify: `src/app/(office)/quotes/actions.ts` (`duplicateQuote` line copy ~lines 216-240)
- Modify: `tests/line-row.test.tsx`, `tests/quote-line-row.test.tsx`, `tests/quote-lines-grid.test.tsx` (the `line()` fixture helpers)

**Interfaces:**
- Produces: `LineData.locked: boolean` (required). Every later task reads it.

- [ ] **Step 1: Write the migration**

```sql
-- 0076: quote_lines.locked — per-line "finalised" padlock on the quote builder.
--
-- Why: while a quote is priced, settled lines sit next to lines still being
-- worked on and a stray edit to a finished figure goes unnoticed. A locked
-- line's fields and delete are refused by the server (updateLine/deleteLine)
-- and disabled in the builder; moving it keeps working. Pressing the padlock
-- again unlocks it. Existing lines start unlocked. Duplicating a quote copies
-- each line's lock; lines added from the rate picker or a takeoff start unlocked.

alter table quote_lines
  add column if not exists locked boolean not null default false;
```

- [ ] **Step 2: Add `locked` to `LineData`**

In `src/app/(office)/quotes/[id]/line-row.tsx`, the interface becomes:

```ts
export interface LineData {
  id: string
  section_id: string | null
  position: number
  description: string
  qty: number
  unit: string
  unit_cost: number
  markup_pct: number
  unit_sell: number
  /** Cost category from the source rate item; null for untagged manual lines. */
  kind: string | null
  /** Finalised: every field and delete are refused until the padlock is pressed again. */
  locked: boolean
}
```

- [ ] **Step 3: Load and map it on the quote page**

In `src/app/(office)/quotes/[id]/page.tsx` change the lines select to:

```ts
      supabase
        .from('quote_lines')
        .select('id, section_id, position, description, qty, unit, unit_cost, markup_pct, unit_sell, kind, locked')
        .eq('quote_id', id)
        .order('position')
        .order('id'),
```

and add to the `lineData` map, after `kind`:

```ts
    kind: (l.kind as string | null) ?? null,
    locked: Boolean(l.locked),
```

- [ ] **Step 4: Copy the lock when duplicating a quote**

In `src/app/(office)/quotes/actions.ts`, `duplicateQuote` line copy. Select:

```ts
    .select(
      'section_id, description, qty, unit, unit_cost, markup_pct, unit_sell, position, kind, locked'
    )
```

Insert map gains, after `kind: l.kind,`:

```ts
        kind: l.kind,
        locked: l.locked,
```

- [ ] **Step 5: Add `locked: false` to every test fixture**

`tests/line-row.test.tsx`, `tests/quote-line-row.test.tsx` and `tests/quote-lines-grid.test.tsx` each have a `line()` helper returning a `LineData`. Add `locked: false,` directly after `kind: ...,` in each, before `...overrides,`.

- [ ] **Step 6: Typecheck and run the quote tests**

Run: `npx tsc --noEmit`
Expected: no output (exit 0).

Run: `npx vitest run tests/line-row.test.tsx tests/quote-line-row.test.tsx tests/quote-lines-grid.test.tsx`
Expected: all existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0076_quote_line_locked.sql "src/app/(office)/quotes/[id]/line-row.tsx" "src/app/(office)/quotes/[id]/page.tsx" "src/app/(office)/quotes/actions.ts" tests/line-row.test.tsx tests/quote-line-row.test.tsx tests/quote-lines-grid.test.tsx
git commit -m "feat(quotes): quote_lines.locked column, loaded into LineData and copied on duplicate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Server action and locked guards

**Files:**
- Modify: `src/lib/zod.ts` (after `quoteLineUpdateSchema`, ~line 341)
- Modify: `src/app/(office)/quotes/actions.ts` (imports ~line 17-25, `updateLine` ~line 673, `deleteLine` ~line 729, new `setLineLocked` after `updateLine`)

**Interfaces:**
- Produces: `setLineLocked(id: string, locked: boolean): Promise<{ error?: string }>` exported from `src/app/(office)/quotes/actions.ts`. Task 3 imports it.
- Produces: `quoteLineLockSchema` in `src/lib/zod.ts`.

No vitest harness exists for the server actions (they need a Supabase session). This task is verified by typecheck here and by hand in Task 4.

- [ ] **Step 1: Add the zod schema**

In `src/lib/zod.ts`, directly after `export type QuoteLineUpdateInput = ...`:

```ts
export const quoteLineLockSchema = z.object({
  locked: z.boolean(),
})
```

- [ ] **Step 2: Import it in the actions file**

In `src/app/(office)/quotes/actions.ts` extend the `@/lib/zod` import:

```ts
import {
  quoteCreateSchema,
  quoteHeaderSchema,
  quoteClientSchema,
  quoteStatusSchema,
  quoteSectionSchema,
  quoteLineCreateSchema,
  quoteLineUpdateSchema,
  quoteLineLockSchema,
} from '@/lib/zod'
```

- [ ] **Step 3: Add the shared refusal message**

Directly after `const EDITABLE_STATUSES = ['draft', 'sent']` add:

```ts
const LOCKED_LINE_ERROR = 'Line is locked. Unlock it to edit.'
```

- [ ] **Step 4: Guard `updateLine`**

Change its line select and add the guard after the editable check:

```ts
  const { data: line } = await supabase
    .from('quote_lines')
    .select('id, quote_id, section_id, kind, locked')
    .eq('id', id)
    .single()
  if (!line) return { error: 'Line not found' }

  const editable = await assertEditable(supabase, line.quote_id)
  if (editable.error) return editable
  if (line.locked) return { error: LOCKED_LINE_ERROR }
```

The rest of `updateLine` is unchanged.

- [ ] **Step 5: Add `setLineLocked`**

Directly after `updateLine` (before `deleteLine`):

```ts
/**
 * Toggle a line's "finalised" padlock. The lock only stops edits and deletes
 * (updateLine / deleteLine); moving the line and the quote-level actions are
 * unaffected. Same role and editable-quote gates as every other line action.
 */
export async function setLineLocked(id: string, locked: boolean): Promise<Result> {
  await requireRole('admin', 'office')

  const parsed = quoteLineLockSchema.safeParse({ locked })
  if (!parsed.success) return { error: 'Invalid data' }

  const supabase = await createClient()
  const { data: line } = await supabase
    .from('quote_lines')
    .select('id, quote_id')
    .eq('id', id)
    .single()
  if (!line) return { error: 'Line not found' }

  const editable = await assertEditable(supabase, line.quote_id)
  if (editable.error) return editable

  const { error } = await supabase
    .from('quote_lines')
    .update({ locked: parsed.data.locked })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidateQuote(line.quote_id)
  return {}
}
```

- [ ] **Step 6: Guard `deleteLine`**

```ts
  const { data: line } = await supabase
    .from('quote_lines')
    .select('id, quote_id, section_id, locked')
    .eq('id', id)
    .single()
  if (!line) return { error: 'Line not found' }

  const editable = await assertEditable(supabase, line.quote_id)
  if (editable.error) return editable
  if (line.locked) return { error: LOCKED_LINE_ERROR }
```

The rest of `deleteLine` is unchanged. `moveLine` is not touched.

- [ ] **Step 7: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

Run: `npx eslint "src/app/(office)/quotes/actions.ts" src/lib/zod.ts`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/zod.ts "src/app/(office)/quotes/actions.ts"
git commit -m "feat(quotes): setLineLocked action; updateLine and deleteLine refuse a locked line

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Padlock toggle in the line row (TDD)

**Files:**
- Modify: `src/components/MoneyInput.tsx` (props + pass-through)
- Modify: `src/app/(office)/quotes/[id]/line-row.tsx` (grid constant, imports, state, editable render)
- Modify: `src/app/(office)/quotes/[id]/lines-grid.tsx` (header row)
- Test: `tests/line-row.test.tsx` (mock + three new tests)
- Modify: `tests/quote-line-row.test.tsx`, `tests/quote-lines-grid.test.tsx` (actions mock gains `setLineLocked`)

**Interfaces:**
- Consumes: `setLineLocked(id: string, locked: boolean)` from Task 2; `LineData.locked` from Task 1.

- [ ] **Step 1: Extend the actions mock and add the failing tests**

In `tests/line-row.test.tsx` replace the top of the file (down to and including the `sonner` mock) with:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import * as React from 'react'

const updateLine = vi.fn(async () => ({}))
const setLineLocked = vi.fn(async (): Promise<{ error?: string }> => ({}))
const refresh = vi.fn()
const toastError = vi.fn()

vi.mock('../src/app/(office)/quotes/actions', () => ({
  updateLine: (...args: unknown[]) => updateLine(...(args as [])),
  setLineLocked: (...args: unknown[]) => setLineLocked(...(args as [])),
  moveLine: vi.fn(async () => ({})),
  deleteLine: vi.fn(async () => ({})),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: (m: string) => toastError(m) },
}))
```

and make `beforeEach` also reset the new mocks:

```tsx
beforeEach(() => {
  updateLine.mockClear()
  setLineLocked.mockClear()
  setLineLocked.mockResolvedValue({})
  refresh.mockClear()
  toastError.mockClear()
})
```

Append these tests at the end of the file:

```tsx
const FIELD_LABELS = [
  'Description',
  'Category',
  'Quantity',
  'Unit',
  'Unit cost',
  'Markup %',
  'Unit sell',
] as const

function fieldDisabled(label: string) {
  return (screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement).disabled
}

function buttonDisabled(name: string) {
  return (screen.getByRole('button', { name }) as HTMLButtonElement).disabled
}

test('pressing the padlock locks the line: saves locked and disables every field and delete, not the arrows', async () => {
  const user = userEvent.setup()
  render(<LineRow line={line()} editable isFirst={false} isLast={false} />)
  expect(FIELD_LABELS.map(fieldDisabled)).toEqual(FIELD_LABELS.map(() => false))

  await user.click(screen.getByRole('button', { name: 'Lock line' }))

  await waitFor(() => expect(setLineLocked).toHaveBeenCalledWith('line-1', true))
  const unlock = screen.getByRole('button', { name: 'Unlock line' })
  expect(unlock.getAttribute('aria-pressed')).toBe('true')
  expect(FIELD_LABELS.map(fieldDisabled)).toEqual(FIELD_LABELS.map(() => true))
  expect(buttonDisabled('Delete line')).toBe(true)
  await waitFor(() => expect(buttonDisabled('Move line up')).toBe(false))
  expect(buttonDisabled('Move line down')).toBe(false)
  await waitFor(() => expect(refresh).toHaveBeenCalled())
})

test('a locked line renders frozen and the padlock unlocks it', async () => {
  const user = userEvent.setup()
  renderRow(line({ locked: true }))

  const unlock = screen.getByRole('button', { name: 'Unlock line' })
  expect(unlock.getAttribute('aria-pressed')).toBe('true')
  expect(FIELD_LABELS.map(fieldDisabled)).toEqual(FIELD_LABELS.map(() => true))
  expect(buttonDisabled('Delete line')).toBe(true)

  await user.click(unlock)

  await waitFor(() => expect(setLineLocked).toHaveBeenCalledWith('line-1', false))
  expect(screen.getByRole('button', { name: 'Lock line' }).getAttribute('aria-pressed')).toBe('false')
  expect(FIELD_LABELS.map(fieldDisabled)).toEqual(FIELD_LABELS.map(() => false))
  await waitFor(() => expect(buttonDisabled('Delete line')).toBe(false))
})

test('a failed lock save reverts the padlock and reports the error', async () => {
  const user = userEvent.setup()
  setLineLocked.mockResolvedValueOnce({ error: 'Quote is accepted and can no longer be edited' })
  renderRow(line())

  await user.click(screen.getByRole('button', { name: 'Lock line' }))

  await waitFor(() =>
    expect(toastError).toHaveBeenCalledWith('Quote is accepted and can no longer be edited')
  )
  const lock = screen.getByRole('button', { name: 'Lock line' })
  expect(lock.getAttribute('aria-pressed')).toBe('false')
  expect(FIELD_LABELS.map(fieldDisabled)).toEqual(FIELD_LABELS.map(() => false))
  expect(refresh).not.toHaveBeenCalled()
})

test('a read-only row shows no padlock', () => {
  render(<LineRow line={line({ locked: true })} editable={false} isFirst isLast />)
  expect(screen.queryByRole('button', { name: 'Unlock line' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Lock line' })).toBeNull()
})
```

Also add `setLineLocked: vi.fn(),` to the `vi.mock('../src/app/(office)/quotes/actions', ...)` factories in `tests/quote-line-row.test.tsx` and `tests/quote-lines-grid.test.tsx` so those files keep matching the module's exports.

- [ ] **Step 2: Run the new tests and watch them fail**

Run: `npx vitest run tests/line-row.test.tsx`
Expected: the four new tests FAIL (`Unable to find an accessible element with the role "button" and name "Lock line"`); the nine existing tests still pass.

- [ ] **Step 3: Let `MoneyInput` be disabled**

`src/components/MoneyInput.tsx`:

```tsx
interface MoneyInputProps {
  value: number | null
  onChange: (v: number | null) => void
  allowNegative?: boolean
  placeholder?: string
  className?: string
  disabled?: boolean
  'aria-label'?: string
}
```

```tsx
export function MoneyInput({
  value,
  onChange,
  allowNegative = false,
  placeholder,
  className,
  disabled,
  'aria-label': ariaLabel,
}: MoneyInputProps) {
```

and on the rendered `<Input>` add `disabled={disabled}` after `aria-label={ariaLabel}`.

- [ ] **Step 4: Implement the padlock in `LineRow`**

In `src/app/(office)/quotes/[id]/line-row.tsx`:

Imports:

```tsx
import { deleteLine, moveLine, setLineLocked, updateLine } from '../actions'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  LockIcon,
  LockOpenIcon,
  Trash2Icon,
} from 'lucide-react'
```

Grid constant (leading `1.75rem` column for the padlock):

```ts
export const LINE_GRID_COLS_EDITABLE =
  'grid-cols-[1.75rem_minmax(10rem,1fr)_10rem_4.5rem_4rem_7rem_5rem_7rem_6.5rem_5.5rem]'
```

State, directly after the `overridden` state:

```tsx
  // Finalised lines are frozen on the server too; this mirrors line.locked
  // optimistically so the padlock answers at once and reverts on failure.
  const [locked, setLocked] = useState(line.locked)
```

Handler, directly after `handleDelete`:

```tsx
  function handleToggleLock() {
    const next = !locked
    setLocked(next)
    startTransition(async () => {
      const result = await setLineLocked(line.id, next)
      if (result.error) {
        toast.error(result.error)
        setLocked(!next)
        return
      }
      router.refresh()
    })
  }
```

Directly before the editable `return`, after `const total = ...`:

```tsx
  // Locked inputs keep legible figures: override the primitive's 50% fade.
  const frozen = locked ? 'disabled:opacity-100 disabled:text-foreground' : undefined
```

Editable render: replace the whole `return (<div className={cn('grid items-center gap-2', LINE_GRID_COLS_EDITABLE)}> ... </div>)` with:

```tsx
  return (
    <div className={cn('grid items-center gap-2', LINE_GRID_COLS_EDITABLE)}>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={handleToggleLock}
        disabled={pending}
        aria-pressed={locked}
        title={locked ? 'Unlock line' : 'Lock line'}
      >
        {locked ? <LockIcon /> : <LockOpenIcon className="text-muted-foreground" />}
        <span className="sr-only">{locked ? 'Unlock line' : 'Lock line'}</span>
      </Button>
      <Input
        aria-label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => {
          if (description !== line.description) save({ description })
        }}
        placeholder="Line description…"
        disabled={locked}
        className={frozen}
      />
      <select
        aria-label="Category"
        className={cn(
          'h-9 w-full rounded-md border border-input bg-transparent px-2 text-base shadow-xs md:text-sm',
          'disabled:cursor-not-allowed disabled:bg-input/50'
        )}
        value={kind ?? ''}
        onChange={(e) => handleKindChange(e.target.value)}
        disabled={locked}
      >
        <option value="">{LINE_KIND_LABELS.uncategorised}</option>
        {LINE_KIND_ORDER.map((k) => (
          <option key={k} value={k}>
            {LINE_KIND_LABELS[k]}
          </option>
        ))}
      </select>
      <Input
        aria-label="Quantity"
        type="number"
        min={0}
        step="any"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        onBlur={(e) => {
          const n = parseFloat(e.target.value) || 0
          if (n !== line.qty) save({ qty: n })
        }}
        className={cn('text-right tabular-nums', frozen)}
        disabled={locked}
      />
      <Input
        aria-label="Unit"
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        onBlur={() => {
          if (unit.trim() && unit !== line.unit) save({ unit: unit.trim() })
          else if (!unit.trim()) setUnit(line.unit)
        }}
        disabled={locked}
        className={frozen}
      />
      <MoneyInput
        aria-label="Unit cost"
        value={cost}
        onChange={handleCostChange}
        disabled={locked}
        className={frozen}
      />
      <Input
        aria-label="Markup %"
        type="number"
        step="0.01"
        value={markup}
        onChange={(e) => setMarkup(e.target.value)}
        onBlur={handleMarkupBlur}
        className={cn('text-right tabular-nums', frozen)}
        disabled={locked}
      />
      <MoneyInput
        aria-label="Unit sell"
        value={sell}
        onChange={handleSellChange}
        disabled={locked}
        className={frozen}
      />
      <span className="px-1 text-right text-sm font-medium tabular-nums">
        {aud(total)}
      </span>
      <div className="flex items-center justify-end gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => handleMove('up')}
          disabled={pending || isFirst}
        >
          <ArrowUpIcon />
          <span className="sr-only">Move line up</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => handleMove('down')}
          disabled={pending || isLast}
        >
          <ArrowDownIcon />
          <span className="sr-only">Move line down</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleDelete}
          disabled={pending || locked}
        >
          <Trash2Icon className="text-destructive" />
          <span className="sr-only">Delete line</span>
        </Button>
      </div>
    </div>
  )
```

The read-only render (`if (!editable)`) is unchanged.

- [ ] **Step 5: Add the header cell in `LinesGrid`**

In `src/app/(office)/quotes/[id]/lines-grid.tsx`, the header row's first child becomes a screen-reader-only cell on editable quotes:

```tsx
        {editable && <span className="sr-only">Lock</span>}
        <span>Description</span>
        <span>Category</span>
```

Everything else in the header stays as it is.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/line-row.test.tsx tests/quote-line-row.test.tsx tests/quote-lines-grid.test.tsx`
Expected: all pass, including the four new tests.

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx eslint "src/app/(office)/quotes/[id]" src/components/MoneyInput.tsx tests/line-row.test.tsx`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/MoneyInput.tsx "src/app/(office)/quotes/[id]/line-row.tsx" "src/app/(office)/quotes/[id]/lines-grid.tsx" tests/line-row.test.tsx tests/quote-line-row.test.tsx tests/quote-lines-grid.test.tsx
git commit -m "feat(quotes): padlock on each line freezes it until pressed again

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Apply the migration and verify end to end

**Files:** none changed unless verification finds a bug.

- [ ] **Step 1: Apply migration 0076 to the live database**

Through the `ecr-portal` MCP `sql` tool (call `help` first in a fresh session), run the body of `supabase/migrations/0076_quote_line_locked.sql`. Then confirm:

```sql
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_name = 'quote_lines' and column_name = 'locked';
```

Expected: one row, `boolean`, default `false`, `NO`.

- [ ] **Step 2: Start the dev server and open a draft quote**

Use `preview_start` with `{ name: "entice-dev" }` (main checkout, port 3000). Log in as the owner account. Open a draft or sent quote that has lines (prefer an existing `zz`-prefixed test quote; creating a new quote burns a work number, so do not create one).

- [ ] **Step 3: Check the padlock in the browser**

1. Each editable line shows an open padlock at the far left; the header still lines up with the inputs.
2. Click a padlock: it closes, every field on that row and its bin go grey but stay legible, the arrows still work.
3. Reload the page: the line is still locked (persisted).
4. Click the closed padlock: the row is editable again. Reload: still unlocked.
5. Server guard: open the same quote in a second tab, lock a line in tab A, then in the still-stale tab B change that line's quantity and tab away. Expected: a toast `Line is locked. Unlock it to edit.` and the field reverts. Unlock the line in tab A afterwards so the quote is left as it was.
6. Open an accepted (read-only) quote: no padlocks.

Take a screenshot of a mix of locked and unlocked rows for the hand-over.

- [ ] **Step 4: Full test suite, typecheck, lint**

Run: `npx vitest run`
Expected: all tests pass.

Run: `npx tsc --noEmit` and `npx eslint .`
Expected: exit 0.

- [ ] **Step 5: Commit any fixes and record state**

If verification required a fix, commit it with a `fix(quotes): …` message carrying the co-author line. Then update the memory index with a short `quote-line-lock` entry (shipped date, migration 0076 applied, owner click-check pending).
