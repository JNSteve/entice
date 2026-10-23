# Quote Unit Rate Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fourth pricing display, **Unit rate**, on the Quote PDF dialog that prints one section as `Rate per m2` / `Initial quantity (m2)` / `Other line items` above the usual totals, without changing any stored line or total.

**Architecture:** Three new keys in the quote's saved `pdf_options` (`rate_section_id`, `rate_qty`, `rate_unit`) validated by `pricingDisplaySchema`. `buildPricingModel` grows a `unit_rate` variant shaped like `lump_sum` whose totals rows carry the rate, a quantity text row and the other sections' total. The PDF renderer prints that variant through the lump sum branch. The dialog gets the quote's sections with their sell totals so it can offer a section picker and show the rate live.

**Tech Stack:** Next.js App Router with server actions, Supabase (no migration here), zod 4, React 19, Base UI select/input via shadcn, @react-pdf/renderer, vitest.

Spec: `docs/superpowers/specs/2026-10-23-quote-unit-rate-display-design.md`

## Global Constraints

- No migration. Everything lives in `quotes.pdf_options` jsonb, already free-form.
- Mode key, verbatim: `unit_rate`. Label, verbatim: `Unit rate`.
- Row labels, verbatim: `Rate per {unit}`, `Initial quantity ({unit})`, `Other line items`, `Subtotal (ex GST)`, `GST n%`, `Total inc GST`.
- Refinement message, verbatim: `Quantity is required` (path `rate_qty`).
- Defaults: `rate_section_id: null`, `rate_qty: 0`, `rate_unit: 'm2'`.
- The rate is `round2(ratedSectionTotal / rate_qty)`; the quote totals are never recomputed.
- Templates never offer `unit_rate` as a default mode.
- Run commands from `C:\Users\nickj\Documents\Devman\nexvia`. `npx vitest run <file>` and `npx tsc --noEmit` need no TLS env var; the dev server does (`NODE_EXTRA_CA_CERTS=C:\Users\nickj\norton-ssl-root-ca.pem`).
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Schema keys and the `unit_rate` pricing model

**Files:**
- Modify: `src/lib/quote-doc.ts` (lines 13–45, the pricing display section)
- Modify: `src/lib/quote-pricing.ts` (whole file is 120 lines)
- Test: `tests/quote-pricing.test.ts`

**Interfaces:**
- Produces: `PRICING_MODES` includes `'unit_rate'`; `TEMPLATE_PRICING_MODES: readonly PricingMode[]` (the modes without `unit_rate`); `PricingDisplay` gains `rate_section_id: string | null`, `rate_qty: number`, `rate_unit: string`; `PricingSection.id?: string`; `TotalsRow = { label: string; value: number } | { label: string; text: string }`; `PricingModel` gains `{ mode: 'unit_rate'; totals: TotalsRows; itemLists: { title: string; items: string[] }[] }`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/quote-pricing.test.ts` (and add `pricingDisplaySchema` to the import from `../src/lib/quote-doc`):

```ts
describe('unit_rate', () => {
  const RATED: PricingSection[] = [
    { id: 'sec-1', title: 'Removal', lines: [
      { description: 'Strip AC sheeting', qty: 1, unit: 'ea', unit_sell: 49620.66 },
    ] },
    { id: 'sec-2', title: 'Hazmat Survey', lines: [
      { description: 'Survey', qty: 1, unit: 'ea', unit_sell: 1200 },
    ] },
  ]
  const RATED_TOTALS = { subtotal: 50820.66, gst: 5082.07, gstRate: 10, total: 55902.73 }
  const display = { ...DEFAULT_PRICING, mode: 'unit_rate' as const, rate_section_id: 'sec-1', rate_qty: 1250, rate_unit: 'm2' }

  test('rows: rate to the cent, quantity text, other line items, then GST; totals unchanged', () => {
    const m = buildPricingModel(RATED, RATED_TOTALS, display)
    expect(m.mode).toBe('unit_rate')
    if (m.mode !== 'unit_rate') return
    expect(m.totals.rows).toEqual([
      { label: 'Rate per m2', value: 39.7 },
      { label: 'Initial quantity (m2)', text: '1250 m2' },
      { label: 'Other line items', value: 1200 },
      { label: 'Subtotal (ex GST)', value: 50820.66 },
      { label: 'GST 10%', value: 5082.07 },
    ])
    expect(m.totals.grand).toEqual({ label: 'Total inc GST', value: 55902.73 })
    expect(m.itemLists).toEqual([
      { title: 'Removal', items: ['Strip AC sheeting'] },
      { title: 'Hazmat Survey', items: ['Survey'] },
    ])
  })

  test('no other section with lines: no Other line items row', () => {
    const m = buildPricingModel([RATED[0]], { subtotal: 49620.66, gst: 4962.07, gstRate: 10, total: 54582.73 }, display)
    if (m.mode !== 'unit_rate') return
    expect(m.totals.rows.map((r) => r.label)).toEqual(['Rate per m2', 'Initial quantity (m2)', 'Subtotal (ex GST)', 'GST 10%'])
  })

  test('show_gst false keeps the rate rows and drops subtotal and GST', () => {
    const m = buildPricingModel(RATED, RATED_TOTALS, { ...display, show_gst: false })
    if (m.mode !== 'unit_rate') return
    expect(m.totals.rows.map((r) => r.label)).toEqual(['Rate per m2', 'Initial quantity (m2)', 'Other line items'])
    expect(m.totals.grand.value).toBe(55902.73)
  })

  test('null or unknown rate_section_id falls back to the first section', () => {
    for (const id of [null, 'nope']) {
      const m = buildPricingModel(RATED, RATED_TOTALS, { ...display, rate_section_id: id })
      if (m.mode !== 'unit_rate') return
      expect(m.totals.rows[0]).toEqual({ label: 'Rate per m2', value: 39.7 })
    }
  })

  test('quantity with decimals prints trimmed and the unit prints as typed', () => {
    const m = buildPricingModel(RATED, RATED_TOTALS, { ...display, rate_qty: 12.5, rate_unit: 'lm' })
    if (m.mode !== 'unit_rate') return
    expect(m.totals.rows[0]).toEqual({ label: 'Rate per lm', value: 3969.65 })
    expect(m.totals.rows[1]).toEqual({ label: 'Initial quantity (lm)', text: '12.5 lm' })
  })

  test('list_items false yields no item lists', () => {
    const m = buildPricingModel(RATED, RATED_TOTALS, { ...display, list_items: false })
    if (m.mode !== 'unit_rate') return
    expect(m.itemLists).toEqual([])
  })
})

describe('pricingDisplaySchema and unit_rate', () => {
  test('options saved before unit rate still parse, with the rate defaults filled in', () => {
    const p = pricingDisplaySchema.parse({ mode: 'lump_sum', show_qty_unit: true, list_items: true, show_gst: true, fee_label: 'Fixed fee' })
    expect(p).toMatchObject({ rate_section_id: null, rate_qty: 0, rate_unit: 'm2' })
  })

  test('unit_rate needs a quantity above zero', () => {
    const bad = pricingDisplaySchema.safeParse({ ...DEFAULT_PRICING, mode: 'unit_rate' })
    expect(bad.success).toBe(false)
    if (!bad.success) expect(bad.error.issues[0]?.message).toBe('Quantity is required')
    expect(pricingDisplaySchema.safeParse({ ...DEFAULT_PRICING, mode: 'unit_rate', rate_qty: 95 }).success).toBe(true)
  })
})
```

Also change the leak test's loop to `['lump_sum', 'unit_rate', 'section_totals', 'itemised'] as const` and its display to `{ ...DEFAULT_PRICING, mode, rate_qty: 1 }`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/quote-pricing.test.ts`
Expected: FAIL. Type errors on `mode: 'unit_rate'` and on `id` in `PricingSection`, and the schema tests fail because the keys do not exist.

- [ ] **Step 3: Extend the schema in `src/lib/quote-doc.ts`**

Replace the pricing display section (from `export const PRICING_MODES` through `PRICING_MODE_LABELS`) with:

```ts
export const PRICING_MODES = ['lump_sum', 'unit_rate', 'section_totals', 'itemised'] as const
export type PricingMode = (typeof PRICING_MODES)[number]

/** Modes a template may default to. Unit rate needs a per-quote quantity, so it is picked on the quote. */
export const TEMPLATE_PRICING_MODES: readonly PricingMode[] = PRICING_MODES.filter((m) => m !== 'unit_rate')

export const pricingDisplaySchema = z
  .object({
    mode: z.enum(PRICING_MODES),
    /** itemised / section_totals: print the qty and unit columns. */
    show_qty_unit: z.boolean(),
    /** lump_sum / unit_rate: list line descriptions by section, without numbers. */
    list_items: z.boolean(),
    /** Print subtotal and GST rows above the total. */
    show_gst: z.boolean(),
    /** lump_sum label, e.g. "Fixed fee". */
    fee_label: z.string().trim().min(1, 'Fee label is required').max(60),
    /** unit_rate: quote_sections id the rate is worked out from; null or unknown → the first section. */
    rate_section_id: z.string().nullable().default(null),
    /** unit_rate: the quantity the rated section's total is divided by. */
    rate_qty: z.number().nonnegative().default(0),
    /** unit_rate: unit printed with the rate, as typed (e.g. "m2"). */
    rate_unit: z.string().trim().min(1, 'Unit is required').max(20).default('m2'),
  })
  .superRefine((d, ctx) => {
    if (d.mode === 'unit_rate' && !(d.rate_qty > 0)) {
      ctx.addIssue({ code: 'custom', message: 'Quantity is required', path: ['rate_qty'] })
    }
  })
export type PricingDisplay = z.infer<typeof pricingDisplaySchema>

export const DEFAULT_PRICING: PricingDisplay = {
  mode: 'itemised',
  show_qty_unit: true,
  list_items: true,
  show_gst: true,
  fee_label: 'Fixed fee',
  rate_section_id: null,
  rate_qty: 0,
  rate_unit: 'm2',
}

export const PRICING_MODE_LABELS: Record<PricingMode, string> = {
  lump_sum: 'Lump sum',
  unit_rate: 'Unit rate',
  section_totals: 'Section totals',
  itemised: 'Itemised',
}
```

Keep whatever doc comments the existing fields already have if they differ from the above; only the three new keys, the refinement, the defaults and the label are new.

- [ ] **Step 4: Extend the model in `src/lib/quote-pricing.ts`**

Replace the types and `buildPricingModel` so the file reads:

```ts
import { pct } from '@/lib/format'
import { lineTotal, round2 } from '@/lib/money'
import type { PricingDisplay } from '@/lib/quote-doc'

/**
 * Sell-side pricing view-model for quote PDFs. Input lines carry unit_sell
 * only; the output is a plain object the PDF layer prints without doing
 * arithmetic. Nothing here knows about cost or markup.
 */

export type PricingLine = { description: string; qty: number; unit: string; unit_sell: number }
/** `id` is the quote_sections id; absent for the orphan "Items" group and template samples. */
export type PricingSection = { id?: string; title: string; lines: PricingLine[] }
export type PricingTotals = { subtotal: number; gst: number; gstRate: number; total: number }

/** A money row prints `value` as AUD; a text row prints `text` as given. */
export type TotalsRow = { label: string; value: number } | { label: string; text: string }
export type TotalsRows = {
  rows: TotalsRow[]
  grand: { label: string; value: number }
}

type ItemList = { title: string; items: string[] }

export type PricingModel =
  | {
      mode: 'lump_sum'
      totals: TotalsRows
      itemLists: ItemList[]
    }
  | {
      /** One section priced as rate × quantity; the rest as "Other line items". */
      mode: 'unit_rate'
      totals: TotalsRows
      itemLists: ItemList[]
    }
  | {
      mode: 'section_totals'
      showQtyUnit: boolean
      sections: { title: string; lines: { description: string; qty: string; unit: string }[]; subtotal: number }[]
      totals: TotalsRows
    }
  | {
      mode: 'itemised'
      showQtyUnit: boolean
      sections: {
        title: string
        lines: { description: string; qty: string; unit: string; rate: number; total: number }[]
        subtotal: number
      }[]
      totals: TotalsRows
    }

/** Trim trailing zeros from a qty (numeric 12,3): 2.000 → "2", 1.250 → "1.25". */
export function fmtQty(n: number): string {
  return String(parseFloat(n.toFixed(3)))
}

function sectionSubtotal(section: PricingSection): number {
  return round2(section.lines.reduce((sum, l) => sum + lineTotal(l.qty, l.unit_sell), 0))
}

function totalsRows(t: PricingTotals, showGst: boolean, subtotalLabel: string): TotalsRows {
  const grand = { label: 'Total inc GST', value: t.total }
  if (!showGst) return { rows: [], grand }
  return {
    rows: [
      { label: subtotalLabel, value: t.subtotal },
      { label: `GST ${pct(t.gstRate)}`, value: t.gst },
    ],
    grand,
  }
}

function itemLists(sections: PricingSection[], display: PricingDisplay): ItemList[] {
  return display.list_items
    ? sections.map((s) => ({ title: s.title, items: s.lines.map((l) => l.description) }))
    : []
}

/**
 * Rate rows for unit_rate: the rated section's total over the typed quantity,
 * rounded to the cent. The quote totals are printed as they are; the few
 * cents between rate × quantity and the section total are not reconciled.
 */
function unitRateRows(sections: PricingSection[], totals: PricingTotals, display: PricingDisplay): TotalsRows {
  const rated = sections.find((s) => s.id === display.rate_section_id) ?? sections[0]
  const ratedTotal = rated ? sectionSubtotal(rated) : 0
  const unit = display.rate_unit
  const rows: TotalsRow[] = [
    { label: `Rate per ${unit}`, value: display.rate_qty > 0 ? round2(ratedTotal / display.rate_qty) : 0 },
    { label: `Initial quantity (${unit})`, text: `${fmtQty(display.rate_qty)} ${unit}` },
  ]
  if (sections.some((s) => s !== rated && s.lines.length > 0)) {
    rows.push({ label: 'Other line items', value: round2(totals.subtotal - ratedTotal) })
  }
  const gst = totalsRows(totals, display.show_gst, 'Subtotal (ex GST)')
  return { rows: [...rows, ...gst.rows], grand: gst.grand }
}

export function buildPricingModel(
  sections: PricingSection[],
  totals: PricingTotals,
  display: PricingDisplay
): PricingModel {
  switch (display.mode) {
    case 'lump_sum':
      return {
        mode: 'lump_sum',
        totals: totalsRows(totals, display.show_gst, `${display.fee_label} (ex GST)`),
        itemLists: itemLists(sections, display),
      }
    case 'unit_rate':
      return {
        mode: 'unit_rate',
        totals: unitRateRows(sections, totals, display),
        itemLists: itemLists(sections, display),
      }
    case 'section_totals':
      return {
        mode: 'section_totals',
        showQtyUnit: display.show_qty_unit,
        sections: sections.map((s) => ({
          title: s.title,
          lines: s.lines.map((l) => ({ description: l.description, qty: fmtQty(l.qty), unit: l.unit })),
          subtotal: sectionSubtotal(s),
        })),
        totals: totalsRows(totals, display.show_gst, 'Subtotal (ex GST)'),
      }
    case 'itemised':
      return {
        mode: 'itemised',
        showQtyUnit: display.show_qty_unit,
        sections: sections.map((s) => ({
          title: s.title,
          lines: s.lines.map((l) => ({
            description: l.description,
            qty: fmtQty(l.qty),
            unit: l.unit,
            rate: l.unit_sell,
            total: lineTotal(l.qty, l.unit_sell),
          })),
          subtotal: sectionSubtotal(s),
        })),
        totals: totalsRows(totals, display.show_gst, 'Subtotal (ex GST)'),
      }
  }
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run tests/quote-pricing.test.ts`
Expected: PASS, all tests including the four pre-existing describe blocks.

- [ ] **Step 6: Commit**

```bash
git add src/lib/quote-doc.ts src/lib/quote-pricing.ts tests/quote-pricing.test.ts
git commit -m "feat(quotes): unit_rate pricing display option and model rows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Print the rate rows on the PDF

**Files:**
- Modify: `src/pdf/quote-pricing.tsx` (`Totals` ~line 55, the lump sum branch ~line 85)
- Modify: `src/pdf/build-quote-pdf.tsx` (`pdfSections` ~line 97)
- Test: `tests/quote-doc-pdf.test.tsx` (mode loop, line 31), `tests/quote-pdf.test.tsx` (mode loop, line 13)

**Interfaces:**
- Consumes: `TotalsRow` text rows and the `unit_rate` model from Task 1.
- Produces: `QuotePdfSection` objects carry `id` for real sections.

- [ ] **Step 1: Extend the two PDF render tests**

In `tests/quote-doc-pdf.test.tsx` change the loop to:

```ts
for (const mode of ['lump_sum', 'unit_rate', 'section_totals', 'itemised'] as const) {
  test(`templated quote renders in ${mode} mode`, async () => {
    const buffer = await renderToBuffer(
      <QuoteDocPdf
        quote={{ number: 'RQ26003', title: 'Unexpected find, Port Drive', date: '26/08/2026' }}
        company={company}
        doc={doc()}
        details={details}
        pricing={buildPricingModel(sections, totals, { ...DEFAULT_PRICING, mode, rate_qty: 95 })}
        quoteFooter="Fine print"
      />
    )
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
    expect(buffer.length).toBeGreaterThan(1000)
  })
}
```

In `tests/quote-pdf.test.tsx` change the loop header to `for (const mode of ['itemised', 'section_totals', 'lump_sum', 'unit_rate'] as const)` and the display prop to `display={{ ...DEFAULT_PRICING, mode, fee_label: 'Fixed fee', rate_qty: 95 }}`.

- [ ] **Step 2: Run them to see the unit_rate cases fail**

Run: `npx vitest run tests/quote-doc-pdf.test.tsx tests/quote-pdf.test.tsx`
Expected: the `unit_rate` cases FAIL (the renderer's final branch treats the model as itemised and reads `model.sections`, which is undefined), the others PASS.

- [ ] **Step 3: Teach the renderer the text row and the new mode**

In `src/pdf/quote-pricing.tsx`, `Totals` prints each row as:

```tsx
      {totals.rows.map((r, i) => (
        <View key={i} style={totalsStyles.row}>
          <Text style={totalsStyles.label}>{r.label}</Text>
          <Text style={totalsStyles.value}>{'text' in r ? r.text : aud(r.value)}</Text>
        </View>
      ))}
```

and the lump sum branch of `PricingBlock` opens with:

```tsx
  if (model.mode === 'lump_sum' || model.mode === 'unit_rate') {
    // What the price covers reads first; the money is the conclusion.
```

- [ ] **Step 4: Pass section ids from the PDF builder**

In `src/pdf/build-quote-pdf.tsx` the `pdfSections` map becomes:

```ts
  const pdfSections: QuotePdfSection[] = (sections ?? [])
    .map((s) => ({
      id: s.id as string,
      title: s.title as string,
      lines: allLines.filter((l) => l.section_id === s.id),
    }))
    .filter((s) => s.lines.length > 0)
```

The orphan `Items` push stays without an id.

- [ ] **Step 5: Run the PDF tests to see them pass**

Run: `npx vitest run tests/quote-doc-pdf.test.tsx tests/quote-pdf.test.tsx`
Expected: PASS.

- [ ] **Step 6: Render a sample to look at**

Write a throwaway test at `tests/zz-render-unit-rate.test.tsx` (deleted again at the end of this step, never committed):

```tsx
import { test } from 'vitest'
import { writeFileSync } from 'node:fs'
import { renderToBuffer } from '@react-pdf/renderer'
import { QuotePdf } from '../src/pdf/QuotePdf'
import { DEFAULT_PRICING } from '../src/lib/quote-doc'

test('render unit rate sample', async () => {
  const buffer = await renderToBuffer(
    <QuotePdf
      quote={{ number: 'RQ26026', title: 'Captain Cook Tavern', date: '23/10/2026', clientName: 'Acme', contactName: 'Dan', siteName: 'Captain Cook Tavern', siteAddress: '1 Site Rd' }}
      company={{ name: 'Test Civil Pty Ltd', abn: '11 222 333 444', address: '1 Test St', phone: null, email: null, logoUrl: undefined }}
      sections={[
        { id: 's1', title: 'Section 1', lines: [{ description: 'Strip AC sheeting', qty: 1, unit: 'ea', unit_sell: 49620.66 }] },
        { id: 's2', title: 'Hazmat Survey', lines: [{ description: 'Survey', qty: 1, unit: 'ea', unit_sell: 1200 }] },
      ]}
      totals={{ subtotal: 50820.66, gst: 5082.07, gstRate: 10, total: 55902.73 }}
      validDays={14}
      display={{ ...DEFAULT_PRICING, mode: 'unit_rate', rate_section_id: 's1', rate_qty: 1250, rate_unit: 'm2' }}
    />
  )
  writeFileSync('C:/Users/nickj/AppData/Local/Temp/claude/C--Users-nickj-Documents-Devman-nexvia/10de77d5-9c82-44a5-8704-ea3f19ab96cd/scratchpad/unit-rate-sample.pdf', buffer)
})
```

Run: `npx vitest run tests/zz-render-unit-rate.test.tsx`, open the PDF with the Read tool (`pages: "1"`), confirm the rows read `Rate per m2 $39.70`, `Initial quantity (m2) 1250 m2`, `Other line items $1,200.00`, `Subtotal (ex GST) $50,820.66`, `GST 10% $5,082.07`, `Total inc GST $55,902.73`. Then delete `tests/zz-render-unit-rate.test.tsx`.

- [ ] **Step 7: Commit**

```bash
git add src/pdf/quote-pricing.tsx src/pdf/build-quote-pdf.tsx tests/quote-doc-pdf.test.tsx tests/quote-pdf.test.tsx
git commit -m "feat(quotes): PDF prints the unit rate rows; sections carry their id

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Dialog fields, section sell totals, template select

**Files:**
- Modify: `src/app/(office)/quotes/[id]/quote-pdf-dialog.tsx` (props ~line 36, mode select ~line 167, the lump sum branch ~line 186)
- Modify: `src/app/(office)/quotes/[id]/quote-builder.tsx` (the `QuotePdfDialog` render, line 431)
- Modify: `src/app/(office)/settings/quote-templates-section.tsx` (the mode select, line 521; the import, line 41)

**Interfaces:**
- Consumes: `PricingDisplay.rate_*`, `TEMPLATE_PRICING_MODES` from Task 1.
- Produces: `QuotePdfDialog` prop `sections: PdfDialogSection[]` with `export type PdfDialogSection = { id: string; title: string; sell: number }`.

No unit test: the dialog has no harness and its Base UI select is awkward under jsdom. Task 4 checks it in the browser.

- [ ] **Step 1: Add the prop and the rate fields to the dialog**

In `src/app/(office)/quotes/[id]/quote-pdf-dialog.tsx`:

Imports: add `import { aud } from '@/lib/format'` and `import { round2 } from '@/lib/money'`.

Below the `STANDARD` constant:

```ts
/** A quote section with its sell total (ex GST), for the rated section picker. */
export type PdfDialogSection = { id: string; title: string; sell: number }
```

Props:

```tsx
export function QuotePdfDialog({
  quote,
  templates,
  sections,
  editable,
}: {
  quote: QuoteData
  templates: TemplateOption[]
  sections: PdfDialogSection[]
  editable: boolean
}) {
```

State, after `const [confirmSwitch, ...]`:

```ts
  // The quantity is typed as text so "0." and "12." survive the keystroke.
  const [qtyText, setQtyText] = useState(
    (quote.pdf_options?.rate_qty ?? 0) > 0 ? String(quote.pdf_options?.rate_qty) : ''
  )
```

Above `const mode = display.mode`:

```ts
  const rated = sections.find((s) => s.id === display.rate_section_id) ?? sections[0]
  const ratePreview =
    rated && display.rate_qty > 0
      ? `= ${aud(round2(rated.sell / display.rate_qty))} per ${display.rate_unit || 'unit'}`
      : 'Enter a quantity'
```

The template pick (`setDisplay(picked.pricing_defaults)`) also resets the text: add `setQtyText('')` right after it (template defaults never carry a quantity).

Mode select `onValueChange`:

```tsx
                onValueChange={(v) => {
                  if (!v) return
                  const next = v as PricingDisplay['mode']
                  const known = sections.some((s) => s.id === display.rate_section_id)
                  patch(
                    next === 'unit_rate' && !known
                      ? { mode: next, rate_section_id: sections[0]?.id ?? null }
                      : { mode: next }
                  )
                }}
```

Mode items:

```tsx
                  {PRICING_MODES.map((m) => (
                    <SelectItem key={m} value={m} disabled={m === 'unit_rate' && sections.length === 0}>
                      {PRICING_MODE_LABELS[m]}
                    </SelectItem>
                  ))}
```

Replace the `{mode === 'lump_sum' ? (...) : (...)}` block with:

```tsx
            {mode === 'lump_sum' && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qp-fee">Fee label</Label>
                <Input
                  id="qp-fee"
                  value={display.fee_label}
                  onChange={(e) => patch({ fee_label: e.target.value })}
                  disabled={!editable}
                />
              </div>
            )}
            {mode === 'unit_rate' && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="qp-rated">Rated section</Label>
                  <Select
                    value={rated?.id ?? ''}
                    onValueChange={(v) => v && patch({ rate_section_id: v })}
                    disabled={!editable}
                  >
                    <SelectTrigger id="qp-rated" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sections.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="qp-qty">Quantity</Label>
                    <Input
                      id="qp-qty"
                      type="number"
                      min={0}
                      step="0.001"
                      value={qtyText}
                      onChange={(e) => {
                        setQtyText(e.target.value)
                        patch({ rate_qty: Number(e.target.value) || 0 })
                      }}
                      disabled={!editable}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="qp-unit">Unit</Label>
                    <Input
                      id="qp-unit"
                      value={display.rate_unit}
                      onChange={(e) => patch({ rate_unit: e.target.value })}
                      disabled={!editable}
                    />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground tabular-nums">{ratePreview}</p>
              </>
            )}
            {mode === 'lump_sum' || mode === 'unit_rate' ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={display.list_items}
                  onCheckedChange={(c) => patch({ list_items: Boolean(c) })}
                  disabled={!editable}
                />
                List included items (no prices)
              </label>
            ) : (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={display.show_qty_unit}
                  onCheckedChange={(c) => patch({ show_qty_unit: Boolean(c) })}
                  disabled={!editable}
                />
                Show qty and unit columns
              </label>
            )}
```

- [ ] **Step 2: Pass the sections with sell totals from the builder**

In `src/app/(office)/quotes/[id]/quote-builder.tsx`, import the type: `import { QuotePdfDialog, type PdfDialogSection } from './quote-pdf-dialog'`. Inside `QuoteBuilder`, next to the other derived values (just before the `return`), add:

```ts
  const pdfSections: PdfDialogSection[] = sections.map((s) => ({
    id: s.id,
    title: s.title,
    sell: round2(
      lines
        .filter((l) => l.section_id === s.id)
        .reduce((sum, l) => sum + lineTotal(l.qty, l.unit_sell), 0)
    ),
  }))
```

(`round2` and `lineTotal` are already imported on line 23.) Then render:

```tsx
            <QuotePdfDialog quote={quote} templates={templates} sections={pdfSections} editable={editable} />
```

- [ ] **Step 3: Keep Unit rate out of the template defaults**

In `src/app/(office)/settings/quote-templates-section.tsx`, import `TEMPLATE_PRICING_MODES` alongside `PRICING_MODES` (drop `PRICING_MODES` from the import if nothing else uses it) and map the select over it:

```tsx
                {TEMPLATE_PRICING_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {PRICING_MODE_LABELS[m]}
                  </SelectItem>
                ))}
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit` then `npx eslint "src/app/(office)/quotes/[id]/quote-pdf-dialog.tsx" "src/app/(office)/quotes/[id]/quote-builder.tsx" "src/app/(office)/settings/quote-templates-section.tsx" src/lib/quote-doc.ts src/lib/quote-pricing.ts src/pdf/quote-pricing.tsx src/pdf/build-quote-pdf.tsx`
Expected: no output from either.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(office)/quotes/[id]/quote-pdf-dialog.tsx" "src/app/(office)/quotes/[id]/quote-builder.tsx" "src/app/(office)/settings/quote-templates-section.tsx"
git commit -m "feat(quotes): Unit rate option on the PDF dialog with section, quantity and unit

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Full verification

**Files:** none changed unless something fails.

- [ ] **Step 1: Whole suite**

Run: `npx vitest run`
Expected: all green (the suite had no failures before this work).

- [ ] **Step 2: Browser check of the dialog**

Start the dev server with `preview_start` (name from `.claude/launch.json`); it needs `NODE_EXTRA_CA_CERTS`. If an office login is available, open `/quotes/53f5bc18-c1c6-4baf-82c9-dde31e4eabde` (Captain Cook Tavern), press PDF, pick Unit rate, confirm: Rated section defaults to Section 1, Quantity blank shows `Enter a quantity`, typing `1250` shows `= $39.70 per m2`, Open PDF opens a PDF whose totals block shows the six rows. Do not leave the quote changed: set it back to Lump sum and Open PDF again, or check the row in the DB afterwards:

`select pdf_options from quotes where id = '53f5bc18-c1c6-4baf-82c9-dde31e4eabde'`

If no office login is available, the Task 2 Step 6 sample PDF is the render proof and the owner clicks through on production.

- [ ] **Step 3: Push**

```bash
git push origin main
```

Then confirm the Vercel deployment id changed:

```bash
curl -k -s "https://entice-pink.vercel.app/login?v=$(date +%s)" | grep -o 'dpl_[A-Za-z0-9]*'
```
