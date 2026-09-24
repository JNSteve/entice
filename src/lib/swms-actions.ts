'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  normalizeHrcwAnswers,
  parseHrcwItems,
  swmsInstanceCreateV2Schema,
} from '@/lib/swms'
import {
  checkSwmsDocumentAttachment,
  swmsDocumentCreateSchema,
  swmsDocumentReviseSchema,
} from '@/lib/swms-document'

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

// ─── Create instance from an uploaded PDF ────────────────────────────────────

/**
 * Issues an uploaded PDF (an attachment on the same job/project) as a
 * document-backed SWMS at version 1. Sign-on, share links and versioning work
 * exactly as for template SWMS; the structured columns stay at their defaults.
 */
export async function createDocumentSwmsInstance(data: unknown): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = swmsDocumentCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }
  const { title, attachment_id, project_id, job_id } = parsed.data
  const parent = job_id
    ? { type: 'job' as const, id: job_id }
    : { type: 'project' as const, id: project_id as string }

  const supabase = await createClient()
  const { data: att } = await supabase
    .from('attachments')
    .select('parent_type, parent_id, content_type, filename')
    .eq('id', attachment_id)
    .maybeSingle()
  const problem = checkSwmsDocumentAttachment(att, parent)
  if (problem) return { error: problem }

  const { error } = await supabase.from('swms_instances').insert({
    template_id: null,
    project_id,
    job_id,
    title,
    document_attachment_id: attachment_id,
    version: 1,
    status: 'active',
  })
  if (error) return { error: error.message }

  revalidateSwms(project_id, job_id)
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
    .select('id, project_id, job_id, version, status, document_attachment_id')
    .eq('id', id)
    .single()
  if (!instance) return { error: 'SWMS not found' }
  if (instance.status !== 'active') {
    return { error: 'Only active SWMS can be revised' }
  }
  if (instance.document_attachment_id) {
    return { error: 'Upload the revised PDF to revise this SWMS' }
  }

  const { error } = await supabase
    .from('swms_instances')
    .update({ version: Number(instance.version) + 1 })
    .eq('id', id)
  if (error) return { error: error.message }

  revalidateSwms(instance.project_id, instance.job_id, id)
  return {}
}

/**
 * Revises a document-backed SWMS: points it at the replacement PDF and bumps
 * the version in ONE update, so every worker must re-sign. The previous PDF
 * stays in Documents; the audit trigger records the file switch.
 */
export async function reviseDocumentSwmsInstance(data: unknown): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = swmsDocumentReviseSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { data: instance } = await supabase
    .from('swms_instances')
    .select('id, project_id, job_id, version, status, document_attachment_id')
    .eq('id', parsed.data.instance_id)
    .single()
  if (!instance) return { error: 'SWMS not found' }
  if (instance.status !== 'active') return { error: 'Only active SWMS can be revised' }
  if (!instance.document_attachment_id) {
    return { error: 'This SWMS was issued from a template — use Revise instead' }
  }
  if (instance.document_attachment_id === parsed.data.attachment_id) {
    return { error: 'Pick the revised PDF — that is the current file' }
  }

  const parent = instance.job_id
    ? { type: 'job' as const, id: instance.job_id as string }
    : { type: 'project' as const, id: instance.project_id as string }
  const { data: att } = await supabase
    .from('attachments')
    .select('parent_type, parent_id, content_type, filename')
    .eq('id', parsed.data.attachment_id)
    .maybeSingle()
  const problem = checkSwmsDocumentAttachment(att, parent)
  if (problem) return { error: problem }

  // Compare-and-set on version: a concurrent revise makes this match 0 rows.
  const { data: updated, error } = await supabase
    .from('swms_instances')
    .update({
      document_attachment_id: parsed.data.attachment_id,
      version: Number(instance.version) + 1,
    })
    .eq('id', instance.id)
    .eq('version', instance.version)
    .eq('status', 'active')
    .select('id')
  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'This SWMS was changed by someone else — reload and try again' }
  }

  revalidateSwms(instance.project_id, instance.job_id, instance.id)
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
