# User-defined rate categories

**Date:** 2026-11-03 · **Status:** building on `feat/rate-categories` · **Migration:** 0077

## Problem

Rate items, quote lines and invoice lines each carry a `kind` (Labour, Plant & equipment,
Materials, Consumables, Subcontract, Other). The set is fixed three times over: a `check`
constraint on each table, a zod enum, and hard-coded label maps in the UI. The owner wants to
add their own categories (waste disposal, permits and fees, air monitoring, transport…) without
a code change.

## Decision

- Categories live in a new table, `rate_kinds`, seeded with the six built-ins. An admin adds,
  renames and removes categories from **Settings → Rates → Categories**.
- A custom category behaves like a built-in everywhere a kind is chosen or grouped: the rates
  list and its filters, the rate item dialog, CSV and price-list imports, the quote builder
  (line category select, rate picker, section group headings, cost breakdown), the invoice line
  kind select, and the Xero income-account mapping.
- Built-ins keep their keys (code depends on them for the P&L cost category, Xero mapping and
  the consumable → material rule on quotes) but their **labels** can be renamed. They cannot be
  deleted.
- A custom category can be deleted only while nothing uses it. The database enforces this with
  foreign keys; the UI explains the refusal.
- Order is fixed and needs no server round-trip: built-ins in their current order, then custom
  categories alphabetically by key, then Uncategorised. No reorder UI.

## Design

### Schema (`supabase/migrations/0077_rate_kinds.sql`)

```sql
create table rate_kinds (
  key        text primary key,
  label      text not null,
  builtin    boolean not null default false,
  created_at timestamptz not null default now(),
  constraint rate_kinds_key_check   check (key ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  constraint rate_kinds_label_check check (length(btrim(label)) between 1 and 40)
);
```

- Seed: `labour` Labour, `plant` Plant & equipment, `material` Materials, `consumable`
  Consumables, `subbie` Subcontract, `other` Other — all `builtin = true`.
- RLS: select for any signed-in user; insert/update/delete for `admin` (mirrors
  `cost_codes`, one role tighter).
- `rate_items.kind`, `quote_lines.kind` and `invoice_lines.kind` lose their `check` constraints
  and gain `references rate_kinds(key) on update cascade` (delete is the default *restrict*,
  which is what refuses deleting a category in use).
- History row `('20261103090000', '0077_rate_kinds', …)` as in 0076.

### Library

- **`src/lib/rate-kinds.ts`** (pure, importable from client code):
  - `BUILTIN_RATE_KINDS`: the six rows above, in display order.
  - `RateKindRow { key; label; builtin }`.
  - `slugKey(label)`: lower-case, spaces and punctuation to `-`, trimmed to 40 chars; `''`
    when nothing is left.
  - `sortRateKinds(rows)`: built-ins in `BUILTIN_RATE_KINDS` order (whatever the DB returns),
    then the rest by key.
  - `compareKinds(a, b)`: the same order for two kind keys, with `null`/unknown last.
    `quote-lines.ts` uses it so sorting needs no catalog.
  - `kindLabel(kind, rows)`: the row's label, else the raw key, else `Uncategorised`.
  - `quoteLineKinds(rows)`: rows minus `consumable` — what quote and invoice line selects
    offer (quotes still store a consumable rate as `material`, via `quoteKind`).
- **`src/lib/rate-kinds-queries.ts`** (server): `loadRateKinds(supabase)` → sorted rows;
  falls back to `BUILTIN_RATE_KINDS` when the query fails (table not yet migrated), so the
  app keeps working between deploy and migration.
- **`src/lib/quote-lines.ts`**: `lineKindRank` is replaced by `compareKinds`;
  `lineKindLabel(kind, kinds?)`, `groupLinesByKind(lines, kinds?)` take the catalog for labels.
  `LINE_KIND_ORDER` and `LINE_KIND_LABELS` stay as the built-in defaults.
- **`src/lib/price-list.ts`**: `PRICE_KINDS`/`PRICE_KIND_LABELS` stay for built-in parsing
  (`parseKind`, extraction) and as the default catalog. `kindToCategory` maps any unknown kind
  to `other`; `quoteKind` passes custom kinds through unchanged.
- **`src/lib/zod.ts`**: `rateKindKey = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/)`
  replaces every `z.enum(RATE_KINDS)` / `z.enum([...RATE_KINDS, 'consumable'])` on rate items,
  the CSV import, quote line create/update, invoice line update and the Xero mapping record.
  `RATE_KINDS` / `RateKind` remain for the built-in mappings. New `rateKindLabel` schema
  (1–40 chars trimmed) and `rateKindCreateSchema { label }`, `rateKindRenameSchema { key, label }`.

### Server actions (`src/app/(office)/settings/actions.ts`, admin only)

- `createRateKind({ label })`: key = `slugKey(label)`; refuses an empty slug ("Use letters or
  numbers in the name") and a taken key ("A category with that name already exists").
- `renameRateKind({ key, label })`: updates the label only.
- `deleteRateKind(key)`: refuses a built-in; on FK violation (`23503`) returns
  "That category is still used by rates or lines. Move them first."
- `upsertRateItem` / `importRateItems` check the kind against `loadRateKinds` and refuse an
  unknown one with "Unknown category" rather than surfacing the FK error.
- All revalidate `/settings`.

### UI

- **Settings → Rates.** A "Categories" outline button beside "Import CSV" opens
  `RateKindsDialog` (`settings/rate-kinds-dialog.tsx`): one row per category — label (click
  pencil to edit inline, Enter/blur saves), a "Built-in" badge or a trash button — and an
  "Add category" input + button at the bottom. The kind filter, the rate item dialog's Kind
  select, the CSV import's kind validation (accepts a key or a label, case-insensitive, stores
  the key) and `PriceListImport`'s "Whole file" / per-line selects all list the catalog.
  `PriceListImport` takes an optional `rateKinds` prop defaulting to the built-ins (the job
  P&L import keeps the default).
- **Quote builder.** `quotes/[id]/page.tsx` loads the catalog and passes `rateKinds` to
  `QuoteBuilder` → `SectionCard` → `LinesGrid` (group labels) → `LineRow` (category select
  lists `quoteLineKinds`), `RatePickerDialog` (filter and group headings; unknown kinds
  already fell back to the raw key) and `TotalsCard` (breakdown labels, grouped with
  `compareKinds`). Every prop is optional and defaults to the built-ins so existing tests and
  callers keep working.
- **Invoice editor.** `invoices/[id]/page.tsx` loads the catalog; the line kind select shows
  labels instead of raw keys and lists custom categories.
- **Settings → Xero.** The "… lines" account mapping lists every catalog kind except
  consumable, labelled from the catalog. Existing mapping JSON is unchanged.

### Not changed

Cost codes, P&L cost categories (`costs.category`), daily sign-off sections, the client quote
PDF (prints no headings; its order follows `compareKinds`), the takeoff push, the supplier
price-list extraction prompt, and `fresh-install.sql`.

### Known limits

- The P&L cost-line dialog searches the price list by P&L category; items in a custom category
  fall under "Other", whose search is hidden, so they are typed by hand there.
- Renaming a built-in's label is purely cosmetic; its key still drives P&L and Xero.

## Tests

- `tests/rate-kinds.test.ts`: `slugKey` cases; `sortRateKinds` puts built-ins first in fixed
  order then custom by key; `compareKinds` ranks built-in < custom < null; `kindLabel` falls
  back to the key then Uncategorised; `quoteLineKinds` drops consumable.
- `tests/quote-lines.test.ts`: `sortLinesGrouped` places a custom kind after `other` and before
  null; `groupLinesByKind(lines, kinds)` labels a custom group from the catalog.
- `tests/line-row.test.tsx`: the category select lists a custom kind passed in `rateKinds`.
- `tests/rate-picker-dialog.test.tsx`: a custom kind groups under its catalog label.
- Existing tests keep passing with the defaults.

## Rollout

1. Build and test on `feat/rate-categories`; `npx tsc --noEmit` and `npx vitest run` clean.
2. Owner pastes `0077_rate_kinds.sql` into the Supabase SQL editor (local dev reads the live
   database, so the Categories dialog cannot be exercised before this).
3. Browser check in the dev server: add a category, rename it, see it in the rates filter, the
   rate dialog, a quote line select and a rate picker group, delete it while unused, confirm the
   in-use refusal.
4. Fast-forward `main`, push, confirm the Vercel deployment id.
