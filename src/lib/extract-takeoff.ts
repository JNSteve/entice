import OpenAI from 'openai'

/**
 * OpenAI-powered takeoff extraction from asbestos registers / survey reports.
 * Dormant until OPENAI_API_KEY is set — mirrors the email engine pattern:
 * everything is wired, the switch is the env var.
 */

export interface ExtractedTakeoffItem {
  location: string
  material: string
  description: string
  friable: boolean | null
  condition: string | null
  qty: number | null
  unit: string
  recommendation: string | null
}

export function extractionEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY)
}

/** Base64 inflates by 4/3 — keep the raw document well under request caps. */
export const MAX_REPORT_BYTES = 20 * 1024 * 1024

const EXTRACTION_MODEL = 'gpt-5'

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description:
              'Where the material is (e.g. "Kitchen ceiling", "External wall — north elevation")',
          },
          material: {
            type: 'string',
            description:
              'The material itself (e.g. "AC sheeting", "Vinyl floor tiles", "Pipe lagging")',
          },
          description: {
            type: 'string',
            description: 'Fuller description as written in the report',
          },
          friable: {
            type: ['boolean', 'null'],
            description:
              'true if friable, false if non-friable/bonded, null if not stated',
          },
          condition: {
            type: ['string', 'null'],
            description:
              'Condition as stated (e.g. "Good", "Weathered", "Damaged"), null if not stated',
          },
          qty: {
            type: ['number', 'null'],
            description: 'Numeric quantity/extent if stated, null otherwise',
          },
          unit: {
            type: 'string',
            description:
              'Unit for qty (m2, lm, item, ea). Use "item" when no quantity is stated.',
          },
          recommendation: {
            type: ['string', 'null'],
            description:
              'Recommended action from the report (e.g. "Remove", "Encapsulate and manage"), null if none',
          },
        },
        required: [
          'location',
          'material',
          'description',
          'friable',
          'condition',
          'qty',
          'unit',
          'recommendation',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const

const EXTRACTION_PROMPT = `You are reading an asbestos register, hazardous-materials survey, or similar site report for a licensed asbestos removal and civil works contractor in Queensland, Australia.

Extract every distinct hazardous-material occurrence (typically the rows of the asbestos register table) into structured items. One item per material occurrence per location — do not merge distinct locations. Include quantities and units exactly as stated; if the report only gives an extent like "approx 40m2", parse the number and unit. If no quantity is stated, use null qty and unit "item".

Only extract what the document actually states — do not infer quantities, conditions, or recommendations that are not written in it. If the document contains no asbestos register or material findings, return an empty items array.`

/**
 * Sends the PDF to OpenAI and returns structured register rows.
 * Caller is responsible for the enabled-check and size cap.
 */
export async function extractTakeoffFromReport(
  pdfBase64: string
): Promise<{ items?: ExtractedTakeoffItem[]; error?: string }> {
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
              filename: 'report.pdf',
              file_data: `data:application/pdf;base64,${pdfBase64}`,
            },
            { type: 'input_text', text: EXTRACTION_PROMPT },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'takeoff_extraction',
          schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
          strict: true,
        },
      },
    })

    if (response.status === 'incomplete') {
      return { error: 'The report is too large to extract in one pass — split the PDF and retry' }
    }

    const text = response.output_text
    if (!text) {
      return { error: 'Extraction returned no result — retry' }
    }
    const parsed = JSON.parse(text) as { items: ExtractedTakeoffItem[] }
    return { items: parsed.items ?? [] }
  } catch (error) {
    if (error instanceof OpenAI.AuthenticationError) {
      return { error: 'OPENAI_API_KEY is invalid — check the environment configuration' }
    }
    if (error instanceof OpenAI.RateLimitError) {
      return { error: 'Extraction is rate-limited right now — try again in a minute' }
    }
    if (error instanceof OpenAI.APIConnectionError) {
      return { error: 'Could not reach the OpenAI API — check connectivity and retry' }
    }
    if (error instanceof OpenAI.APIError) {
      return { error: `Extraction failed (${error.status ?? 'API error'}): ${error.message}` }
    }
    if (error instanceof SyntaxError) {
      return { error: 'Extraction returned an unreadable result — retry' }
    }
    throw error
  }
}
