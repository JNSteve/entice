# Quote line groups — design

**Date:** 2026-10-16
**Status:** approved by owner (chat, 2026-10-16); implementation pending
**Branch:** `feat/quote-line-groups` (worktree `.claude/worktrees/quote-line-groups`, off origin/main 666fa8c)

## Problem

On the quote builder every line in a section is one flat stack. Recent quotes
(RQ26020 Club Mermaid, 73 lines; RQ26021 Ingham, 55 lines) sit in a single
"Section 1" with site vehicle, scaffold, plastic, tape, bins and vacuums all
interleaved. The owner wants them organised into labour, subcontractors,
equipment/materials and plant.

## What already exists

- `quote_lines.kind` (nullable; check `labour|plant|material|subbie|other`,
  migration 0049) is set when a line comes from the rate library, the price
  list or a takeoff push (`quoteKind()` folds `consumable` into `material`).
  Hand-typed lines have `kind = null`. It is not shown or editable on screen,
  and `duplicateQuote` drops it when copying lines.
- Live data on 2026-10-16: 169 quote lines, 83 untagged.
- `quote_sections` are **client-facing scope stages**: their titles print on
  the quote PDF in all three pricing modes and feed the project scope summary
  and budget order on conversion. They stay exactly as they are.
- The totals card already shows a "Cost breakdown" by kind.
- The invoice editor already has an editable per-line kind select, which is
  the pattern to copy.

## Design

### 1. Category groups inside each section

Within a section, lines render under category headings in a fixed order:

| key | label |
|---|---|
| `labour` | Labour |
| `plant` | Plant & equipment |
| `material` | Materials |
| `subbie` | Subcontract |
| `other` | Other |
| `null` | Uncategorised |

- Only groups that contain at least one line are rendered.
- The column header row (Description, Qty, Unit, …) stays once per section,
  above the first group.
- Each group has a heading row: label on the left, the group's **sell
  subtotal** (Σ qty × unit_sell) on the right. When the quote is editable the
  heading also carries a compact "Add line" button that creates a blank line
  already in that category.
- Lines orphaned by a deleted section ("Ungrouped lines" card) are grouped
  the same way.
- Read-only quotes (accepted/lost) show the same grouping without buttons.
- An empty section still shows "No lines yet."

### 2. Category on every line

- `LineRow` gains a **Category** column between Description and Qty: a native
  `<select aria-label="Category">` with the six options above (Uncategorised
  = empty value). Read-only rows show the label as muted text, or "—" for an
  uncategorised line.
- Grid templates (`LINE_GRID_COLS_EDITABLE` / `_READONLY`) gain a `7rem`
  column; the section header row gains a "Category" heading.
- Changing the select saves immediately (same save path as the other fields).
- `quoteLineUpdateSchema` gains `kind: z.enum(RATE_KINDS).nullable()`;
  `updateLine` writes it. When the kind actually changes, the server also sets
  `position = (max position in the section) + 1`, so the line lands at the
  end of its new group and the stored order stays grouped.
- `quoteLineCreateSchema` gains optional `kind: z.enum(RATE_KINDS)`; `addLine`
  stores it on a blank manual line (ignored when `rate_item_id` is given,
  which already sets kind from the rate item). The per-group "Add line"
  button passes it. The section-level "Add line" button still creates an
  uncategorised line.

### 3. One ordering, used everywhere

New pure module `src/lib/quote-lines.ts`:

- `LINE_KIND_ORDER = ['labour','plant','material','subbie','other']`
- `LINE_KIND_LABELS` (the table above, plus `uncategorised`)
- `lineKindRank(kind)` — index in the order; `null`/unknown ranks last.
- `sortLinesGrouped(lines)` — stable sort by rank, then `position`, then `id`.
- `groupLinesByKind(lines)` — `{ kind, label, lines, sellSubtotal }[]` in
  rank order, empty groups omitted.

Consumers:

- **Builder** (`quote-builder.tsx`): `LinesGrid` groups with
  `groupLinesByKind`; `isFirst`/`isLast` are per group. `TotalsCard` reuses
  `LINE_KIND_LABELS`/`LINE_KIND_ORDER` instead of its own copies.
- **Quote PDF** (`src/app/api/pdf/[type]/[id]/route.tsx`): selects `kind`
  and applies `sortLinesGrouped` to each section's lines, so the PDF prints
  the same order the screen shows. Category headings are **not** printed.
- **Conversion** (`convertQuoteToJob`, `convertQuoteToProject` in
  `quotes/actions.ts`): select `kind` and apply `sortLinesGrouped` before
  building the scope summary and budget lines.
- **`moveLine`**: siblings are lines in the same section **and the same
  category** (null-aware), so the arrows move a line within its group.
- **`duplicateQuote`**: copies `kind` along with the other line fields.

No migration: the column, its check constraint and the labels all exist.

### 4. Out of scope

- Printing category headings or subtotals on the client PDF.
- Bulk tagging of existing untagged lines (the save-lines-to-rates branch
  tags lines as they are linked to the rate library).
- Moving lines between sections, drag-and-drop, invoice line grouping.

## Error handling

- `kind` is validated by zod against `RATE_KINDS`; the DB check constraint is
  the backstop. A failed save reverts the row's local state and toasts, as
  the other fields do.
- `moveLine` on a line whose group has one member is a no-op (buttons are
  disabled by `isFirst`/`isLast` anyway).

## Testing

- `tests/quote-lines.test.ts`: rank order, null last, stability on equal
  rank, `groupLinesByKind` subtotals and omission of empty groups.
- `tests/quote-lines-grid.test.tsx` (jsdom): renders group headings in order
  with subtotals, skips empty groups, shows the Category select when
  editable and plain text when not, per-group Add line calls `addLine` with
  the group's kind.
- `tests/quote-line-row.test.tsx` (jsdom): the Category select offers the six
  options, a change saves with `kind`, other field saves carry the current
  kind, read-only rows show the label or "—".
- `buildQuotePdfResponse` and the conversion actions fetch from Supabase and
  have no unit harness; their grouped order is the helper's `sortLinesGrouped`
  (unit tested) plus the browser PDF check.
- `npm test`, `npx tsc --noEmit`, `npm run lint` green; browser check on the
  worktree dev server against a real quote.
