'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { swmsInstanceCreateSchema } from '@/lib/zod'

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
 * Issues a SWMS to a project or job by copying the template's current
 * title/body/hazards into a new active instance at version 1.
 */
export async function createSwmsInstance(data: unknown): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = swmsInstanceCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: template } = await supabase
    .from('swms_templates')
    .select('id, title, body, hazards, active')
    .eq('id', parsed.data.template_id)
    .single()
  if (!template) return { error: 'SWMS template not found' }
  if (!template.active) return { error: 'That SWMS template is inactive' }

  const { error } = await supabase.from('swms_instances').insert({
    template_id: template.id,
    project_id: parsed.data.project_id,
    job_id: parsed.data.job_id,
    title: template.title,
    body: template.body,
    hazards: template.hazards,
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
