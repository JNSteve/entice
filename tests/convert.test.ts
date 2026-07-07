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

// Sell subtotal (contract_sum): 300 + 100 + 250.50 = 650.50
// Cost per line (budget_amount): 180, 60, 150
const LINES: ConvertLine[] = [
  { section_id: 'sec-1', description: 'Site setup',   qty: 3, unit_cost: 60,  unit_sell: 100 },
  { section_id: 'sec-1', description: 'Traffic mgmt', qty: 2, unit_cost: 30,  unit_sell: 50 },
  { section_id: 'sec-2', description: 'Membrane',     qty: 1, unit_cost: 150, unit_sell: 250.50 },
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

  test('creates one budget line per quote line, valued at cost', () => {
    const { budgetLines } = projectPayloadFromQuote(QUOTE, SECTIONS, LINES, OTHER_CODE_ID, TODAY)
    // One budget line per quote line (not per section)
    expect(budgetLines).toHaveLength(3)

    // Ordered by section position, preserving line order within each section
    expect(budgetLines.map((bl) => bl.description)).toEqual([
      'Site setup',
      'Traffic mgmt',
      'Membrane',
    ])
    // budget_amount = qty × unit_cost (COST, not sell)
    expect(budgetLines.map((bl) => bl.budget_amount)).toEqual([180, 60, 150])
    expect(budgetLines.map((bl) => bl.position)).toEqual([0, 1, 2])
    expect(budgetLines.every((bl) => bl.cost_code_id === OTHER_CODE_ID)).toBe(true)
  })

  test('unsectioned lines become their own budget lines, ordered last', () => {
    const linesWithOrphans: ConvertLine[] = [
      ...LINES,
      { section_id: null, description: 'Contingency', qty: 2, unit_cost: 40, unit_sell: 75 },
      { section_id: null, description: 'Disposal',    qty: 1, unit_cost: 20, unit_sell: 33.33 },
    ]
    const { budgetLines } = projectPayloadFromQuote(
      QUOTE, SECTIONS, linesWithOrphans, OTHER_CODE_ID, TODAY
    )
    // Every line carries across; unsectioned ones sort after the sectioned ones
    expect(budgetLines).toHaveLength(5)
    expect(budgetLines.map((bl) => bl.description)).toEqual([
      'Site setup',
      'Traffic mgmt',
      'Membrane',
      'Contingency',
      'Disposal',
    ])

    const contingency = budgetLines.find((bl) => bl.description === 'Contingency')!
    expect(contingency.budget_amount).toBe(80)  // 2 × 40
    expect(contingency.position).toBe(3)
  })

  test('no lines → zero budget lines', () => {
    const { budgetLines } = projectPayloadFromQuote(QUOTE, [], [], OTHER_CODE_ID, TODAY)
    expect(budgetLines).toHaveLength(0)
  })

  test('lines with no matching section still produce budget lines', () => {
    const orphans: ConvertLine[] = [
      { section_id: null, description: 'Lump sum', qty: 5, unit_cost: 20, unit_sell: 40 },
    ]
    const { budgetLines } = projectPayloadFromQuote(QUOTE, [], orphans, OTHER_CODE_ID, TODAY)
    expect(budgetLines).toHaveLength(1)
    expect(budgetLines[0].description).toBe('Lump sum')
    expect(budgetLines[0].budget_amount).toBe(100)  // 5 × 20
    expect(budgetLines[0].position).toBe(0)
  })

  test('contract_sum with GST rate 0 still equals subtotal', () => {
    const q = { ...QUOTE, gst_rate: 0 }
    const { project } = projectPayloadFromQuote(q, SECTIONS, LINES, OTHER_CODE_ID, TODAY)
    // With 0% GST the subtotal is the same
    expect(project.contract_sum).toBe(650.50)
  })

  test('rounding: budget amounts use round2', () => {
    // 3 × 33.33 = 99.99
    const lines: ConvertLine[] = [
      { section_id: 'sec-1', description: 'Odd', qty: 3, unit_cost: 33.33, unit_sell: 50 },
    ]
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
