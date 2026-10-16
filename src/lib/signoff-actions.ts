'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { buildSignoffDraft, type WorkRef } from '@/lib/signoff-build'
import { isClientLinkActive } from '@/lib/portal'
import { notifyClientSignoffReleased } from '@/lib/notify'
import { SIGNOFF_SECTIONS } from '@/lib/signoffs'

/**
 * Office side of daily sign-offs. Only admin/office (the PM pool — pm_id only
 * ever points at admin/office profiles) build, edit and release. Nothing
 * reaches the client until releaseSignoff.
 */

type Result = { error?: string; id?: string }
type Supabase = Awaited<ReturnType<typeof createClient>>

const UUID = z.string().uuid()
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

type SignoffRow = {
  id: string
  job_id: string | null
  project_id: string | null
  date: string
  version: number
  status: string
  summary: string
  photo_ids: string[]
  supersedes_id: string | null
  source_hash: string | null
}

async function loadSignoff(supabase: Supabase, id: string): Promise<SignoffRow | null> {
  const { data } = await supabase
    .from('daily_signoffs')
    .select('id, job_id, project_id, date, version, status, summary, photo_ids, supersedes_id, source_hash')
    .eq('id', id)
    .maybeSingle()
  return (data as SignoffRow | null) ?? null
}

function revalidateSignoff(s: Pick<SignoffRow, 'id' | 'job_id' | 'project_id'>) {
  revalidatePath('/signoffs')
  revalidatePath(`/signoffs/${s.id}`)
  if (s.job_id) revalidatePath(`/jobs/${s.job_id}`)
  if (s.project_id) revalidatePath(`/projects/${s.project_id}/signoffs`)
}

// ─── Build ───────────────────────────────────────────────────────────────────

export async function buildSignoff(kind: string, id: string, date: string): Promise<Result> {
  const profile = await requireRole('admin', 'office')
  if ((kind !== 'job' && kind !== 'project') || !UUID.safeParse(id).success) {
    return { error: 'Work not found' }
  }
  if (!DATE.safeParse(date).success) return { error: 'Pick a date' }

  const supabase = await createClient()
  const work: WorkRef = { kind, id }
  const result = await buildSignoffDraft(supabase, work, date, profile.id)
  if ('error' in result) return { error: result.error }

  revalidateSignoff({
    id: result.id,
    job_id: kind === 'job' ? id : null,
    project_id: kind === 'project' ? id : null,
  })
  return { id: result.id }
}

// ─── Draft editing ───────────────────────────────────────────────────────────

const lineSchema = z.object({
  description: z.string().trim().min(1, 'Description is required').max(300),
  qty: z.coerce.number().min(0, 'Quantity cannot be negative').max(999999999),
  unit: z.string().trim().max(20).default(''),
  detail: z.string().trim().max(300).nullable().default(null),
  scope_label: z.string().trim().max(500).nullable().default(null),
})

const newLineSchema = lineSchema.extend({
  section: z.enum(SIGNOFF_SECTIONS as [string, ...string[]]),
})

async function draftFor(supabase: Supabase, signoffId: string): Promise<SignoffRow | { error: string }> {
  const signoff = await loadSignoff(supabase, signoffId)
  if (!signoff) return { error: 'Sign-off not found' }
  if (signoff.status !== 'draft') return { error: 'Only a draft can be edited' }
  return signoff
}

export async function updateSignoffLine(lineId: string, data: unknown): Promise<Result> {
  await requireRole('admin', 'office')
  if (!UUID.safeParse(lineId).success) return { error: 'Line not found' }
  const parsed = lineSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid line' }

  const supabase = await createClient()
  const { data: line } = await supabase
    .from('daily_signoff_lines')
    .select('signoff_id')
    .eq('id', lineId)
    .maybeSingle()
  if (!line) return { error: 'Line not found' }
  const signoff = await draftFor(supabase, line.signoff_id as string)
  if ('error' in signoff) return signoff

  const { error } = await supabase
    .from('daily_signoff_lines')
    .update({
      description: parsed.data.description,
      qty: parsed.data.qty,
      unit: parsed.data.unit,
      detail: parsed.data.detail || null,
      scope_label: parsed.data.scope_label || null,
    })
    .eq('id', lineId)
  if (error) return { error: error.message }

  // Fixing someone's hours by hand clears the "still checked in" block.
  if (parsed.data.qty > 0) {
    const { data: flagged } = await supabase
      .from('daily_signoff_lines')
      .select('flags')
      .eq('id', lineId)
      .single()
    const flags = ((flagged?.flags as string[] | null) ?? []).filter((f) => f !== 'still_checked_in')
    await supabase.from('daily_signoff_lines').update({ flags }).eq('id', lineId)
  }

  revalidateSignoff(signoff)
  return {}
}

export async function addSignoffLine(signoffId: string, data: unknown): Promise<Result> {
  await requireRole('admin', 'office')
  if (!UUID.safeParse(signoffId).success) return { error: 'Sign-off not found' }
  const parsed = newLineSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid line' }

  const supabase = await createClient()
  const signoff = await draftFor(supabase, signoffId)
  if ('error' in signoff) return signoff

  // Displays group by section and order by sort within it, so a new line
  // goes after everything already on the sheet.
  const { data: lines } = await supabase
    .from('daily_signoff_lines')
    .select('sort')
    .eq('signoff_id', signoffId)
  const sort = (lines ?? []).reduce((max, l) => Math.max(max, Number(l.sort) + 10), 0)

  const { data: created, error } = await supabase
    .from('daily_signoff_lines')
    .insert({
      signoff_id: signoffId,
      sort,
      section: parsed.data.section,
      description: parsed.data.description,
      qty: parsed.data.qty,
      unit: parsed.data.unit,
      detail: parsed.data.detail || null,
      scope_label: parsed.data.scope_label || null,
      source: { manual: true },
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  revalidateSignoff(signoff)
  return { id: created.id as string }
}

export async function deleteSignoffLine(lineId: string): Promise<Result> {
  await requireRole('admin', 'office')
  if (!UUID.safeParse(lineId).success) return { error: 'Line not found' }

  const supabase = await createClient()
  const { data: line } = await supabase
    .from('daily_signoff_lines')
    .select('signoff_id')
    .eq('id', lineId)
    .maybeSingle()
  if (!line) return { error: 'Line not found' }
  const signoff = await draftFor(supabase, line.signoff_id as string)
  if ('error' in signoff) return signoff

  const { error } = await supabase.from('daily_signoff_lines').delete().eq('id', lineId)
  if (error) return { error: error.message }
  revalidateSignoff(signoff)
  return {}
}

const draftSchema = z.object({
  summary: z.string().max(4000, 'Keep the summary under 4000 characters'),
  photo_ids: z.array(UUID).max(30, 'Pick up to 30 photos'),
})

export async function updateSignoffDraft(id: string, data: unknown): Promise<Result> {
  await requireRole('admin', 'office')
  if (!UUID.safeParse(id).success) return { error: 'Sign-off not found' }
  const parsed = draftSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }

  const supabase = await createClient()
  const signoff = await draftFor(supabase, id)
  if ('error' in signoff) return signoff

  const { error } = await supabase
    .from('daily_signoffs')
    .update({ summary: parsed.data.summary.trim(), photo_ids: parsed.data.photo_ids })
    .eq('id', id)
    .eq('status', 'draft')
  if (error) return { error: error.message }
  revalidateSignoff(signoff)
  return {}
}

export async function deleteSignoffDraft(id: string): Promise<Result> {
  await requireRole('admin', 'office')
  if (!UUID.safeParse(id).success) return { error: 'Sign-off not found' }

  const supabase = await createClient()
  const signoff = await draftFor(supabase, id)
  if ('error' in signoff) return signoff

  const { error } = await supabase.from('daily_signoffs').delete().eq('id', id).eq('status', 'draft')
  if (error) return { error: error.message }
  revalidateSignoff(signoff)
  return {}
}

// ─── Release ─────────────────────────────────────────────────────────────────

export async function releaseSignoff(id: string): Promise<Result> {
  const profile = await requireRole('admin', 'office')
  if (!UUID.safeParse(id).success) return { error: 'Sign-off not found' }

  const supabase = await createClient()
  const signoff = await draftFor(supabase, id)
  if ('error' in signoff) return signoff

  const { data: lines } = await supabase
    .from('daily_signoff_lines')
    .select('flags')
    .eq('signoff_id', id)
  if (!lines || lines.length === 0) return { error: 'Add at least one line before releasing' }
  if (lines.some((l) => ((l.flags as string[] | null) ?? []).includes('still_checked_in'))) {
    return {
      error: 'Someone is still shown as checked in — correct their hours before releasing',
    }
  }

  // The client must be able to see it: a live full-scope portal link.
  const { data: work } = signoff.job_id
    ? await supabase.from('jobs').select('client_id').eq('id', signoff.job_id).single()
    : await supabase.from('projects').select('client_id').eq('id', signoff.project_id!).single()
  if (!work) return { error: 'Work not found' }
  const { data: links } = await supabase
    .from('client_links')
    .select('revoked_at, expires_at, scope')
    .eq('client_id', work.client_id)
  const hasLive = (links ?? []).some(
    (l) =>
      (l.scope ?? 'full') === 'full' &&
      isClientLinkActive({
        revoked_at: l.revoked_at as string | null,
        expires_at: l.expires_at as string | null,
      })
  )
  if (!hasLive) {
    return {
      error:
        'This client has no active portal link — create one on the client page (Portal card) first',
    }
  }

  const { data: released, error } = await supabase
    .from('daily_signoffs')
    .update({
      status: 'released',
      released_at: new Date().toISOString(),
      released_by: profile.id,
    })
    .eq('id', id)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle()
  if (error) return { error: error.message }
  if (!released) return { error: 'This sign-off was already released — refresh the page' }

  // The chosen photos must be visible to the client to appear on the sheet.
  if (signoff.photo_ids.length > 0) {
    await supabase.from('attachments').update({ client_visible: true }).in('id', signoff.photo_ids)
  }
  // A released revision replaces the disputed version it was made from.
  if (signoff.supersedes_id) {
    await supabase
      .from('daily_signoffs')
      .update({ status: 'superseded' })
      .eq('id', signoff.supersedes_id)
      .eq('status', 'disputed')
  }

  after(() => notifyClientSignoffReleased({ signoffId: id }))

  revalidateSignoff(signoff)
  return { id }
}

// ─── Revise after a dispute ──────────────────────────────────────────────────

export async function reviseSignoff(id: string): Promise<Result> {
  const profile = await requireRole('admin', 'office')
  if (!UUID.safeParse(id).success) return { error: 'Sign-off not found' }

  const supabase = await createClient()
  const signoff = await loadSignoff(supabase, id)
  if (!signoff) return { error: 'Sign-off not found' }
  if (signoff.status !== 'disputed' && signoff.status !== 'released') {
    return { error: 'Only a released or disputed sign-off can be revised' }
  }

  // A released sheet nobody has answered yet is withdrawn from the client
  // first (one live version per day); a disputed one stays on record until
  // its revision is released.
  if (signoff.status === 'released') {
    const { data: withdrawn, error: wErr } = await supabase
      .from('daily_signoffs')
      .update({ status: 'superseded' })
      .eq('id', id)
      .eq('status', 'released')
      .select('id')
      .maybeSingle()
    if (wErr) return { error: wErr.message }
    if (!withdrawn) return { error: 'The client has just answered this sheet — refresh the page' }
  }

  const [{ data: lines }, { data: response }] = await Promise.all([
    supabase
      .from('daily_signoff_lines')
      .select('id, sort, section, description, qty, unit, detail, scope_label, flags, source')
      .eq('signoff_id', id)
      .order('sort')
      .order('id'),
    supabase.from('daily_signoff_responses').select('disputes').eq('signoff_id', id).maybeSingle(),
  ])
  const disputes = new Map(
    (((response?.disputes as { line_id: string; client_qty: number }[] | null) ?? [])).map((d) => [
      d.line_id,
      Number(d.client_qty),
    ])
  )

  const { data: created, error } = await supabase
    .from('daily_signoffs')
    .insert({
      job_id: signoff.job_id,
      project_id: signoff.project_id,
      date: signoff.date,
      version: signoff.version + 1,
      status: 'draft',
      summary: signoff.summary,
      photo_ids: signoff.photo_ids,
      built_by: profile.id,
      supersedes_id: signoff.id,
      source_hash: signoff.source_hash,
    })
    .select('id')
    .single()
  if (error || !created) {
    return {
      error:
        error?.code === '23505'
          ? 'A revision for this day already exists — refresh the page'
          : (error?.message ?? 'Could not create the revision'),
    }
  }

  const copies = (lines ?? []).map((l) => {
    const clientQty = disputes.get(l.id as string)
    const flags = ((l.flags as string[] | null) ?? []).filter((f) => f !== 'client_figure')
    return {
      signoff_id: created.id as string,
      sort: l.sort,
      section: l.section,
      description: l.description,
      qty: clientQty ?? l.qty,
      unit: l.unit,
      detail: l.detail,
      scope_label: l.scope_label,
      flags: clientQty !== undefined ? [...flags, 'client_figure'] : flags,
      source: { ...((l.source as Record<string, unknown>) ?? {}), revised_from_line: l.id },
    }
  })
  if (copies.length > 0) {
    const { error: linesErr } = await supabase.from('daily_signoff_lines').insert(copies)
    if (linesErr) return { error: linesErr.message }
  }

  revalidateSignoff(signoff)
  return { id: created.id as string }
}
