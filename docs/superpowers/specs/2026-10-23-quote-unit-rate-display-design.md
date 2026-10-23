# Unit rate pricing display on the quote PDF

**Date:** 2026-10-23 · **Status:** approved, building on `main` · **Migration:** none

## Problem

Some clients want the price as a rate per square metre (or another unit) rather than a fixed fee.
Captain Cook Tavern (RQ26026) is the live case: Section 1 (the removal) is to be quoted as $/m²,
while the Hazmat Survey section stays a fixed fee. The Quote PDF dialog offers three pricing
displays (lump sum, section totals, itemised) and each applies to the whole quote.

## Decision (owner, 2026-10-23)

- **Display only.** The builder lines, the quote total, job and project budgets, claims and Xero
  are not touched. Nothing is stored on the lines or sections.
- **One rated section.** The rate is that section's sell total divided by a quantity typed in the
  PDF dialog, rounded to the cent. The quote total stays the sum of the lines; the few cents or
  dollars between `rate × quantity` and the section total are not reconciled.
- **Printed rows**, in the owner's wording: `Rate per m2`, `Initial quantity (m2)`,
  `Other line items`, then the usual totals.

## Design

### Pricing display options (`src/lib/quote-doc.ts`)

- `PRICING_MODES` gains `'unit_rate'` (label **Unit rate**), listed after lump sum.
- `pricingDisplaySchema` gains three keys. Each has a default so options saved before this change,
  and template defaults, still parse:
  - `rate_section_id: string | null`, default `null`. The `quote_sections` id of the rated
    section. `null`, or an id not on the quote, means the first printed section.
  - `rate_qty: number`, ≥ 0, default `0`. The quantity the rated section is divided by.
  - `rate_unit: string`, trimmed, 1–20 characters, default `'m2'`. Printed as typed.
  - A refinement on the whole object: when `mode === 'unit_rate'`, `rate_qty` must be > 0, with
    the message `Quantity is required` on the `rate_qty` path.
- `DEFAULT_PRICING` carries the three defaults.
- Templates do not offer Unit rate as a default pricing display, because it needs a per-quote
  quantity. The settings select in `quote-templates-section.tsx` lists `PRICING_MODES` without
  `unit_rate`. The template preview route is unchanged (it can never receive that mode).

### Pricing model (`src/lib/quote-pricing.ts`)

- `PricingSection` gains an optional `id`. `build-quote-pdf.tsx` passes each section's id; the
  orphan "Items" pseudo-section and the template preview's samples have none.
- `TotalsRows.rows` becomes a union: `{ label; value: number }` printed as money, or
  `{ label; text: string }` printed as given. Existing rows are unchanged.
- New model variant `{ mode: 'unit_rate'; totals: TotalsRows; itemLists }`, the same shape as
  `lump_sum`. Built as:
  - `rated` = the section whose `id` equals `rate_section_id`, else the first section.
  - `rate` = `round2(sectionSubtotal(rated) / rate_qty)`.
  - `others` = `round2(totals.subtotal − sectionSubtotal(rated))`.
  - rows, in order: `Rate per {unit}` → `rate`; `Initial quantity ({unit})` →
    text `{fmtQty(rate_qty)} {unit}`; `Other line items` → `others`, only when a section other
    than `rated` has at least one line; then, when `show_gst`, `Subtotal (ex GST)` and
    `GST n%`. Grand row `Total inc GST`, as every mode.
  - `itemLists` exactly as lump sum: every section's descriptions when `list_items`, else none.
  - A quote with no sections prints a rate of `$0.00`; the dialog does not offer Unit rate in
    that case, so this is only a guard.

### PDF renderer (`src/pdf/quote-pricing.tsx`)

- The lump sum branch of `PricingBlock` also handles `unit_rate`: item lists, then the totals
  block. No other layout change.
- `Totals` prints a `text` row as its text, right-aligned like the money rows.

### Dialog (`src/app/(office)/quotes/[id]/quote-pdf-dialog.tsx`)

- New prop `sections: { id: string; title: string; sell: number }[]`. The builder computes
  `sell` as `round2` of the sum of `lineTotal(qty, unit_sell)` over the section's lines, in
  builder order, and passes it where it renders `QuotePdfDialog`.
- **Unit rate** appears in the Pricing display select, disabled when the quote has no sections.
- With Unit rate selected, three fields replace the Fee label:
  - **Rated section**: a select of the quote's sections. It shows the saved id when that id is on
    the quote, else the first section.
  - **Quantity**: a number input (`min 0`, `step 0.001`).
  - **Unit**: a text input, default `m2`.
  - Under them a muted line reads `= $90.00 per m2` (the rated section's `sell ÷ quantity`,
    rounded to the cent), or `Enter a quantity` while the quantity is 0 or blank.
  - The **List included items (no prices)** checkbox stays, shared with lump sum.
- Picking Unit rate sets `rate_section_id` to the first section's id when the saved one is not on
  this quote, so the saved options always name a real section.
- **Open PDF** saves through `updateQuotePdfOptions` as today. A blank quantity is refused by the
  schema refinement and shown as the existing error toast.
- A frozen quote shows the fields disabled, as the other fields are today.

### Not changed

Builder lines and totals, the client portal (it renders the same saved options through the same
builder), Xero, job and project conversion, template wording, the standard `QuotePdf` layout
beyond receiving section ids.

## Tests

`tests/quote-pricing.test.ts`:

1. Unit rate with a rated section and another section: rows are rate, quantity text, other line
   items, subtotal, GST; grand total unchanged; `itemLists` as lump sum.
2. The rate rounds to the cent (`49620.66 / 1250` → `39.7`).
3. No other section with lines: no `Other line items` row.
4. `show_gst: false` keeps the rate and quantity rows and drops subtotal and GST.
5. `rate_section_id` of `null` or an unknown id uses the first section.
6. The cost and markup leak check loops over `unit_rate` too.

`tests/quote-doc-pdf.test.tsx`: the mode loop includes `unit_rate` with a quantity.

The dialog has no test harness today and its Base UI select is awkward under jsdom; the dialog is
checked in the browser against the Captain Cook quote.

## Out of scope

Storing the quantity on the section, more than one rated section, editing the row labels, a rate
typed by the user, reconciling the rounding gap, templates defaulting to Unit rate.

## Rollout

No migration. Merge to main; Vercel deploys. The owner opens Captain Cook Tavern → PDF, picks
Unit rate, Section 1, the area in m², and opens the PDF.
