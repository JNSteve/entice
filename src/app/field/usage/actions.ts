'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

type Result = { error?: string }

export type CatalogueHit = {
  id: string
  name: string
  unit: string | null
  kind: string
  supplier: string | null
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const id = z.guid()
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date')
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))

const usageFields = z
  .object({
    kind: z.enum(['material', 'plant', 'subbie']),
    description: z.string().trim().max(300).optional().default(''),
    qty: z.number().min(0, 'Quantity can’t be negative').optional().nullable(),
    unit: optText(20),
    quote_line_id: id.optional().nullable(),
    rate_item_id: id.optional().nullable(),
    plant_id: id.optional().nullable(),
    company: optText(200),
    headcount: z.number().int().min(1).max(500).optional().nullable(),
    hours: z.number().min(0).max(24, 'Hours must be 24 or less').optional().nullable(),
    notes: optText(1000),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'subbie') {
      if (!v.company) ctx.addIssue({ code: 'custom', message: 'Enter the company name' })
      if (v.headcount == null) ctx.addIssue({ code: 'custom', message: 'Enter how many people' })
      if (v.hours == null) ctx.addIssue({ code: 'custom', message: 'Enter the hours' })
    } else {
      if (!v.description) ctx.addIssue({ code: 'custom', message: 'Enter what was used' })
      if (v.qty == null || Number.isNaN(v.qty)) {
        ctx.addIssue({
          code: 'custom',
          message: v.kind === 'plant' ? 'Enter the hours' : 'Enter a quantity',
        })
      }
    }
  })

const addUsageSchema = z
  .object({
    job_id: id.nullable(),
    project_id: id.nullable(),
    date: dateStr,
  })
  .and(usageFields)
  .refine((v) => (v.job_id ? 1 : 0) + (v.project_id ? 1 : 0) === 1, {
    message: 'Pick a job or project',
  })

const dayNoteSchema = z
  .object({
    job_id: id.nullable(),
    project_id: id.nullable(),
    date: dateStr,
    summary: z.string().max(4000, 'Keep it under 4000 characters'),
  })
  .refine((v) => (v.job_id ? 1 : 0) + (v.project_id ? 1 : 0) === 1, {
    message: 'Pick a job or project',
  })

type UsageFields = z.infer<typeof usageFields>

// ─── Helpers ─────────────────────────────────────────────────────────────────

function friendlyError(err: { code?: string; message?: string }): string {
  if (err.code === '42501' || (err.message ?? '').includes('row-level security')) {
    return "You can only change today's or yesterday's entries"
  }
  return err.message || 'Something went wrong'
}

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid data'
}

/** Normalise the per-kind columns so the DB constraints are satisfied. */
function rowFields(v: UsageFields) {
  if (v.kind === 'subbie') {
    return {
      kind: v.kind,
      description: v.company!,
      company: v.company,
      headcount: v.headcount,
      hours: v.hours,
      qty: null,
      unit: null,
      quote_line_id: null,
      rate_item_id: null,
      plant_id: null,
      notes: v.notes,
    }
  }
  return {
    kind: v.kind,
    description: v.description,
    qty: v.qty,
    unit: v.kind === 'plant' ? (v.unit ?? 'hrs') : v.unit,
    quote_line_id: v.kind === 'material' ? (v.quote_line_id ?? null) : null,
    rate_item_id: v.rate_item_id ?? null,
    plant_id: v.kind === 'plant' ? (v.plant_id ?? null) : null,
    company: null,
    headcount: null,
    hours: null,
    notes: v.notes,
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export async function addUsage(input: unknown): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const parsed = addUsageSchema.safeParse(input)
  if (!parsed.success) return { error: firstIssue(parsed.error) }
  const v = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.from('field_usage').insert({
    job_id: v.job_id,
    project_id: v.project_id,
    date: v.date,
    user_id: profile.id,
    ...rowFields(v),
  })
  if (error) return { error: friendlyError(error) }

  revalidatePath('/field/usage')
  return {}
}

export async function updateUsage(usageId: string, input: unknown): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const idParsed = id.safeParse(usageId)
  if (!idParsed.success) return { error: 'Invalid entry' }
  const parsed = usageFields.safeParse(input)
  if (!parsed.success) return { error: firstIssue(parsed.error) }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('field_usage')
    .update(rowFields(parsed.data))
    .eq('id', idParsed.data)
    .select('id')
  if (error) return { error: friendlyError(error) }
  if (!data || data.length === 0) {
    return { error: "You can only change today's or yesterday's entries" }
  }

  revalidatePath('/field/usage')
  return {}
}

export async function deleteUsage(usageId: string): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const idParsed = id.safeParse(usageId)
  if (!idParsed.success) return { error: 'Invalid entry' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('field_usage')
    .delete()
    .eq('id', idParsed.data)
    .select('id')
  if (error) return { error: friendlyError(error) }
  if (!data || data.length === 0) {
    return { error: "You can only change today's or yesterday's entries" }
  }

  revalidatePath('/field/usage')
  return {}
}

export async function saveDayNote(input: unknown): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const parsed = dayNoteSchema.safeParse(input)
  if (!parsed.success) return { error: firstIssue(parsed.error) }
  const v = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.from('field_day_notes').upsert(
    {
      job_id: v.job_id,
      project_id: v.project_id,
      date: v.date,
      summary: v.summary.trim(),
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: v.job_id ? 'job_id,date' : 'project_id,date' }
  )
  if (error) return { error: friendlyError(error) }

  revalidatePath('/field/usage')
  return {}
}

export async function searchCatalogue(q: string): Promise<CatalogueHit[]> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const query = typeof q === 'string' ? q.trim().slice(0, 100) : ''
  if (query.length < 2) return []

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('field_catalogue_search', { p_q: query })
  if (error || !Array.isArray(data)) return []
  return data as CatalogueHit[]
}
