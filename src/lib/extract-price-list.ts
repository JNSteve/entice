import OpenAI from 'openai'
import { PRICE_KINDS, type PriceKind } from './price-list'

/**
 * OpenAI extraction of priced lines from a supplier document — a price list,
 * quote, proforma or invoice. The review screen checks everything before it
 * is saved, so this only has to be a good first draft.
 */

const EXTRACTION_MODEL = 'gpt-5'

export type ExtractedPriceLine = {
  code: string | null
  name: string
  unit: string | null
  qty: number | null
  unit_price: number
  kind: PriceKind
  note: string | null
}

export type ExtractedPriceDocument = {
  supplier: string | null
  document_date: string | null
  subtotal: number | null
  gst: number | null
  lines: ExtractedPriceLine[]
}

const nullable = (type: string) => ({ type: [type, 'null'] })

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['supplier', 'document_date', 'subtotal', 'gst', 'lines'],
  properties: {
    supplier: nullable('string'),
    document_date: nullable('string'),
    subtotal: nullable('number'),
    gst: nullable('number'),
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'name', 'unit', 'qty', 'unit_price', 'kind', 'note'],
        properties: {
          code: nullable('string'),
          name: { type: 'string' },
          unit: nullable('string'),
          qty: nullable('number'),
          unit_price: { type: 'number' },
          kind: { type: 'string', enum: [...PRICE_KINDS] },
          note: nullable('string'),
        },
      },
    },
  },
} as const

const EXTRACTION_PROMPT = `This PDF is from a supplier to an Australian asbestos-removal and civil remediation company. It may be a price list, quote, proforma or tax invoice. Extract every purchasable line.

For each line:
- code: the supplier's stock/product code, or null.
- name: the product description exactly as written (fix obvious typos only if certain).
- unit: unit of measure if shown (ea, roll, box, bag, m, m2, kg, pk…), else null.
- qty: the quantity on this document if it is an order/invoice, else null.
- unit_price: the UNIT price exactly as printed, with every decimal place kept (e.g. 99.313, 5.6525). Never a line total.
- kind: consumable (used up on the job: plastic sheeting, tape, rags, filters, bags, PPE, binder, fasteners), material (becomes part of the works: concrete, timber, membrane, sheeting installed), plant (reusable equipment, tools, machines, vacuum parts and attachments, hire), subbie (a subcontracted service), labour, or other.
- note: any extra instruction printed under the line (e.g. "Mixing ratio 5:1, approx 20 m2 coverage"), else null.

Do NOT output lines for: zero-price lines, serial-number lines, freight/delivery/courier lines, headings, notes, or totals. Put a note line under the product it belongs to instead.

supplier: the supplier's company name (not the customer). document_date: ISO date (YYYY-MM-DD) if shown. subtotal and gst: the document's ex-GST subtotal and GST amount if shown, else null.`

export function priceExtractionEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY)
}

export async function extractPriceList(
  pdfBase64: string
): Promise<{ result?: ExtractedPriceDocument; error?: string }> {
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
              filename: 'supplier-document.pdf',
              file_data: `data:application/pdf;base64,${pdfBase64}`,
            },
            { type: 'input_text', text: EXTRACTION_PROMPT },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'supplier_price_extraction',
          schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
          strict: true,
        },
      },
    })

    if (response.status === 'incomplete') {
      return { error: 'This document is too long to read in one go — split it into smaller PDFs' }
    }
    const text = response.output_text
    if (!text) return { error: 'The document came back empty — try again' }
    return { result: JSON.parse(text) as ExtractedPriceDocument }
  } catch (error) {
    if (error instanceof OpenAI.AuthenticationError) {
      return { error: 'OPENAI_API_KEY is invalid — check the environment configuration' }
    }
    if (error instanceof OpenAI.RateLimitError) {
      return { error: 'Reading is rate-limited right now — try again in a minute' }
    }
    if (error instanceof OpenAI.APIConnectionError) {
      return { error: 'Could not reach the OpenAI API — check connectivity and retry' }
    }
    if (error instanceof OpenAI.APIError) {
      return { error: `Reading failed (${error.status ?? 'API error'}): ${error.message}` }
    }
    if (error instanceof SyntaxError) {
      return { error: 'The result was unreadable — try again' }
    }
    throw error
  }
}
