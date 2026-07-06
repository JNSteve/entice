import { z } from 'zod'
import { RISK_LEVELS, swmsHazardSchema, type SwmsHazard } from '@/lib/zod'

/**
 * SWMS 2.0 structured shapes — mirror the jsonb columns added by migration
 * 0030_swms_two.sql. The document anatomy follows a professional SWMS:
 *
 * Template level (swms_templates):
 *   doc_control          {prepared_by, approved_by, scope_note}
 *   hrcw_items           [{id, label, suggested}]  — HRCW trigger checklist ITEMS
 *   requirements         {competency, licences_permits, ppe, equipment, monitoring}
 *   steps                [{step, hazards, initial_risk, controls, residual_risk, responsible}]
 *   stop_work_triggers   [string]
 *   emergency_scenarios  [{scenario, immediate_action, notification}]
 *   references_list      [string]
 *
 * Instance level (swms_instances) — template columns snapshotted at issue, plus:
 *   project_details      {work_location, work_dates, …}  — filled at issue
 *   hrcw_answers         {[itemId]: 'yes'|'no'|'na'}     — office-confirmed ANSWERS
 *   emergency_contacts   {coordinator, first_aid, assembly_point}
 *
 * Risk ratings are practical H/M/L — deliberately NOT the risk register's
 * 5×5 numerics. The numeric matrix appears as static reference text in the
 * PDF only.
 */

// ─── Building blocks ─────────────────────────────────────────────────────────

const text = z.string().default('')

export const HRCW_ANSWERS = ['yes', 'no', 'na'] as const
export type HrcwAnswer = (typeof HRCW_ANSWERS)[number]

export const HRCW_ANSWER_LABELS: Record<HrcwAnswer, string> = {
  yes: 'Yes',
  no: 'No',
  na: 'N/A',
}

export const swmsStepSchema = z.object({
  step: z.string().min(1, 'Work step is required'),
  hazards: z.string().min(1, 'Key hazards are required'),
  initial_risk: z.enum(RISK_LEVELS),
  controls: z.string().min(1, 'Required controls are required'),
  residual_risk: z.enum(RISK_LEVELS),
  /** Responsible position / evidence, e.g. "Site Supervisor / daily inspection record". */
  responsible: text,
})
export type SwmsStep = z.infer<typeof swmsStepSchema>

export const hrcwItemSchema = z.object({
  /** Stable slug — instance answers key off it. */
  id: z.string().min(1),
  label: z.string().min(1, 'Item text is required'),
  /** Pre-checked suggestion shown at issue time; office confirms. */
  suggested: z.enum(HRCW_ANSWERS).default('yes'),
})
export type SwmsHrcwItem = z.infer<typeof hrcwItemSchema>

export const swmsDocControlSchema = z.object({
  prepared_by: text,
  approved_by: text,
  scope_note: text,
})
export type SwmsDocControl = z.infer<typeof swmsDocControlSchema>

export const swmsRequirementsSchema = z.object({
  competency: text,
  licences_permits: text,
  ppe: text,
  equipment: text,
  monitoring: text,
})
export type SwmsRequirements = z.infer<typeof swmsRequirementsSchema>

export const SWMS_REQUIREMENT_LABELS: Record<keyof SwmsRequirements, string> = {
  competency: 'Competency & supervision',
  licences_permits: 'Licences & permits',
  ppe: 'PPE',
  equipment: 'Equipment',
  monitoring: 'Monitoring',
}

export const emergencyScenarioSchema = z.object({
  scenario: z.string().min(1, 'Scenario is required'),
  immediate_action: z.string().min(1, 'Immediate action is required'),
  notification: text,
})
export type SwmsEmergencyScenario = z.infer<typeof emergencyScenarioSchema>

export const swmsProjectDetailsSchema = z.object({
  work_location: text,
  work_dates: text,
  workers_roles: text,
  other_pcbus: text,
  client_contact: text,
  nearest_hospital: text,
  comms_arrangements: text,
  known_hazards_info: text,
  permits_required: text,
})
export type SwmsProjectDetails = z.infer<typeof swmsProjectDetailsSchema>

/** Field → label for the project-details block (render order matters). */
export const SWMS_PROJECT_DETAIL_LABELS: Record<keyof SwmsProjectDetails, string> = {
  work_location: 'Work location & access constraints',
  work_dates: 'Work dates / hours',
  workers_roles: 'Workers & roles',
  other_pcbus: 'Other PCBUs / contractors on site',
  client_contact: 'Client site contact',
  nearest_hospital: 'Nearest hospital / emergency access',
  comms_arrangements: 'Communications / lone-worker arrangements',
  known_hazards_info: 'Known asbestos, hazmat or contamination information reviewed',
  permits_required: 'Permits, licences & inductions required',
}

export const swmsEmergencyContactsSchema = z.object({
  coordinator: text,
  first_aid: text,
  assembly_point: text,
})
export type SwmsEmergencyContacts = z.infer<typeof swmsEmergencyContactsSchema>

export const SWMS_EMERGENCY_CONTACT_LABELS: Record<keyof SwmsEmergencyContacts, string> = {
  coordinator: 'Emergency response coordinator',
  first_aid: 'First aid representative & kit location',
  assembly_point: 'Assembly point / evacuation area',
}

export const hrcwAnswersSchema = z.record(z.string(), z.enum(HRCW_ANSWERS))
export type SwmsHrcwAnswers = z.infer<typeof hrcwAnswersSchema>

// ─── Template upsert (Settings editor) ───────────────────────────────────────

export const swmsTemplateV2Schema = z.object({
  id: z.uuid().optional(),
  title: z.string().min(1, 'Title is required'),
  doc_control: swmsDocControlSchema,
  hrcw_items: z.array(hrcwItemSchema),
  requirements: swmsRequirementsSchema,
  steps: z.array(swmsStepSchema).min(1, 'Add at least one work step'),
  stop_work_triggers: z.array(z.string().min(1)),
  emergency_scenarios: z.array(emergencyScenarioSchema),
  references_list: z.array(z.string().min(1)),
  active: z.boolean().default(true),
})
export type SwmsTemplateV2Input = z.infer<typeof swmsTemplateV2Schema>

// ─── Instance issue (project/job WHS tab) ────────────────────────────────────

export const swmsInstanceCreateV2Schema = z
  .object({
    template_id: z.uuid('Pick a template'),
    project_id: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    job_id: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    project_details: swmsProjectDetailsSchema,
    hrcw_answers: hrcwAnswersSchema,
    emergency_contacts: swmsEmergencyContactsSchema,
  })
  .refine(
    (d) => d.project_id !== null || d.job_id !== null,
    'Attach the SWMS to a project or job'
  )
export type SwmsInstanceCreateV2Input = z.infer<typeof swmsInstanceCreateV2Schema>

// ─── Legacy migration mapping (mirrors 0030 SQL) ─────────────────────────────

/**
 * Maps legacy flat hazard rows to structured work steps. This is the exact
 * mapping migration 0030 applies in SQL: task→step, risk→initial_risk,
 * and "Site Supervisor" as the default responsible position.
 */
export function hazardsToSteps(hazards: SwmsHazard[]): SwmsStep[] {
  return hazards.map((h) => ({
    step: h.task,
    hazards: h.hazards,
    initial_risk: h.risk,
    controls: h.controls,
    residual_risk: h.residual_risk,
    responsible: 'Site Supervisor',
  }))
}

// ─── Tolerant parsers (DB jsonb → typed, never throw) ───────────────────────

export function parseSteps(value: unknown): SwmsStep[] {
  const parsed = z.array(swmsStepSchema).safeParse(value)
  return parsed.success ? parsed.data : []
}

export function parseHrcwItems(value: unknown): SwmsHrcwItem[] {
  const parsed = z.array(hrcwItemSchema).safeParse(value)
  return parsed.success ? parsed.data : []
}

export function parseDocControl(value: unknown): SwmsDocControl {
  const parsed = swmsDocControlSchema.safeParse(value)
  return parsed.success
    ? parsed.data
    : { prepared_by: '', approved_by: '', scope_note: '' }
}

export function parseRequirements(value: unknown): SwmsRequirements {
  const parsed = swmsRequirementsSchema.safeParse(value)
  return parsed.success
    ? parsed.data
    : { competency: '', licences_permits: '', ppe: '', equipment: '', monitoring: '' }
}

export function parseEmergencyScenarios(value: unknown): SwmsEmergencyScenario[] {
  const parsed = z.array(emergencyScenarioSchema).safeParse(value)
  return parsed.success ? parsed.data : []
}

export function parseProjectDetails(value: unknown): SwmsProjectDetails {
  const parsed = swmsProjectDetailsSchema.safeParse(value)
  return parsed.success
    ? parsed.data
    : swmsProjectDetailsSchema.parse({})
}

export function parseEmergencyContacts(value: unknown): SwmsEmergencyContacts {
  const parsed = swmsEmergencyContactsSchema.safeParse(value)
  return parsed.success ? parsed.data : { coordinator: '', first_aid: '', assembly_point: '' }
}

export function parseStringList(value: unknown): string[] {
  const parsed = z.array(z.string()).safeParse(value)
  return parsed.success ? parsed.data.filter((s) => s.trim() !== '') : []
}

export function parseHrcwAnswers(value: unknown): SwmsHrcwAnswers {
  const parsed = hrcwAnswersSchema.safeParse(value)
  return parsed.success ? parsed.data : {}
}

// ─── Issue-time helpers ──────────────────────────────────────────────────────

/**
 * One confirmed answer per template item: the office's answer when provided,
 * otherwise the template's suggestion. Answers for unknown item ids are
 * dropped — the template's item list is the contract.
 */
export function normalizeHrcwAnswers(
  items: SwmsHrcwItem[],
  answers: SwmsHrcwAnswers
): SwmsHrcwAnswers {
  const result: SwmsHrcwAnswers = {}
  for (const item of items) {
    result[item.id] = answers[item.id] ?? item.suggested
  }
  return result
}

/** True when at least one non-empty value exists in a label/value record. */
export function hasAnyValue(record: Record<string, string>): boolean {
  return Object.values(record).some((v) => v.trim() !== '')
}

// ─── Standard HRCW checklist (editor "insert standard items" helper) ────────

export const DEFAULT_HRCW_ITEMS: SwmsHrcwItem[] = [
  { id: 'asbestos', label: 'Work on or near asbestos or asbestos-containing material.', suggested: 'no' },
  { id: 'demolition', label: 'Demolition of a load-bearing element or work affecting structural stability.', suggested: 'no' },
  { id: 'contaminated_soil', label: 'Disturbance of contaminated or potentially contaminated soil, water or other material.', suggested: 'no' },
  { id: 'mobile_plant', label: 'Work near mobile plant, excavators, trucks or powered equipment.', suggested: 'no' },
  { id: 'excavation', label: 'Work in, near or above excavations, trenches, pits or unstable ground.', suggested: 'no' },
  { id: 'fall_2m', label: 'Work where a person could fall more than 2 m.', suggested: 'no' },
  { id: 'confined_space', label: 'Work in or near a confined space, tank, pit, ceiling void or poorly ventilated area.', suggested: 'no' },
  { id: 'services', label: 'Work on or near energised electrical services or underground services.', suggested: 'no' },
  { id: 'traffic', label: 'Work on or adjacent to a road or other trafficked area.', suggested: 'no' },
  { id: 'public_access', label: 'Work in areas accessible by occupants, tenants, pedestrians or the public.', suggested: 'no' },
  { id: 'hazardous_chemicals', label: 'Work involving hazardous chemicals, fuels, solvents, lead, silica, mould or biological hazards.', suggested: 'no' },
  { id: 'extreme_conditions', label: 'Work in extreme heat, storms, flood-affected areas, fire-damaged structures or remote locations.', suggested: 'no' },
]

/** Fresh slug for editor-added HRCW items. */
export function newHrcwItemId(): string {
  return `item_${Math.random().toString(36).slice(2, 10)}`
}

// ─── Full snapshot shape (instance render + PDF) ─────────────────────────────

export interface SwmsStructure {
  docControl: SwmsDocControl
  hrcwItems: SwmsHrcwItem[]
  hrcwAnswers: SwmsHrcwAnswers
  requirements: SwmsRequirements
  steps: SwmsStep[]
  stopWorkTriggers: string[]
  emergencyScenarios: SwmsEmergencyScenario[]
  emergencyContacts: SwmsEmergencyContacts
  projectDetails: SwmsProjectDetails
  referencesList: string[]
}

/** Raw swms_instances / swms_templates row → typed structure (tolerant). */
export function parseSwmsStructure(row: {
  doc_control?: unknown
  hrcw_items?: unknown
  hrcw_answers?: unknown
  requirements?: unknown
  steps?: unknown
  stop_work_triggers?: unknown
  emergency_scenarios?: unknown
  emergency_contacts?: unknown
  project_details?: unknown
  references_list?: unknown
  body?: string | null
  hazards?: unknown
}): SwmsStructure {
  const docControl = parseDocControl(row.doc_control)
  // Pre-0030 rows: fall back to legacy body / hazards so nothing disappears.
  if (docControl.scope_note.trim() === '' && row.body) {
    docControl.scope_note = row.body
  }
  let steps = parseSteps(row.steps)
  if (steps.length === 0) {
    const legacy = z.array(swmsHazardSchema).safeParse(row.hazards)
    if (legacy.success) steps = hazardsToSteps(legacy.data)
  }
  return {
    docControl,
    hrcwItems: parseHrcwItems(row.hrcw_items),
    hrcwAnswers: parseHrcwAnswers(row.hrcw_answers),
    requirements: parseRequirements(row.requirements),
    steps,
    stopWorkTriggers: parseStringList(row.stop_work_triggers),
    emergencyScenarios: parseEmergencyScenarios(row.emergency_scenarios),
    emergencyContacts: parseEmergencyContacts(row.emergency_contacts),
    projectDetails: parseProjectDetails(row.project_details),
    referencesList: parseStringList(row.references_list),
  }
}

/** Column list shared by every full-structure select on swms_instances. */
export const SWMS_STRUCTURE_COLUMNS =
  'doc_control, hrcw_items, hrcw_answers, requirements, steps, stop_work_triggers, emergency_scenarios, emergency_contacts, project_details, references_list'
