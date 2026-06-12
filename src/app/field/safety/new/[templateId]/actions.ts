'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { nextNumber } from '@/lib/numbering'
import { validateSubmissionData } from '@/lib/form-validate'
import {
  formSubmissionSchema,
  incidentCreateSchema,
  type FormField,
} from '@/lib/zod'

type Result = { error?: string; id?: string }

/**
 * Inserts an immutable form_submissions row for any template kind except
 * 'incident'. The data payload is re-validated server-side against the
 * template schema (required answers, options, signature caps) and unknown
 * keys are stripped. Photos attach AFTER submit via the attachments table
 * (parent_type 'form_submission') — data itself never changes.
 */
export async function submitForm(input: unknown): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const parsed = formSubmissionSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: template } = await supabase
    .from('form_templates')
    .select('id, kind, schema, version, active')
    .eq('id', parsed.data.template_id)
    .single()
  if (!template) return { error: 'Form template not found' }
  if (!template.active) {
    return { error: 'This form template is no longer active' }
  }
  if (template.kind === 'incident') {
    return { error: 'Incident reports are recorded in the incident register' }
  }
  if (template.kind === 'prestart' && !parsed.data.plant_id) {
    return { error: 'Pick the plant item being inspected' }
  }

  const validated = validateSubmissionData(
    (template.schema as FormField[]) ?? [],
    parsed.data.data
  )
  if (!validated.ok) {
    const first = Object.values(validated.errors)[0]
    return { error: first ?? 'The form has missing or invalid answers' }
  }

  const { data: row, error } = await supabase
    .from('form_submissions')
    .insert({
      template_id: template.id,
      template_version: Number(template.version),
      kind: template.kind,
      project_id: parsed.data.project_id,
      job_id: parsed.data.job_id,
      plant_id: template.kind === 'prestart' ? parsed.data.plant_id : null,
      data: validated.data,
      submitted_by: profile.id,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  revalidatePath('/field/safety')
  return { id: row.id as string }
}

/**
 * Records a field incident report straight into the incident register
 * (NOT a form_submission) with the next INC-xxxx number. Photos attach on
 * the success screen via parent_type 'incident'.
 */
export async function createIncident(input: unknown): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const parsed = incidentCreateSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  let number: string
  try {
    number = await nextNumber(supabase, 'incident')
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Numbering failed' }
  }

  // datetime-local has no timezone; treat it as server-local (acceptable v1).
  const occurredAt = new Date(parsed.data.occurred_at)
  if (Number.isNaN(occurredAt.getTime())) {
    return { error: 'Invalid date/time for when it happened' }
  }

  const { data: row, error } = await supabase
    .from('incidents')
    .insert({
      number,
      project_id: parsed.data.project_id,
      job_id: parsed.data.job_id,
      type: parsed.data.type,
      severity: parsed.data.severity,
      occurred_at: occurredAt.toISOString(),
      location: parsed.data.location,
      description: parsed.data.description,
      immediate_action: parsed.data.immediate_action,
      reported_by: profile.id,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  revalidatePath('/field/safety')
  return { id: row.id as string }
}
