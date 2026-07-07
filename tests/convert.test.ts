import { describe, expect, test } from 'vitest'
import {
  jobPayloadFromQuote,
  projectPayloadFromQuote,
  type ConvertQuote,
  type ConvertSection,
  type ConvertLine,
} from '../src/lib/convert'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const QUOTE: ConvertQuote = {
  id: 'q-001',
  client_id: 'c-001',
  site_id: 's-001',
  title: 'Roof Restoration',
  description: 'Full roof restoration scope',
  gst_rate: 10,
}

const SECTIONS: ConvertSection[] = [
  { id: 'sec-1', title: 'Preparation', position: 0 },
  { id: 'sec-2', title: 'Materials', position: 1 },
]

// Section 1: 2 lines  →  lineTotal(3, 100) + lineTotal(2, 50) = 300 + 100 = 400
// Section 2: 1 line   →  lineTotal(1, 250.50) = 250.50
// Unsectioned: none
const LINES: ConvertLine[] = [
  { section_id: 'sec-1', qty: 3, unit_sell: 100 },
  { section_id: 'sec-1', qty: 2, unit_sell: 50 },
  { section_id: 'sec-2', qty: 1, unit_sell: 250.50 },
]

const OTHER_CODE_ID = 'cc-99'
const TODAY = '2026-06-11'

// ─── jobPayloadFromQuote ─────────────────────────────────────────────────────

describe('jobPayloadFromQuote', () => {
  test('copies quote fields into job payload', () => {
    const payload = jobPayloadFromQuote(QUOTE, 'J-0001')
    expect(payload.number).toBe('J-0001')
    expect(payload.client_id).toBe(QUOTE.client_id)
    expect(payload.site_id).toBe(QUOTE.site_id)
    expect(payload.quote_id).toBe(QUOTE.id)
    expect(payload.title).toBe(QUOTE.title)
    expect(payload.description).toBe(QUOTE.description)
    expect(payload.status).toBe('scheduled')
    expect(payload.scheduled_start).toBeNull()
    expect(payload.scheduled_end).toBeNull()
  })

  test('null site_id is preserved', () => {
    const q = { ...QUOTE, site_id: null }
    const payload = jobPayloadFromQuote(q, 'J-0002')
    expect(payload.site_id).toBeNull()
  })

  test('null description is preserved', () => {
    const q = { ...QUOTE, description: null }
    const payload = jobPayloadFromQuote(q, 'J-0003')
    expect(payload.description).toBeNull()
  })
})

// ─── projectPayloadFromQuote ─────────────────────────────────────────────────

describe('projectPayloadFromQuote', () => {
  test('contract_sum equals sell subtotal ex GST', () => {
    // Subtotal = 300 + 100 + 250.50 = 650.50
    const { project } = projectPayloadFromQuote(QUOTE, SECTIONS, LINES, OTHER_CODE_ID, TODAY)
    expect(project.contract_sum).toBe(650.50)
  })

  test('project defaults are applied correctly', () => {
    const { project } = projectPayloadFromQuote(QUOTE, SECTIONS, LINES, OTHER_CODE_ID, TODAY)
    expect(project.retention_pct).toBe(10)
    expect(project.retention_cap_pct).toBe(5)
    expect(project.pc_release_fraction).toBe(0.5)
    expect(project.dlp_months).toBe(12)
    expect(project.claim_day).toBe(25)
    expect(project.start_date).toBe(TODAY)
    // Must be a value the projects.status CHECK accepts
    // (active|practical_completion|defects_liability|closed) — 'quote' is a JOB
    // status and previously made every quote→project conversion fail at insert.
    expect(project.status).toBe('active')
  })

  test('project name equals quote title', () => {
    const { project } = projectPayloadFromQuote(QUOTE, SECTIONS, LINES, OTHER_CODE_ID, TODAY)
    expect(project.name).toBe(QUOTE.title)
  })

  test('project number placeholder is empty string (caller fills it)', () => {
    const { project } = projectPayloadFromQuote(QUOTE, SECTIONS, LINES, OTHER_CODE_ID, TODAY)
    expect(project.number).toBe('')
  })

  test('creates one budget line per section with correct subtotals', () => {
    const { budgetLines } = projectPayloadFromQuote(QUOTE, SECTIONS, LINES, OTHER_CODE_ID, TODAY)
    // Two sections → two budget lines; no unsectioned lines → no General line
    expect(budgetLines).toHaveLength(2)

    const prep = budgetLines.find((bl) => bl.description === 'Preparation')
    const mat = budgetLines.find((bl) => bl.description === 'Materials')

    expect(prep).toBeDefined()
    expect(prep!.budget_amount).toBe(400)       // 3*100 + 2*50
    expect(prep!.cost_code_id).toBe(OTHER_CODE_ID)
    expect(prep!.position).toBe(0)

    expect(mat).toBeDefined()
    expect(mat!.budget_amount).toBe(250.50)     // 1*250.50
    expect(mat!.cost_code_id).toBe(OTHER_CODE_ID)
    expect(mat!.position).toBe(1)
  })

  test('unsectioned lines produce a General budget line', () => {
    const linesWithOrphans: ConvertLine[] = [
      ...LINES,
      { section_id: null, qty: 2, unit_sell: 75 },  // 150
      { section_id: null, qty: 1, unit_sell: 33.33 }, // 33.33
    ]
    const { budgetLines } = projectPayloadFromQuote(
      QUOTE, SECTIONS, linesWithOrphans, OTHER_CODE_ID, TODAY
    )
    // 2 section lines + 1 General line
    expect(budgetLines).toHaveLength(3)

    const general = budgetLines.find((bl) => bl.description === 'General')
    expect(general).toBeDefined()
    expect(general!.budget_amount).toBe(183.33)  // round2(150 + 33.33)
    expect(general!.position).toBe(2)            // after 2 sections
  })

  test('no sections and no unsectioned lines → zero budget lines', () => {
    const { budgetLines } = projectPayloadFromQuote(QUOTE, [], [], OTHER_CODE_ID, TODAY)
    expect(budgetLines).toHaveLength(0)
  })

  test('no sections but unsectioned lines → single General line', () => {
    const orphans: ConvertLine[] = [{ section_id: null, qty: 5, unit_sell: 20 }]
    const { budgetLines } = projectPayloadFromQuote(QUOTE, [], orphans, OTHER_CODE_ID, TODAY)
    expect(budgetLines).toHaveLength(1)
    expect(budgetLines[0].description).toBe('General')
    expect(budgetLines[0].budget_amount).toBe(100)
    expect(budgetLines[0].position).toBe(0)
  })

  test('contract_sum with GST rate 0 still equals subtotal', () => {
    const q = { ...QUOTE, gst_rate: 0 }
    const { project } = projectPayloadFromQuote(q, SECTIONS, LINES, OTHER_CODE_ID, TODAY)
    // With 0% GST the subtotal is the same
    expect(project.contract_sum).toBe(650.50)
  })

  test('rounding: section budget amounts use round2', () => {
    // 3 * 33.33 = 99.99 (exactly via lineTotal), section sum = round2(99.99) = 99.99
    const lines: ConvertLine[] = [{ section_id: 'sec-1', qty: 3, unit_sell: 33.33 }]
    const { budgetLines } = projectPayloadFromQuote(
      QUOTE,
      [{ id: 'sec-1', title: 'Works', position: 0 }],
      lines,
      OTHER_CODE_ID,
      TODAY
    )
    expect(budgetLines[0].budget_amount).toBe(99.99)
  })

  test('quote_id is linked correctly', () => {
    const { project } = projectPayloadFromQuote(QUOTE, SECTIONS, LINES, OTHER_CODE_ID, TODAY)
    expect(project.quote_id).toBe(QUOTE.id)
  })
})
