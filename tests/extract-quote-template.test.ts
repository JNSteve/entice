import { describe, expect, test } from 'vitest'
import { draftFromExtraction, type ExtractedTemplate } from '../src/lib/extract-quote-template'
import { quoteTemplateSchema } from '../src/lib/quote-doc'

const block = (
  b: Partial<ExtractedTemplate['blocks'][number]>
): ExtractedTemplate['blocks'][number] => ({
  type: 'text',
  heading: 'H',
  body: null,
  items: [],
  intro: null,
  columns: [],
  rows: [],
  note: null,
  ...b,
})

const RAW: ExtractedTemplate = {
  doc_title: 'Quotation',
  heading: 'Asbestos Inspection, Sampling and Close-out',
  validity_text: '{{quote.valid_days}} days from issue unless otherwise stated',
  pricing_mode: 'lump_sum',
  fee_label: 'Fixed fee',
  notes: ['Project line had no matching field'],
  blocks: [
    block({
      type: 'table',
      heading: 'Scope and Deliverables',
      intro: 'ECR will attend the pit at {{site.name}}.',
      columns: ['Service', 'Included scope'],
      rows: [{ label: 'Site attendance', value: 'One attendance by an LAA.' }],
    }),
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
    const raw = {
      ...RAW,
      blocks: [
        ...RAW.blocks,
        block({ type: 'pricing', heading: 'Rates', note: 'Hourly rates.' }),
        block({ type: 'acceptance', heading: 'Sign-off', body: 'Again.' }),
      ],
    }
    const { draft, notes } = draftFromExtraction(raw, 'X')
    expect(draft.blocks.filter((b) => b.type === 'pricing')).toHaveLength(1)
    expect(draft.blocks.filter((b) => b.type === 'acceptance')).toHaveLength(1)
    expect(draft.blocks[4]).toEqual(
      expect.objectContaining({ type: 'text', heading: 'Rates', body: 'Hourly rates.' })
    )
    expect(draft.blocks[5]).toEqual(
      expect.objectContaining({ type: 'text', heading: 'Sign-off', body: 'Again.' })
    )
    expect(notes.filter((n) => /converted to text/i.test(n))).toHaveLength(2)
  })

  test('normalises padded known tokens and brackets case typos', () => {
    const raw = {
      ...RAW,
      blocks: [RAW.blocks[1], block({ type: 'text', heading: 'T', body: 'Dear {{ contact.name }} of {{Client.Name}}' })],
    }
    const { draft, notes } = draftFromExtraction(raw, 'X')
    expect(draft.blocks[1]).toMatchObject({ body: 'Dear {{contact.name}} of [Client.Name]' })
    expect(notes.some((n) => n.includes('{{Client.Name}}'))).toBe(true)
    expect(quoteTemplateSchema.safeParse(draft).success).toBe(true)
  })

  test('rewrites unknown merge tokens as bracketed text and notes them', () => {
    const raw = {
      ...RAW,
      blocks: [
        RAW.blocks[1],
        block({ type: 'text', heading: 'Project', body: 'Project: {{project.name}} for {{client.name}}' }),
      ],
    }
    const { draft, notes } = draftFromExtraction(raw, 'X')
    expect(draft.blocks[1]).toMatchObject({ body: 'Project: [project.name] for {{client.name}}' })
    expect(notes.some((n) => n.includes('{{project.name}}'))).toBe(true)
    expect(quoteTemplateSchema.safeParse(draft).success).toBe(true)
  })

  test('falls back to defaults for missing title, validity, columns and fee label', () => {
    const raw: ExtractedTemplate = {
      ...RAW,
      doc_title: '',
      validity_text: '',
      fee_label: null,
      pricing_mode: 'itemised',
      blocks: [
        RAW.blocks[1],
        block({ type: 'table', heading: 'T', columns: [], rows: [{ label: 'a', value: 'b' }] }),
      ],
    }
    const { draft } = draftFromExtraction(raw, 'X')
    expect(draft.doc_title).toBe('Quotation')
    expect(draft.validity_text).toBe('{{quote.valid_days}} days from issue unless otherwise stated')
    expect(draft.pricing_defaults).toMatchObject({ mode: 'itemised', fee_label: 'Fixed fee' })
    expect(draft.blocks[1]).toMatchObject({ columns: ['Item', 'Detail'] })
  })
})
