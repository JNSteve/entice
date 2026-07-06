'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  normalizeHrcwAnswers,
  parseHrcwItems,
  swmsInstanceCreateV2Schema,
} from '@/lib/swms'

type Result = { error?: string }

/** Revalidates every page that lists this instance. */
function revalidateSwms(projectId: string | null, jobId: string | null, instanceId?: string) {
  if (projectId) revalidatePath(`/projects/${projectId}`)
  if (jobId) revalidatePath(`/jobs/${jobId}`)
  revalidatePath('/field/swms')
  if (instanceId) revalidatePath(`/field/swms/${instanceId}`)
}

// ─── Create instance from template ───────────────────────────────────────────

/**
 * Issues a SWMS to a project or job: snapshots the template's full structure
 * (document control, HRCW items, requirements, steps, stop-work triggers,
 * emergency scenarios, references — plus legacy body/hazards for back-compat)
 * into a new active instance at version 1, and captures the project-specific
 * details, confirmed HRCW answers and emergency contacts supplied at issue.
 */
export async function createSwmsInstance(data: unknown): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = swmsInstanceCreateV2Schema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: template } = await supabase
    .from('swms_templates')
    .select(
      'id, title, body, hazards, active, doc_control, hrcw_items, requirements, steps, stop_work_triggers, emergency_scenarios, references_list'
    )
    .eq('id', parsed.data.template_id)
    .single()
  if (!template) return { error: 'SWMS template not found' }
  if (!template.active) return { error: 'That SWMS template is inactive' }

  // One confirmed answer per template item (office answer, else suggestion).
  const hrcwAnswers = normalizeHrcwAnswers(
    parseHrcwItems(template.hrcw_items),
    parsed.data.hrcw_answers
  )

  const { error } = await supabase.from('swms_instances').insert({
    template_id: template.id,
    project_id: parsed.data.project_id,
    job_id: parsed.data.job_id,
    title: template.title,
    body: template.body,
    hazards: template.hazards,
    doc_control: template.doc_control,
    hrcw_items: template.hrcw_items,
    requirements: template.requirements,
    steps: template.steps,
    stop_work_triggers: template.stop_work_triggers,
    emergency_scenarios: template.emergency_scenarios,
    references_list: template.references_list,
    project_details: parsed.data.project_details,
    hrcw_answers: hrcwAnswers,
    emergency_contacts: parsed.data.emergency_contacts,
    version: 1,
    status: 'active',
  })
  if (error) return { error: error.message }

  revalidateSwms(parsed.data.project_id, parsed.data.job_id)
  return {}
}

// ─── Revise ──────────────────────────────────────────────────────────────────

/**
 * Bumps the instance version. Signatures for older versions become stale,
 * so the sign-on register shows everyone as outstanding again.
 */
export async function reviseSwmsInstance(id: string): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const { data: instance } = await supabase
    .from('swms_instances')
    .select('id, project_id, job_id, version, status')
    .eq('id', id)
    .single()
  if (!instance) return { error: 'SWMS not found' }
  if (instance.status !== 'active') {
    return { error: 'Only active SWMS can be revised' }
  }

  const { error } = await supabase
    .from('swms_instances')
    .update({ version: Number(instance.version) + 1 })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidateSwms(instance.project_id, instance.job_id, id)
  return {}
}

// ─── Supersede ───────────────────────────────────────────────────────────────

export async function supersedeSwmsInstance(id: string): Promise<Result> {
  await requireRole('admin', 'office')

  const supabase = await createClient()

  const { data: instance } = await supabase
    .from('swms_instances')
    .select('id, project_id, job_id, status')
    .eq('id', id)
    .single()
  if (!instance) return { error: 'SWMS not found' }
  if (instance.status !== 'active') {
    return { error: 'This SWMS is already superseded' }
  }

  const { error } = await supabase
    .from('swms_instances')
    .update({ status: 'superseded' })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidateSwms(instance.project_id, instance.job_id, id)
  return {}
}
