'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { nextNumber } from '@/lib/numbering'
import { auLocalToInstant } from '@/lib/tz'
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

  // Amendments: the original must exist, be the same kind, and be the
  // caller's own unless they're staff. Both rows stay immutable — the new
  // row supersedes the old one by reference.
  if (parsed.data.amends) {
    const { data: original } = await supabase
      .from('form_submissions')
      .select('id, kind, submitted_by')
      .eq('id', parsed.data.amends)
      .maybeSingle()
    if (!original) {
      return { error: 'The submission being amended no longer exists' }
    }
    if (original.kind !== template.kind) {
      return { error: 'An amendment must use the same form kind as the original' }
    }
    const isStaff = ['admin', 'office', 'supervisor'].includes(profile.role)
    if (!isStaff && original.submitted_by !== profile.id) {
      return { error: 'You can only amend your own submissions' }
    }
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
      // Snapshot the schema so this submission always renders against the field
      // set it was captured with, even after the template is edited in place.
      schema_snapshot: template.schema,
      kind: template.kind,
      project_id: parsed.data.project_id,
      job_id: parsed.data.job_id,
      plant_id: template.kind === 'prestart' ? parsed.data.plant_id : null,
      data: validated.data,
      submitted_by: profile.id,
      amends: parsed.data.amends,
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

  // datetime-local has no timezone; the crew keys in Brisbane wall-clock time,
  // so convert it to the real instant (never parse as server-local — the
  // production server runs on UTC).
  let occurredAt: string
  try {
    occurredAt = auLocalToInstant(parsed.data.occurred_at)
  } catch {
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
      occurred_at: occurredAt,
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
