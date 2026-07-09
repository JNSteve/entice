'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { nextNumber } from '@/lib/numbering'
import { notifyClientRequestStatus, syncRequestsForQuote } from '@/lib/notify'
import {
  jobCreateSchema,
  jobUpdateSchema,
  jobScheduleSchema,
  jobStatusSchema,
  checklistItemSchema,
  workLogSchema,
  jobCostSchema,
} from '@/lib/zod'

type Result = { error?: string }

function revalidateJob(jobId: string) {
  revalidatePath('/jobs')
  revalidatePath(`/jobs/${jobId}`)
}

// ─── Job CRUD ─────────────────────────────────────────────────────────────────

export async function createJob(
  data: unknown
): Promise<{ error?: string; id?: string }> {
  await requireRole('admin', 'office')

  const parsed = jobCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  // Verify client exists and is not archived.
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('id', parsed.data.client_id)
    .eq('archived', false)
    .single()
  if (!client) return { error: 'Client not found or archived' }

  let number: string
  try {
    number = await nextNumber(supabase, 'job')
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to allocate job number' }
  }

  const { data: row, error } = await supabase
    .from('jobs')
    .insert({
      number,
      client_id: parsed.data.client_id,
      site_id: parsed.data.site_id,
      title: parsed.data.title,
      description: parsed.data.description,
      supervisor_id: parsed.data.supervisor_id,
      pm_id: parsed.data.pm_id,
      status: 'quote',
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidatePath('/jobs')
  return { id: row.id }
}

export async function updateJob(
  jobId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = jobUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('jobs')
    .update(parsed.data)
    .eq('id', jobId)

  if (error) return { error: error.message }

  revalidateJob(jobId)
  return {}
}

// ─── Schedule work ────────────────────────────────────────────────────────────

/**
 * Sets the job's schedule (start required, end optional) in one visible
 * action, flips quote → scheduled when applicable, and pushes the date into
 * any portal work request linked via the job's quote — so the client's
 * request timeline shows "scheduled for {date}" (plus the dormant status
 * email) the moment the office schedules the work.
 */
export async function scheduleJob(jobId: string, data: unknown): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = jobScheduleSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { data: job } = await supabase
    .from('jobs')
    .select('id, status, quote_id')
    .eq('id', jobId)
    .single()
  if (!job) return { error: 'Job not found' }
  if (job.status === 'completed' || job.status === 'lost') {
    return { error: `A ${job.status} job can no longer be scheduled` }
  }

  const update: Record<string, unknown> = {
    scheduled_start: parsed.data.scheduled_start,
    scheduled_end: parsed.data.scheduled_end,
  }
  if (job.status === 'quote') update.status = 'scheduled'

  const { error } = await supabase.from('jobs').update(update).eq('id', jobId)
  if (error) return { error: error.message }

  // Push the schedule into linked portal requests (request.quote_id = the
  // quote this job was converted from). Forward-only like the SQL sync:
  // declined/completed requests are never touched; the date always follows
  // the job (the job IS the source of truth once work is scheduled).
  if (job.quote_id) {
    const { data: requests } = await supabase
      .from('portal_requests')
      .select('id, status')
      .eq('quote_id', job.quote_id)
      .in('status', ['submitted', 'reviewed', 'quoted', 'scheduled'])

    for (const request of requests ?? []) {
      const patch: Record<string, unknown> = {
        scheduled_for: parsed.data.scheduled_start,
      }
      if (request.status !== 'scheduled') patch.status = 'scheduled'
      const { error: reqError } = await supabase
        .from('portal_requests')
        .update(patch)
        .eq('id', request.id)
      if (!reqError) {
        const requestId = request.id as string
        after(() =>
          notifyClientRequestStatus({ requestId, status: 'scheduled' })
        )
      }
    }
    revalidatePath('/clients/requests')
  }

  revalidateJob(jobId)
  return {}
}

// ─── Status transitions ───────────────────────────────────────────────────────

/**
 * Legal transitions:
 *   quote → scheduled (requires scheduled_start)
 *   scheduled → in_progress
 *   in_progress → completed (blocked server-side if any checklist item is not done)
 *   quote / scheduled / in_progress → lost
 */
export async function setJobStatus(
  jobId: string,
  data: unknown
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = jobStatusSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: job, error: fetchError } = await supabase
    .from('jobs')
    .select('id, status, scheduled_start, quote_id')
    .eq('id', jobId)
    .single()
  if (fetchError || !job) return { error: 'Job not found' }

  const target = parsed.data.status

  // Validate legal transitions
  const legal: Record<string, string[]> = {
    quote: ['scheduled', 'lost'],
    scheduled: ['in_progress', 'lost'],
    in_progress: ['completed', 'lost'],
  }
  if (!legal[job.status]?.includes(target)) {
    return { error: `Cannot move a ${job.status} job to ${target}` }
  }

  const now = new Date().toISOString()
  const update: Record<string, unknown> = { status: target }

  if (target === 'scheduled') {
    // Require scheduled_start — either already on the job or passed in
    const start = parsed.data.scheduled_start ?? job.scheduled_start
    if (!start) {
      return { error: 'A start date is required before scheduling the job' }
    }
    update.scheduled_start = start
  }

  if (target === 'completed') {
    // Block if any checklist item is not done
    const { data: open, error: clErr } = await supabase
      .from('job_checklist_items')
      .select('id, text')
      .eq('job_id', jobId)
      .eq('done', false)
    if (clErr) return { error: clErr.message }
    if (open && open.length > 0) {
      const names = open.map((i) => `• ${i.text}`).join('\n')
      return {
        error: `Cannot complete job — ${open.length} checklist item(s) not done:\n${names}`,
      }
    }
    update.completed_at = now
  }

  const { error } = await supabase.from('jobs').update(update).eq('id', jobId)
  if (error) return { error: error.message }

  // Job done → linked portal request 'completed' (invoiced/paid come only
  // after completed, so this hook covers the whole done group). Fire-and-
  // forget after the response — never blocks the status change.
  if (target === 'completed' && job.quote_id) {
    const quoteId = job.quote_id as string
    after(() => syncRequestsForQuote(quoteId, 'work_completed'))
  }

  revalidateJob(jobId)
  return {}
}

// ─── Checklist ────────────────────────────────────────────────────────────────

export async function addChecklistItem(data: unknown): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = checklistItemSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  // Get next position
  const { data: last } = await supabase
    .from('job_checklist_items')
    .select('position')
    .eq('job_id', parsed.data.job_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await supabase.from('job_checklist_items').insert({
    job_id: parsed.data.job_id,
    text: parsed.data.text,
    position: (last?.position ?? -1) + 1,
    done: false,
  })
  if (error) return { error: error.message }

  revalidateJob(parsed.data.job_id)
  return {}
}

export async function toggleChecklistItem(
  itemId: string,
  jobId: string,
  done: boolean
): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const supabase = await createClient()

  const update = done
    ? { done: true, done_by: profile.id, done_at: new Date().toISOString() }
    : { done: false, done_by: null, done_at: null }

  const { error } = await supabase
    .from('job_checklist_items')
    .update(update)
    .eq('id', itemId)
  if (error) return { error: error.message }

  revalidateJob(jobId)
  return {}
}

export async function deleteChecklistItem(
  itemId: string,
  jobId: string
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()
  const { error } = await supabase
    .from('job_checklist_items')
    .delete()
    .eq('id', itemId)
  if (error) return { error: error.message }

  revalidateJob(jobId)
  return {}
}

export async function applyChecklistTemplate(
  jobId: string,
  templateId: string
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const { data: template, error: tErr } = await supabase
    .from('checklist_templates')
    .select('items')
    .eq('id', templateId)
    .single()
  if (tErr || !template) return { error: 'Template not found' }

  // Get max current position
  const { data: last } = await supabase
    .from('job_checklist_items')
    .select('position')
    .eq('job_id', jobId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const startPos = (last?.position ?? -1) + 1
  const items = (template.items as string[]).map((text, i) => ({
    job_id: jobId,
    text,
    position: startPos + i,
    done: false,
  }))

  if (items.length === 0) return {}

  const { error } = await supabase.from('job_checklist_items').insert(items)
  if (error) return { error: error.message }

  revalidateJob(jobId)
  return {}
}

// ─── Work log ─────────────────────────────────────────────────────────────────

export async function addWorkLog(data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = workLogSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('work_logs').insert({
    job_id: parsed.data.job_id,
    date: parsed.data.date,
    notes: parsed.data.notes,
    created_by: profile.id,
  })
  if (error) return { error: error.message }

  revalidateJob(parsed.data.job_id)
  return {}
}

// ─── Costs ────────────────────────────────────────────────────────────────────

export async function addJobCost(data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office')

  const parsed = jobCostSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('costs').insert({
    parent_type: 'job',
    parent_id: parsed.data.job_id,
    date: parsed.data.date,
    description: parsed.data.description,
    amount: parsed.data.amount,
    cost_code_id: parsed.data.cost_code_id,
    source: 'manual',
    created_by: profile.id,
  })
  if (error) return { error: error.message }

  revalidateJob(parsed.data.job_id)
  return {}
}
