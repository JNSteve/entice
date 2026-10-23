# Per-line lock on the quote builder

**Date:** 2026-10-23 · **Status:** approved, building on `main` · **Migration:** 0076

## Problem

While a quote is being priced, lines that are already settled sit next to lines still being worked
on, and a stray edit to a finished figure goes unnoticed. The owner wants a small padlock on each
line that marks it as finalised. A locked line cannot be edited; pressing the padlock again unlocks
it.

## Decision (owner, 2026-10-23)

- The padlock sits at the **far left** of each editable line row.
- Locking freezes the **whole line**: description, category, qty, unit, unit cost, markup %, unit
  sell and delete. Moving the line up or down within its group still works.
- The lock is a **persisted flag** on the line, shared by everyone who opens the quote, and the
  server refuses edits and deletes on a locked line.

## Design

- **Schema.** `quote_lines.locked boolean not null default false`. Existing lines start unlocked.
- **Server actions** (`src/app/(office)/quotes/actions.ts`).
  - New `setLineLocked(id, locked)`: admin/office only, quote must be editable (same
    `assertEditable` gate as every other line action), updates the flag, revalidates the quote.
    Input validated with a small zod schema (`quoteLineLockSchema`).
  - `updateLine` and `deleteLine` select `locked` and refuse a locked line with
    `Line is locked. Unlock it to edit.` `moveLine` is unchanged.
  - `duplicateQuote` copies `locked` with each line. Lines created by `addLine` (manual or from the
    rate picker) and by the takeoff push start unlocked via the column default.
- **Page data.** `quotes/[id]/page.tsx` selects `locked` and maps it onto `LineData.locked`.
- **Line row** (`line-row.tsx`).
  - `LINE_GRID_COLS_EDITABLE` gains a leading `1.75rem` column; the header row in `lines-grid.tsx`
    gets a matching screen-reader-only "Lock" cell. `LINE_GRID_COLS_READONLY` is unchanged: a
    quote that can no longer be edited shows no padlock.
  - A ghost `icon-sm` button in that column. Unlocked: `LockOpenIcon` in `text-muted-foreground`,
    label "Lock line". Locked: `LockIcon` in the normal foreground colour, label "Unlock line".
    `aria-pressed` mirrors the state. Disabled while a save is pending.
  - Clicking flips local state optimistically, calls `setLineLocked`, and on error shows a toast
    and reverts. On success it refreshes the router like the other line actions.
  - When locked, every input and the category select get `disabled`, as does the delete button.
    Inputs keep full-opacity text so the figures stay legible (override the primitive's
    `disabled:opacity-50`). Move arrows stay enabled, still gated by first/last as today.
  - `MoneyInput` gains a `disabled?: boolean` prop passed through to `Input`.
- **Not changed.** Quote PDF, portal, Xero, job/project conversion, section controls.

## Tests

`tests/line-row.test.tsx` (vitest + testing-library, actions module mocked):

1. Clicking the padlock on an unlocked line calls `setLineLocked('line-1', true)` and the inputs
   and delete button become disabled; move arrows stay enabled.
2. A line rendered with `locked: true` shows the pressed padlock, disabled fields and delete, and
   clicking it calls `setLineLocked('line-1', false)`.
3. When `setLineLocked` returns an error the padlock reverts to unlocked and `toast.error` fires.

The existing mocks of the actions module in `tests/line-row.test.tsx`, `tests/quote-line-row.test.tsx`
and `tests/quote-lines-grid.test.tsx` gain a `setLineLocked` entry. No harness exists for the server
actions; the server-side refusal is checked by hand in the dev server.

## Out of scope

Lock-all / unlock-all for a section or group, recording who locked a line and when, locking whole
sections, any change to the PDF.

## Rollout

1. Owner pastes `supabase/migrations/0076_quote_line_locked.sql` into the Supabase SQL editor
   (or I apply it through the portal MCP `sql` tool).
2. Merge to main, Vercel deploys.
