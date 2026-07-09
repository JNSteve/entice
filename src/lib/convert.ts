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
  /** Office-side owner — carried onto the job/project. */
  pm_id: string | null
}

export interface ConvertSection {
  id: string
  title: string
  position: number
}

export interface ConvertLine {
  section_id: string | null
  description: string
  qty: number
  unit_cost: number
  unit_sell: number
}

// ─── Scope summary ────────────────────────────────────────────────────────────

/**
 * Price-free scope-of-works text for the converted job/project description —
 * the site crew and supervisor can read WHAT was quoted without any money
 * fields (field/supervisor roles cannot see quotes).
 */
export function scopeSummaryFromQuote(
  sections: ConvertSection[],
  lines: ConvertLine[]
): string | null {
  if (lines.length === 0) return null

  const bySection = new Map<string | null, ConvertLine[]>()
  for (const line of lines) {
    const list = bySection.get(line.section_id) ?? []
    list.push(line)
    bySection.set(line.section_id, list)
  }

  const parts: string[] = ['Scope of works (from quote):']
  const ordered = [...sections].sort((a, b) => a.position - b.position)
  for (const section of ordered) {
    const sectionLines = bySection.get(section.id)
    if (!sectionLines?.length) continue
    parts.push(`\n${section.title}`)
    for (const l of sectionLines) parts.push(`- ${l.description}`)
  }
  const orphans = lines.filter(
    (l) => l.section_id === null || !sections.some((s) => s.id === l.section_id)
  )
  if (orphans.length > 0) {
    parts.push('\nOther works')
    for (const l of orphans) parts.push(`- ${l.description}`)
  }
  return parts.join('\n')
}

/** Quote description + scope block; either may be absent. */
function describeWithScope(
  description: string | null,
  sections: ConvertSection[],
  lines: ConvertLine[]
): string | null {
  const scope = scopeSummaryFromQuote(sections, lines)
  const combined = [description, scope].filter(Boolean).join('\n\n')
  return combined || null
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
  pm_id: string | null
}

export function jobPayloadFromQuote(
  quote: ConvertQuote,
  number: string,
  sections: ConvertSection[] = [],
  lines: ConvertLine[] = []
): JobPayload {
  return {
    number,
    client_id: quote.client_id,
    site_id: quote.site_id,
    quote_id: quote.id,
    title: quote.title,
    description: describeWithScope(quote.description, sections, lines),
    status: 'scheduled',
    scheduled_start: null,
    scheduled_end: null,
    pm_id: quote.pm_id ?? null,
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
  pm_id: string | null
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

  // One budget line per quote line, valued at COST (qty × unit_cost) — the
  // budget tracks committed/actual COSTS, so seeding it with sell prices would
  // make every line look over budget from day one.  Exception: quotes priced
  // via sell rates only (unit_cost left at its 0 default on every line) would
  // seed a useless all-zero budget, so fall back to sell for the whole quote.
  const hasCostData = lines.some((l) => lineTotal(l.qty, l.unit_cost) !== 0)
  const amountOf = (l: ConvertLine) =>
    round2(lineTotal(l.qty, hasCostData ? l.unit_cost : l.unit_sell))

  // Lines are grouped by their section's position (unsectioned lines last),
  // preserving the incoming line order within each group (sort is stable),
  // then handed sequential positions.
  const LAST = Number.MAX_SAFE_INTEGER
  const sectionPosition = new Map(sections.map((s) => [s.id, s.position]))
  const sectionOf = (l: ConvertLine) =>
    l.section_id !== null ? sectionPosition.get(l.section_id) ?? LAST : LAST

  const budgetLines: BudgetLinePayload[] = [...lines]
    .sort((a, b) => sectionOf(a) - sectionOf(b))
    .map((line, position) => ({
      description: line.description,
      budget_amount: amountOf(line),
      cost_code_id: otherCostCodeId,
      position,
    }))

  const project: ProjectPayload = {
    number: '', // caller replaces this with nextNumber('project')
    client_id: quote.client_id,
    site_id: quote.site_id,
    quote_id: quote.id,
    name: quote.title,
    description: describeWithScope(quote.description, sections, lines),
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
    pm_id: quote.pm_id ?? null,
  }

  return { project, budgetLines }
}
