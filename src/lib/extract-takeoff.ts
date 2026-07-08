import Anthropic from '@anthropic-ai/sdk'

/**
 * Claude-powered takeoff extraction from asbestos registers / survey reports.
 * Dormant until ANTHROPIC_API_KEY is set — mirrors the email engine pattern:
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
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/** Base64 inflates by 4/3 and the API caps requests at 32MB. */
export const MAX_REPORT_BYTES = 20 * 1024 * 1024

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
            description: 'Where the material is (e.g. "Kitchen ceiling", "External wall — north elevation")',
          },
          material: {
            type: 'string',
            description: 'The material itself (e.g. "AC sheeting", "Vinyl floor tiles", "Pipe lagging")',
          },
          description: {
            type: 'string',
            description: 'Fuller description as written in the report',
          },
          friable: {
            anyOf: [{ type: 'boolean' }, { type: 'null' }],
            description: 'true if friable, false if non-friable/bonded, null if not stated',
          },
          condition: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Condition as stated (e.g. "Good", "Weathered", "Damaged"), null if not stated',
          },
          qty: {
            anyOf: [{ type: 'number' }, { type: 'null' }],
            description: 'Numeric quantity/extent if stated, null otherwise',
          },
          unit: {
            type: 'string',
            description: 'Unit for qty (m2, lm, item, ea). Use "item" when no quantity is stated.',
          },
          recommendation: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Recommended action from the report (e.g. "Remove", "Encapsulate and manage"), null if none',
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
 * Sends the PDF to Claude and returns structured register rows.
 * Caller is responsible for the enabled-check and size cap.
 */
export async function extractTakeoffFromReport(
  pdfBase64: string
): Promise<{ items?: ExtractedTakeoffItem[]; error?: string }> {
  const client = new Anthropic()

  try {
    const stream = client.messages.stream({
      model: 'claude-opus-4-8',
      max_tokens: 64000,
      thinking: { type: 'adaptive' },
      output_config: {
        format: { type: 'json_schema', schema: EXTRACTION_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            { type: 'text', text: EXTRACTION_PROMPT },
          ],
        },
      ],
    })
    const message = await stream.finalMessage()

    if (message.stop_reason === 'max_tokens') {
      return { error: 'The report is too large to extract in one pass — split the PDF and retry' }
    }
    if (message.stop_reason === 'refusal') {
      return { error: 'Extraction was declined for this document' }
    }

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    const parsed = JSON.parse(text) as { items: ExtractedTakeoffItem[] }
    return { items: parsed.items ?? [] }
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return { error: 'ANTHROPIC_API_KEY is invalid — check the environment configuration' }
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { error: 'Extraction is rate-limited right now — try again in a minute' }
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return { error: 'Could not reach the Anthropic API — check connectivity and retry' }
    }
    if (error instanceof Anthropic.APIError) {
      return { error: `Extraction failed (${error.status ?? 'API error'}): ${error.message}` }
    }
    if (error instanceof SyntaxError) {
      return { error: 'Extraction returned an unreadable result — retry' }
    }
    throw error
  }
}
