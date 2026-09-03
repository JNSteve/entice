# Quote templates — design

Date: 2026-09-02
Status: implemented 2026-09-03 (plan: docs/superpowers/plans/2026-09-02-quote-templates.md)

## 1. Goal

Let ECR keep a library of quote document templates (asbestos removal, mould
remediation, site inspection, …) in Settings, pick one per quote, and control
how pricing is presented on the PDF. Templates are loaded by uploading an
existing quote PDF; the app reads it and turns it into a structured template
that renders through the platform's branded PDF engine.

Cost price and markup never appear on any quote PDF. The PDF dialog only
controls how the sell side is presented.

## 2. Decisions already made

- **Structured templates, not file fill.** PDFs are fixed pages and cannot
  reflow to fit a different number of line items; the host has no Word engine.
  Templates are structured records rendered by `@react-pdf/renderer` inside the
  shared `DocShell`, so logo, page numbers, portal watermark and the online
  acceptance block keep working.
- **Upload a PDF to create a template.** The app extracts the document with the
  same OpenAI (`gpt-5`) file-input pattern already used for survey-report
  takeoff extraction (`src/lib/extract-takeoff.ts`), swaps job-specific details
  for merge fields, and shows the result for a one-off review before saving.
- **Sell side only, always.** No cost or markup on this document in any mode,
  office or portal. Internal costing stays in the builder screen and the
  Takeoff schedule PDF.
- **The chosen template and display options are saved on the quote**, so the
  office PDF and the portal copy are the same document, and a sent quote does
  not change when a template is later edited.

## 3. Reference document

`RQ26003_Port of Brisbane_August 2026.pdf` (two pages). Structure:

1. Header: doc type "Quotation", service heading, job line.
2. Details block: quote no, issue date, prepared for (client, ABN, contact and
   role, address, email, phone), project, site, prepared by (PM, position,
   company, ABN, address), validity.
3. Numbered sections: Scope and Deliverables (intro paragraph + two-column
   table), Fixed Fee (fee ex GST, GST, total inc GST, note), Key Assumptions
   (bullets), Exclusions (bullets), Variations (two-column rate table), Client
   Responsibilities (bullets), Standard Terms (two-column table), Acceptance
   (paragraph + sign block: accepted by, company and PO no, signature, date).

Every one of these maps to a block type below.

## 4. Template model

### 4.1 `quote_templates` table (migration `0061_quote_templates.sql`)

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text not null | picker label, e.g. "Asbestos inspection" |
| doc_title | text not null default 'Quotation' | `DocShell` title |
| heading | text | service heading under the title, e.g. "Asbestos Inspection, Sampling and Close-out" |
| validity_text | text not null | default `{{quote.valid_days}} days from issue unless otherwise stated` |
| number_headings | boolean not null default true | "1. Scope…" numbering |
| blocks | jsonb not null default '[]' | ordered `DocBlock[]`, see 4.2 |
| pricing_defaults | jsonb not null | `PricingDisplay`, see 4.3 |
| is_default | boolean not null default false | partial unique index: one default among active rows |
| active | boolean not null default true | inactive templates are hidden from pickers |
| source_path, source_filename | text | uploaded PDF kept in the `attachments` bucket under `quote-templates/` |
| created_by | uuid references profiles | |
| created_at, updated_at | timestamptz | |

RLS: `select` for `current_app_role() in ('admin','office')`; insert/update/
delete for `admin` only. Server actions also gate with `requireRole('admin')`.

### 4.2 Blocks (`src/lib/quote-doc.ts`, zod-validated)

```ts
type DocBlock =
  | { id; type: 'text';       heading: string; body: string }                 // paragraphs split on blank lines
  | { id; type: 'bullets';    heading: string; items: string[] }
  | { id; type: 'table';      heading: string; intro?: string;
                              columns: [string, string]; rows: { label: string; value: string }[] }
  | { id; type: 'pricing';    heading: string; note?: string }                // exactly one per template
  | { id; type: 'acceptance'; heading: string; body: string }                 // at most one
```

Rules enforced by the schema: exactly one `pricing` block, at most one
`acceptance` block, headings required, every `{{token}}` must be a known merge
field (unknown tokens are rejected at save time with the list of valid ones).

### 4.3 Pricing display (`PricingDisplay`)

```ts
type PricingDisplay = {
  mode: 'lump_sum' | 'section_totals' | 'itemised'
  show_qty_unit: boolean   // itemised / section_totals: qty and unit columns
  list_items: boolean      // lump_sum: list line descriptions by section, no prices
  show_gst: boolean        // ex GST / GST / inc GST rows; false = single inc-GST line
  fee_label: string        // lump_sum label, default "Fixed fee"
}
```

Global default when a quote has no template and no saved options:
`itemised`, qty/unit on, GST on. This is the current PDF, unchanged.

What each mode prints:

- **lump_sum** — `fee_label` and the ex-GST total, GST line, total inc GST
  (subject to `show_gst`), the block's note, and optionally the line
  descriptions grouped by section with no numbers.
- **section_totals** — one table per section with description (and qty/unit if
  enabled), no per-line rate or total, a section subtotal row, then the totals.
- **itemised** — the current table: description, qty, unit, rate, total,
  section subtotal, then the totals.

The line data passed to the PDF layer is typed without `unit_cost` or
`markup_pct` and the builder's query selects sell fields only, exactly as
today. There is no mode that can print cost.

### 4.4 Merge fields

`{{path}}` tokens, replaced by `mergeDoc(doc, ctx)` before rendering. Empty
values print as "—".

| group | fields |
|---|---|
| quote | number, title, date, valid_days, subtotal, gst, total |
| client | name, abn, address |
| contact | name, role, email, phone |
| site | name, address |
| pm | name, phone, position |
| company | name, abn, address, phone, email |

Two small schema additions make the reference document's details block
possible: `clients.address text` (edited in the client dialog) and
`profiles.position text` (edited in Settings → Users). Both nullable.

### 4.5 Fixed details block

Rendered on every templated quote between the headings and the first block,
from quote data rather than template text: Quote no, Issue date, Prepared for
(client name + ABN; Attn contact, role; address · email · phone), Site (name,
address), Prepared by (PM name | position | company name (ABN) | company
address), Validity (`validity_text` merged).

## 5. Creating a template by uploading a PDF

Settings → Quote templates → **Upload template**.

1. Browser: name field + PDF file (only `application/pdf`, ≤ 20 MB, the
   existing `MAX_REPORT_BYTES`). Upload to `attachments` at
   `buildStorageKey('quote-templates', filename)`.
2. Server action `importQuoteTemplate({ path, filename, name })` (admin):
   downloads the object, base64-encodes it, calls
   `extractQuoteTemplate(base64)` in `src/lib/extract-quote-template.ts`.
3. The extractor sends the file to `gpt-5` with a strict JSON schema for
   `{ doc_title, heading, validity_text, blocks[], pricing_defaults }` and a
   prompt that: keeps wording verbatim; classifies each section into a block
   type; replaces job-specific details (client, contact, site, PM, dates,
   quote number, amounts) with the merge fields from the list; maps the fee
   section to the `pricing` block with `mode: 'lump_sum'` when the document
   shows a single fee, otherwise `itemised`; maps the sign-off section to
   `acceptance`. Nothing is saved yet.
4. The action returns the draft. The browser opens the template editor
   prefilled with it, plus any extraction notes (for example "could not place:
   Project line"). The user checks it and clicks **Save** →
   `createQuoteTemplate(draft)` validates with the block schema and inserts
   the row with `source_path`/`source_filename` set.
5. Failure at any step after upload deletes the uploaded object
   (`removeUploadedObject`) and shows the reason. Failure cases: no
   `OPENAI_API_KEY` (button disabled with a hint, same as takeoff extraction),
   file too large, model error, or a result with no recognisable sections.

Manual creation stays available: **New template** opens the same editor with
a starter skeleton (the eight headings from the reference document, empty
bodies, one pricing block, one acceptance block).

## 6. Per-quote document

New `quotes` columns:

| column | notes |
|---|---|
| template_id uuid references quote_templates on delete set null | which template was applied |
| doc jsonb | snapshot `{ doc_title, heading, validity_text, number_headings, blocks }` |
| pdf_options jsonb | `PricingDisplay` |

Both `doc` and `pdf_options` null → the current PDF layout, unchanged.

Actions (`quotes/actions.ts`, admin/office, all through `assertEditable` so
accepted and lost quotes are frozen):

- `applyQuoteTemplate(quoteId, templateId | null)` — copies the template
  into `doc`, sets `template_id`, resets `pdf_options` to the template's
  defaults. `null` clears `doc` and `template_id` (standard layout) and keeps
  `pdf_options`.
- `updateQuoteDoc(quoteId, doc)` — saves edited blocks (same zod schema).
- `updateQuotePdfOptions(quoteId, options)`.

`createQuote` accepts an optional `template_id` (new-quote dialog gains a
Template select, preselecting the default template) and applies it.
`duplicateQuote` copies `template_id`, `doc` and `pdf_options`.

### 6.1 Builder UI

- **PDF button** opens `quote-pdf-dialog.tsx`: Template select (active
  templates + "Standard layout"), Pricing display radio (Lump sum / Section
  totals / Itemised), the toggles relevant to the chosen mode, fee label when
  lump sum. **Open PDF** saves any change (apply template and/or options),
  then opens `/api/pdf/quote/[id]` in a new tab as now. Switching templates
  when the quote's `doc` has been edited asks to confirm, since edits are
  replaced. When the quote is not editable the dialog shows the saved choice
  read-only and just opens the PDF.
- **Document card** in the builder (below the header, above the sections):
  shows the template name and the block editor when a template is applied.
  This is where job-specific assumptions or client responsibilities are
  tweaked for one quote. Read-only when the quote is frozen.

The block editor (`src/components/DocBlocksEditor.tsx`) is shared by Settings
and the builder: a list of blocks with type badge, heading input, a body
textarea (text), one-item-per-line textarea (bullets), label/value rows with
add/remove (table), note textarea (pricing), move up/down, delete (except the
pricing block), and an **Add block** menu. A short merge-field legend sits
under the editor.

## 7. PDF rendering

- `src/pdf/quote-pricing.tsx` — `PricingBlock` component implementing the
  three modes from typed sell-side lines and totals. Used by both documents.
- `src/pdf/QuotePdf.tsx` (existing) — keeps its layout; its table section is
  replaced by `PricingBlock` so display options also apply to standard-layout
  quotes.
- `src/pdf/QuoteDocPdf.tsx` (new) — `DocShell` with `doc_title`, then the
  service heading and job line, the fixed details block, then blocks in order
  with auto-numbered headings: text paragraphs, bullet lists (SWMS `BulletList`
  style), two-column tables (label column ~32%), the pricing block, and the
  acceptance block. When the quote was accepted through the portal the
  existing evidence block (signer, time, signature image) replaces the blank
  sign block. `settings.quote_footer` prints as fine print after the last block
  as now.
- Word hyphenation is disabled for these documents
  (`Font.registerHyphenationCallback(word => [word])`), so narrative text
  wraps on whole words. The design preview showed react-pdf's default
  hyphenation splitting words like "responses" across lines.
- `src/pdf/build-quote-pdf.tsx` — additionally selects `template_id, doc,
  pdf_options`, the client's `abn, address`, the contact's `role, email,
  phone`, and the PM's `full_name, phone, position`; builds the merge context;
  renders `QuoteDocPdf` when `doc` is set, else `QuotePdf`. The route and the
  portal proxy are untouched; the portal keeps its watermark and, because it
  reads the quote's own snapshot, prints exactly the office document.

## 8. Settings → Quote templates tab

New tab `quote-templates` (`quote-templates-section.tsx`, admin only like the
rest of Settings). Table: name, heading, pricing default, default badge,
active badge, updated. Actions: Upload template, New template, Edit (dialog
with name, doc title, heading, validity text, numbering toggle, pricing
defaults, block editor), Set as default, Activate/Deactivate, View original
(signed URL of the uploaded PDF). Templates are never hard-deleted; quotes
keep their snapshot regardless.

Server actions in `settings/actions.ts`: `importQuoteTemplate`,
`createQuoteTemplate`, `updateQuoteTemplate`, `setQuoteTemplateActive`,
`setDefaultQuoteTemplate`.

## 9. Error handling

- Import: every failure after the upload removes the object and returns a
  plain message; nothing is inserted until Save.
- Validation: unknown merge field, missing pricing block, duplicate acceptance
  block or empty heading fail with a field-level message in the editor.
- Frozen quotes: template/doc/options changes return the existing
  "Quote is accepted and can no longer be edited" error.
- Rendering: missing merge data prints "—"; a template deleted or deactivated
  later has no effect on quotes, which render from their snapshot.

## 10. Testing (Vitest, `tests/`)

- `quote-doc.test.ts` — block schema accept/reject cases; merge-field
  substitution including money formatting and empty values; unknown-token
  rejection; heading numbering; the pricing view-model for each mode (lump
  sum totals, section subtotals, itemised rows; asserts the model has no cost
  fields); `show_gst` off.
- `quote-doc-pdf.test.tsx` — smoke renders of `QuoteDocPdf` for each mode,
  with and without portal acceptance, and of `QuotePdf` with display options.
- `extract-quote-template.test.ts` — the model-output → draft mapping and
  validation against a fixture shaped like the reference document; no
  network.
- Existing `convert.test.ts` and money tests unchanged.

Manual click-through after implementation: upload the reference PDF, review,
save, apply to a quote, open the PDF in each mode, accept via the portal and
confirm the evidence block replaces the sign block.

## 11. Out of scope

- Word (.docx) upload, pixel-exact reproduction of the original layout,
  custom fonts, per-template logos or colours.
- Cost or markup on any client-facing document.
- Templates for invoices, variations or claims (the block model would extend
  to them later).
- Editing a template's text after a quote is accepted.
