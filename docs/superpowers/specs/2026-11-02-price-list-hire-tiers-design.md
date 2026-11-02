# Price list import: one rate per hire-duration tier

**Date:** 2026-11-02 · **Status:** approved by owner ("do the easy version")

## Problem

Hire price lists price the same item at several durations (1 week, 2–4 weeks, 5–8 weeks, per day…).
The PDF reader has room for one `unit_price` per line, a rate item has one `cost`, and the save
step merges lines with the same supplier + name. The Assured Equipment hire import on 2026-11-02
therefore kept one price per item — the longest-hire (cheapest) column — and dropped the rest.

## Design

**One rate item per tier, tier in the name.** No migration, no new screens.

- `ImportLine` gains `tier: string | null` — the heading of the price column the price came from
  (`"1 Week"`, `"5-8 Weeks"`, `"per day"`), null for single-price lines. Spreadsheet rows set null.
- `withTier(name, tier)` (pure, `src/lib/price-list.ts`) builds the stored name:
  `"SMH NPU5000 Negative Pressure Unit (5-8 Weeks)"`. Dashes and whitespace in the tier are
  tidied (`"5 – 8  Weeks"` → `"5-8 Weeks"`) so re-imports match the same item. A name that already
  carries the tier text is left alone.
- `importLinesFromExtraction(lines)` (pure) turns the reader's output into `ImportLine`s: applies
  `withTier`, trims, defaults unit to `ea`, drops unpriced lines. `extractPriceListPdf` calls it.
- PDF reader (`extract-price-list.ts`): the JSON schema gains `tier` (nullable string) and the prompt
  says: when a line is priced under several duration or quantity-break columns, output one line per
  price with `tier` = that column's heading, same code/name/unit across the tiers; the per-unit basis
  (week, day, ea) goes in `unit`; the heading is not repeated in `note`.
- `matchLine`: a **tiered** line matches by supplier + name only (its product code is shared by its
  sibling tiers, so code-first matching would merge them). Untiered lines are unchanged: code first,
  then name.
- Zod `lineSchema` gains `tier`; the review screen's `toImportLine` passes it through. Nothing else
  on the review screen changes — the tier is visible in the name and editable there.

## Consequences

- The quote picker lists the tiers side by side under the item name (same prefix, alphabetical).
- A quote line added from a tiered rate carries the tier in its description, e.g.
  "SMH NPU5000 Negative Pressure Unit (5-8 Weeks)". The line description stays editable.
- Re-importing a supplier whose earlier import had no tiers creates the tiered items as new; the
  "deactivate items missing from this file" tick retires the old single-price ones.
- Spreadsheet imports still take one price column. Multi-column spreadsheets are a later step on
  the column-mapping screen.

## Data fix

The 21 existing Assured Equipment hire items are renamed to show the tier their note revealed
(`"(7 weeks)"`, `"(5-8 weeks)"`) and that phrase is removed from the note, so they stop reading as
the only price until the list is re-imported on the live site.

## Testing

Unit tests in `tests/price-list.test.ts`: `withTier` tidying and no-double-suffix, extraction
mapping keeps one line per tier, tiered lines are not merged by code, untiered matching unchanged.
The reader itself can only be proven live (OpenAI key is prod-only): owner re-uploads the Assured
PDF and checks the review screen before saving.
