import OpenAI from 'openai'
import {
  ACCEPTANCE_BODY,
  DEFAULT_PRICING,
  MERGE_FIELDS,
  isMergeField,
  newBlockId,
  stripLeadingOrdinal,
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
    doc_title: {
      type: 'string',
      description: 'Document type printed in the header, usually "Quotation"',
    },
    heading: {
      type: ['string', 'null'],
      description:
        'Service heading under the document type, e.g. "Asbestos Inspection, Sampling and Close-out". Null if none.',
    },
    validity_text: {
      type: 'string',
      description:
        'The validity sentence with the number of days replaced by {{quote.valid_days}}',
    },
    pricing_mode: {
      type: 'string',
      enum: ['lump_sum', 'itemised'],
      description:
        'lump_sum when the document shows a single fee; itemised when it lists priced line items',
    },
    fee_label: {
      type: ['string', 'null'],
      description: 'Label used for the fee, e.g. "Fixed fee". Null if not applicable.',
    },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Anything you could not place, one short note each',
    },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['text', 'bullets', 'table', 'pricing', 'acceptance'] },
          heading: { type: 'string' },
          body: {
            type: ['string', 'null'],
            description: 'text/acceptance: paragraphs separated by a blank line',
          },
          items: {
            type: 'array',
            items: { type: 'string' },
            description: 'bullets: one entry per bullet',
          },
          intro: {
            type: ['string', 'null'],
            description: 'table: paragraph printed above the table',
          },
          columns: {
            type: 'array',
            items: { type: 'string' },
            description: 'table: exactly two column headings',
          },
          rows: {
            type: 'array',
            items: {
              type: 'object',
              properties: { label: { type: 'string' }, value: { type: 'string' } },
              required: ['label', 'value'],
              additionalProperties: false,
            },
          },
          note: {
            type: ['string', 'null'],
            description: 'pricing: sentence printed under the fee',
          },
        },
        required: ['type', 'heading', 'body', 'items', 'intro', 'columns', 'rows', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'doc_title',
    'heading',
    'validity_text',
    'pricing_mode',
    'fee_label',
    'notes',
    'blocks',
  ],
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

/**
 * Sends the PDF to OpenAI and returns the loose extraction. The caller checks
 * size and enablement first.
 */
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
            {
              type: 'input_file',
              filename: 'quote.pdf',
              file_data: `data:application/pdf;base64,${pdfBase64}`,
            },
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
  return text.replace(/\{\{([^{}]*)\}\}/g, (_whole, raw: string) => {
    const key = raw.trim()
    return isMergeField(key) ? `{{${key}}}` : `[${key}]`
  })
}

/** Pure mapping from the model's loose output to a valid template draft plus review notes. */
export function draftFromExtraction(
  raw: ExtractedTemplate,
  name: string
): { draft: QuoteTemplateInput; notes: string[] } {
  const notes: string[] = [...(raw.notes ?? [])]
  const blocks: DocBlock[] = []
  let pricingSeen = false
  let acceptanceSeen = false

  for (const b of raw.blocks ?? []) {
    // The app numbers headings by position, so drop the source's own numbers.
    const heading = scrub(stripLeadingOrdinal((b.heading ?? '').trim()) || 'Section', notes)
    const asText = (body: string) =>
      blocks.push({ id: newBlockId(), type: 'text', heading, body: scrub(body, notes) })

    switch (b.type) {
      case 'text':
        asText(b.body ?? '')
        break
      case 'bullets':
        blocks.push({
          id: newBlockId(),
          type: 'bullets',
          heading,
          items: (b.items ?? []).map((i) => scrub(i.trim(), notes)).filter(Boolean),
        })
        break
      case 'table': {
        const cols = (b.columns ?? []).map((c) => c.trim()).filter(Boolean)
        blocks.push({
          id: newBlockId(),
          type: 'table',
          heading,
          intro: b.intro?.trim() ? scrub(b.intro.trim(), notes) : undefined,
          columns: [cols[0] ?? 'Item', cols[1] ?? 'Detail'],
          rows: (b.rows ?? [])
            .map((r) => ({ label: scrub(r.label.trim(), notes), value: scrub(r.value.trim(), notes) }))
            .filter((r) => r.label || r.value),
        })
        break
      }
      case 'pricing':
        if (pricingSeen) {
          notes.push(`Second pricing section "${heading}" converted to text`)
          asText(b.note ?? b.body ?? '')
        } else {
          pricingSeen = true
          blocks.push({
            id: newBlockId(),
            type: 'pricing',
            heading,
            note: b.note?.trim() ? scrub(b.note.trim(), notes) : undefined,
          })
        }
        break
      case 'acceptance':
        if (acceptanceSeen) {
          notes.push(`Second acceptance section "${heading}" converted to text`)
          asText(b.body ?? '')
        } else {
          acceptanceSeen = true
          blocks.push({
            id: newBlockId(),
            type: 'acceptance',
            heading,
            body: scrub((b.body ?? '').trim() || ACCEPTANCE_BODY, notes),
          })
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
    validity_text: raw.validity_text?.trim()
      ? scrub(raw.validity_text.trim(), notes)
      : DEFAULT_VALIDITY,
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
