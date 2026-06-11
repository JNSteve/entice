'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  diarySchema,
  labourRowSchema,
  labourRowUpdateSchema,
  plantRowSchema,
} from '@/lib/zod'

type Result = { error?: string }

/** YYYY-MM-DD for a date offset from today (server local). */
function localDateStr(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function revalidateDiary(projectId: string) {
  revalidatePath(`/field/diary/${projectId}`)
  revalidatePath(`/projects/${projectId}/diary`)
}

// ─── Save (upsert) diary ─────────────────────────────────────────────────────

/**
 * Upserts the diary row for (project, date): inserts with created_by on first
 * save, updates the text fields after that — last write wins. Entries are
 * limited to today and yesterday (backfill).
 */
export async function saveDiary(data: unknown): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const parsed = diarySchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const { project_id, date, weather, work_performed, delays, instructions, visitors } =
    parsed.data

  if (date !== localDateStr(0) && date !== localDateStr(-1)) {
    return { error: 'Diary entries can only be made for today or yesterday.' }
  }

  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, status')
    .eq('id', project_id)
    .single()
  if (!project) return { error: 'Project not found' }
  if (project.status === 'closed') {
    return { error: 'This project is closed — diary entries are no longer accepted.' }
  }

  const fields = {
    weather: weather ?? null,
    work_performed,
    delays: delays ?? null,
    instructions: instructions ?? null,
    visitors: visitors ?? null,
  }

  const { data: existing } = await supabase
    .from('diaries')
    .select('id')
    .eq('project_id', project_id)
    .eq('date', date)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('diaries')
      .update(fields)
      .eq('id', existing.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('diaries').insert({
      project_id,
      date,
      ...fields,
      created_by: profile.id,
    })
    if (error) {
      // Race on unique(project_id, date): another save created the row first —
      // fall through to the update path (last write wins).
      if (error.code === '23505') {
        const { error: updateError } = await supabase
          .from('diaries')
          .update(fields)
          .eq('project_id', project_id)
          .eq('date', date)
        if (updateError) return { error: updateError.message }
      } else {
        return { error: error.message }
      }
    }
  }

  revalidateDiary(project_id)
  return {}
}

// ─── Labour rows ─────────────────────────────────────────────────────────────

export async function addLabourRow(data: unknown): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const parsed = labourRowSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: diary } = await supabase
    .from('diaries')
    .select('id, project_id')
    .eq('id', parsed.data.diary_id)
    .single()
  if (!diary) return { error: 'Diary not found' }

  const { error } = await supabase.from('diary_labour').insert({
    diary_id: parsed.data.diary_id,
    user_id: parsed.data.user_id,
    name: parsed.data.name,
    trade: parsed.data.trade ?? null,
    headcount: parsed.data.headcount,
    hours: parsed.data.hours,
  })
  if (error) return { error: error.message }

  revalidateDiary(diary.project_id)
  return {}
}

export async function updateLabourRow(id: string, data: unknown): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const parsed = labourRowUpdateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: row } = await supabase
    .from('diary_labour')
    .select('id, diaries(project_id)')
    .eq('id', id)
    .single()
  if (!row) return { error: 'Labour row not found' }

  // RLS allows updates by staff or the diary owner; surfaces an error otherwise.
  const { error } = await supabase
    .from('diary_labour')
    .update(parsed.data)
    .eq('id', id)
  if (error) return { error: error.message }

  const diaryRel = row.diaries as unknown as { project_id: string } | null
  if (diaryRel) revalidateDiary(diaryRel.project_id)
  return {}
}

export async function deleteLabourRow(id: string): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()

  const { data: row } = await supabase
    .from('diary_labour')
    .select('id, diaries(project_id)')
    .eq('id', id)
    .single()
  if (!row) return { error: 'Labour row not found' }

  const { error } = await supabase.from('diary_labour').delete().eq('id', id)
  if (error) return { error: error.message }

  const diaryRel = row.diaries as unknown as { project_id: string } | null
  if (diaryRel) revalidateDiary(diaryRel.project_id)
  return {}
}

// ─── Plant rows ──────────────────────────────────────────────────────────────

export async function addPlantRow(data: unknown): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const parsed = plantRowSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: diary } = await supabase
    .from('diaries')
    .select('id, project_id')
    .eq('id', parsed.data.diary_id)
    .single()
  if (!diary) return { error: 'Diary not found' }

  const { error } = await supabase.from('diary_plant').insert({
    diary_id: parsed.data.diary_id,
    plant_id: parsed.data.plant_id,
    name: parsed.data.name,
    status: parsed.data.status,
    hours: parsed.data.hours,
  })
  if (error) return { error: error.message }

  revalidateDiary(diary.project_id)
  return {}
}

export async function deletePlantRow(id: string): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()

  const { data: row } = await supabase
    .from('diary_plant')
    .select('id, diaries(project_id)')
    .eq('id', id)
    .single()
  if (!row) return { error: 'Plant row not found' }

  const { error } = await supabase.from('diary_plant').delete().eq('id', id)
  if (error) return { error: error.message }

  const diaryRel = row.diaries as unknown as { project_id: string } | null
  if (diaryRel) revalidateDiary(diaryRel.project_id)
  return {}
}
