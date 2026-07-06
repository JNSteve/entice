// Shared waste-load select + row shaper for the env hub, load detail page and
// the project Environment tab (server-side only — plain data helpers).

import type { WasteClassification, WasteUnitKey } from '@/lib/zod'
import type { WasteLoadRow } from './waste-loads-client'

export type LoadQueryRow = {
  id: string
  number: string
  date: string
  project_id: string | null
  job_id: string | null
  classification: string
  classification_detail: string | null
  qty: number
  unit: string
  facility_id: string | null
  permit_id: string | null
  transporter: string | null
  docket_ref: string | null
  notes: string | null
  override_reason: string | null
  projects: { number: string; name: string } | null
  jobs: { number: string; title: string } | null
  env_facilities: { name: string } | null
  env_permits: { reference: string } | null
  profiles: { full_name: string } | null
}

export const WASTE_LOAD_SELECT = `id, number, date, project_id, job_id,
  classification, classification_detail, qty, unit, facility_id, permit_id,
  transporter, docket_ref, notes, override_reason,
  projects(number, name), jobs(number, title),
  env_facilities(name), env_permits(reference),
  profiles!waste_loads_created_by_fkey(full_name)`

export function shapeLoadRow(raw: unknown): WasteLoadRow {
  const l = raw as LoadQueryRow
  const project = l.projects
  const job = l.jobs
  return {
    id: l.id,
    number: l.number,
    date: l.date,
    project_id: l.project_id,
    job_id: l.job_id,
    target_label: project
      ? `${project.number} — ${project.name}`
      : job
        ? `${job.number} — ${job.title}`
        : '—',
    classification: l.classification as WasteClassification,
    classification_detail: l.classification_detail,
    qty: Number(l.qty),
    unit: l.unit as WasteUnitKey,
    facility_id: l.facility_id,
    facility_name: l.env_facilities?.name ?? null,
    permit_id: l.permit_id,
    permit_ref: l.env_permits?.reference ?? null,
    transporter: l.transporter,
    docket_ref: l.docket_ref,
    notes: l.notes,
    override_reason: l.override_reason,
    created_by_name: l.profiles?.full_name ?? null,
  }
}
