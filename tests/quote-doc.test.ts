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
  parseQuoteDocInput,
  parseQuoteTemplateInput,
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

  test('unknownMergeTokens catches case and spacing typos, accepts inner padding', () => {
    expect(unknownMergeTokens('{{Client.Name}} {{client name}} {{ client.name }} {{}}')).toEqual([
      'Client.Name',
      'client name',
      '',
    ])
    const r = docBlocksSchema.safeParse([
      { id: 'p', type: 'pricing', heading: 'Fee', note: 'For {{Client.Name}}' },
    ])
    expect(r.success).toBe(false)
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

  test('quoteDocSchema rejects an unknown merge token in the heading', () => {
    const r = quoteDocSchema.safeParse({ ...starterDoc(), heading: 'Works for {{cilent.name}}' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toContain('{{cilent.name}}')
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

describe('editor payload parsing', () => {
  test('parseQuoteDocInput trims header fields and normalises blocks', () => {
    const r = parseQuoteDocInput({
      ...starterDoc(),
      heading: '   ',
      validity_text: '  14 days  ',
      blocks: [
        { id: 'p', type: 'pricing', heading: ' Fee ', note: '  ' },
        { id: 'b', type: 'bullets', heading: 'B', items: [' one ', ''] },
      ],
    })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.heading).toBeNull()
    expect(r.data.validity_text).toBe('14 days')
    expect(r.data.blocks[0]).toEqual({ id: 'p', type: 'pricing', heading: 'Fee', note: undefined })
    expect(r.data.blocks[1]).toMatchObject({ items: ['one'] })
  })

  test('parseQuoteDocInput returns a zod error (does not throw) on malformed blocks', () => {
    const malformed = {
      ...starterDoc(),
      blocks: [{ id: 'x', type: 'bullets', heading: 'B', items: 'not-an-array' }, 42, null],
    }
    expect(() => parseQuoteDocInput(malformed)).not.toThrow()
    expect(parseQuoteDocInput(malformed).success).toBe(false)
    expect(parseQuoteDocInput('garbage').success).toBe(false)
    expect(parseQuoteDocInput(undefined).success).toBe(false)
  })

  test('parseQuoteTemplateInput applies the same cleaning and requires the template fields', () => {
    const ok = parseQuoteTemplateInput({
      ...starterDoc(),
      name: ' Asbestos ',
      heading: ' Works ',
      pricing_defaults: DEFAULT_PRICING,
    })
    expect(ok.success).toBe(true)
    if (ok.success) {
      expect(ok.data.name).toBe('Asbestos')
      expect(ok.data.heading).toBe('Works')
    }
    expect(parseQuoteTemplateInput({ ...starterDoc(), pricing_defaults: DEFAULT_PRICING }).success).toBe(false)
    expect(() => parseQuoteTemplateInput({ blocks: [{ type: 'table' }] })).not.toThrow()
  })
})
