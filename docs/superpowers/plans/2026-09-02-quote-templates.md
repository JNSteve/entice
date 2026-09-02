# Quote Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins upload an existing quote PDF to create a structured quote template; office users pick a template and a pricing display per quote, and the quote PDF (office and portal) renders the template with the quote's data. Cost and markup never print.

**Architecture:** A new `quote_templates` table holds structured documents (ordered blocks + pricing defaults). Applying a template snapshots it onto the quote (`quotes.doc`, `quotes.pdf_options`), so the existing `buildQuotePdfResponse` renders either the current `QuotePdf` or the new `QuoteDocPdf` from the quote row alone. Template import sends the PDF to OpenAI (`gpt-5`, structured output) using the same pattern as `src/lib/extract-takeoff.ts`, then the admin reviews the draft in a shared block editor before saving.

**Tech Stack:** Next.js 16 App Router (server actions), React 19, Supabase (Postgres + RLS + Storage), `@react-pdf/renderer` v4, zod v4, `openai` SDK (Responses API), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-02-quote-templates-design.md`

## Global Constraints

- Read `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md). This Next.js differs from training data.
- Sell side only: no `unit_cost`, `markup_pct` or margin may reach any quote PDF component or the pricing view-model. Queries for PDF data select `qty, unit, unit_sell` only.
- All server actions start with `await requireRole(...)`: settings/template actions `requireRole('admin')`; quote actions `requireRole('admin', 'office')`. Quote mutations go through `assertEditable` (draft or sent only).
- Migration file is `supabase/migrations/0061_quote_templates.sql`. `supabase/fresh-install.sql` is a frozen snapshot through 0053 and is NOT edited.
- Upload limit for template PDFs is 20 MB (`MAX_TEMPLATE_PDF_BYTES = 20 * 1024 * 1024`), PDF only. Uploaded originals live in the `attachments` bucket under `quote-templates/`.
- Merge fields are exactly the 24 listed in the spec §4.4. Unknown tokens are rejected at save time; empty values print as "—".
- Every block list has exactly one `pricing` block and at most one `acceptance` block.
- Tests run with `npm test` (Vitest, node environment). Type-check with `npx tsc --noEmit`, lint with `npm run lint`.
- Dev server on this machine needs `$env:NODE_EXTRA_CA_CERTS='C:\Users\nickj\norton-tls-npm-workaround'` before `npm run dev` or server-side Supabase calls fail.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Prose copy: Australian spelling ("itemised"), no em-dashes in UI strings you add.

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0061_quote_templates.sql` | `quote_templates` table + RLS, `quotes.template_id/doc/pdf_options`, `clients.address`, `profiles.position` |
| `src/lib/quote-doc.ts` | Types + zod schemas for blocks, doc, pricing display, template; merge fields; merge context; details rows; starter doc; snapshot; normalise |
| `src/lib/quote-pricing.ts` | Pure pricing view-model (`buildPricingModel`) for the three display modes |
| `src/lib/extract-quote-template.ts` | OpenAI structured extraction + pure `draftFromExtraction` mapper |
| `src/pdf/quote-pricing.tsx` | `PricingBlock` react-pdf component (shared by both quote documents) |
| `src/pdf/QuotePdf.tsx` | Existing standard quote; now delegates its pricing to `PricingBlock` |
| `src/pdf/QuoteDocPdf.tsx` | New templated quote document |
| `src/pdf/build-quote-pdf.tsx` | Fetches quote + related rows, builds merge context, picks the document |
| `src/pdf/theme.ts` | Registers the no-hyphenation callback (global to all PDFs) |
| `src/components/DocBlocksEditor.tsx` | Shared block editor (Settings template editor + quote Document card) |
| `src/app/(office)/settings/quote-templates-section.tsx` | Settings tab: list, upload/import dialog, editor dialog |
| `src/app/(office)/settings/actions.ts` | Template CRUD + import actions |
| `src/app/(office)/settings/settings-tabs.tsx`, `settings/page.tsx` | Wire the new tab and its data |
| `src/app/(office)/settings/users-section.tsx` | `position` field on the user edit dialog |
| `src/app/(office)/clients/client-dialogs.tsx`, `clients/[id]/page.tsx` | `address` field on client dialogs and detail card |
| `src/app/(office)/quotes/actions.ts` | `applyQuoteTemplate`, `updateQuoteDoc`, `updateQuotePdfOptions`; `createQuote` template; `duplicateQuote` copy |
| `src/app/(office)/quotes/[id]/quote-pdf-dialog.tsx` | PDF button dialog: template + pricing display, then open PDF |
| `src/app/(office)/quotes/[id]/quote-doc-card.tsx` | Document card in the builder (per-quote block editing) |
| `src/app/(office)/quotes/[id]/quote-builder.tsx`, `[id]/page.tsx` | Pass template data; mount dialog and card |
| `src/app/(office)/quotes/new-quote-dialog.tsx`, `quotes/page.tsx` | Template select on quote creation |
| `src/lib/zod.ts` | `clients.address`, `profiles.position`, `quoteCreateSchema.template_id` |
| `tests/quote-doc.test.ts`, `tests/quote-pricing.test.ts`, `tests/quote-pdf.test.tsx`, `tests/quote-doc-pdf.test.tsx`, `tests/extract-quote-template.test.ts`, `tests/doc-blocks-editor.test.tsx` | Tests |

---

### Task 1: Schema additions (migration, zod, client address, staff position)

**Files:**
- Create: `supabase/migrations/0061_quote_templates.sql`
- Modify: `src/lib/zod.ts:24-47` (clientSchema), `src/lib/zod.ts:147-153` (profileUpdateSchema), `src/lib/zod.ts:238-255` (quoteCreateSchema)
- Modify: `src/app/(office)/clients/client-dialogs.tsx` (both dialogs), `src/app/(office)/clients/[id]/page.tsx:176-215`
- Modify: `src/app/(office)/settings/users-section.tsx:30-40` (ProfileRow), `:311-326` (edit state/submit), `:356-366` (form)
- Modify: `src/app/(office)/settings/page.tsx:65-68` (profiles select)

**Interfaces:**
- Produces: columns `clients.address text`, `profiles.position text`, `quotes.template_id uuid`, `quotes.doc jsonb`, `quotes.pdf_options jsonb`, table `quote_templates`; zod `quoteCreateSchema.template_id: string | null`.

- [ ] **Step 1: Write the migration**

```sql
-- 0061: quote templates — structured client-facing quote documents imported
-- from an existing PDF (Settings → Quote templates), snapshotted onto quotes.
-- Also the two fields the templated details block needs: client address and
-- staff position ("Prepared by Nicholas Jones | Director").

alter table clients add column address text;
alter table profiles add column position text;

create table quote_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  doc_title text not null default 'Quotation',
  heading text,
  validity_text text not null default '{{quote.valid_days}} days from issue unless otherwise stated',
  number_headings boolean not null default true,
  blocks jsonb not null default '[]'::jsonb,
  pricing_defaults jsonb not null default '{"mode":"itemised","show_qty_unit":true,"list_items":true,"show_gst":true,"fee_label":"Fixed fee"}'::jsonb,
  is_default boolean not null default false,
  active boolean not null default true,
  source_path text,
  source_filename text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One default among the active templates.
create unique index quote_templates_one_default
  on quote_templates (is_default) where is_default and active;

alter table quote_templates enable row level security;
create policy quote_templates_money_select on public.quote_templates
  for select to authenticated using (current_app_role() in ('admin','office'));
create policy quote_templates_admin_insert on public.quote_templates
  for insert to authenticated with check (current_app_role() = 'admin');
create policy quote_templates_admin_update on public.quote_templates
  for update to authenticated
  using (current_app_role() = 'admin') with check (current_app_role() = 'admin');
create policy quote_templates_admin_delete on public.quote_templates
  for delete to authenticated using (current_app_role() = 'admin');

-- Per-quote snapshot: the document travels with the quote, so a template edit
-- never changes a sent quote and the portal proxy needs no template lookup.
alter table quotes add column template_id uuid references quote_templates(id) on delete set null;
alter table quotes add column doc jsonb;
alter table quotes add column pdf_options jsonb;
```

- [ ] **Step 2: Apply the migration to the live project**

Use the Supabase MCP tool `apply_migration` (project `zspauxavbhtutanhekuu`, name `0061_quote_templates`, query = the file contents). If the MCP is unavailable, paste the file into the Supabase SQL editor.

- [ ] **Step 3: Verify the columns exist**

Run with the `ecr-portal` MCP `sql` tool:

```sql
select table_name, column_name from information_schema.columns
where (table_name = 'quotes' and column_name in ('template_id','doc','pdf_options'))
   or (table_name = 'clients' and column_name = 'address')
   or (table_name = 'profiles' and column_name = 'position')
   or table_name = 'quote_templates'
order by table_name, column_name;
```

Expected: 3 quotes rows, 1 clients row, 1 profiles row, 15 quote_templates rows.

- [ ] **Step 4: Extend the zod schemas**

In `src/lib/zod.ts`, inside `clientSchema` after `abn`:

```ts
  address: z
    .string()
    .optional()
    .transform((v) => (v?.trim() === '' ? undefined : v?.trim())),
```

Inside `profileUpdateSchema` after `phone`:

```ts
  position: optionalText.optional(),
```

Inside `quoteCreateSchema` after `pm_id`:

```ts
  /** Quote template to snapshot at creation; null = standard layout. */
  template_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
```

Note: `optionalText` is declared at `src/lib/zod.ts:103` below `clientSchema`, which is why `clientSchema` uses the inline transform form. Keep that form for `address`.

- [ ] **Step 5: Client address in the dialogs and detail card**

`src/app/(office)/clients/client-dialogs.tsx`. In `NewClientDialog`: add `const [address, setAddress] = useState('')`, reset it in `reset()`, pass `address` in the `createClient({...})` payload, and add this field after the ABN field:

```tsx
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nc-address">Address (optional)</Label>
              <Input
                id="nc-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="11/126 Compton Road, Woodridge QLD 4114"
              />
            </div>
```

In `ClientRow` add `address: string | null`. In `EditClientDialog`: `const [address, setAddress] = useState(client.address ?? '')`, pass `address` to `updateClient`, and add the same field with ids `ec-address`.

`src/app/(office)/clients/[id]/page.tsx`: pass `address: client.address,` in the `EditClientDialog client={{...}}` object, and add after the ABN `<div>` in the details `<dl>`:

```tsx
          <div className="col-span-2">
            <dt className="text-muted-foreground">Address</dt>
            <dd className="font-medium">{client.address ?? '—'}</dd>
          </div>
```

- [ ] **Step 6: Staff position in Settings → Users**

`src/app/(office)/settings/page.tsx:65-68`: change the profiles select to `'id, full_name, role, phone, position, hourly_cost, active'`.

`src/app/(office)/settings/users-section.tsx`: add `position: string | null` to `ProfileRow`. In the edit dialog add `const [position, setPosition] = useState(profile.position ?? '')`, include `position` in the `updateProfile(profile.id, {...})` payload, and add after the Phone field:

```tsx
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eu-position">Position</Label>
              <Input
                id="eu-position"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                placeholder="Director"
              />
              <p className="text-xs text-muted-foreground">
                Printed as &quot;Prepared by&quot; on templated quotes.
              </p>
            </div>
```

- [ ] **Step 7: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (`settings/page.tsx` passes `profiles` straight into `UsersSection`, so the new column flows through without further changes.)

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0061_quote_templates.sql src/lib/zod.ts "src/app/(office)/clients/client-dialogs.tsx" "src/app/(office)/clients/[id]/page.tsx" "src/app/(office)/settings/users-section.tsx" "src/app/(office)/settings/page.tsx"
git commit -m "feat: quote templates schema, client address and staff position (0061)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Document model library (`src/lib/quote-doc.ts`)

**Files:**
- Create: `src/lib/quote-doc.ts`
- Test: `tests/quote-doc.test.ts`

**Interfaces:**
- Produces (all exported from `@/lib/quote-doc`):
  - `PRICING_MODES`, `PricingMode`, `pricingDisplaySchema`, `PricingDisplay`, `DEFAULT_PRICING`, `PRICING_MODE_LABELS`
  - `MERGE_FIELDS`, `MergeField`, `MergeContext`, `unknownMergeTokens(text): string[]`, `mergeText(text, ctx): string`
  - `docBlockSchema`, `DocBlock`, `docBlocksSchema`, `quoteDocSchema`, `QuoteDoc`, `quoteTemplateSchema`, `QuoteTemplateInput`, `QuoteTemplateRow`
  - `newBlockId(): string`, `starterDoc(): QuoteDoc`, `snapshotFromTemplate(t): QuoteDoc`, `normaliseBlocks(blocks): DocBlock[]`, `mergeDoc(doc, ctx): QuoteDoc`
  - `MergeSource`, `buildMergeContext(src): MergeContext`, `buildDetailsRows(src, validityText): DetailRow[]`, `DetailRow`
  - `MAX_TEMPLATE_PDF_BYTES`

- [ ] **Step 1: Write the failing tests**

`tests/quote-doc.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  DEFAULT_PRICING,
  MERGE_FIELDS,
  buildDetailsRows,
  buildMergeContext,
  docBlocksSchema,
  mergeDoc,
  mergeText,
  normaliseBlocks,
  quoteDocSchema,
  quoteTemplateSchema,
  snapshotFromTemplate,
  starterDoc,
  unknownMergeTokens,
  type DocBlock,
  type MergeContext,
  type MergeSource,
} from '../src/lib/quote-doc'

const emptyCtx = Object.fromEntries(MERGE_FIELDS.map((f) => [f, null])) as MergeContext

const SRC: MergeSource = {
  quote: { number: 'Q-0042', title: 'Unexpected find', date: '2026-08-26', valid_days: 14, subtotal: 1500, gst: 150, total: 1650 },
  client: { name: 'Malcolm Civil', abn: '52 663 107 757', address: '11/126 Compton Road, Woodridge QLD 4114' },
  contact: { name: 'Dan McCutchion', role: 'Project Manager', email: 'dan@example.com', phone: '0490 726 623' },
  site: { name: 'Port of Brisbane', address: 'Port Drive, Port of Brisbane QLD 4178' },
  pm: { full_name: 'Nicholas Jones', phone: '0434 149 935', position: 'Director' },
  company: { name: 'Entice Civil & Remediation', abn: '75 698 881 560', address: '4/284 Musgrave Road, Coopers Plains QLD 4108', phone: null, email: null },
}

describe('merge fields', () => {
  test('unknownMergeTokens lists tokens outside MERGE_FIELDS once each', () => {
    expect(unknownMergeTokens('Hi {{client.name}} re {{project.name}} and {{ project.name }}')).toEqual(['project.name'])
    expect(unknownMergeTokens('no tokens')).toEqual([])
  })

  test('mergeText substitutes known fields, dashes empties, leaves unknown tokens', () => {
    const ctx = { ...emptyCtx, 'client.name': 'Malcolm Civil' }
    expect(mergeText('For {{client.name}} ({{client.abn}}) {{nope}}', ctx)).toBe('For Malcolm Civil (—) {{nope}}')
  })

  test('buildMergeContext formats money and long dates', () => {
    const ctx = buildMergeContext(SRC)
    expect(ctx['quote.total']).toBe('$1,650.00')
    expect(ctx['quote.subtotal']).toBe('$1,500.00')
    expect(ctx['quote.date']).toBe('26 August 2026')
    expect(ctx['quote.valid_days']).toBe('14')
    expect(ctx['site.address']).toBe('Port Drive, Port of Brisbane QLD 4178')
    expect(ctx['company.phone']).toBeNull()
  })

  test('buildMergeContext tolerates missing related rows', () => {
    const ctx = buildMergeContext({ ...SRC, client: null, contact: null, site: null, pm: null })
    expect(ctx['client.name']).toBeNull()
    expect(ctx['pm.name']).toBeNull()
  })
})

describe('details rows', () => {
  test('buildDetailsRows composes the prepared-for / prepared-by lines and merges validity', () => {
    const rows = buildDetailsRows(SRC, '{{quote.valid_days}} days from issue')
    expect(rows.map((r) => r.label)).toEqual(['Quote no.', 'Issue date', 'Prepared for', 'Site', 'Prepared by', 'Validity'])
    expect(rows[2].value).toBe(
      'Malcolm Civil (ABN 52 663 107 757), Attn: Dan McCutchion, Project Manager\n11/126 Compton Road, Woodridge QLD 4114  ·  dan@example.com  ·  0490 726 623'
    )
    expect(rows[3].value).toBe('Port of Brisbane, Port Drive, Port of Brisbane QLD 4178')
    expect(rows[4].value).toBe(
      'Nicholas Jones  |  Director  |  Entice Civil & Remediation (ABN 75 698 881 560)\n4/284 Musgrave Road, Coopers Plains QLD 4108'
    )
    expect(rows[5].value).toBe('14 days from issue')
  })

  test('buildDetailsRows drops the Site row when there is no site', () => {
    const rows = buildDetailsRows({ ...SRC, site: null }, 'x')
    expect(rows.some((r) => r.label === 'Site')).toBe(false)
  })
})

describe('block schemas', () => {
  const pricing: DocBlock = { id: 'p', type: 'pricing', heading: 'Fee' }

  test('accepts a valid block list with one pricing block', () => {
    const blocks: DocBlock[] = [
      { id: 'a', type: 'text', heading: 'Scope', body: 'For {{client.name}}' },
      pricing,
      { id: 'b', type: 'bullets', heading: 'Exclusions', items: ['x'] },
      { id: 'c', type: 'table', heading: 'Terms', columns: ['Term', 'Detail'], rows: [{ label: 'Payment', value: '14 days' }] },
      { id: 'd', type: 'acceptance', heading: 'Acceptance', body: 'Sign below' },
    ]
    expect(docBlocksSchema.safeParse(blocks).success).toBe(true)
  })

  test('rejects zero or two pricing blocks and two acceptance blocks', () => {
    expect(docBlocksSchema.safeParse([]).success).toBe(false)
    const twoPricing = docBlocksSchema.safeParse([pricing, { ...pricing, id: 'q' }])
    expect(twoPricing.success).toBe(false)
    if (!twoPricing.success) expect(twoPricing.error.issues[0].message).toMatch(/one pricing block/i)
    const acc: DocBlock = { id: 'x', type: 'acceptance', heading: 'A', body: '' }
    expect(docBlocksSchema.safeParse([pricing, acc, { ...acc, id: 'y' }]).success).toBe(false)
  })

  test('rejects unknown merge tokens with a helpful message', () => {
    const r = docBlocksSchema.safeParse([pricing, { id: 't', type: 'text', heading: 'H', body: 'Dear {{client.contact}}' }])
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toContain('{{client.contact}}')
  })

  test('rejects an empty heading', () => {
    expect(docBlocksSchema.safeParse([{ ...pricing, heading: '  ' }]).success).toBe(false)
  })

  test('quoteTemplateSchema requires a name and pricing defaults', () => {
    const base = { ...starterDoc(), pricing_defaults: DEFAULT_PRICING }
    expect(quoteTemplateSchema.safeParse({ ...base, name: 'Asbestos inspection' }).success).toBe(true)
    expect(quoteTemplateSchema.safeParse({ ...base, name: '' }).success).toBe(false)
  })
})

describe('helpers', () => {
  test('starterDoc is valid, has 8 blocks, fresh ids each call', () => {
    const a = starterDoc()
    const b = starterDoc()
    expect(quoteDocSchema.safeParse(a).success).toBe(true)
    expect(a.blocks).toHaveLength(8)
    expect(a.blocks[0].id).not.toBe(b.blocks[0].id)
  })

  test('snapshotFromTemplate copies only document fields', () => {
    const t = { ...starterDoc(), id: 'tpl', name: 'N', pricing_defaults: DEFAULT_PRICING, is_default: true, active: true, updated_at: 'x', source_path: null, source_filename: null }
    const snap = snapshotFromTemplate(t)
    expect(Object.keys(snap).sort()).toEqual(['blocks', 'doc_title', 'heading', 'number_headings', 'validity_text'])
  })

  test('normaliseBlocks trims text and drops empty bullets and empty table rows', () => {
    const out = normaliseBlocks([
      { id: 'b', type: 'bullets', heading: ' Exclusions ', items: [' one ', '', '  '] },
      { id: 't', type: 'table', heading: 'T', columns: ['A', 'B'], rows: [{ label: ' x ', value: ' y ' }, { label: '', value: ' ' }] },
      { id: 'p', type: 'pricing', heading: 'Fee', note: '  ' },
    ])
    expect(out[0]).toEqual({ id: 'b', type: 'bullets', heading: 'Exclusions', items: ['one'] })
    expect(out[1]).toMatchObject({ rows: [{ label: 'x', value: 'y' }] })
    expect(out[2]).toEqual({ id: 'p', type: 'pricing', heading: 'Fee', note: undefined })
  })

  test('mergeDoc merges heading, validity and every block string', () => {
    const ctx = { ...emptyCtx, 'client.name': 'Acme', 'quote.valid_days': '30' }
    const doc = {
      ...starterDoc(),
      heading: 'Works for {{client.name}}',
      validity_text: '{{quote.valid_days}} days',
      blocks: [
        { id: 'p', type: 'pricing' as const, heading: 'Fee', note: 'Fee for {{client.name}}' },
        { id: 't', type: 'table' as const, heading: 'T', intro: '{{client.name}}', columns: ['A', 'B'] as [string, string], rows: [{ label: '{{client.name}}', value: '{{client.abn}}' }] },
        { id: 'b', type: 'bullets' as const, heading: 'B', items: ['{{client.name}} x'] },
        { id: 'a', type: 'acceptance' as const, heading: 'A', body: 'Sign, {{client.name}}' },
      ],
    }
    const merged = mergeDoc(doc, ctx)
    expect(merged.heading).toBe('Works for Acme')
    expect(merged.validity_text).toBe('30 days')
    expect(merged.blocks[0]).toMatchObject({ note: 'Fee for Acme' })
    expect(merged.blocks[1]).toMatchObject({ intro: 'Acme', rows: [{ label: 'Acme', value: '—' }] })
    expect(merged.blocks[2]).toMatchObject({ items: ['Acme x'] })
    expect(merged.blocks[3]).toMatchObject({ body: 'Sign, Acme' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/quote-doc.test.ts`
Expected: FAIL, "Cannot find module '../src/lib/quote-doc'".

- [ ] **Step 3: Implement `src/lib/quote-doc.ts`**

```ts
import { z } from 'zod'
import { format, isValid, parseISO } from 'date-fns'
import { aud } from '@/lib/format'

/**
 * Structured quote documents: the template model (Settings → Quote templates),
 * the per-quote snapshot (quotes.doc) and the pricing display options
 * (quotes.pdf_options). Pure — safe to import from client components.
 */

export const MAX_TEMPLATE_PDF_BYTES = 20 * 1024 * 1024

// ─── Pricing display ─────────────────────────────────────────────────────────

export const PRICING_MODES = ['lump_sum', 'section_totals', 'itemised'] as const
export type PricingMode = (typeof PRICING_MODES)[number]

export const pricingDisplaySchema = z.object({
  mode: z.enum(PRICING_MODES),
  /** itemised / section_totals: print the Qty and Unit columns. */
  show_qty_unit: z.boolean(),
  /** lump_sum: list line descriptions by section, without numbers. */
  list_items: z.boolean(),
  /** Print ex-GST / GST rows; false = a single inc-GST line. */
  show_gst: z.boolean(),
  /** lump_sum label, e.g. "Fixed fee". */
  fee_label: z.string().trim().min(1, 'Fee label is required').max(60),
})
export type PricingDisplay = z.infer<typeof pricingDisplaySchema>

export const DEFAULT_PRICING: PricingDisplay = {
  mode: 'itemised',
  show_qty_unit: true,
  list_items: true,
  show_gst: true,
  fee_label: 'Fixed fee',
}

export const PRICING_MODE_LABELS: Record<PricingMode, string> = {
  lump_sum: 'Lump sum',
  section_totals: 'Section totals',
  itemised: 'Itemised',
}

// ─── Merge fields ────────────────────────────────────────────────────────────

export const MERGE_FIELDS = [
  'quote.number', 'quote.title', 'quote.date', 'quote.valid_days',
  'quote.subtotal', 'quote.gst', 'quote.total',
  'client.name', 'client.abn', 'client.address',
  'contact.name', 'contact.role', 'contact.email', 'contact.phone',
  'site.name', 'site.address',
  'pm.name', 'pm.phone', 'pm.position',
  'company.name', 'company.abn', 'company.address', 'company.phone', 'company.email',
] as const
export type MergeField = (typeof MERGE_FIELDS)[number]
export type MergeContext = Record<MergeField, string | null>

const TOKEN_RE = /\{\{\s*([a-z_.]+)\s*\}\}/g

function isMergeField(key: string): key is MergeField {
  return (MERGE_FIELDS as readonly string[]).includes(key)
}

/** Distinct `{{tokens}}` in the text that are not merge fields. */
export function unknownMergeTokens(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(TOKEN_RE)) {
    if (!isMergeField(m[1])) out.add(m[1])
  }
  return [...out]
}

/** Replaces known tokens; empty values become "—"; unknown tokens are left as-is. */
export function mergeText(text: string, ctx: MergeContext): string {
  return text.replace(TOKEN_RE, (whole, key: string) => {
    if (!isMergeField(key)) return whole
    const v = ctx[key]
    return v && v.trim() ? v : '—'
  })
}

/** Text field that may carry merge tokens — unknown tokens fail validation. */
function mergedText(max: number) {
  return z
    .string()
    .max(max)
    .superRefine((t, ctx) => {
      const bad = unknownMergeTokens(t)
      if (bad.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: `Unknown merge field {{${bad[0]}}}. Valid fields: ${MERGE_FIELDS.map((f) => `{{${f}}}`).join(', ')}`,
        })
      }
    })
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

const heading = z.string().trim().min(1, 'Every block needs a heading').max(120)
const blockBase = { id: z.string().min(1), heading }

export const docBlockSchema = z.discriminatedUnion('type', [
  z.object({ ...blockBase, type: z.literal('text'), body: mergedText(8000) }),
  z.object({ ...blockBase, type: z.literal('bullets'), items: z.array(mergedText(1000)).max(50) }),
  z.object({
    ...blockBase,
    type: z.literal('table'),
    intro: mergedText(2000).optional(),
    columns: z.tuple([z.string().trim().min(1).max(60), z.string().trim().min(1).max(60)]),
    rows: z.array(z.object({ label: mergedText(200), value: mergedText(2000) })).max(60),
  }),
  z.object({ ...blockBase, type: z.literal('pricing'), note: mergedText(2000).optional() }),
  z.object({ ...blockBase, type: z.literal('acceptance'), body: mergedText(2000) }),
])
export type DocBlock = z.infer<typeof docBlockSchema>

export const docBlocksSchema = z
  .array(docBlockSchema)
  .max(40)
  .superRefine((blocks, ctx) => {
    const pricing = blocks.filter((b) => b.type === 'pricing').length
    if (pricing === 0) ctx.addIssue({ code: 'custom', message: 'Add a pricing block' })
    if (pricing > 1) ctx.addIssue({ code: 'custom', message: 'Only one pricing block is allowed' })
    if (blocks.filter((b) => b.type === 'acceptance').length > 1) {
      ctx.addIssue({ code: 'custom', message: 'Only one acceptance block is allowed' })
    }
  })

export const quoteDocSchema = z.object({
  doc_title: z.string().trim().min(1, 'Document title is required').max(60),
  heading: z.string().trim().max(160).nullable(),
  validity_text: mergedText(300).refine((t) => t.trim().length > 0, 'Validity text is required'),
  number_headings: z.boolean(),
  blocks: docBlocksSchema,
})
export type QuoteDoc = z.infer<typeof quoteDocSchema>

export const quoteTemplateSchema = quoteDocSchema.extend({
  name: z.string().trim().min(1, 'Name is required').max(80),
  pricing_defaults: pricingDisplaySchema,
  source_path: z.string().max(400).nullable().optional(),
  source_filename: z.string().max(200).nullable().optional(),
})
export type QuoteTemplateInput = z.infer<typeof quoteTemplateSchema>

/** What the Settings tab and the quote builder receive per template. */
export type QuoteTemplateRow = QuoteTemplateInput & {
  id: string
  is_default: boolean
  active: boolean
  updated_at: string
}

export function newBlockId(): string {
  return crypto.randomUUID()
}

export const ACCEPTANCE_BODY =
  'To accept this quotation, sign below and return it to {{company.name}} with any purchase order or project reference requirements.'

/** Blank template with the reference document's eight sections. */
export function starterDoc(): QuoteDoc {
  return {
    doc_title: 'Quotation',
    heading: null,
    validity_text: '{{quote.valid_days}} days from issue unless otherwise stated',
    number_headings: true,
    blocks: [
      { id: newBlockId(), type: 'table', heading: 'Scope and Deliverables', intro: '', columns: ['Service', 'Included scope'], rows: [] },
      { id: newBlockId(), type: 'pricing', heading: 'Fee' },
      { id: newBlockId(), type: 'bullets', heading: 'Key Assumptions', items: [] },
      { id: newBlockId(), type: 'bullets', heading: 'Exclusions', items: [] },
      { id: newBlockId(), type: 'table', heading: 'Variations', columns: ['Potential variation', 'Indicative rate ex GST'], rows: [] },
      { id: newBlockId(), type: 'bullets', heading: 'Client Responsibilities', items: [] },
      { id: newBlockId(), type: 'table', heading: 'Standard Terms', columns: ['Term', 'Detail'], rows: [] },
      { id: newBlockId(), type: 'acceptance', heading: 'Acceptance', body: ACCEPTANCE_BODY },
    ],
  }
}

/** The part of a template that is copied onto a quote. */
export function snapshotFromTemplate(t: QuoteDoc): QuoteDoc {
  return {
    doc_title: t.doc_title,
    heading: t.heading,
    validity_text: t.validity_text,
    number_headings: t.number_headings,
    blocks: t.blocks,
  }
}

const trimOrUndefined = (s: string | undefined) => {
  const t = s?.trim()
  return t ? t : undefined
}

/** Editor output → clean blocks: trimmed strings, no empty bullets or rows. */
export function normaliseBlocks(blocks: DocBlock[]): DocBlock[] {
  return blocks.map((b) => {
    const h = b.heading.trim()
    switch (b.type) {
      case 'text':
        return { id: b.id, type: 'text', heading: h, body: b.body.trim() }
      case 'bullets':
        return { id: b.id, type: 'bullets', heading: h, items: b.items.map((i) => i.trim()).filter(Boolean) }
      case 'table':
        return {
          id: b.id,
          type: 'table',
          heading: h,
          intro: trimOrUndefined(b.intro),
          columns: [b.columns[0].trim(), b.columns[1].trim()],
          rows: b.rows
            .map((r) => ({ label: r.label.trim(), value: r.value.trim() }))
            .filter((r) => r.label || r.value),
        }
      case 'pricing':
        return { id: b.id, type: 'pricing', heading: h, note: trimOrUndefined(b.note) }
      case 'acceptance':
        return { id: b.id, type: 'acceptance', heading: h, body: b.body.trim() }
    }
  })
}

/** Applies merge fields to every string in the document. */
export function mergeDoc(doc: QuoteDoc, ctx: MergeContext): QuoteDoc {
  const m = (s: string) => mergeText(s, ctx)
  return {
    ...doc,
    heading: doc.heading ? m(doc.heading) : doc.heading,
    validity_text: m(doc.validity_text),
    blocks: doc.blocks.map((b) => {
      switch (b.type) {
        case 'text':
          return { ...b, heading: m(b.heading), body: m(b.body) }
        case 'bullets':
          return { ...b, heading: m(b.heading), items: b.items.map(m) }
        case 'table':
          return {
            ...b,
            heading: m(b.heading),
            intro: b.intro === undefined ? undefined : m(b.intro),
            rows: b.rows.map((r) => ({ label: m(r.label), value: m(r.value) })),
          }
        case 'pricing':
          return { ...b, heading: m(b.heading), note: b.note === undefined ? undefined : m(b.note) }
        case 'acceptance':
          return { ...b, heading: m(b.heading), body: m(b.body) }
      }
    }),
  }
}

// ─── Merge context from data ─────────────────────────────────────────────────

export type MergeSource = {
  quote: {
    number: string
    title: string
    /** ISO date or datetime string. */
    date: string
    valid_days: number
    subtotal: number
    gst: number
    total: number
  }
  client: { name: string; abn: string | null; address: string | null } | null
  contact: { name: string; role: string | null; email: string | null; phone: string | null } | null
  site: { name: string; address: string | null } | null
  pm: { full_name: string; phone: string | null; position: string | null } | null
  company: {
    name: string
    abn?: string | null
    address?: string | null
    phone?: string | null
    email?: string | null
  }
}

/** "26 August 2026" — the long form used in the details block and {{quote.date}}. */
export function fmtDateLong(d: string): string {
  const date = parseISO(d)
  return isValid(date) ? format(date, 'd MMMM yyyy') : ''
}

const orNull = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)

export function buildMergeContext(src: MergeSource): MergeContext {
  const { quote, client, contact, site, pm, company } = src
  return {
    'quote.number': quote.number,
    'quote.title': orNull(quote.title),
    'quote.date': orNull(fmtDateLong(quote.date)),
    'quote.valid_days': String(quote.valid_days),
    'quote.subtotal': aud(quote.subtotal),
    'quote.gst': aud(quote.gst),
    'quote.total': aud(quote.total),
    'client.name': orNull(client?.name),
    'client.abn': orNull(client?.abn),
    'client.address': orNull(client?.address),
    'contact.name': orNull(contact?.name),
    'contact.role': orNull(contact?.role),
    'contact.email': orNull(contact?.email),
    'contact.phone': orNull(contact?.phone),
    'site.name': orNull(site?.name),
    'site.address': orNull(site?.address),
    'pm.name': orNull(pm?.full_name),
    'pm.phone': orNull(pm?.phone),
    'pm.position': orNull(pm?.position),
    'company.name': orNull(company.name),
    'company.abn': orNull(company.abn),
    'company.address': orNull(company.address),
    'company.phone': orNull(company.phone),
    'company.email': orNull(company.email),
  }
}

export type DetailRow = { label: string; value: string }

const SEP = '  ·  '

/** The fixed details block printed on every templated quote (spec §4.5). */
export function buildDetailsRows(src: MergeSource, validityText: string): DetailRow[] {
  const ctx = buildMergeContext(src)
  const { client, contact, site, pm, company } = src

  const preparedForLine1 = [
    client ? `${client.name}${client.abn ? ` (ABN ${client.abn})` : ''}` : null,
    contact ? `Attn: ${contact.name}${contact.role ? `, ${contact.role}` : ''}` : null,
  ]
    .filter(Boolean)
    .join(', ')
  const preparedForLine2 = [client?.address, contact?.email, contact?.phone].filter(Boolean).join(SEP)
  const preparedFor = [preparedForLine1, preparedForLine2].filter(Boolean).join('\n')

  const preparedByLine1 = [
    pm?.full_name,
    pm?.position,
    `${company.name}${company.abn ? ` (ABN ${company.abn})` : ''}`,
  ]
    .filter(Boolean)
    .join('  |  ')
  const preparedBy = [preparedByLine1, company.address].filter(Boolean).join('\n')

  const rows: DetailRow[] = [
    { label: 'Quote no.', value: src.quote.number },
    { label: 'Issue date', value: ctx['quote.date'] ?? '—' },
    { label: 'Prepared for', value: preparedFor || '—' },
  ]
  if (site) {
    rows.push({ label: 'Site', value: [site.name, site.address].filter(Boolean).join(', ') })
  }
  rows.push({ label: 'Prepared by', value: preparedBy })
  rows.push({ label: 'Validity', value: mergeText(validityText, ctx) })
  return rows
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/quote-doc.test.ts`
Expected: all tests PASS. If the `two pricing` message assertion fails because zod reports the array-level issue after element issues, check `issues.some(i => /one pricing block/i.test(i.message))` instead.

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit`

```bash
git add src/lib/quote-doc.ts tests/quote-doc.test.ts
git commit -m "feat: quote document model - blocks, merge fields, details rows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Pricing view-model (`src/lib/quote-pricing.ts`)

**Files:**
- Create: `src/lib/quote-pricing.ts`
- Test: `tests/quote-pricing.test.ts`

**Interfaces:**
- Consumes: `PricingDisplay` from `@/lib/quote-doc`; `lineTotal`, `round2` from `@/lib/money`; `pct` from `@/lib/format`.
- Produces: `PricingLine`, `PricingSection`, `PricingTotals`, `TotalsRows`, `PricingModel`, `fmtQty(n)`, `buildPricingModel(sections, totals, display)`.

- [ ] **Step 1: Write the failing tests**

`tests/quote-pricing.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { DEFAULT_PRICING } from '../src/lib/quote-doc'
import { buildPricingModel, fmtQty, type PricingSection } from '../src/lib/quote-pricing'

const SECTIONS: PricingSection[] = [
  { title: 'Preparation', lines: [
    { description: 'Site setup', qty: 3, unit: 'ea', unit_sell: 100 },
    { description: 'Traffic mgmt', qty: 2.5, unit: 'hr', unit_sell: 50 },
  ] },
  { title: 'Materials', lines: [{ description: 'Membrane', qty: 1, unit: 'm2', unit_sell: 250.5 }] },
]
const TOTALS = { subtotal: 675.5, gst: 67.55, gstRate: 10, total: 743.05 }

test('fmtQty trims trailing zeros', () => {
  expect(fmtQty(2)).toBe('2')
  expect(fmtQty(1.25)).toBe('1.25')
  expect(fmtQty(0.5)).toBe('0.5')
})

describe('itemised', () => {
  test('rows carry rate and total per line, section subtotals and GST rows', () => {
    const m = buildPricingModel(SECTIONS, TOTALS, DEFAULT_PRICING)
    expect(m.mode).toBe('itemised')
    if (m.mode !== 'itemised') return
    expect(m.showQtyUnit).toBe(true)
    expect(m.sections[0].lines[1]).toEqual({ description: 'Traffic mgmt', qty: '2.5', unit: 'hr', rate: 50, total: 125 })
    expect(m.sections[0].subtotal).toBe(425)
    expect(m.sections[1].subtotal).toBe(250.5)
    expect(m.totals.rows).toEqual([{ label: 'Subtotal (ex GST)', value: 675.5 }, { label: 'GST 10%', value: 67.55 }])
    expect(m.totals.grand).toEqual({ label: 'Total inc GST', value: 743.05 })
  })

  test('show_gst false collapses the totals to the grand line', () => {
    const m = buildPricingModel(SECTIONS, TOTALS, { ...DEFAULT_PRICING, show_gst: false })
    expect(m.totals.rows).toEqual([])
    expect(m.totals.grand.value).toBe(743.05)
  })
})

describe('section_totals', () => {
  test('lines have no rate or total; subtotals remain', () => {
    const m = buildPricingModel(SECTIONS, TOTALS, { ...DEFAULT_PRICING, mode: 'section_totals', show_qty_unit: false })
    expect(m.mode).toBe('section_totals')
    if (m.mode !== 'section_totals') return
    expect(m.showQtyUnit).toBe(false)
    expect(m.sections[0].lines[0]).toEqual({ description: 'Site setup', qty: '3', unit: 'ea' })
    expect(m.sections[0].subtotal).toBe(425)
    expect(JSON.stringify(m)).not.toMatch(/"rate"|"total":/)
  })
})

describe('lump_sum', () => {
  test('fee label, totals and optional item lists without numbers', () => {
    const m = buildPricingModel(SECTIONS, TOTALS, { ...DEFAULT_PRICING, mode: 'lump_sum', fee_label: 'Fixed fee' })
    expect(m.mode).toBe('lump_sum')
    if (m.mode !== 'lump_sum') return
    expect(m.totals.rows[0]).toEqual({ label: 'Fixed fee (ex GST)', value: 675.5 })
    expect(m.itemLists).toEqual([
      { title: 'Preparation', items: ['Site setup', 'Traffic mgmt'] },
      { title: 'Materials', items: ['Membrane'] },
    ])
  })

  test('list_items false yields no item lists', () => {
    const m = buildPricingModel(SECTIONS, TOTALS, { ...DEFAULT_PRICING, mode: 'lump_sum', list_items: false })
    if (m.mode !== 'lump_sum') return
    expect(m.itemLists).toEqual([])
  })
})

test('the model never carries cost or markup even if the input has extra keys', () => {
  const leaky = SECTIONS.map((s) => ({
    ...s,
    lines: s.lines.map((l) => ({ ...l, unit_cost: 1, markup_pct: 99 })),
  }))
  for (const mode of ['lump_sum', 'section_totals', 'itemised'] as const) {
    const json = JSON.stringify(buildPricingModel(leaky, TOTALS, { ...DEFAULT_PRICING, mode }))
    expect(json).not.toMatch(/unit_cost|markup/)
  }
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/quote-pricing.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement `src/lib/quote-pricing.ts`**

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
export type PricingSection = { title: string; lines: PricingLine[] }
export type PricingTotals = { subtotal: number; gst: number; gstRate: number; total: number }

export type TotalsRows = {
  rows: { label: string; value: number }[]
  grand: { label: string; value: number }
}

export type PricingModel =
  | {
      mode: 'lump_sum'
      totals: TotalsRows
      itemLists: { title: string; items: string[] }[]
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
        itemLists: display.list_items
          ? sections.map((s) => ({ title: s.title, items: s.lines.map((l) => l.description) }))
          : [],
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/quote-pricing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quote-pricing.ts tests/quote-pricing.test.ts
git commit -m "feat: sell-side pricing view-model for quote PDFs (lump sum / section totals / itemised)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `PricingBlock` PDF component, standard `QuotePdf` uses it, hyphenation off

**Files:**
- Create: `src/pdf/quote-pricing.tsx`
- Modify: `src/pdf/QuotePdf.tsx` (replace `SectionTable`, `col`, `fmtQty`, the totals block)
- Modify: `src/pdf/theme.ts:1` (import `Font`, register callback)
- Test: `tests/quote-pdf.test.tsx`

**Interfaces:**
- Consumes: `PricingModel` from `@/lib/quote-pricing`, `tableStyles`, `totalsStyles`, `palette`, `fontSize`, `font` from `./theme`.
- Produces: `PricingBlock({ model })` react-pdf component; `QuotePdfProps.display?: PricingDisplay` (default `DEFAULT_PRICING`); `QuotePdfLine`/`QuotePdfSection` now aliases of `PricingLine`/`PricingSection`.

- [ ] **Step 1: Write the failing smoke test**

`tests/quote-pdf.test.tsx`:

```tsx
import { expect, test } from 'vitest'
import { renderToBuffer } from '@react-pdf/renderer'
import { QuotePdf } from '../src/pdf/QuotePdf'
import { DEFAULT_PRICING } from '../src/lib/quote-doc'

const company = { name: 'Test Civil Pty Ltd', abn: '11 222 333 444', address: '1 Test St', phone: null, email: null, logoUrl: undefined }
const sections = [
  { title: 'Preparation', lines: [{ description: 'Site setup', qty: 3, unit: 'ea', unit_sell: 100 }] },
  { title: 'Materials', lines: [{ description: 'Membrane', qty: 1, unit: 'm2', unit_sell: 250.5 }] },
]
const totals = { subtotal: 550.5, gst: 55.05, gstRate: 10, total: 605.55 }

for (const mode of ['itemised', 'section_totals', 'lump_sum'] as const) {
  test(`standard quote pdf renders in ${mode} mode`, async () => {
    const buffer = await renderToBuffer(
      <QuotePdf
        quote={{ number: 'Q-0001', title: 'Roof restoration', date: '26/08/2026', clientName: 'Acme', contactName: 'Dan', siteName: 'Depot', siteAddress: '1 Site Rd' }}
        company={company}
        sections={sections}
        totals={totals}
        validDays={14}
        description="Scope"
        quoteFooter="Fine print"
        display={{ ...DEFAULT_PRICING, mode, fee_label: 'Fixed fee' }}
      />
    )
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
    expect(buffer.length).toBeGreaterThan(1000)
  })
}

test('standard quote pdf renders without a display prop (legacy call)', async () => {
  const buffer = await renderToBuffer(
    <QuotePdf
      quote={{ number: 'Q-0002', title: 'T', date: '26/08/2026', clientName: 'Acme' }}
      company={company}
      sections={sections}
      totals={totals}
      validDays={30}
    />
  )
  expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/quote-pdf.test.tsx`
Expected: FAIL (type error / unknown prop `display`, or module missing once the test imports are compiled).

- [ ] **Step 3: Turn off hyphenation in `src/pdf/theme.ts`**

Replace the first line `import { StyleSheet } from '@react-pdf/renderer'` with:

```ts
import { Font, StyleSheet } from '@react-pdf/renderer'

// react-pdf hyphenates at line ends by default ("re-sponses"). Wrap on whole
// words in every document instead. The callback is global to the renderer.
Font.registerHyphenationCallback((word) => [word])
```

- [ ] **Step 4: Create `src/pdf/quote-pricing.tsx`**

```tsx
import { View, Text, StyleSheet } from '@react-pdf/renderer'
import { aud } from '@/lib/format'
import type { PricingModel, TotalsRows } from '@/lib/quote-pricing'
import { palette, fontSize, font, tableStyles, totalsStyles } from './theme'

/**
 * Prints a PricingModel (see src/lib/quote-pricing.ts). Shared by the
 * standard QuotePdf and the templated QuoteDocPdf. Sell side only.
 */

// Itemised: Description | Qty | Unit | Rate | Total
const colFull = StyleSheet.create({
  description: { width: '46%' },
  qty: { width: '10%' },
  unit: { width: '12%' },
  rate: { width: '16%' },
  total: { width: '16%' },
})
// Itemised without qty/unit: Description | Rate | Total
const colNoQty = StyleSheet.create({
  description: { width: '68%' },
  rate: { width: '16%' },
  total: { width: '16%' },
})
// Section totals: Description | Qty | Unit (or Description only)
const colSec = StyleSheet.create({
  description: { width: '78%' },
  qty: { width: '10%' },
  unit: { width: '12%' },
  descriptionOnly: { width: '100%' },
})

const styles = StyleSheet.create({
  itemListTitle: {
    fontFamily: font.bold,
    fontSize: fontSize.sm,
    color: palette.slate700,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 8,
    marginBottom: 3,
  },
  itemRow: { flexDirection: 'row', gap: 5, paddingVertical: 1.5, paddingLeft: 4 },
  itemMark: { fontSize: fontSize.base, color: palette.slate500 },
  itemText: { flex: 1, fontSize: fontSize.base, color: palette.slate900, lineHeight: 1.4 },
  lumpBlock: { alignSelf: 'flex-start', width: 300, marginTop: 2 },
})

function Totals({ totals, style }: { totals: TotalsRows; style?: object }) {
  return (
    <View style={[totalsStyles.block, style ?? {}]} wrap={false}>
      {totals.rows.map((r, i) => (
        <View key={i} style={totalsStyles.row}>
          <Text style={totalsStyles.label}>{r.label}</Text>
          <Text style={totalsStyles.value}>{aud(r.value)}</Text>
        </View>
      ))}
      <View style={totalsStyles.grandRow}>
        <Text style={totalsStyles.grandLabel}>{totals.grand.label}</Text>
        <Text style={totalsStyles.grandValue}>{aud(totals.grand.value)}</Text>
      </View>
    </View>
  )
}

function SubtotalRow({ value }: { value: number }) {
  return (
    <View style={tableStyles.subtotalRow} wrap={false}>
      <Text style={tableStyles.subtotalLabel}>Section subtotal</Text>
      <Text style={tableStyles.subtotalValue}>{aud(value)}</Text>
    </View>
  )
}

export function PricingBlock({ model }: { model: PricingModel }) {
  if (model.mode === 'lump_sum') {
    return (
      <View>
        <Totals totals={model.totals} style={styles.lumpBlock} />
        {model.itemLists.map((list, i) => (
          <View key={i}>
            <Text style={styles.itemListTitle}>{list.title}</Text>
            {list.items.map((item, j) => (
              <View key={j} style={styles.itemRow} wrap={false}>
                <Text style={styles.itemMark}>•</Text>
                <Text style={styles.itemText}>{item}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    )
  }

  if (model.mode === 'section_totals') {
    const q = model.showQtyUnit
    return (
      <View>
        {model.sections.map((s, i) => (
          <View key={i} style={tableStyles.table} wrap>
            <View style={tableStyles.sectionTitleRow} minPresenceAhead={60}>
              <Text style={tableStyles.sectionTitle}>{s.title}</Text>
            </View>
            <View style={tableStyles.headRow}>
              <Text style={[tableStyles.headCell, q ? colSec.description : colSec.descriptionOnly]}>Description</Text>
              {q ? <Text style={[tableStyles.headCell, colSec.qty, tableStyles.right]}>Qty</Text> : null}
              {q ? <Text style={[tableStyles.headCell, colSec.unit, tableStyles.right]}>Unit</Text> : null}
            </View>
            {s.lines.map((l, j) => (
              <View key={j} style={tableStyles.row} wrap={false}>
                <Text style={[tableStyles.cell, q ? colSec.description : colSec.descriptionOnly]}>{l.description}</Text>
                {q ? <Text style={[tableStyles.cell, colSec.qty, tableStyles.right]}>{l.qty}</Text> : null}
                {q ? <Text style={[tableStyles.cellMuted, colSec.unit, tableStyles.right]}>{l.unit}</Text> : null}
              </View>
            ))}
            <SubtotalRow value={s.subtotal} />
          </View>
        ))}
        <Totals totals={model.totals} />
      </View>
    )
  }

  const q = model.showQtyUnit
  const col = q ? colFull : colNoQty
  return (
    <View>
      {model.sections.map((s, i) => (
        <View key={i} style={tableStyles.table} wrap>
          <View style={tableStyles.sectionTitleRow} minPresenceAhead={60}>
            <Text style={tableStyles.sectionTitle}>{s.title}</Text>
          </View>
          <View style={tableStyles.headRow}>
            <Text style={[tableStyles.headCell, col.description]}>Description</Text>
            {q ? <Text style={[tableStyles.headCell, colFull.qty, tableStyles.right]}>Qty</Text> : null}
            {q ? <Text style={[tableStyles.headCell, colFull.unit, tableStyles.right]}>Unit</Text> : null}
            <Text style={[tableStyles.headCell, col.rate, tableStyles.right]}>Rate</Text>
            <Text style={[tableStyles.headCell, col.total, tableStyles.right]}>Total</Text>
          </View>
          {s.lines.map((l, j) => (
            <View key={j} style={tableStyles.row} wrap={false}>
              <Text style={[tableStyles.cell, col.description]}>{l.description}</Text>
              {q ? <Text style={[tableStyles.cell, colFull.qty, tableStyles.right]}>{l.qty}</Text> : null}
              {q ? <Text style={[tableStyles.cellMuted, colFull.unit, tableStyles.right]}>{l.unit}</Text> : null}
              <Text style={[tableStyles.cell, col.rate, tableStyles.right]}>{aud(l.rate)}</Text>
              <Text style={[tableStyles.cell, col.total, tableStyles.right]}>{aud(l.total)}</Text>
            </View>
          ))}
          <SubtotalRow value={s.subtotal} />
        </View>
      ))}
      <Totals totals={model.totals} />
    </View>
  )
}
```

- [ ] **Step 5: Rewire `src/pdf/QuotePdf.tsx`**

Replace the imports at the top with:

```tsx
import { View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import { DEFAULT_PRICING, type PricingDisplay } from '@/lib/quote-doc'
import { buildPricingModel, type PricingLine, type PricingSection } from '@/lib/quote-pricing'
import { DocShell, type DocCompany } from './DocShell'
import { PricingBlock } from './quote-pricing'
import { palette, fontSize, font } from './theme'

export type QuotePdfLine = PricingLine
export type QuotePdfSection = PricingSection
```

Delete the old `QuotePdfLine`/`QuotePdfSection` type declarations (lines 7-17), the `col` StyleSheet, `fmtQty` and `SectionTable` (lines 127-176). Add to `QuotePdfProps`:

```tsx
  /** Pricing presentation (quotes.pdf_options); defaults to the itemised table. */
  display?: PricingDisplay
```

In the component signature add `display = DEFAULT_PRICING,` to the destructured props, and replace the `{sections.map(...)}` block plus the whole `<View style={totalsStyles.block} ...>` totals block with:

```tsx
      <PricingBlock model={buildPricingModel(sections, totals, display)} />
```

Remove `aud`, `pct`, `lineTotal`, `tableStyles`, `totalsStyles` imports if now unused (`aud`/`pct` were only used in the removed code).

- [ ] **Step 6: Run the tests, then all PDF tests**

Run: `npx vitest run tests/quote-pdf.test.tsx tests/po-pdf.test.tsx tests/form-pdf.test.tsx tests/programme-pdf.test.tsx tests/itp-lot-pdf.test.tsx`
Expected: PASS (the theme change touches every document).

- [ ] **Step 7: Type-check, lint, commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add src/pdf/quote-pricing.tsx src/pdf/QuotePdf.tsx src/pdf/theme.ts tests/quote-pdf.test.tsx
git commit -m "feat: PricingBlock with three display modes; standard quote PDF honours pdf_options; no hyphenation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Templated document (`src/pdf/QuoteDocPdf.tsx`)

**Files:**
- Create: `src/pdf/QuoteDocPdf.tsx`
- Test: `tests/quote-doc-pdf.test.tsx`

**Interfaces:**
- Consumes: `QuoteDoc`, `DetailRow` from `@/lib/quote-doc` (doc is ALREADY merged by the caller); `PricingModel`; `PricingBlock`; `DocShell`, `DocCompany`; `QuotePdfAcceptance` from `./QuotePdf`.
- Produces: `QuoteDocPdf(props: QuoteDocPdfProps)`.

```ts
export type QuoteDocPdfProps = {
  quote: { number: string; title: string; date: string }  // date = dd/MM/yyyy for the header bar
  company: DocCompany
  doc: QuoteDoc                 // merged
  details: DetailRow[]
  pricing: PricingModel
  quoteFooter?: string | null
  acceptance?: QuotePdfAcceptance | null
  watermark?: string | null
}
```

- [ ] **Step 1: Write the failing smoke tests**

`tests/quote-doc-pdf.test.tsx`:

```tsx
import { expect, test } from 'vitest'
import { renderToBuffer } from '@react-pdf/renderer'
import { QuoteDocPdf } from '../src/pdf/QuoteDocPdf'
import { DEFAULT_PRICING, starterDoc, type QuoteDoc } from '../src/lib/quote-doc'
import { buildPricingModel } from '../src/lib/quote-pricing'

const company = { name: 'Test Civil Pty Ltd', abn: '11 222 333 444', address: '1 Test St', phone: null, email: null, logoUrl: undefined }
const sections = [{ title: 'Works', lines: [{ description: 'Attendance', qty: 1, unit: 'ea', unit_sell: 1500 }] }]
const totals = { subtotal: 1500, gst: 150, gstRate: 10, total: 1650 }
const details = [
  { label: 'Quote no.', value: 'RQ26003' },
  { label: 'Issue date', value: '26 August 2026' },
  { label: 'Prepared for', value: 'Malcolm Civil (ABN 52 663 107 757), Attn: Dan\n11/126 Compton Road' },
  { label: 'Prepared by', value: 'Nicholas Jones  |  Director' },
  { label: 'Validity', value: '14 days from issue' },
]

function doc(): QuoteDoc {
  const d = starterDoc()
  d.heading = 'Asbestos Inspection, Sampling and Close-out'
  d.blocks = [
    { id: '1', type: 'table', heading: 'Scope and Deliverables', intro: 'ECR will attend the pit.', columns: ['Service', 'Included scope'], rows: [{ label: 'Site attendance', value: 'One attendance by an LAA.' }] },
    { id: '2', type: 'pricing', heading: 'Fixed Fee', note: 'The fee is a fixed sum.' },
    { id: '3', type: 'bullets', heading: 'Key Assumptions', items: ['Safe access.', 'Water supply.'] },
    { id: '4', type: 'text', heading: 'Notes', body: 'First paragraph.\n\nSecond paragraph.' },
    { id: '5', type: 'acceptance', heading: 'Acceptance', body: 'Sign below.' },
  ]
  return d
}

for (const mode of ['lump_sum', 'section_totals', 'itemised'] as const) {
  test(`templated quote renders in ${mode} mode`, async () => {
    const buffer = await renderToBuffer(
      <QuoteDocPdf
        quote={{ number: 'RQ26003', title: 'Unexpected find, Port Drive', date: '26/08/2026' }}
        company={company}
        doc={doc()}
        details={details}
        pricing={buildPricingModel(sections, totals, { ...DEFAULT_PRICING, mode })}
        quoteFooter="Fine print"
      />
    )
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
    expect(buffer.length).toBeGreaterThan(1000)
  })
}

test('templated quote renders portal acceptance evidence and a watermark', async () => {
  const buffer = await renderToBuffer(
    <QuoteDocPdf
      quote={{ number: 'RQ26003', title: 'T', date: '26/08/2026' }}
      company={company}
      doc={doc()}
      details={details}
      pricing={buildPricingModel(sections, totals, DEFAULT_PRICING)}
      acceptance={{ signerName: 'Dan', signedAtDisplay: '27 Aug 2026, 9:00 am', signatureUrl: null }}
      watermark="Issued to Malcolm Civil via the client portal"
    />
  )
  expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
})

test('templated quote without an acceptance block still prints portal evidence', async () => {
  const d = doc()
  d.blocks = d.blocks.filter((b) => b.type !== 'acceptance')
  const buffer = await renderToBuffer(
    <QuoteDocPdf
      quote={{ number: 'RQ26003', title: 'T', date: '26/08/2026' }}
      company={company}
      doc={d}
      details={details}
      pricing={buildPricingModel(sections, totals, DEFAULT_PRICING)}
      acceptance={{ signerName: 'Dan', signedAtDisplay: '27 Aug 2026, 9:00 am', signatureUrl: null }}
    />
  )
  expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/quote-doc-pdf.test.tsx`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Create `src/pdf/QuoteDocPdf.tsx`**

```tsx
import { View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import type { DetailRow, DocBlock, QuoteDoc } from '@/lib/quote-doc'
import type { PricingModel } from '@/lib/quote-pricing'
import { DocShell, type DocCompany } from './DocShell'
import { PricingBlock } from './quote-pricing'
import type { QuotePdfAcceptance } from './QuotePdf'
import { palette, fontSize, font, tableStyles } from './theme'

export type QuoteDocPdfProps = {
  quote: { number: string; title: string; date: string }
  company: DocCompany
  /** Merge fields already applied (mergeDoc). */
  doc: QuoteDoc
  details: DetailRow[]
  pricing: PricingModel
  quoteFooter?: string | null
  acceptance?: QuotePdfAcceptance | null
  watermark?: string | null
}

const styles = StyleSheet.create({
  serviceHeading: { fontFamily: font.bold, fontSize: fontSize.xl, color: palette.navy },
  jobLine: { fontSize: fontSize.md, color: palette.slate700, marginTop: 2, marginBottom: 12 },
  details: {
    borderTopWidth: 0.75,
    borderBottomWidth: 0.75,
    borderColor: palette.slate300,
    paddingVertical: 6,
    marginBottom: 6,
  },
  detailRow: { flexDirection: 'row', paddingVertical: 2.5 },
  detailLabel: {
    width: '20%',
    fontFamily: font.bold,
    fontSize: fontSize.xs,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingTop: 1,
  },
  detailValue: { width: '80%', fontSize: fontSize.base, color: palette.slate900, lineHeight: 1.4 },
  h: {
    fontFamily: font.bold,
    fontSize: fontSize.lg,
    color: palette.navy,
    marginTop: 14,
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 0.75,
    borderBottomColor: palette.slate300,
  },
  p: { fontSize: fontSize.base, color: palette.slate900, lineHeight: 1.5, marginBottom: 6 },
  bulletRow: { flexDirection: 'row', gap: 6, marginBottom: 3, paddingRight: 8 },
  bulletMark: { width: 8, fontSize: fontSize.base, color: palette.slate500 },
  bulletText: { flex: 1, fontSize: fontSize.base, color: palette.slate900, lineHeight: 1.5 },
  colLabel: { width: '30%', paddingRight: 8 },
  colValue: { width: '70%' },
  cellLabel: { fontFamily: font.bold, fontSize: fontSize.base, color: palette.slate700, lineHeight: 1.45 },
  cellValue: { fontSize: fontSize.base, color: palette.slate900, lineHeight: 1.45 },
  feeNote: { fontSize: fontSize.sm, color: palette.slate500, lineHeight: 1.5, marginTop: 6 },
  signGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, gap: 12 },
  signCell: {
    width: '47%',
    borderBottomWidth: 0.75,
    borderBottomColor: palette.slate400,
    paddingBottom: 4,
    marginBottom: 8,
  },
  signCellTall: { height: 48 },
  signLabel: {
    fontFamily: font.bold,
    fontSize: fontSize.xs,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  quoteFooter: { fontSize: fontSize.sm, color: palette.slate500, lineHeight: 1.5, marginTop: 14 },
  acceptanceBlock: {
    marginTop: 10,
    borderWidth: 0.75,
    borderColor: palette.slate300,
    borderRadius: 4,
    padding: 12,
    gap: 4,
  },
  acceptanceTitle: {
    fontFamily: font.bold,
    fontSize: fontSize.sm,
    color: palette.navy,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  acceptanceLine: { fontSize: fontSize.base, color: palette.slate700 },
  acceptanceSignature: {
    width: 180,
    height: 60,
    objectFit: 'contain',
    marginTop: 4,
    borderWidth: 0.5,
    borderColor: palette.slate300,
  },
})

function Heading({ n, text }: { n: number | null; text: string }) {
  return (
    <Text style={styles.h} minPresenceAhead={80}>
      {n === null ? text : `${n}. ${text}`}
    </Text>
  )
}

function Paragraphs({ body }: { body: string }) {
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  return (
    <>
      {paras.map((p, i) => (
        <Text key={i} style={styles.p}>
          {p}
        </Text>
      ))}
    </>
  )
}

function Bullets({ items }: { items: string[] }) {
  return (
    <View style={{ marginBottom: 4 }}>
      {items.map((item, i) => (
        <View key={i} style={styles.bulletRow} wrap={false}>
          <Text style={styles.bulletMark}>•</Text>
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  )
}

function TwoColTable({ columns, rows }: { columns: [string, string]; rows: { label: string; value: string }[] }) {
  return (
    <View style={tableStyles.table} wrap>
      <View style={tableStyles.headRow}>
        <Text style={[tableStyles.headCell, styles.colLabel]}>{columns[0]}</Text>
        <Text style={[tableStyles.headCell, styles.colValue]}>{columns[1]}</Text>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={tableStyles.row} wrap={false}>
          <Text style={[styles.cellLabel, styles.colLabel]}>{r.label}</Text>
          <Text style={[styles.cellValue, styles.colValue]}>{r.value}</Text>
        </View>
      ))}
    </View>
  )
}

function SignBlock() {
  const cell = (label: string, tall = false) => (
    <View style={[styles.signCell, tall ? styles.signCellTall : {}]}>
      <Text style={styles.signLabel}>{label}</Text>
    </View>
  )
  return (
    <View style={styles.signGrid} wrap={false}>
      {cell('Accepted by')}
      {cell('Company and PO no.')}
      {cell('Signature', true)}
      {cell('Date', true)}
    </View>
  )
}

function PortalEvidence({ acceptance, clientLine }: { acceptance: QuotePdfAcceptance; clientLine: string }) {
  return (
    <View style={styles.acceptanceBlock} wrap={false}>
      <Text style={styles.acceptanceTitle}>Accepted via client portal</Text>
      <Text style={styles.acceptanceLine}>Accepted by {acceptance.signerName}{clientLine}</Text>
      <Text style={styles.acceptanceLine}>{acceptance.signedAtDisplay}</Text>
      {acceptance.signatureUrl ? (
        // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop
        <Image src={acceptance.signatureUrl} style={styles.acceptanceSignature} />
      ) : null}
    </View>
  )
}

function Block({ block, n, pricing, acceptance }: { block: DocBlock; n: number | null; pricing: PricingModel; acceptance: QuotePdfAcceptance | null }) {
  switch (block.type) {
    case 'text':
      return (
        <View>
          <Heading n={n} text={block.heading} />
          <Paragraphs body={block.body} />
        </View>
      )
    case 'bullets':
      return (
        <View>
          <Heading n={n} text={block.heading} />
          <Bullets items={block.items} />
        </View>
      )
    case 'table':
      return (
        <View>
          <Heading n={n} text={block.heading} />
          {block.intro ? <Paragraphs body={block.intro} /> : null}
          <TwoColTable columns={block.columns} rows={block.rows} />
        </View>
      )
    case 'pricing':
      return (
        <View>
          <Heading n={n} text={block.heading} />
          <PricingBlock model={pricing} />
          {block.note ? <Text style={styles.feeNote}>{block.note}</Text> : null}
        </View>
      )
    case 'acceptance':
      return (
        <View>
          <Heading n={n} text={block.heading} />
          <Paragraphs body={block.body} />
          {acceptance ? <PortalEvidence acceptance={acceptance} clientLine="" /> : <SignBlock />}
        </View>
      )
  }
}

/**
 * Templated client-facing quotation (quotes.doc snapshot). Sell side only —
 * the pricing model carries no cost or markup by construction.
 */
export function QuoteDocPdf({ quote, company, doc, details, pricing, quoteFooter, acceptance, watermark }: QuoteDocPdfProps) {
  const hasAcceptanceBlock = doc.blocks.some((b) => b.type === 'acceptance')
  return (
    <DocShell title={doc.doc_title} docNumber={quote.number} docDate={quote.date} company={company} watermark={watermark}>
      {doc.heading ? <Text style={styles.serviceHeading}>{doc.heading}</Text> : null}
      <Text style={[styles.jobLine, doc.heading ? {} : { fontFamily: font.bold, fontSize: fontSize.xl, color: palette.navy }]}>
        {quote.title}
      </Text>

      <View style={styles.details}>
        {details.map((d, i) => (
          <View key={i} style={styles.detailRow}>
            <Text style={styles.detailLabel}>{d.label}</Text>
            <Text style={styles.detailValue}>{d.value}</Text>
          </View>
        ))}
      </View>

      {doc.blocks.map((block, i) => (
        <Block
          key={block.id}
          block={block}
          n={doc.number_headings ? i + 1 : null}
          pricing={pricing}
          acceptance={acceptance ?? null}
        />
      ))}

      {!hasAcceptanceBlock && acceptance ? <PortalEvidence acceptance={acceptance} clientLine="" /> : null}

      {quoteFooter ? <Text style={styles.quoteFooter}>{quoteFooter}</Text> : null}
    </DocShell>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/quote-doc-pdf.test.tsx`
Expected: PASS.

- [ ] **Step 5: Type-check, lint, commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add src/pdf/QuoteDocPdf.tsx tests/quote-doc-pdf.test.tsx
git commit -m "feat: templated quote PDF document (blocks, details, sign block, portal evidence)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Builder picks the document (`src/pdf/build-quote-pdf.tsx`)

**Files:**
- Modify: `src/pdf/build-quote-pdf.tsx:16-146`

**Interfaces:**
- Consumes: `quoteDocSchema`, `pricingDisplaySchema`, `DEFAULT_PRICING`, `buildMergeContext`, `buildDetailsRows`, `mergeDoc`, `MergeSource` from `@/lib/quote-doc`; `buildPricingModel` from `@/lib/quote-pricing`; `QuoteDocPdf`.
- Produces: unchanged signature `buildQuotePdfResponse(supabase, id, opts)`; the office route and the portal proxy need no change.

- [ ] **Step 1: Widen the quote query**

Replace the `quotes` select string (line 31) with:

```ts
        '*, clients(name, abn, address), sites(name, address, suburb, state, postcode), contacts(name, role, email, phone), profiles!quotes_pm_id_fkey(full_name, phone, position)'
```

- [ ] **Step 2: Parse the saved options and doc, then branch**

Add imports:

```ts
import {
  DEFAULT_PRICING,
  buildDetailsRows,
  buildMergeContext,
  mergeDoc,
  pricingDisplaySchema,
  quoteDocSchema,
  type MergeSource,
} from '@/lib/quote-doc'
import { buildPricingModel } from '@/lib/quote-pricing'
import { QuoteDocPdf } from '@/pdf/QuoteDocPdf'
```

Replace the `const buffer = await renderToBuffer(<QuotePdf .../>)` statement with:

```ts
  const displayParsed = pricingDisplaySchema.safeParse(quote.pdf_options)
  const display = displayParsed.success ? displayParsed.data : DEFAULT_PRICING
  const docParsed = quote.doc ? quoteDocSchema.safeParse(quote.doc) : null
  const gstRate = Number(quote.gst_rate)
  const quoteFooter = (settings?.quote_footer as string | null) ?? null
  const company = toDocCompany(settings)

  let buffer: Buffer
  if (docParsed?.success) {
    const client = quote.clients as { name: string; abn: string | null; address: string | null } | null
    const contact = quote.contacts as { name: string; role: string | null; email: string | null; phone: string | null } | null
    const pm = quote.profiles as { full_name: string; phone: string | null; position: string | null } | null
    const src: MergeSource = {
      quote: {
        number: quote.number,
        title: quote.title,
        date: (quote.sent_at ?? quote.created_at) as string,
        valid_days: quote.valid_days,
        subtotal: totals.subtotal,
        gst: totals.gst,
        total: totals.total,
      },
      client,
      contact,
      site: site ? { name: site.name, address: siteAddress } : null,
      pm,
      company: {
        name: company.name,
        abn: company.abn,
        address: company.address,
        phone: company.phone,
        email: company.email,
      },
    }
    const ctx = buildMergeContext(src)
    buffer = await renderToBuffer(
      <QuoteDocPdf
        quote={{ number: quote.number, title: quote.title, date: fmtDate(quote.sent_at ?? quote.created_at) }}
        company={company}
        doc={mergeDoc(docParsed.data, ctx)}
        details={buildDetailsRows(src, docParsed.data.validity_text)}
        pricing={buildPricingModel(pdfSections, { ...totals, gstRate }, display)}
        quoteFooter={quoteFooter}
        acceptance={acceptance}
        watermark={opts.watermark ?? null}
      />
    )
  } else {
    buffer = await renderToBuffer(
      <QuotePdf
        quote={{
          number: quote.number,
          title: quote.title,
          date: fmtDate(quote.sent_at ?? quote.created_at),
          clientName: (quote.clients as { name: string } | null)?.name ?? '—',
          contactName: (quote.contacts as { name: string } | null)?.name ?? null,
          siteName: site?.name ?? null,
          siteAddress,
        }}
        company={company}
        sections={pdfSections}
        totals={{ ...totals, gstRate }}
        validDays={quote.valid_days}
        description={quote.description}
        quoteFooter={quoteFooter}
        acceptance={acceptance}
        watermark={opts.watermark ?? null}
        display={display}
      />
    )
  }
```

Update the module doc comment (lines 8-15) to add: "Renders the templated QuoteDocPdf when the quote carries a doc snapshot, otherwise the standard QuotePdf; both honour quotes.pdf_options."

- [ ] **Step 3: Type-check and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 4: Manual check against the live app**

Start the dev server (PowerShell): `$env:NODE_EXTRA_CA_CERTS='C:\Users\nickj\norton-tls-npm-workaround'; npm run dev`. Log in as admin, open any quote, click PDF. Expected: the PDF looks exactly as before (no doc, no options → standard itemised).

- [ ] **Step 5: Commit**

```bash
git add src/pdf/build-quote-pdf.tsx
git commit -m "feat: quote PDF builder renders the doc snapshot and pricing display saved on the quote

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Template CRUD server actions (Settings)

**Files:**
- Modify: `src/app/(office)/settings/actions.ts` (append a new section after the takeoff assembly actions, ~line 780)

**Interfaces:**
- Consumes: `quoteTemplateSchema`, `normaliseBlocks` from `@/lib/quote-doc`; `requireRole`, `createSupabaseClient`, `revalidatePath` already imported in the file.
- Produces:
  - `createQuoteTemplate(data: unknown): Promise<{ error?: string; id?: string }>`
  - `updateQuoteTemplate(id: string, data: unknown): Promise<{ error?: string }>`
  - `setQuoteTemplateActive(id: string, active: boolean): Promise<{ error?: string }>`
  - `setDefaultQuoteTemplate(id: string): Promise<{ error?: string }>`

- [ ] **Step 1: Add the actions**

Add to the imports: `import { normaliseBlocks, quoteTemplateSchema } from '@/lib/quote-doc'`. Append:

```ts
// ─── Quote templates ─────────────────────────────────────────────────────────

/** Validates editor output; blocks are normalised (trimmed, empties dropped) first. */
function parseTemplate(data: unknown) {
  const pre = data as { blocks?: unknown }
  const withClean =
    pre && Array.isArray(pre.blocks)
      ? { ...(data as object), blocks: normaliseBlocks(pre.blocks as Parameters<typeof normaliseBlocks>[0]) }
      : data
  return quoteTemplateSchema.safeParse(withClean)
}

export async function createQuoteTemplate(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  const profile = await requireRole('admin')

  const parsed = parseTemplate(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createSupabaseClient()
  const { data: row, error } = await supabase
    .from('quote_templates')
    .insert({ ...parsed.data, created_by: profile.id })
    .select('id')
    .single()
  if (error) return { error: error.message }

  revalidatePath('/settings')
  revalidatePath('/quotes')
  return { id: row.id as string }
}

export async function updateQuoteTemplate(
  id: string,
  data: unknown
): Promise<{ error?: string }> {
  await requireRole('admin')

  const parsed = parseTemplate(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  // The uploaded original never changes through an edit.
  const { source_path: _sp, source_filename: _sf, ...rest } = parsed.data
  void _sp
  void _sf

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from('quote_templates')
    .update({ ...rest, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/settings')
  revalidatePath('/quotes')
  return {}
}

export async function setQuoteTemplateActive(
  id: string,
  active: boolean
): Promise<{ error?: string }> {
  await requireRole('admin')

  const supabase = await createSupabaseClient()
  // A deactivated template cannot stay the default (partial unique index).
  const patch = active ? { active } : { active, is_default: false }
  const { error } = await supabase.from('quote_templates').update(patch).eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/settings')
  revalidatePath('/quotes')
  return {}
}

export async function setDefaultQuoteTemplate(id: string): Promise<{ error?: string }> {
  await requireRole('admin')

  const supabase = await createSupabaseClient()
  const { data: target } = await supabase
    .from('quote_templates')
    .select('id, active')
    .eq('id', id)
    .maybeSingle()
  if (!target) return { error: 'Template not found' }
  if (!target.active) return { error: 'Activate the template before making it the default' }

  const { error: clearErr } = await supabase
    .from('quote_templates')
    .update({ is_default: false })
    .eq('is_default', true)
  if (clearErr) return { error: clearErr.message }

  const { error } = await supabase
    .from('quote_templates')
    .update({ is_default: true })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/settings')
  revalidatePath('/quotes')
  return {}
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean. If lint flags the unused destructured names, replace the destructure with `const rest = { ...parsed.data }; delete rest.source_path; delete rest.source_filename` (cast `rest` as `Partial<typeof parsed.data>` first).

- [ ] **Step 3: Commit**

```bash
git add "src/app/(office)/settings/actions.ts"
git commit -m "feat: quote template create/update/activate/default actions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: PDF import — OpenAI extraction and the import action

**Files:**
- Create: `src/lib/extract-quote-template.ts`
- Modify: `src/app/(office)/settings/actions.ts` (append `importQuoteTemplate`)
- Test: `tests/extract-quote-template.test.ts`

**Interfaces:**
- Consumes: `extractionEnabled`, `MAX_REPORT_BYTES` from `@/lib/extract-takeoff`; `MERGE_FIELDS`, `newBlockId`, `unknownMergeTokens`, `quoteTemplateSchema`, `DEFAULT_PRICING`, `ACCEPTANCE_BODY`, `QuoteTemplateInput`, `DocBlock` from `@/lib/quote-doc`.
- Produces:
  - `ExtractedTemplate` (raw model output type), `extractQuoteTemplate(pdfBase64): Promise<{ result?: ExtractedTemplate; error?: string }>`
  - `draftFromExtraction(raw: ExtractedTemplate, name: string): { draft: QuoteTemplateInput; notes: string[] }` — pure
  - server action `importQuoteTemplate(input: unknown): Promise<{ error?: string; draft?: QuoteTemplateInput; notes?: string[] }>`

- [ ] **Step 1: Write the failing mapper tests**

`tests/extract-quote-template.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { draftFromExtraction, type ExtractedTemplate } from '../src/lib/extract-quote-template'
import { quoteTemplateSchema } from '../src/lib/quote-doc'

const block = (b: Partial<ExtractedTemplate['blocks'][number]>): ExtractedTemplate['blocks'][number] => ({
  type: 'text', heading: 'H', body: null, items: [], intro: null, columns: [], rows: [], note: null, ...b,
})

const RAW: ExtractedTemplate = {
  doc_title: 'Quotation',
  heading: 'Asbestos Inspection, Sampling and Close-out',
  validity_text: '{{quote.valid_days}} days from issue unless otherwise stated',
  pricing_mode: 'lump_sum',
  fee_label: 'Fixed fee',
  notes: ['Project line had no matching field'],
  blocks: [
    block({ type: 'table', heading: 'Scope and Deliverables', intro: 'ECR will attend the pit at {{site.name}}.', columns: ['Service', 'Included scope'], rows: [{ label: 'Site attendance', value: 'One attendance by an LAA.' }] }),
    block({ type: 'pricing', heading: 'Fixed Fee', note: 'The fee is a fixed sum.' }),
    block({ type: 'bullets', heading: 'Key Assumptions', items: ['Safe access for {{client.name}}.', ''] }),
    block({ type: 'acceptance', heading: 'Acceptance', body: 'Sign and return to {{company.name}}.' }),
  ],
}

describe('draftFromExtraction', () => {
  test('maps a good extraction to a valid template draft', () => {
    const { draft, notes } = draftFromExtraction(RAW, 'Asbestos inspection')
    expect(quoteTemplateSchema.safeParse(draft).success).toBe(true)
    expect(draft.name).toBe('Asbestos inspection')
    expect(draft.heading).toBe(RAW.heading)
    expect(draft.pricing_defaults).toMatchObject({ mode: 'lump_sum', fee_label: 'Fixed fee' })
    expect(draft.blocks.map((b) => b.type)).toEqual(['table', 'pricing', 'bullets', 'acceptance'])
    expect(draft.blocks[2]).toMatchObject({ items: ['Safe access for {{client.name}}.'] })
    expect(notes).toEqual(['Project line had no matching field'])
    expect(new Set(draft.blocks.map((b) => b.id)).size).toBe(4)
  })

  test('adds a pricing block when the extraction has none, with a note', () => {
    const raw = { ...RAW, blocks: RAW.blocks.filter((b) => b.type !== 'pricing') }
    const { draft, notes } = draftFromExtraction(raw, 'X')
    expect(draft.blocks.filter((b) => b.type === 'pricing')).toHaveLength(1)
    expect(draft.blocks.at(-1)).toMatchObject({ type: 'pricing', heading: 'Fee' })
    expect(notes.some((n) => /pricing block/i.test(n))).toBe(true)
  })

  test('keeps the first pricing/acceptance block and downgrades extras to text', () => {
    const raw = { ...RAW, blocks: [...RAW.blocks, block({ type: 'pricing', heading: 'Rates', note: 'Hourly rates.' }), block({ type: 'acceptance', heading: 'Sign-off', body: 'Again.' })] }
    const { draft, notes } = draftFromExtraction(raw, 'X')
    expect(draft.blocks.filter((b) => b.type === 'pricing')).toHaveLength(1)
    expect(draft.blocks.filter((b) => b.type === 'acceptance')).toHaveLength(1)
    expect(draft.blocks[4]).toEqual(expect.objectContaining({ type: 'text', heading: 'Rates', body: 'Hourly rates.' }))
    expect(draft.blocks[5]).toEqual(expect.objectContaining({ type: 'text', heading: 'Sign-off', body: 'Again.' }))
    expect(notes.filter((n) => /converted to text/i.test(n))).toHaveLength(2)
  })

  test('rewrites unknown merge tokens as bracketed text and notes them', () => {
    const raw = { ...RAW, blocks: [RAW.blocks[1], block({ type: 'text', heading: 'Project', body: 'Project: {{project.name}} for {{client.name}}' })] }
    const { draft, notes } = draftFromExtraction(raw, 'X')
    expect(draft.blocks[1]).toMatchObject({ body: 'Project: [project.name] for {{client.name}}' })
    expect(notes.some((n) => n.includes('{{project.name}}'))).toBe(true)
    expect(quoteTemplateSchema.safeParse(draft).success).toBe(true)
  })

  test('falls back to defaults for missing title, validity, columns and fee label', () => {
    const raw: ExtractedTemplate = { ...RAW, doc_title: '', validity_text: '', fee_label: null, pricing_mode: 'itemised', blocks: [RAW.blocks[1], block({ type: 'table', heading: 'T', columns: [], rows: [{ label: 'a', value: 'b' }] })] }
    const { draft } = draftFromExtraction(raw, 'X')
    expect(draft.doc_title).toBe('Quotation')
    expect(draft.validity_text).toBe('{{quote.valid_days}} days from issue unless otherwise stated')
    expect(draft.pricing_defaults).toMatchObject({ mode: 'itemised', fee_label: 'Fixed fee' })
    expect(draft.blocks[1]).toMatchObject({ columns: ['Item', 'Detail'] })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/extract-quote-template.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Create `src/lib/extract-quote-template.ts`**

```ts
import OpenAI from 'openai'
import {
  ACCEPTANCE_BODY,
  DEFAULT_PRICING,
  MERGE_FIELDS,
  newBlockId,
  unknownMergeTokens,
  type DocBlock,
  type QuoteTemplateInput,
} from '@/lib/quote-doc'

/**
 * OpenAI-powered import of an existing quote PDF into a structured quote
 * template. Same dormant-until-OPENAI_API_KEY pattern as extract-takeoff.ts.
 * The model returns a loose shape; draftFromExtraction turns it into a valid
 * QuoteTemplateInput (pure, tested) for the admin to review before saving.
 */

const EXTRACTION_MODEL = 'gpt-5'

export type ExtractedBlock = {
  type: 'text' | 'bullets' | 'table' | 'pricing' | 'acceptance'
  heading: string
  body: string | null
  items: string[]
  intro: string | null
  columns: string[]
  rows: { label: string; value: string }[]
  note: string | null
}

export type ExtractedTemplate = {
  doc_title: string
  heading: string | null
  validity_text: string
  pricing_mode: 'lump_sum' | 'itemised'
  fee_label: string | null
  notes: string[]
  blocks: ExtractedBlock[]
}

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    doc_title: { type: 'string', description: 'Document type printed in the header, usually "Quotation"' },
    heading: { type: ['string', 'null'], description: 'Service heading under the document type, e.g. "Asbestos Inspection, Sampling and Close-out". Null if none.' },
    validity_text: { type: 'string', description: 'The validity sentence with the number of days replaced by {{quote.valid_days}}' },
    pricing_mode: { type: 'string', enum: ['lump_sum', 'itemised'], description: 'lump_sum when the document shows a single fee; itemised when it lists priced line items' },
    fee_label: { type: ['string', 'null'], description: 'Label used for the fee, e.g. "Fixed fee". Null if not applicable.' },
    notes: { type: 'array', items: { type: 'string' }, description: 'Anything you could not place, one short note each' },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['text', 'bullets', 'table', 'pricing', 'acceptance'] },
          heading: { type: 'string' },
          body: { type: ['string', 'null'], description: 'text/acceptance: paragraphs separated by a blank line' },
          items: { type: 'array', items: { type: 'string' }, description: 'bullets: one entry per bullet' },
          intro: { type: ['string', 'null'], description: 'table: paragraph printed above the table' },
          columns: { type: 'array', items: { type: 'string' }, description: 'table: exactly two column headings' },
          rows: {
            type: 'array',
            items: {
              type: 'object',
              properties: { label: { type: 'string' }, value: { type: 'string' } },
              required: ['label', 'value'],
              additionalProperties: false,
            },
          },
          note: { type: ['string', 'null'], description: 'pricing: sentence printed under the fee' },
        },
        required: ['type', 'heading', 'body', 'items', 'intro', 'columns', 'rows', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['doc_title', 'heading', 'validity_text', 'pricing_mode', 'fee_label', 'notes', 'blocks'],
  additionalProperties: false,
} as const

const EXTRACTION_PROMPT = `You are converting a finished quotation PDF from an Australian civil, asbestos and remediation contractor into a reusable quote TEMPLATE.

Split the document into ordered blocks in the order they appear. Block types:
- text: heading + paragraphs (separate paragraphs with a blank line)
- bullets: heading + one item per bullet
- table: heading + optional intro paragraph + exactly two column headings + rows (label, value). Use this for two-column lists such as "Service | Included scope", "Potential variation | Indicative rate", and term-by-term standard terms.
- pricing: the fee / price section. Do NOT copy the amounts; the app prints the price. Put any explanatory sentence in "note". Emit exactly one pricing block.
- acceptance: the sign-off section. Put the instruction paragraph in "body". The app prints the signature lines. Emit at most one.

Do NOT create blocks for the header details (quote number, issue date, prepared for, site, prepared by, validity) — the app prints those itself. Put the document type in doc_title, the service heading in heading, and the validity sentence in validity_text with the number of days replaced by {{quote.valid_days}}.

Keep the wording verbatim. Replace job-specific details with these merge fields and nothing else:
${MERGE_FIELDS.map((f) => `{{${f}}}`).join(', ')}
Examples: the client company name → {{client.name}}; the client contact → {{contact.name}}; their role → {{contact.role}}; the site or address → {{site.name}} / {{site.address}}; the quoting company → {{company.name}}; the person who prepared it → {{pm.name}}; the total fee → {{quote.total}}; the ex-GST fee → {{quote.subtotal}}. Leave generic sentences alone. Dates and quantities that describe THIS job (e.g. "Friday 28 August 2026", "one sample") stay as written; the user edits them per quote.

pricing_mode is "lump_sum" when the document presents a single fee, "itemised" when it lists priced line items. fee_label is the label used for the fee (e.g. "Fixed fee").

List anything you could not place in notes.`

export function extractionEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY)
}

/** Sends the PDF to OpenAI and returns the loose extraction. Caller checks size and enablement. */
export async function extractQuoteTemplate(
  pdfBase64: string
): Promise<{ result?: ExtractedTemplate; error?: string }> {
  const client = new OpenAI()
  try {
    const response = await client.responses.create({
      model: EXTRACTION_MODEL,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_file', filename: 'quote.pdf', file_data: `data:application/pdf;base64,${pdfBase64}` },
            { type: 'input_text', text: EXTRACTION_PROMPT },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'quote_template_extraction',
          schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
          strict: true,
        },
      },
    })

    if (response.status === 'incomplete') {
      return { error: 'The document is too long to import in one pass' }
    }
    const text = response.output_text
    if (!text) return { error: 'Import returned no result — retry' }
    return { result: JSON.parse(text) as ExtractedTemplate }
  } catch (error) {
    if (error instanceof OpenAI.AuthenticationError) {
      return { error: 'OPENAI_API_KEY is invalid — check the environment configuration' }
    }
    if (error instanceof OpenAI.RateLimitError) {
      return { error: 'Import is rate-limited right now — try again in a minute' }
    }
    if (error instanceof OpenAI.APIConnectionError) {
      return { error: 'Could not reach the OpenAI API — check connectivity and retry' }
    }
    if (error instanceof OpenAI.APIError) {
      return { error: `Import failed (${error.status ?? 'API error'}): ${error.message}` }
    }
    if (error instanceof SyntaxError) {
      return { error: 'Import returned an unreadable result — retry' }
    }
    throw error
  }
}

const DEFAULT_VALIDITY = '{{quote.valid_days}} days from issue unless otherwise stated'

/** Replaces `{{unknown}}` with `[unknown]` so the draft validates; records a note per token. */
function scrub(text: string, notes: string[]): string {
  for (const key of unknownMergeTokens(text)) {
    notes.push(`Unrecognised merge field {{${key}}} was kept as plain text [${key}]`)
  }
  return text.replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, (whole, key: string) =>
    (MERGE_FIELDS as readonly string[]).includes(key) ? whole : `[${key}]`
  )
}

/** Pure mapping from the model's loose output to a valid template draft plus review notes. */
export function draftFromExtraction(raw: ExtractedTemplate, name: string): { draft: QuoteTemplateInput; notes: string[] } {
  const notes: string[] = [...(raw.notes ?? [])]
  const blocks: DocBlock[] = []
  let pricingSeen = false
  let acceptanceSeen = false

  for (const b of raw.blocks ?? []) {
    const heading = scrub((b.heading ?? '').trim() || 'Section', notes)
    const asText = (body: string) => blocks.push({ id: newBlockId(), type: 'text', heading, body: scrub(body, notes) })

    switch (b.type) {
      case 'text':
        asText(b.body ?? '')
        break
      case 'bullets':
        blocks.push({ id: newBlockId(), type: 'bullets', heading, items: (b.items ?? []).map((i) => scrub(i.trim(), notes)).filter(Boolean) })
        break
      case 'table': {
        const cols = (b.columns ?? []).map((c) => c.trim()).filter(Boolean)
        blocks.push({
          id: newBlockId(),
          type: 'table',
          heading,
          intro: b.intro?.trim() ? scrub(b.intro.trim(), notes) : undefined,
          columns: [cols[0] ?? 'Item', cols[1] ?? 'Detail'],
          rows: (b.rows ?? []).map((r) => ({ label: scrub(r.label.trim(), notes), value: scrub(r.value.trim(), notes) })).filter((r) => r.label || r.value),
        })
        break
      }
      case 'pricing':
        if (pricingSeen) {
          notes.push(`Second pricing section "${heading}" converted to text`)
          asText(b.note ?? b.body ?? '')
        } else {
          pricingSeen = true
          blocks.push({ id: newBlockId(), type: 'pricing', heading, note: b.note?.trim() ? scrub(b.note.trim(), notes) : undefined })
        }
        break
      case 'acceptance':
        if (acceptanceSeen) {
          notes.push(`Second acceptance section "${heading}" converted to text`)
          asText(b.body ?? '')
        } else {
          acceptanceSeen = true
          blocks.push({ id: newBlockId(), type: 'acceptance', heading, body: scrub((b.body ?? '').trim() || ACCEPTANCE_BODY, notes) })
        }
        break
    }
  }

  if (!pricingSeen) {
    notes.push('No fee section was found, so a pricing block was added at the end')
    blocks.push({ id: newBlockId(), type: 'pricing', heading: 'Fee' })
  }

  const draft: QuoteTemplateInput = {
    name,
    doc_title: (raw.doc_title ?? '').trim() || 'Quotation',
    heading: raw.heading?.trim() ? scrub(raw.heading.trim(), notes) : null,
    validity_text: raw.validity_text?.trim() ? scrub(raw.validity_text.trim(), notes) : DEFAULT_VALIDITY,
    number_headings: true,
    blocks,
    pricing_defaults: {
      ...DEFAULT_PRICING,
      mode: raw.pricing_mode === 'lump_sum' ? 'lump_sum' : 'itemised',
      fee_label: raw.fee_label?.trim() || DEFAULT_PRICING.fee_label,
    },
    source_path: null,
    source_filename: null,
  }
  return { draft, notes }
}
```

- [ ] **Step 4: Run the mapper tests**

Run: `npx vitest run tests/extract-quote-template.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the import server action**

In `src/app/(office)/settings/actions.ts` add imports:

```ts
import { z } from 'zod'
import { MAX_TEMPLATE_PDF_BYTES } from '@/lib/quote-doc'
import { draftFromExtraction, extractQuoteTemplate, extractionEnabled } from '@/lib/extract-quote-template'
```

Append after the template CRUD actions:

```ts
const importInputSchema = z.object({
  path: z.string().regex(/^quote-templates\/[A-Za-z0-9._-]+$/, 'Bad upload path'),
  filename: z.string().min(1).max(200),
  name: z.string().trim().min(1, 'Name is required').max(80),
})

/**
 * Reads an uploaded quote PDF (attachments bucket, quote-templates/ prefix)
 * and returns a template DRAFT for review. Nothing is inserted here; the
 * browser calls createQuoteTemplate after the admin checks the result, and
 * removes the upload if they cancel or this fails.
 */
export async function importQuoteTemplate(
  input: unknown
): Promise<{ error?: string; draft?: QuoteTemplateInput; notes?: string[] }> {
  await requireRole('admin')

  const parsed = importInputSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }
  if (!extractionEnabled()) {
    return { error: 'Add OPENAI_API_KEY to the environment to enable PDF import' }
  }

  const supabase = await createSupabaseClient()
  const { data: blob, error: downloadError } = await supabase.storage
    .from('attachments')
    .download(parsed.data.path)
  if (downloadError || !blob) {
    return { error: downloadError?.message ?? 'Could not read the uploaded PDF' }
  }
  const bytes = Buffer.from(await blob.arrayBuffer())
  if (bytes.byteLength > MAX_TEMPLATE_PDF_BYTES) {
    return { error: 'This PDF is over 20MB' }
  }
  if (bytes.subarray(0, 4).toString() !== '%PDF') {
    return { error: 'That file is not a PDF' }
  }

  const result = await extractQuoteTemplate(bytes.toString('base64'))
  if (result.error || !result.result) return { error: result.error ?? 'Import failed' }
  if ((result.result.blocks ?? []).length === 0) {
    return { error: 'No sections were recognised in this document' }
  }

  const { draft, notes } = draftFromExtraction(result.result, parsed.data.name)
  return {
    draft: { ...draft, source_path: parsed.data.path, source_filename: parsed.data.filename },
    notes,
  }
}
```

Also add `import type { QuoteTemplateInput } from '@/lib/quote-doc'` (merge into the existing quote-doc import).

- [ ] **Step 6: Type-check, lint, commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add src/lib/extract-quote-template.ts tests/extract-quote-template.test.ts "src/app/(office)/settings/actions.ts"
git commit -m "feat: import a quote PDF into a template draft via OpenAI structured extraction

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Shared block editor (`src/components/DocBlocksEditor.tsx`)

**Files:**
- Create: `src/components/DocBlocksEditor.tsx`
- Test: `tests/doc-blocks-editor.test.tsx`

**Interfaces:**
- Consumes: `DocBlock`, `MERGE_FIELDS`, `newBlockId` from `@/lib/quote-doc`; UI: `Button`, `Input`, `Textarea`, `Badge`, `DropdownMenu*`.
- Produces: `DocBlocksEditor({ value, onChange, disabled })` — controlled; emits the full next `DocBlock[]` on every change. Also `MergeFieldLegend()`.

- [ ] **Step 1: Write the failing test (jsdom)**

`tests/doc-blocks-editor.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DocBlocksEditor } from '../src/components/DocBlocksEditor'
import type { DocBlock } from '../src/lib/quote-doc'

const BLOCKS: DocBlock[] = [
  { id: 'b1', type: 'bullets', heading: 'Exclusions', items: ['one', 'two'] },
  { id: 'p1', type: 'pricing', heading: 'Fee', note: 'Fixed.' },
  { id: 't1', type: 'table', heading: 'Terms', columns: ['Term', 'Detail'], rows: [{ label: 'Payment', value: '14 days' }] },
]

describe('DocBlocksEditor', () => {
  test('renders one card per block with heading inputs', () => {
    render(<DocBlocksEditor value={BLOCKS} onChange={() => {}} />)
    expect(screen.getByDisplayValue('Exclusions')).toBeTruthy()
    expect(screen.getByDisplayValue('Fee')).toBeTruthy()
    expect(screen.getByDisplayValue('Terms')).toBeTruthy()
  })

  test('editing the bullets textarea emits split items', () => {
    const onChange = vi.fn()
    render(<DocBlocksEditor value={BLOCKS} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Bullet items'), { target: { value: 'one\ntwo\nthree' } })
    expect(onChange).toHaveBeenCalledWith([{ ...BLOCKS[0], items: ['one', 'two', 'three'] }, BLOCKS[1], BLOCKS[2]])
  })

  test('editing a table cell emits the updated row', () => {
    const onChange = vi.fn()
    render(<DocBlocksEditor value={BLOCKS} onChange={onChange} />)
    fireEvent.change(screen.getByDisplayValue('14 days'), { target: { value: '30 days' } })
    expect(onChange.mock.calls[0][0][2]).toMatchObject({ rows: [{ label: 'Payment', value: '30 days' }] })
  })

  test('the pricing block has no delete button; others do; move down reorders', () => {
    const onChange = vi.fn()
    render(<DocBlocksEditor value={BLOCKS} onChange={onChange} />)
    expect(screen.getAllByLabelText('Delete block')).toHaveLength(2)
    fireEvent.click(screen.getAllByLabelText('Move down')[0])
    expect(onChange).toHaveBeenCalledWith([BLOCKS[1], BLOCKS[0], BLOCKS[2]])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/doc-blocks-editor.test.tsx`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Create `src/components/DocBlocksEditor.tsx`**

```tsx
'use client'

import React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MERGE_FIELDS, newBlockId, type DocBlock } from '@/lib/quote-doc'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react'

const TYPE_LABELS: Record<DocBlock['type'], string> = {
  text: 'Text',
  bullets: 'Bullet list',
  table: 'Table',
  pricing: 'Pricing',
  acceptance: 'Acceptance',
}

/** Merge-field cheat sheet printed under both editors. */
export function MergeFieldLegend() {
  return (
    <p className="text-xs text-muted-foreground">
      Merge fields: {MERGE_FIELDS.map((f) => `{{${f}}}`).join(', ')}
    </p>
  )
}

function blankBlock(type: DocBlock['type']): DocBlock {
  const id = newBlockId()
  switch (type) {
    case 'text':
      return { id, type, heading: 'New section', body: '' }
    case 'bullets':
      return { id, type, heading: 'New list', items: [] }
    case 'table':
      return { id, type, heading: 'New table', columns: ['Item', 'Detail'], rows: [{ label: '', value: '' }] }
    case 'pricing':
      return { id, type, heading: 'Fee' }
    case 'acceptance':
      return { id, type, heading: 'Acceptance', body: '' }
  }
}

export function DocBlocksEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: DocBlock[]
  onChange: (next: DocBlock[]) => void
  disabled?: boolean
}) {
  const hasAcceptance = value.some((b) => b.type === 'acceptance')

  function update(index: number, next: DocBlock) {
    onChange(value.map((b, i) => (i === index ? next : b)))
  }
  function move(index: number, dir: -1 | 1) {
    const to = index + dir
    if (to < 0 || to >= value.length) return
    const next = [...value]
    ;[next[index], next[to]] = [next[to], next[index]]
    onChange(next)
  }
  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }
  function add(type: DocBlock['type']) {
    onChange([...value, blankBlock(type)])
  }

  return (
    <div className="flex flex-col gap-3">
      {value.map((block, i) => (
        <div key={block.id} className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="shrink-0 font-normal">
              {TYPE_LABELS[block.type]}
            </Badge>
            <Input
              aria-label="Block heading"
              value={block.heading}
              onChange={(e) => update(i, { ...block, heading: e.target.value })}
              disabled={disabled}
              className="h-8"
            />
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Move up" disabled={disabled || i === 0} onClick={() => move(i, -1)}>
              <ArrowUpIcon />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Move down" disabled={disabled || i === value.length - 1} onClick={() => move(i, 1)}>
              <ArrowDownIcon />
            </Button>
            {block.type !== 'pricing' && (
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Delete block" disabled={disabled} onClick={() => remove(i)}>
                <Trash2Icon />
              </Button>
            )}
          </div>
          <BlockBody block={block} disabled={disabled} onChange={(next) => update(i, next)} />
        </div>
      ))}

      {!disabled && (
        <div className="flex items-center justify-between gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button type="button" variant="outline" size="sm" />}
            >
              <PlusIcon />
              Add block
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => add('text')}>Text</DropdownMenuItem>
              <DropdownMenuItem onClick={() => add('bullets')}>Bullet list</DropdownMenuItem>
              <DropdownMenuItem onClick={() => add('table')}>Table</DropdownMenuItem>
              <DropdownMenuItem disabled={hasAcceptance} onClick={() => add('acceptance')}>
                Acceptance
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <MergeFieldLegend />
        </div>
      )}
    </div>
  )
}

function BlockBody({ block, disabled, onChange }: { block: DocBlock; disabled: boolean; onChange: (next: DocBlock) => void }) {
  switch (block.type) {
    case 'text':
      return (
        <Textarea
          aria-label="Body text"
          value={block.body}
          onChange={(e) => onChange({ ...block, body: e.target.value })}
          placeholder="Paragraphs, separated by a blank line"
          rows={4}
          disabled={disabled}
        />
      )
    case 'acceptance':
      return (
        <Textarea
          aria-label="Acceptance text"
          value={block.body}
          onChange={(e) => onChange({ ...block, body: e.target.value })}
          placeholder="Instruction printed above the signature lines"
          rows={3}
          disabled={disabled}
        />
      )
    case 'bullets':
      return (
        <Textarea
          aria-label="Bullet items"
          value={block.items.join('\n')}
          onChange={(e) => onChange({ ...block, items: e.target.value.split('\n') })}
          placeholder="One item per line"
          rows={4}
          disabled={disabled}
        />
      )
    case 'pricing':
      return (
        <Textarea
          aria-label="Pricing note"
          value={block.note ?? ''}
          onChange={(e) => onChange({ ...block, note: e.target.value })}
          placeholder="Sentence printed under the fee (optional). The price itself comes from the quote."
          rows={2}
          disabled={disabled}
        />
      )
    case 'table':
      return (
        <div className="flex flex-col gap-2">
          <Textarea
            aria-label="Table intro"
            value={block.intro ?? ''}
            onChange={(e) => onChange({ ...block, intro: e.target.value })}
            placeholder="Paragraph above the table (optional)"
            rows={2}
            disabled={disabled}
          />
          <div className="grid grid-cols-[30%_1fr_auto] gap-2">
            <Input aria-label="Column 1 heading" value={block.columns[0]} onChange={(e) => onChange({ ...block, columns: [e.target.value, block.columns[1]] })} disabled={disabled} className="h-8 font-medium" />
            <Input aria-label="Column 2 heading" value={block.columns[1]} onChange={(e) => onChange({ ...block, columns: [block.columns[0], e.target.value] })} disabled={disabled} className="h-8 font-medium" />
            <span />
            {block.rows.map((row, r) => (
              <React.Fragment key={r}>
                <Input
                  aria-label={`Row ${r + 1} label`}
                  value={row.label}
                  onChange={(e) => onChange({ ...block, rows: block.rows.map((x, j) => (j === r ? { ...x, label: e.target.value } : x)) })}
                  disabled={disabled}
                  className="h-8"
                />
                <Textarea
                  aria-label={`Row ${r + 1} value`}
                  value={row.value}
                  onChange={(e) => onChange({ ...block, rows: block.rows.map((x, j) => (j === r ? { ...x, value: e.target.value } : x)) })}
                  disabled={disabled}
                  rows={1}
                />
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete row ${r + 1}`} disabled={disabled} onClick={() => onChange({ ...block, rows: block.rows.filter((_, j) => j !== r) })}>
                  <Trash2Icon />
                </Button>
              </React.Fragment>
            ))}
          </div>
          {!disabled && (
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onChange({ ...block, rows: [...block.rows, { label: '', value: '' }] })}>
              <PlusIcon />
              Add row
            </Button>
          )}
        </div>
      )
  }
}
```

If `DropdownMenuTrigger` in this repo does not accept `render`, check how an existing menu trigger is written (`grep -rn "DropdownMenuTrigger" src/app | head -3`) and copy that form (Base UI uses `render={<Button/>}`; shadcn-radix used `asChild`).

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/doc-blocks-editor.test.tsx`
Expected: PASS. If the jsdom environment complains about `crypto.randomUUID`, it exists in Node 22 and jsdom exposes the global; no polyfill needed.

- [ ] **Step 5: Type-check, lint, commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add src/components/DocBlocksEditor.tsx tests/doc-blocks-editor.test.tsx
git commit -m "feat: shared DocBlocksEditor for quote templates and per-quote documents

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Settings → Quote templates tab

**Files:**
- Create: `src/app/(office)/settings/quote-templates-section.tsx`
- Modify: `src/app/(office)/settings/settings-tabs.tsx:41-76` (tab union + TABS), `:78-106` (props), `:150-155` (TabsContent)
- Modify: `src/app/(office)/settings/page.tsx:6-23` (VALID_TABS), `:40-63` (queries), the `<SettingsTabs …/>` render at the bottom

**Interfaces:**
- Consumes: `createQuoteTemplate`, `updateQuoteTemplate`, `setQuoteTemplateActive`, `setDefaultQuoteTemplate`, `importQuoteTemplate` (Tasks 7–8); `DocBlocksEditor`, `MergeFieldLegend` (Task 9); `QuoteTemplateRow`, `starterDoc`, `DEFAULT_PRICING`, `PRICING_MODES`, `MAX_TEMPLATE_PDF_BYTES`, `pricingDisplaySchema` from `@/lib/quote-doc`; `buildStorageKey`, `removeUploadedObject` from `@/lib/storage-keys`; `createClient` from `@/lib/supabase/client`; `signedUrl` is server-only, so "View original" uses a server action below.
- Produces: `QuoteTemplatesSection({ templates, importEnabled })`; settings tab value `'quote-templates'`; server action `quoteTemplateOriginalUrl(id): Promise<{ url?: string; error?: string }>`.

- [ ] **Step 1: Add the "view original" action**

Append to `src/app/(office)/settings/actions.ts` (add `import { signedUrl } from '@/lib/attachment-urls'`):

```ts
export async function quoteTemplateOriginalUrl(id: string): Promise<{ url?: string; error?: string }> {
  await requireRole('admin')
  const supabase = await createSupabaseClient()
  const { data } = await supabase.from('quote_templates').select('source_path').eq('id', id).maybeSingle()
  if (!data?.source_path) return { error: 'This template was not imported from a file' }
  const url = await signedUrl(supabase, data.source_path as string, 600)
  return url ? { url } : { error: 'Could not sign the file URL' }
}
```

- [ ] **Step 2: Load templates on the settings page**

`src/app/(office)/settings/page.tsx`: add `'quote-templates'` to `VALID_TABS`. Add to the `Promise.all` destructure a new entry `{ data: quoteTemplates }` and the query:

```ts
    supabase
      .from('quote_templates')
      .select('id, name, doc_title, heading, validity_text, number_headings, blocks, pricing_defaults, is_default, active, source_path, source_filename, updated_at')
      .order('name'),
```

Before the return, coerce with the schema so bad JSON never reaches the client:

```ts
  const quoteTemplateRows: QuoteTemplateRow[] = (quoteTemplates ?? []).flatMap((t) => {
    const parsed = quoteTemplateSchema.safeParse(t)
    return parsed.success
      ? [{ ...parsed.data, id: t.id as string, is_default: Boolean(t.is_default), active: Boolean(t.active), updated_at: t.updated_at as string }]
      : []
  })
```

(import `quoteTemplateSchema, type QuoteTemplateRow` from `@/lib/quote-doc`). Pass `quoteTemplates={quoteTemplateRows}` and `templateImportEnabled={Boolean(process.env.OPENAI_API_KEY)}` to `<SettingsTabs>`.

- [ ] **Step 3: Wire the tab**

`settings-tabs.tsx`: add `| 'quote-templates'` to `SettingsTab`; add `{ value: 'quote-templates', label: 'Quote templates' }` to `TABS` right after `estimating`; add props `quoteTemplates: QuoteTemplateRow[]` and `templateImportEnabled: boolean`; import `QuoteTemplatesSection`; add:

```tsx
      <TabsContent value="quote-templates" className="pt-4">
        <QuoteTemplatesSection templates={quoteTemplates} importEnabled={templateImportEnabled} />
      </TabsContent>
```

- [ ] **Step 4: Create the section component**

`src/app/(office)/settings/quote-templates-section.tsx`:

```tsx
'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/EmptyState'
import { DocBlocksEditor } from '@/components/DocBlocksEditor'
import { createClient } from '@/lib/supabase/client'
import { buildStorageKey, removeUploadedObject } from '@/lib/storage-keys'
import {
  DEFAULT_PRICING,
  MAX_TEMPLATE_PDF_BYTES,
  PRICING_MODES,
  PRICING_MODE_LABELS,
  starterDoc,
  type PricingDisplay,
  type QuoteTemplateInput,
  type QuoteTemplateRow,
} from '@/lib/quote-doc'
import { fmtDate } from '@/lib/format'
import { ActiveBadge, ToggleActiveButton } from './users-section'
import {
  createQuoteTemplate,
  importQuoteTemplate,
  quoteTemplateOriginalUrl,
  setDefaultQuoteTemplate,
  updateQuoteTemplate,
} from './actions'
import { FileTextIcon, PencilIcon, PlusIcon, StarIcon, UploadIcon } from 'lucide-react'

type Draft = QuoteTemplateInput & { id?: string }

export function QuoteTemplatesSection({
  templates,
  importEnabled,
}: {
  templates: QuoteTemplateRow[]
  importEnabled: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<{ draft: Draft; notes: string[]; uploadPath: string | null } | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)

  function startBlank() {
    setEditing({ draft: { ...starterDoc(), name: '', pricing_defaults: DEFAULT_PRICING }, notes: [], uploadPath: null })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Templates shape the quote PDF: headings, boilerplate text and how pricing is shown. Cost and markup never print.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={startBlank}>
            <PlusIcon />
            New template
          </Button>
          <Button onClick={() => setUploadOpen(true)} disabled={!importEnabled} title={importEnabled ? undefined : 'Add OPENAI_API_KEY to enable PDF import'}>
            <UploadIcon />
            Upload template
          </Button>
        </div>
      </div>

      {templates.length === 0 ? (
        <EmptyState icon={<FileTextIcon className="size-8" />} title="No quote templates yet" description="Upload an existing quote PDF or start from the standard structure." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Heading</TableHead>
              <TableHead>Pricing</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">
                  {t.name}
                  {t.is_default && <Badge variant="secondary" className="ml-2 font-normal">Default</Badge>}
                </TableCell>
                <TableCell className="text-muted-foreground">{t.heading ?? '—'}</TableCell>
                <TableCell>{PRICING_MODE_LABELS[t.pricing_defaults.mode]}</TableCell>
                <TableCell><ActiveBadge active={t.active} /></TableCell>
                <TableCell className="text-muted-foreground">{fmtDate(t.updated_at)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {t.source_path && <ViewOriginalButton id={t.id} />}
                    {!t.is_default && t.active && (
                      <Button variant="ghost" size="icon-sm" title="Set as default" onClick={async () => {
                        const r = await setDefaultQuoteTemplate(t.id)
                        if (r.error) toast.error(r.error); else { toast.success('Default template set'); router.refresh() }
                      }}>
                        <StarIcon />
                        <span className="sr-only">Set as default</span>
                      </Button>
                    )}
                    <Button variant="ghost" size="icon-sm" onClick={() => setEditing({ draft: { ...t }, notes: [], uploadPath: null })}>
                      <PencilIcon />
                      <span className="sr-only">Edit</span>
                    </Button>
                    <ToggleActiveButton active={t.active} label={t.name} onToggle={(active) => setQuoteTemplateActive(t.id, active)} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onDraft={(draft, notes, uploadPath) => {
          setUploadOpen(false)
          setEditing({ draft, notes, uploadPath })
        }}
      />

      {editing && (
        <TemplateEditorDialog
          initial={editing.draft}
          notes={editing.notes}
          uploadPath={editing.uploadPath}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function ViewOriginalButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition()
  return (
    <Button variant="ghost" size="icon-sm" disabled={pending} title="View original PDF" onClick={() => startTransition(async () => {
      const r = await quoteTemplateOriginalUrl(id)
      if (r.url) window.open(r.url, '_blank', 'noopener'); else toast.error(r.error ?? 'Unavailable')
    })}>
      <FileTextIcon />
      <span className="sr-only">View original</span>
    </Button>
  )
}

// ─── Upload / import ─────────────────────────────────────────────────────────

function UploadDialog({ open, onClose, onDraft }: { open: boolean; onClose: () => void; onDraft: (draft: QuoteTemplateInput, notes: string[], uploadPath: string) => void }) {
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) { toast.error('Choose a PDF'); return }
    if (file.size === 0) { toast.error('That file is empty'); return }
    if (file.size > MAX_TEMPLATE_PDF_BYTES) { toast.error('PDF must be under 20 MB'); return }

    startTransition(async () => {
      const supabase = createClient()
      const path = buildStorageKey('quote-templates', file.name)
      const { error: upErr } = await supabase.storage.from('attachments').upload(path, file, { contentType: 'application/pdf', upsert: false })
      if (upErr) { toast.error(upErr.message); return }

      const result = await importQuoteTemplate({ path, filename: file.name, name: name.trim() })
      if (result.error || !result.draft) {
        await removeUploadedObject(supabase, path)
        toast.error(result.error ?? 'Import failed')
        return
      }
      toast.success('Template read. Check it, then save.')
      setName(''); setFile(null)
      onDraft(result.draft, result.notes ?? [], path)
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload template</DialogTitle>
          <DialogDescription>
            Pick an existing quote PDF. The app reads it into sections and swaps job details for merge fields; you review before saving. Reading takes 30 to 90 seconds.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qt-name">Template name</Label>
            <Input id="qt-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Asbestos inspection" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qt-file">Quote PDF</Label>
            <Input id="qt-file" type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !file || !name.trim()}>
              {pending ? 'Reading PDF…' : 'Read PDF'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Editor ──────────────────────────────────────────────────────────────────

function TemplateEditorDialog({ initial, notes, uploadPath, onClose }: { initial: Draft; notes: string[]; uploadPath: string | null; onClose: () => void }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [draft, setDraft] = useState<Draft>(initial)
  const isNew = !initial.id

  function patch(p: Partial<Draft>) { setDraft((d) => ({ ...d, ...p })) }
  function patchPricing(p: Partial<PricingDisplay>) { setDraft((d) => ({ ...d, pricing_defaults: { ...d.pricing_defaults, ...p } })) }

  async function cancel() {
    // An imported-but-unsaved upload is removed so nothing orphans in storage.
    if (isNew && uploadPath) await removeUploadedObject(createClient(), uploadPath)
    onClose()
  }

  function save() {
    startTransition(async () => {
      const { id, ...payload } = draft
      const result = id ? await updateQuoteTemplate(id, payload) : await createQuoteTemplate(payload)
      if (result.error) { toast.error(result.error); return }
      toast.success(id ? 'Template updated' : 'Template saved')
      onClose()
      router.refresh()
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && void cancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isNew ? 'New quote template' : `Edit ${initial.name}`}</DialogTitle>
          {notes.length > 0 && (
            <DialogDescription>
              Check these before saving: {notes.join(' · ')}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qte-name">Name</Label>
            <Input id="qte-name" value={draft.name} onChange={(e) => patch({ name: e.target.value })} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qte-title">Document title</Label>
            <Input id="qte-title" value={draft.doc_title} onChange={(e) => patch({ doc_title: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="qte-heading">Service heading (optional)</Label>
            <Input id="qte-heading" value={draft.heading ?? ''} onChange={(e) => patch({ heading: e.target.value || null })} placeholder="Asbestos Inspection, Sampling and Close-out" />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="qte-validity">Validity text</Label>
            <Input id="qte-validity" value={draft.validity_text} onChange={(e) => patch({ validity_text: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qte-mode">Default pricing display</Label>
            <Select value={draft.pricing_defaults.mode} onValueChange={(v) => v && patchPricing({ mode: v as PricingDisplay['mode'] })}>
              <SelectTrigger id="qte-mode" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRICING_MODES.map((m) => <SelectItem key={m} value={m}>{PRICING_MODE_LABELS[m]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qte-fee">Fee label (lump sum)</Label>
            <Input id="qte-fee" value={draft.pricing_defaults.fee_label} onChange={(e) => patchPricing({ fee_label: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-4 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={draft.pricing_defaults.show_qty_unit} onCheckedChange={(c) => patchPricing({ show_qty_unit: Boolean(c) })} />
              Show qty and unit columns
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={draft.pricing_defaults.list_items} onCheckedChange={(c) => patchPricing({ list_items: Boolean(c) })} />
              List included items under a lump sum
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={draft.pricing_defaults.show_gst} onCheckedChange={(c) => patchPricing({ show_gst: Boolean(c) })} />
              Show GST breakdown
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={draft.number_headings} onCheckedChange={(c) => patch({ number_headings: Boolean(c) })} />
              Number the headings
            </label>
          </div>
        </div>

        <h3 className="mt-2 text-sm font-semibold">Sections</h3>
        <DocBlocksEditor value={draft.blocks} onChange={(blocks) => patch({ blocks })} />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void cancel()} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={save} disabled={pending || !draft.name.trim()}>
            {pending ? 'Saving…' : 'Save template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

Note the `setQuoteTemplateActive` import is used by `ToggleActiveButton`; add it to the actions import list.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean. If `Checkbox`'s `onCheckedChange` signature differs, mirror an existing usage (`grep -rn "onCheckedChange" src/app | head -3`).

- [ ] **Step 6: Click-through**

Dev server (see Global Constraints). As admin: Settings → Quote templates → New template → save with name "Test template" → row appears; Edit → change heading → save; Set as default (star) → Default badge; toggle inactive → Default badge disappears (the action clears it). Then Upload template with the reference PDF `C:\Users\nickj\Documents\ECR\ECR Managed\Jobs\RQ26003 - Port of Brisbane\RQ26003_Port of Brisbane_August 2026.pdf` (requires `OPENAI_API_KEY` in `.env.local`): expect the editor prefilled with 8-ish blocks, notes in the description, Save → row with a "View original" button that opens the PDF. Deactivate "Test template" afterwards.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(office)/settings/quote-templates-section.tsx" "src/app/(office)/settings/settings-tabs.tsx" "src/app/(office)/settings/page.tsx" "src/app/(office)/settings/actions.ts"
git commit -m "feat: Settings → Quote templates tab with PDF import, editor, default and active toggles

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Quote-side server actions

**Files:**
- Modify: `src/app/(office)/quotes/actions.ts` — `createQuote` (lines 56-117), `duplicateQuote` (119-220), append three actions

**Interfaces:**
- Consumes: `quoteDocSchema`, `pricingDisplaySchema`, `snapshotFromTemplate`, `normaliseBlocks`, `quoteTemplateSchema` from `@/lib/quote-doc`.
- Produces:
  - `applyQuoteTemplate(quoteId: string, templateId: string | null): Promise<{ error?: string }>`
  - `updateQuoteDoc(quoteId: string, doc: unknown): Promise<{ error?: string }>`
  - `updateQuotePdfOptions(quoteId: string, options: unknown): Promise<{ error?: string }>`
  - `createQuote` accepts `template_id`.

- [ ] **Step 1: Add a template loader and the three actions**

Add imports:

```ts
import {
  normaliseBlocks,
  pricingDisplaySchema,
  quoteDocSchema,
  quoteTemplateSchema,
  snapshotFromTemplate,
  type DocBlock,
} from '@/lib/quote-doc'
```

Append after `duplicateQuote`:

```ts
// ─── Document template ───────────────────────────────────────────────────────

/** Active template row, validated, or an error message. */
async function loadTemplate(supabase: SupabaseClient, templateId: string) {
  const { data } = await supabase
    .from('quote_templates')
    .select('doc_title, heading, validity_text, number_headings, blocks, pricing_defaults, name')
    .eq('id', templateId)
    .eq('active', true)
    .maybeSingle()
  if (!data) return { error: 'Template not found or inactive' as const }
  const parsed = quoteTemplateSchema.safeParse(data)
  if (!parsed.success) return { error: 'Template is invalid — fix it in Settings' as const }
  return { template: parsed.data }
}

/**
 * Snapshots a template onto the quote (doc + pricing defaults) or, with null,
 * returns the quote to the standard layout. Frozen quotes are refused.
 */
export async function applyQuoteTemplate(
  quoteId: string,
  templateId: string | null
): Promise<Result> {
  await requireRole('admin', 'office')
  const supabase = await createClient()
  const editable = await assertEditable(supabase, quoteId)
  if (editable.error) return editable

  let patch: Record<string, unknown>
  if (templateId) {
    const loaded = await loadTemplate(supabase, templateId)
    if ('error' in loaded) return { error: loaded.error }
    patch = {
      template_id: templateId,
      doc: snapshotFromTemplate(loaded.template),
      pdf_options: loaded.template.pricing_defaults,
    }
  } else {
    patch = { template_id: null, doc: null }
  }

  const { error } = await supabase.from('quotes').update(patch).eq('id', quoteId)
  if (error) return { error: error.message }
  revalidateQuote(quoteId)
  return {}
}

export async function updateQuoteDoc(quoteId: string, doc: unknown): Promise<Result> {
  await requireRole('admin', 'office')
  const raw = doc as { blocks?: unknown }
  const cleaned = raw && Array.isArray(raw.blocks) ? { ...(doc as object), blocks: normaliseBlocks(raw.blocks as DocBlock[]) } : doc
  const parsed = quoteDocSchema.safeParse(cleaned)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid document' }
  }

  const supabase = await createClient()
  const editable = await assertEditable(supabase, quoteId)
  if (editable.error) return editable

  const { error } = await supabase.from('quotes').update({ doc: parsed.data }).eq('id', quoteId)
  if (error) return { error: error.message }
  revalidateQuote(quoteId)
  return {}
}

export async function updateQuotePdfOptions(quoteId: string, options: unknown): Promise<Result> {
  await requireRole('admin', 'office')
  const parsed = pricingDisplaySchema.safeParse(options)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid options' }
  }

  const supabase = await createClient()
  const editable = await assertEditable(supabase, quoteId)
  if (editable.error) return editable

  const { error } = await supabase.from('quotes').update({ pdf_options: parsed.data }).eq('id', quoteId)
  if (error) return { error: error.message }
  revalidateQuote(quoteId)
  return {}
}
```

- [ ] **Step 2: Template at creation**

In `createQuote`, before the `nextNumber` block:

```ts
  let templatePatch: Record<string, unknown> = {}
  if (parsed.data.template_id) {
    const loaded = await loadTemplate(supabase, parsed.data.template_id)
    if ('error' in loaded) return { error: loaded.error }
    templatePatch = {
      template_id: parsed.data.template_id,
      doc: snapshotFromTemplate(loaded.template),
      pdf_options: loaded.template.pricing_defaults,
    }
  }
```

and spread `...templatePatch,` into the `.insert({...})` object after `created_by`.

- [ ] **Step 3: Duplicate carries the document**

In `duplicateQuote`, add `template_id, doc, pdf_options` to the source select string and `template_id: source.template_id, doc: source.doc, pdf_options: source.pdf_options,` to the insert object.

- [ ] **Step 4: Type-check, lint, commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add "src/app/(office)/quotes/actions.ts"
git commit -m "feat: apply/edit quote document template and PDF options; template on create and duplicate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Quote builder UI — PDF dialog, Document card, template on creation

**Files:**
- Create: `src/app/(office)/quotes/[id]/quote-pdf-dialog.tsx`, `src/app/(office)/quotes/[id]/quote-doc-card.tsx`
- Modify: `src/app/(office)/quotes/[id]/page.tsx:25-61` (queries), `:89-126` (quoteData), the `<QuoteBuilder …/>` render
- Modify: `src/app/(office)/quotes/[id]/quote-builder.tsx:77-98` (QuoteData), `:123-190` (QuoteBuilder), `:374-383` (PDF anchor)
- Modify: `src/app/(office)/quotes/new-quote-dialog.tsx`, `src/app/(office)/quotes/page.tsx:60-116`

**Interfaces:**
- Consumes: Task 11 actions; `DocBlocksEditor`, `MergeFieldLegend`; `PRICING_MODE_LABELS`, `QuoteDoc`, `PricingDisplay`, `DEFAULT_PRICING`, `PRICING_MODES`, `quoteDocSchema`, `pricingDisplaySchema`.
- Produces: `QuoteData` gains `template_id: string | null`, `template_name: string | null`, `doc: QuoteDoc | null`, `pdf_options: PricingDisplay | null`; `QuoteBuilder` gains prop `templates: TemplateOption[]` where `TemplateOption = { id: string; name: string; is_default: boolean }`.

- [ ] **Step 1: Load template data on the quote page**

`src/app/(office)/quotes/[id]/page.tsx`: change the quote select to

```ts
'*, clients(name), sites(name), contacts(name), profiles!quotes_pm_id_fkey(id, full_name), quote_templates(name)'
```

Add a sixth query to the `Promise.all`:

```ts
      supabase
        .from('quote_templates')
        .select('id, name, is_default')
        .eq('active', true)
        .order('name'),
```

destructured as `{ data: templates }`. In `quoteData` add:

```ts
    template_id: (quote.template_id as string | null) ?? null,
    template_name: (quote.quote_templates as { name: string } | null)?.name ?? null,
    doc: (() => { const p = quoteDocSchema.safeParse(quote.doc); return p.success ? p.data : null })(),
    pdf_options: (() => { const p = pricingDisplaySchema.safeParse(quote.pdf_options); return p.success ? p.data : null })(),
```

(import `quoteDocSchema, pricingDisplaySchema` from `@/lib/quote-doc`). Pass `templates={(templates ?? []).map((t) => ({ id: t.id, name: t.name, is_default: Boolean(t.is_default) }))}` to `<QuoteBuilder>`.

- [ ] **Step 2: Extend `QuoteData` and mount the new pieces**

`quote-builder.tsx`: add to `QuoteData`:

```ts
  template_id: string | null
  template_name: string | null
  doc: QuoteDoc | null
  pdf_options: PricingDisplay | null
```

(import `type QuoteDoc, type PricingDisplay` from `@/lib/quote-doc`). Add `export interface TemplateOption { id: string; name: string; is_default: boolean }`, add `templates: TemplateOption[]` to `QuoteBuilder` props and to `HeaderCard` props (pass through). Below `<HeaderCard …/>` in `QuoteBuilder` add:

```tsx
      <QuoteDocCard quoteId={quote.id} doc={quote.doc} templateName={quote.template_name} editable={editable} />
```

Replace the PDF `<a …>` (lines 374-383) with:

```tsx
            <QuotePdfDialog quote={quote} templates={templates} editable={editable} />
```

Import both new components.

- [ ] **Step 3: Create the PDF dialog**

`src/app/(office)/quotes/[id]/quote-pdf-dialog.tsx`:

```tsx
'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DEFAULT_PRICING,
  PRICING_MODES,
  PRICING_MODE_LABELS,
  type PricingDisplay,
} from '@/lib/quote-doc'
import { applyQuoteTemplate, updateQuotePdfOptions } from '../actions'
import type { QuoteData, TemplateOption } from './quote-builder'
import { FileDownIcon } from 'lucide-react'

const STANDARD = 'standard'

export function QuotePdfDialog({ quote, templates, editable }: { quote: QuoteData; templates: TemplateOption[]; editable: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [templateId, setTemplateId] = useState(quote.template_id ?? STANDARD)
  const [display, setDisplay] = useState<PricingDisplay>(quote.pdf_options ?? DEFAULT_PRICING)

  function patch(p: Partial<PricingDisplay>) { setDisplay((d) => ({ ...d, ...p })) }

  function openPdf() {
    // Open the tab synchronously so popup blockers allow it; point it after saving.
    const tab = window.open('', '_blank')
    startTransition(async () => {
      if (editable) {
        const templateChanged = templateId !== (quote.template_id ?? STANDARD)
        if (templateChanged) {
          if (quote.doc && !confirm('Switching templates replaces this quote\'s document text. Continue?')) { tab?.close(); return }
          const r = await applyQuoteTemplate(quote.id, templateId === STANDARD ? null : templateId)
          if (r.error) { tab?.close(); toast.error(r.error); return }
        }
        const r2 = await updateQuotePdfOptions(quote.id, display)
        if (r2.error) { tab?.close(); toast.error(r2.error); return }
        router.refresh()
      }
      const url = `/api/pdf/quote/${quote.id}`
      if (tab) tab.location.href = url; else window.open(url, '_blank')
      setOpen(false)
    })
  }

  const mode = display.mode
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FileDownIcon />
        PDF
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Quote PDF</DialogTitle>
            <DialogDescription>
              {editable ? 'Choices are saved on the quote and used for the client portal copy too.' : 'This quote is frozen; the saved layout is shown.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qp-template">Template</Label>
              <Select value={templateId} onValueChange={(v) => v && setTemplateId(v)} disabled={!editable}>
                <SelectTrigger id="qp-template" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={STANDARD}>Standard layout</SelectItem>
                  {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qp-mode">Pricing display</Label>
              <Select value={mode} onValueChange={(v) => v && patch({ mode: v as PricingDisplay['mode'] })} disabled={!editable}>
                <SelectTrigger id="qp-mode" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRICING_MODES.map((m) => <SelectItem key={m} value={m}>{PRICING_MODE_LABELS[m]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {mode === 'lump_sum' ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="qp-fee">Fee label</Label>
                  <Input id="qp-fee" value={display.fee_label} onChange={(e) => patch({ fee_label: e.target.value })} disabled={!editable} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={display.list_items} onCheckedChange={(c) => patch({ list_items: Boolean(c) })} disabled={!editable} />
                  List included items (no prices)
                </label>
              </>
            ) : (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={display.show_qty_unit} onCheckedChange={(c) => patch({ show_qty_unit: Boolean(c) })} disabled={!editable} />
                Show qty and unit columns
              </label>
            )}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={display.show_gst} onCheckedChange={(c) => patch({ show_gst: Boolean(c) })} disabled={!editable} />
              Show GST breakdown
            </label>
            <p className="text-xs text-muted-foreground">Cost price and markup are never printed.</p>
          </div>
          <DialogFooter>
            <Button onClick={openPdf} disabled={pending}>
              <FileDownIcon />
              {pending ? 'Preparing…' : 'Open PDF'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
```

- [ ] **Step 4: Create the Document card**

`src/app/(office)/quotes/[id]/quote-doc-card.tsx`:

```tsx
'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DocBlocksEditor } from '@/components/DocBlocksEditor'
import type { QuoteDoc } from '@/lib/quote-doc'
import { updateQuoteDoc } from '../actions'
import { ChevronDownIcon, ChevronRightIcon, FileTextIcon } from 'lucide-react'

export function QuoteDocCard({ quoteId, doc, templateName, editable }: { quoteId: string; doc: QuoteDoc | null; templateName: string | null; editable: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [openEditor, setOpenEditor] = useState(false)
  const [draft, setDraft] = useState<QuoteDoc | null>(doc)
  const dirty = draft !== doc

  if (!doc) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 text-sm text-muted-foreground">
          <FileTextIcon className="size-4" />
          Standard layout. Choose a template from the PDF button to add scope, assumptions, exclusions and terms.
        </CardContent>
      </Card>
    )
  }

  function save() {
    if (!draft) return
    startTransition(async () => {
      const r = await updateQuoteDoc(quoteId, draft)
      if (r.error) { toast.error(r.error); return }
      toast.success('Document saved')
      router.refresh()
    })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <button type="button" className="flex items-center gap-2 text-left text-sm font-semibold" onClick={() => setOpenEditor((o) => !o)}>
          {openEditor ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
          Document{templateName ? ` · ${templateName}` : ''}
          <span className="font-normal text-muted-foreground">({doc.blocks.length} sections)</span>
        </button>
        {openEditor && draft && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qd-heading">Service heading</Label>
                <Input id="qd-heading" value={draft.heading ?? ''} onChange={(e) => setDraft({ ...draft, heading: e.target.value || null })} disabled={!editable} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qd-validity">Validity text</Label>
                <Input id="qd-validity" value={draft.validity_text} onChange={(e) => setDraft({ ...draft, validity_text: e.target.value })} disabled={!editable} />
              </div>
            </div>
            <DocBlocksEditor value={draft.blocks} onChange={(blocks) => setDraft({ ...draft, blocks })} disabled={!editable} />
            {editable && (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDraft(doc)} disabled={!dirty || pending}>Discard</Button>
                <Button onClick={save} disabled={!dirty || pending}>{pending ? 'Saving…' : 'Save document'}</Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 5: Template select on the new-quote dialog**

`src/app/(office)/quotes/page.tsx`: add a query `supabase.from('quote_templates').select('id, name, is_default').eq('active', true).order('name')` to its `Promise.all` (destructure as `{ data: quoteTemplates }`) and pass `templates={quoteTemplates ?? []}` to `<NewQuoteDialog>`.

`new-quote-dialog.tsx`: add prop `templates: { id: string; name: string; is_default: boolean }[]`; state `const [templateId, setTemplateId] = useState(templates.find((t) => t.is_default)?.id ?? NONE)`; reset it in `reset()`; pass `template_id: templateId === NONE ? null : templateId` to `createQuote`; add after the Title field:

```tsx
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nq-template">Template</Label>
              <Select value={templateId} onValueChange={(v) => v && setTemplateId(v)}>
                <SelectTrigger id="nq-template" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Standard layout</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
```

- [ ] **Step 6: Type-check, lint, tests**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean.

- [ ] **Step 7: Click-through**

Dev server. As office user: New quote with the template → builder shows the Document card with the template name; expand, edit an assumption, Save document → toast. PDF button → dialog shows the template and its default pricing; choose Lump sum, Open PDF → the templated document opens with the fee block; reopen with Itemised → line table. Duplicate the quote → the copy carries the Document card. Mark sent → still editable; Accept → dialog is read-only, Document card read-only. Portal: publish the quote, open the portal PDF link → same templated document with the watermark.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(office)/quotes/[id]/quote-pdf-dialog.tsx" "src/app/(office)/quotes/[id]/quote-doc-card.tsx" "src/app/(office)/quotes/[id]/quote-builder.tsx" "src/app/(office)/quotes/[id]/page.tsx" "src/app/(office)/quotes/new-quote-dialog.tsx" "src/app/(office)/quotes/page.tsx"
git commit -m "feat: quote PDF dialog (template + pricing display), Document card, template on new quote

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Docs and final verification

**Files:**
- Modify: `README.md:123-137` (PDF section)
- Modify: `docs/superpowers/specs/2026-09-02-quote-templates-design.md:4` (Status)

- [ ] **Step 1: README**

Replace the stale route table in the PDFs section with:

```markdown
## PDFs

The app generates PDFs server-side using `@react-pdf/renderer`, streamed from the consolidated route `GET /api/pdf/[type]/[id]` (types include `quote`, `invoice`, `po`, `claim`, `swms`, `form`, `incident`, `qr-poster`, `programme`, `diary`, `takeoff`, …). Nothing is written to disk.

**Quote templates.** Settings → Quote templates holds structured quote documents (headings, boilerplate, merge fields, pricing display defaults). Upload an existing quote PDF and the app reads it into a template via OpenAI (`OPENAI_API_KEY`), or build one by hand. Applying a template to a quote snapshots it onto the quote (`quotes.doc`, `quotes.pdf_options`); the office PDF and the client-portal copy render the same snapshot. Pricing can be shown as a lump sum, section totals or itemised lines. Cost price and markup never print.
```

- [ ] **Step 2: Document the OpenAI key**

In the README environment-variable table (the one listing `NEXT_PUBLIC_SITE_URL`, around line 170) add a row:

```markdown
| `OPENAI_API_KEY` | Enables PDF import for quote templates and takeoff report extraction. Optional; both features show a hint until it is set. Add to `.env.local` and to the Vercel project environment. |
```

- [ ] **Step 3: Mark the spec implemented**

Change `Status: draft for review` to `Status: implemented 2026-09-02 (plan: docs/superpowers/plans/2026-09-02-quote-templates.md)`.

- [ ] **Step 4: Full verification**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all green. Then the manual pass from Task 10 Step 6 and Task 12 Step 7 with the reference PDF; confirm one templated PDF in each pricing mode opens, the portal copy carries the watermark, and no cost figure appears anywhere in any of them (search the PDF text for the quote's unit costs).

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-02-quote-templates-design.md
git commit -m "docs: quote templates in README; spec marked implemented

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
