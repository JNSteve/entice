import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HRCW_ITEMS,
  hazardsToSteps,
  hasAnyValue,
  hrcwItemSchema,
  normalizeHrcwAnswers,
  parseHrcwAnswers,
  parseSteps,
  parseStringList,
  parseSwmsStructure,
  swmsInstanceCreateV2Schema,
  swmsStepSchema,
  swmsTemplateV2Schema,
  type SwmsHrcwItem,
} from '@/lib/swms'
import type { SwmsHazard } from '@/lib/zod'

// ─── Legacy → new migration mapping (mirrors 0030 SQL) ───────────────────────

describe('hazardsToSteps (legacy migration mapping)', () => {
  const legacy: SwmsHazard[] = [
    {
      task: 'Excavate trench',
      hazards: 'Collapse, engulfment',
      risk: 'H',
      controls: 'Bench, batter or shore',
      residual_risk: 'M',
    },
    {
      task: 'Access and egress',
      hazards: 'Falls',
      risk: 'M',
      controls: 'Ladder within 9m',
      residual_risk: 'L',
    },
  ]

  it('maps task→step and risk→initial_risk, preserving H/M/L values', () => {
    const steps = hazardsToSteps(legacy)
    expect(steps).toHaveLength(2)
    expect(steps[0]).toEqual({
      step: 'Excavate trench',
      hazards: 'Collapse, engulfment',
      initial_risk: 'H',
      controls: 'Bench, batter or shore',
      residual_risk: 'M',
      responsible: 'Site Supervisor',
    })
    expect(steps[1].initial_risk).toBe('M')
    expect(steps[1].residual_risk).toBe('L')
  })

  it('produces steps that validate against the step schema', () => {
    for (const step of hazardsToSteps(legacy)) {
      expect(swmsStepSchema.safeParse(step).success).toBe(true)
    }
  })

  it('maps an empty list to an empty list', () => {
    expect(hazardsToSteps([])).toEqual([])
  })
})

// ─── H/M/L step + shape validation ───────────────────────────────────────────

describe('swmsStepSchema', () => {
  const valid = {
    step: 'Cut concrete',
    hazards: 'Silica dust',
    initial_risk: 'H',
    controls: 'Wet cutting only',
    residual_risk: 'M',
    responsible: 'Site Supervisor',
  }

  it('accepts a valid step', () => {
    expect(swmsStepSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects risk values outside H/M/L', () => {
    expect(
      swmsStepSchema.safeParse({ ...valid, initial_risk: 'X' }).success
    ).toBe(false)
    expect(
      swmsStepSchema.safeParse({ ...valid, residual_risk: 'Extreme' }).success
    ).toBe(false)
  })

  it('rejects empty step/hazards/controls but allows empty responsible', () => {
    expect(swmsStepSchema.safeParse({ ...valid, step: '' }).success).toBe(false)
    expect(swmsStepSchema.safeParse({ ...valid, hazards: '' }).success).toBe(false)
    expect(swmsStepSchema.safeParse({ ...valid, controls: '' }).success).toBe(false)
    expect(swmsStepSchema.safeParse({ ...valid, responsible: '' }).success).toBe(true)
  })

  it('defaults responsible when omitted', () => {
    const rest: Record<string, string> = { ...valid }
    delete rest.responsible
    const parsed = swmsStepSchema.parse(rest)
    expect(parsed.responsible).toBe('')
  })
})

describe('swmsTemplateV2Schema', () => {
  const validTemplate = {
    title: 'Test SWMS',
    doc_control: { prepared_by: 'A', approved_by: 'B', scope_note: 'C' },
    hrcw_items: [{ id: 'asbestos', label: 'Work near asbestos.', suggested: 'yes' }],
    requirements: {
      competency: 'White card',
      licences_permits: '',
      ppe: 'P2',
      equipment: '',
      monitoring: '',
    },
    steps: [
      {
        step: 'Do the work',
        hazards: 'A hazard',
        initial_risk: 'M',
        controls: 'A control',
        residual_risk: 'L',
        responsible: '',
      },
    ],
    stop_work_triggers: ['Something changes.'],
    emergency_scenarios: [
      { scenario: 'Fire', immediate_action: 'Evacuate', notification: 'Notify' },
    ],
    references_list: ['A code of practice.'],
    active: true,
  }

  it('accepts a full template', () => {
    expect(swmsTemplateV2Schema.safeParse(validTemplate).success).toBe(true)
  })

  it('requires at least one work step', () => {
    expect(
      swmsTemplateV2Schema.safeParse({ ...validTemplate, steps: [] }).success
    ).toBe(false)
  })

  it('rejects an HRCW item without a label', () => {
    expect(
      swmsTemplateV2Schema.safeParse({
        ...validTemplate,
        hrcw_items: [{ id: 'x', label: '', suggested: 'no' }],
      }).success
    ).toBe(false)
  })

  it('rejects a bad suggested answer', () => {
    expect(
      hrcwItemSchema.safeParse({ id: 'x', label: 'Item', suggested: 'maybe' })
        .success
    ).toBe(false)
  })
})

describe('swmsInstanceCreateV2Schema', () => {
  const base = {
    template_id: '6b7f0f9e-93c7-4f0f-9d8a-1a2b3c4d5e6f',
    project_id: '6b7f0f9e-93c7-4f0f-9d8a-1a2b3c4d5e60',
    job_id: null,
    project_details: { work_location: 'Site A' },
    hrcw_answers: { asbestos: 'yes' },
    emergency_contacts: { coordinator: 'Site Supervisor' },
  }

  it('accepts a valid create payload and fills detail defaults', () => {
    const parsed = swmsInstanceCreateV2Schema.parse(base)
    expect(parsed.project_details.work_location).toBe('Site A')
    expect(parsed.project_details.nearest_hospital).toBe('')
    expect(parsed.emergency_contacts.first_aid).toBe('')
  })

  it('requires a project or job', () => {
    expect(
      swmsInstanceCreateV2Schema.safeParse({
        ...base,
        project_id: null,
        job_id: null,
      }).success
    ).toBe(false)
  })

  it('rejects answers outside yes/no/na', () => {
    expect(
      swmsInstanceCreateV2Schema.safeParse({
        ...base,
        hrcw_answers: { asbestos: 'yep' },
      }).success
    ).toBe(false)
  })
})

// ─── HRCW answer normalization ───────────────────────────────────────────────

describe('normalizeHrcwAnswers', () => {
  const items: SwmsHrcwItem[] = [
    { id: 'asbestos', label: 'Asbestos', suggested: 'yes' },
    { id: 'fall_2m', label: 'Falls over 2 m', suggested: 'no' },
  ]

  it('keeps the office answer when provided', () => {
    expect(normalizeHrcwAnswers(items, { asbestos: 'na' })).toEqual({
      asbestos: 'na',
      fall_2m: 'no',
    })
  })

  it('falls back to the template suggestion', () => {
    expect(normalizeHrcwAnswers(items, {})).toEqual({
      asbestos: 'yes',
      fall_2m: 'no',
    })
  })

  it('drops answers for unknown item ids', () => {
    const result = normalizeHrcwAnswers(items, {
      asbestos: 'yes',
      rogue_item: 'yes',
    })
    expect(Object.keys(result).sort()).toEqual(['asbestos', 'fall_2m'])
  })
})

// ─── Tolerant parsers ────────────────────────────────────────────────────────

describe('tolerant parsers', () => {
  it('parseSteps returns [] for malformed jsonb', () => {
    expect(parseSteps(null)).toEqual([])
    expect(parseSteps('nope')).toEqual([])
    expect(parseSteps([{ step: 'x' }])).toEqual([])
  })

  it('parseStringList filters blank lines', () => {
    expect(parseStringList(['a', ' ', 'b', ''])).toEqual(['a', 'b'])
    expect(parseStringList({ not: 'a list' })).toEqual([])
  })

  it('parseHrcwAnswers drops malformed maps', () => {
    expect(parseHrcwAnswers({ a: 'yes', b: 'na' })).toEqual({ a: 'yes', b: 'na' })
    expect(parseHrcwAnswers({ a: 'nope' })).toEqual({})
    expect(parseHrcwAnswers(null)).toEqual({})
  })

  it('hasAnyValue ignores whitespace-only values', () => {
    expect(hasAnyValue({ a: '  ', b: '' })).toBe(false)
    expect(hasAnyValue({ a: '', b: 'x' })).toBe(true)
  })
})

describe('parseSwmsStructure', () => {
  it('reads a full structured row', () => {
    const structure = parseSwmsStructure({
      doc_control: { prepared_by: 'A', approved_by: 'B', scope_note: 'Scope' },
      hrcw_items: [{ id: 'asbestos', label: 'Asbestos', suggested: 'yes' }],
      hrcw_answers: { asbestos: 'yes' },
      requirements: {
        competency: 'C',
        licences_permits: '',
        ppe: '',
        equipment: '',
        monitoring: '',
      },
      steps: [
        {
          step: 'S',
          hazards: 'H',
          initial_risk: 'H',
          controls: 'C',
          residual_risk: 'M',
          responsible: 'R',
        },
      ],
      stop_work_triggers: ['Trigger'],
      emergency_scenarios: [
        { scenario: 'X', immediate_action: 'Y', notification: 'Z' },
      ],
      emergency_contacts: { coordinator: 'Co', first_aid: '', assembly_point: '' },
      project_details: { work_location: 'Loc' },
      references_list: ['Ref'],
    })
    expect(structure.steps).toHaveLength(1)
    expect(structure.hrcwAnswers.asbestos).toBe('yes')
    expect(structure.docControl.scope_note).toBe('Scope')
    expect(structure.projectDetails.work_location).toBe('Loc')
  })

  it('falls back to legacy body/hazards for pre-0030 rows', () => {
    const structure = parseSwmsStructure({
      body: 'Legacy safe work method',
      hazards: [
        {
          task: 'Legacy task',
          hazards: 'Legacy hazard',
          risk: 'H',
          controls: 'Legacy control',
          residual_risk: 'L',
        },
      ],
    })
    expect(structure.docControl.scope_note).toBe('Legacy safe work method')
    expect(structure.steps).toHaveLength(1)
    expect(structure.steps[0]).toMatchObject({
      step: 'Legacy task',
      initial_risk: 'H',
      residual_risk: 'L',
      responsible: 'Site Supervisor',
    })
  })

  it('prefers structured steps over legacy hazards when both exist', () => {
    const structure = parseSwmsStructure({
      hazards: [
        {
          task: 'Old',
          hazards: 'Old',
          risk: 'H',
          controls: 'Old',
          residual_risk: 'L',
        },
      ],
      steps: [
        {
          step: 'New',
          hazards: 'New',
          initial_risk: 'M',
          controls: 'New',
          residual_risk: 'L',
          responsible: '',
        },
      ],
    })
    expect(structure.steps).toHaveLength(1)
    expect(structure.steps[0].step).toBe('New')
  })
})

// ─── Standard HRCW checklist ─────────────────────────────────────────────────

describe('DEFAULT_HRCW_ITEMS', () => {
  it('every item validates and ids are unique', () => {
    const ids = new Set<string>()
    for (const item of DEFAULT_HRCW_ITEMS) {
      expect(hrcwItemSchema.safeParse(item).success).toBe(true)
      ids.add(item.id)
    }
    expect(ids.size).toBe(DEFAULT_HRCW_ITEMS.length)
  })
})
