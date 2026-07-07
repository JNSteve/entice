/**
 * Pure payload-builder functions for quote conversion.
 *
 * These are intentionally side-effect-free so they can be unit-tested without
 * a DB connection.  The server actions in quotes/actions.ts call these, then
 * do the actual DB writes.
 */
import { lineTotal, docTotals, round2 } from '@/lib/money'
import { todayAU } from '@/lib/tz'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConvertQuote {
  id: string
  client_id: string
  site_id: string | null
  title: string
  description: string | null
  gst_rate: number
}

export interface ConvertSection {
  id: string
  title: string
  position: number
}

export interface ConvertLine {
  section_id: string | null
  qty: number
  unit_sell: number
}

// ─── Job payload ──────────────────────────────────────────────────────────────

export interface JobPayload {
  number: string
  client_id: string
  site_id: string | null
  quote_id: string
  title: string
  description: string | null
  status: 'scheduled'
  scheduled_start: null
  scheduled_end: null
}

export function jobPayloadFromQuote(quote: ConvertQuote, number: string): JobPayload {
  return {
    number,
    client_id: quote.client_id,
    site_id: quote.site_id,
    quote_id: quote.id,
    title: quote.title,
    description: quote.description,
    status: 'scheduled',
    scheduled_start: null,
    scheduled_end: null,
  }
}

// ─── Project payload ──────────────────────────────────────────────────────────

export interface ProjectPayload {
  number: string
  client_id: string
  site_id: string | null
  quote_id: string
  name: string
  description: string | null
  status: 'active'
  contract_sum: number
  retention_pct: number
  retention_cap_pct: number
  pc_release_fraction: number
  dlp_months: number
  claim_day: number
  start_date: string
}

export interface BudgetLinePayload {
  description: string
  budget_amount: number
  cost_code_id: string
  position: number
}

export interface ProjectConversionPayload {
  project: ProjectPayload
  budgetLines: BudgetLinePayload[]
}

/**
 * Builds the project insert payload and budget line payloads from quote data.
 *
 * @param quote           - the quote row
 * @param sections        - all sections for the quote (ordered by position)
 * @param lines           - all lines for the quote
 * @param otherCostCodeId - id of cost_codes row where code = '99' (Other)
 * @param today           - ISO date string for start_date (defaults to today)
 */
export function projectPayloadFromQuote(
  quote: ConvertQuote,
  sections: ConvertSection[],
  lines: ConvertLine[],
  otherCostCodeId: string,
  today: string = todayAU()
): ProjectConversionPayload {
  // Contract sum = sell subtotal ex GST over ALL lines
  const contractSum = docTotals(
    lines.map((l) => ({ qty: l.qty, unitSell: l.unit_sell })),
    quote.gst_rate
  ).subtotal

  // Build per-section budget lines
  const sectionedBudgetLines: BudgetLinePayload[] = sections.map((section) => {
    const sectionLines = lines.filter((l) => l.section_id === section.id)
    const sectionSubtotal = round2(
      sectionLines.reduce((sum, l) => sum + lineTotal(l.qty, l.unit_sell), 0)
    )
    return {
      description: section.title,
      budget_amount: sectionSubtotal,
      cost_code_id: otherCostCodeId,
      position: section.position,
    }
  })

  // Lines with no section → single "General" budget line (if any exist)
  const unsectionedLines = lines.filter((l) => l.section_id === null)
  const generalBudgetLine: BudgetLinePayload | null =
    unsectionedLines.length > 0
      ? {
          description: 'General',
          budget_amount: round2(
            unsectionedLines.reduce((sum, l) => sum + lineTotal(l.qty, l.unit_sell), 0)
          ),
          cost_code_id: otherCostCodeId,
          // Place after all sections
          position: sections.length,
        }
      : null

  const budgetLines = generalBudgetLine
    ? [...sectionedBudgetLines, generalBudgetLine]
    : sectionedBudgetLines

  const project: ProjectPayload = {
    number: '', // caller replaces this with nextNumber('project')
    client_id: quote.client_id,
    site_id: quote.site_id,
    quote_id: quote.id,
    name: quote.title,
    description: quote.description,
    // A converted project is a live project — 'active' matches the projects
    // status CHECK (active|practical_completion|defects_liability|closed).
    // ('quote' is a JOB status; using it here rejected every project insert.)
    status: 'active',
    contract_sum: contractSum,
    retention_pct: 10,
    retention_cap_pct: 5,
    pc_release_fraction: 0.5,
    dlp_months: 12,
    claim_day: 25,
    start_date: today,
  }

  return { project, budgetLines }
}
