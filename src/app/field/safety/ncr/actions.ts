'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { nextNumber } from '@/lib/numbering'
import { ncrFieldRaiseSchema } from '@/lib/zod'

type Result = { error?: string; id?: string }

/**
 * Field-side NCR raise (report-only). A field worker reports a problem; it is
 * recorded straight into the NCR register at status 'open' with the next
 * NCR-xxxx number. raised_by = the reporter. Field users do NOT manage CAPA or
 * close NCRs — that is office/supervisor work. Photos attach on the success
 * screen via parent_type 'ncr'. RLS already permits a field insert.
 */
export async function raiseFieldNcr(input: unknown): Promise<Result> {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const parsed = ncrFieldRaiseSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  let number: string
  try {
    number = await nextNumber(supabase, 'ncr')
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Numbering failed' }
  }

  const { data: row, error } = await supabase
    .from('ncrs')
    .insert({
      number,
      source: parsed.data.source,
      // Field reports default to severity 3 (medium) — the office triages.
      severity: 3,
      title: parsed.data.title,
      description: parsed.data.description,
      project_id: parsed.data.project_id,
      raised_by: profile.id,
      status: 'open',
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  revalidatePath('/field/safety')
  return { id: row.id as string }
}
