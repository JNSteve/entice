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
